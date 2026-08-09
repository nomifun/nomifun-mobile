import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Screen } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';
import { MAX_PAGE_SIZE, type ListRequirementsParams } from '@/features/requirements/api';
import { PausedBanner } from '@/features/requirements/components/paused-banner';
import { RequirementRow } from '@/features/requirements/components/requirement-row';
import { StatusFilterBar } from '@/features/requirements/components/status-filter-bar';
import { TagStrip } from '@/features/requirements/components/tag-strip';
import {
  useRequirementList,
  useRequirementTags,
  useRequirementsLive,
} from '@/features/requirements/hooks';
import type { Requirement, StatusFilter } from '@/features/requirements/types';

const PAGE_STEP = 20;

export default function RequirementsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');

  const [status, setStatus] = useState<StatusFilter>('all');
  const [tag, setTag] = useState<string | undefined>(undefined);
  const [pageSize, setPageSize] = useState(PAGE_STEP);
  const [refreshing, setRefreshing] = useState(false);

  // requirement.* / autowork.* / ws.reconnected → invalidate every list page.
  useRequirementsLive();

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

  /** Creating from a filtered view pre-fills that queue's tag. */
  const openCreate = useCallback(() => {
    router.push({ pathname: '/requirement/new', params: tag ? { tag } : {} });
  }, [tag]);

  const renderItem = useCallback(
    ({ item }: { item: Requirement }) => (
      <RequirementRow
        item={item}
        onPress={() =>
          router.push({ pathname: '/requirement/[id]', params: { id: item.requirement_id } })
        }
      />
    ),
    [],
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
    if (items.length < total && pageSize < MAX_PAGE_SIZE) {
      return (
        <View style={styles.footer}>
          <Button
            variant="secondary"
            small
            loading={list.isValidating}
            onPress={() => setPageSize((size) => Math.min(size + PAGE_STEP, MAX_PAGE_SIZE))}
          >
            {t('list.loadMore')}
          </Button>
        </View>
      );
    }
    return (
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: colors.textTertiary }]}>
          {items.length < total
            ? t('list.tooMany', { count: items.length })
            : t('list.loadedAll', { count: total })}
        </Text>
      </View>
    );
  };

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.filters}>
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  filters: { paddingTop: Spacing.md, gap: Spacing.sm, paddingBottom: Spacing.sm },
  wsHint: { fontSize: FontSize.xs, paddingHorizontal: Spacing.lg },
  list: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingBottom: 96, paddingTop: Spacing.xs },
  footer: { alignItems: 'center', paddingVertical: Spacing.lg },
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
