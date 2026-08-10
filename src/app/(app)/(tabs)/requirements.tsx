import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Screen, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Radius, Spacing } from '@/constants/theme';
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
import type { Requirement, StatusFilter } from '@/features/requirements/types';
import { confirmAction } from '@/features/requirements/utils';

const PAGE_STEP = 20;

export default function RequirementsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');

  const [status, setStatus] = useState<StatusFilter>('all');
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
          router.push({ pathname: '/requirement/[id]', params: { id: item.requirement_id } });
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
        {/* Long-press is the only entry into multi-select, so say so once. */}
        {selectionActive ? null : (
          <Text style={[styles.footerText, { color: colors.textTertiary }]}>
            {t('list.selectHint')}
          </Text>
        )}
      </View>
    );
  };

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.filters}>
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
            <StatusFilterBar
              value={status}
              counts={counts}
              onChange={(next) => {
                setStatus(next);
                resetPaging();
              }}
            />
          </>
        )}
        {wsStatus === 'reconnecting' ? (
          <Text style={[styles.wsHint, { color: colors.warning }]}>{t('list.wsOffline')}</Text>
        ) : null}
      </View>

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
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.textTertiary}
          />
        }
      />

      {selectionActive ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('list.new')}
          onPress={openCreate}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 },
          ]}
        >
          <Ionicons name="add" size={28} color="#FFFFFF" />
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  filters: { paddingTop: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.sm },
  wsHint: { fontSize: FontSize.xs, paddingHorizontal: Spacing.lg },
  list: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingBottom: 96, paddingTop: Spacing.xs },
  footer: { alignItems: 'center', paddingVertical: Spacing.lg, gap: Spacing.sm },
  footerText: { fontSize: FontSize.xs },
  fab: {
    position: 'absolute',
    right: Spacing.lg,
    bottom: Spacing.lg,
    width: 56,
    height: 56,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
});
