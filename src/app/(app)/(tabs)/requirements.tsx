import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Loading,
  Notice,
  PageHeading,
  Screen,
  toast,
} from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Spacing } from '@/constants/theme';
import { WorkBoard, ViewSwitch } from '@/components/codevisual/work-board';
import { partitionBoard } from '@/components/codevisual/board-data';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';
import {
  MAX_PAGE_SIZE,
  batchDeleteRequirements,
  requirementKey,
  type ListRequirementsParams,
} from '@/features/requirements/api';
import { PausedBanner } from '@/features/requirements/components/paused-banner';
import { RequirementRow } from '@/features/requirements/components/requirement-row';
import { SelectionBar } from '@/features/requirements/components/selection-bar';
import { StatusFilterBar } from '@/features/requirements/components/status-filter-bar';
import { TagStrip } from '@/features/requirements/components/tag-strip';
import {
  useInvalidateRequirements,
  useRequirementList,
  useRequirementTags,
  useRequirementsLive,
} from '@/features/requirements/hooks';
import {
  NO_SELECTION,
  allSelected as allVisibleSelected,
  beginSelection,
  isSelected,
  pruneSelection,
  toggleAll,
  toggleSelection,
  type SelectionState,
} from '@/features/requirements/selection';
import {
  REQUIREMENT_STATUSES,
  type Requirement,
  type StatusFilter,
} from '@/features/requirements/types';
import { confirmAction } from '@/features/requirements/utils';

const PAGE_STEP = 20;

export default function RequirementsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [view, setView] = useState<'list' | 'board'>('board');
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [pageSize, setPageSize] = useState(PAGE_STEP);
  const [refreshing, setRefreshing] = useState(false);
  const [selection, setSelection] = useState<SelectionState>(NO_SELECTION);
  const [deleting, setDeleting] = useState(false);

  // requirement.* / autowork.* / ws.reconnected → invalidate every list page.
  useRequirementsLive();
  const invalidate = useInvalidateRequirements();

  const params: ListRequirementsParams = {
    tag,
    status: status === 'all' ? undefined : status,
    order_by: 'updated_at',
    order: 'desc',
    page_size: pageSize,
  };
  const list = useRequirementList(params);
  const tags = useRequirementTags();
  const wsStatus = useWsStatus();

  const items = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const tagSummaries = tags.data ?? [];
  const filtered = status !== 'all' || tag !== undefined;
  const columns = partitionBoard(
    items,
    REQUIREMENT_STATUSES.filter((value) => status === 'all' || status === value).map((value) => ({
      key: value,
      title: t(`status.${value}`),
      danger: value === 'failed',
    })),
    (item) => item.status,
  );

  const counts = useMemo(() => {
    const scope = tag ? tagSummaries.filter((item) => item.tag === tag) : tagSummaries;
    const acc: Partial<Record<StatusFilter, number>> = {
      all: 0,
      pending: 0,
      in_progress: 0,
      needs_review: 0,
      done: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const summary of scope) {
      acc.all = (acc.all ?? 0) + summary.total;
      acc.pending = (acc.pending ?? 0) + summary.pending;
      acc.in_progress = (acc.in_progress ?? 0) + summary.in_progress;
      acc.needs_review = (acc.needs_review ?? 0) + summary.needs_review;
      acc.done = (acc.done ?? 0) + summary.done;
      acc.failed = (acc.failed ?? 0) + summary.failed;
      acc.cancelled = (acc.cancelled ?? 0) + summary.cancelled;
    }
    return acc;
  }, [tagSummaries, tag]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([list.mutate(), tags.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [list, tags]);

  const resetPaging = () => setPageSize(PAGE_STEP);

  const visibleIds = useMemo(() => items.map((item) => item.requirement_id), [items]);
  const loaded = list.data !== undefined;

  // Rows deleted from any surface (or filtered away) must leave the batch, or
  // the count would promise a delete that cannot happen. Skipped while the list
  // is unloaded — a filter/page-size switch empties `items` for one tick and
  // would otherwise wipe the selection.
  useEffect(() => {
    if (!loaded) return;
    setSelection((current) => pruneSelection(current, visibleIds));
  }, [loaded, visibleIds]);

  const selectionActive = selection.active;
  const selectedCount = selection.ids.length;

  const confirmBatchDelete = useCallback(() => {
    const ids = [...selection.ids];
    if (ids.length === 0) return;
    confirmAction({
      title: t('select.deleteTitle', { count: ids.length }),
      message: `${t('select.deleteBody', { count: ids.length })}\n${tc('confirm.irreversible')}`,
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      destructive: true,
      onConfirm: () => {
        setDeleting(true);
        void (async () => {
          try {
            const result = await batchDeleteRequirements(ids);
            setSelection(NO_SELECTION);
            toast.success(t('select.deleted', { count: result.deleted }));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
          } finally {
            setDeleting(false);
            // Authoritative refetch either way: a partial batch still deleted
            // some rows, and a failed one must not leave phantom gaps.
            invalidate(ids.map((id) => requirementKey(id)));
          }
        })();
      },
    });
  }, [invalidate, selection.ids, t, tc]);

  /** Creating from a filtered view pre-fills that queue's tag. */
  const openCreate = useCallback(() => {
    router.push({ pathname: '/requirement/new', params: tag ? { tag } : {} });
  }, [tag]);

  const renderItem = useCallback(
    ({ item }: { item: Requirement }) => (
      <RequirementRow
        item={item}
        selecting={selectionActive}
        selected={isSelected(selection, item.requirement_id)}
        onPress={() => {
          // In select mode a tap toggles instead of navigating.
          if (selectionActive) {
            setSelection((current) => toggleSelection(current, item.requirement_id));
            return;
          }
          router.push({
            pathname: '/requirement/[id]',
            params: { id: item.requirement_id },
          });
        }}
        onLongPress={() => {
          if (deleting) return;
          setSelection((current) =>
            current.active
              ? toggleSelection(current, item.requirement_id)
              : beginSelection(item.requirement_id),
          );
        }}
      />
    ),
    [deleting, selection, selectionActive],
  );

  const empty = () => {
    if (list.isLoading) return <Loading label={tc('state.loading')} />;
    if (list.error) {
      return (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : tc('feedback.requestFailed')}
          retryLabel={tc('actions.retry')}
          onRetry={() => void list.mutate()}
        />
      );
    }
    if (filtered) {
      return (
        <EmptyState
          icon="funnel-outline"
          title={t('list.emptyFiltered')}
          description={t('list.emptyFilteredHint')}
          action={
            <Button
              variant="secondary"
              onPress={() => {
                setStatus('all');
                setTag(undefined);
                resetPaging();
              }}
            >
              {t('list.clearFilters')}
            </Button>
          }
        />
      );
    }
    return (
      <EmptyState
        icon="clipboard-outline"
        title={t('list.empty')}
        description={t('list.emptyHint')}
        action={<Button onPress={openCreate}>{t('list.new')}</Button>}
      />
    );
  };

  const footer = () => {
    if (items.length === 0) return null;
    return (
      <View style={styles.footer}>
        {items.length < total && pageSize < MAX_PAGE_SIZE ? (
          <Button
            variant="secondary"
            small
            loading={list.isValidating}
            onPress={() => setPageSize((size) => Math.min(size + PAGE_STEP, MAX_PAGE_SIZE))}
          >
            {t('list.loadMore')}
          </Button>
        ) : (
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            {items.length < total
              ? t('list.tooMany', { count: items.length })
              : t('list.loadedAll', { count: total })}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Screen scroll={false} padded={false} wide={view === 'board' && !selectionActive}>
      <View style={styles.filters}>
        <View style={styles.heading}>
          <PageHeading
            title={tc('tabs.requirements')}
            onRefresh={() => void refresh()}
            refreshing={refreshing}
            action={
              selectionActive ? undefined : (
                <View style={styles.headingActions}>
                  {items.length > 0 ? (
                    <IconButton
                      icon="checkbox-outline"
                      label={t('select.start')}
                      onPress={() => setSelection({ active: true, ids: [] })}
                    />
                  ) : null}
                  <IconButton
                    icon="add"
                    variant="primary"
                    label={t('list.new')}
                    onPress={openCreate}
                  />
                </View>
              )
            }
          />
        </View>
        {selectionActive ? (
          <SelectionBar
            count={selectedCount}
            allSelected={allVisibleSelected(selection, visibleIds)}
            busy={deleting}
            onToggleAll={() => setSelection((current) => toggleAll(current, visibleIds))}
            onDelete={confirmBatchDelete}
            onCancel={() => setSelection(NO_SELECTION)}
          />
        ) : (
          <>
            <TagStrip
              tags={tagSummaries}
              selected={tag}
              onSelect={(next) => {
                setTag(next);
                resetPaging();
              }}
            />
            <View style={styles.viewRow}>
              <View style={styles.filterField}>
                <StatusFilterBar
                  value={status}
                  counts={counts}
                  onChange={(next) => {
                    setStatus(next);
                    resetPaging();
                  }}
                />
              </View>
              <ViewSwitch value={view} onChange={setView} />
            </View>
          </>
        )}
        {wsStatus === 'reconnecting' ? (
          <View style={styles.wsBanner}>
            <Notice tone="warning" icon="cloud-offline-outline">
              {t('list.wsOffline')}
            </Notice>
          </View>
        ) : null}
      </View>

      {view === 'board' && !selectionActive && items.length > 0 ? (
        <>
          <View style={styles.board}>
            <PausedBanner tags={tagSummaries} selectedTag={tag} />
            <WorkBoard
              columns={columns}
              keyExtractor={(item) => item.requirement_id}
              renderItem={(item) => renderItem({ item })}
            />
          </View>
          {footer()}
        </>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(item) => item.requirement_id}
          renderItem={renderItem}
          style={styles.fill}
          contentContainerStyle={styles.list}
          ListHeaderComponent={<PausedBanner tags={tagSummaries} selectedTag={tag} />}
          ListEmptyComponent={empty()}
          ListFooterComponent={footer()}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              showButton={false}
              refreshing={refreshing}
              onRefresh={() => void refresh()}
              tintColor={colors.textTertiary}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  board: { flex: 1, minHeight: 0, paddingHorizontal: Spacing.lg },
  viewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingRight: Spacing.lg,
  },
  filterField: { flex: 1, minWidth: 0 },
  heading: { paddingHorizontal: Spacing.lg },
  headingActions: { flexDirection: 'row', gap: Spacing.xs },
  filters: {
    paddingTop: Spacing.md,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  wsBanner: { paddingHorizontal: Spacing.lg },
  list: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
    paddingTop: Spacing.sm,
  },
  footer: {
    alignItems: 'center',
    paddingVertical: Spacing.lg,
    gap: Spacing.sm,
  },
  footerText: { fontSize: FontSize.xs },
});
