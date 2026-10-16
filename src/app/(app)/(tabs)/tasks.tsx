import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import {
  EmptyState,
  ErrorState,
  IconButton,
  Loading,
  Notice,
  PageHeading,
  Screen,
  SearchField,
} from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, FontWeight, Layout, Spacing } from '@/constants/theme';
import { WorkBoard, ViewSwitch } from '@/components/codevisual/work-board';
import { partitionBoard } from '@/components/codevisual/board-data';
import { jobStatusOf, type JobStatus } from '@/features/tasks/cron';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import { TaskCard } from '@/features/tasks/components/task-card';
import { useCronActions, useCronJobs } from '@/features/tasks/hooks';
import { filterCronJobs, type StatusFilter } from '@/features/tasks/search';
import type { CronJob } from '@/features/tasks/types';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';

/** 定时任务 — a monitoring surface first: status, next run, one-tap enable. */
export default function TasksScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('tasks');
  const { t: tc } = useTranslation('common');
  const wsStatus = useWsStatus();
  const { width } = useWindowDimensions();

  const { jobs, total, activeCount, errorCount, isLoading, error, refresh } = useCronJobs();
  const { setEnabled } = useCronActions();

  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'board'>('board');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const canShowBoard = width >= Layout.sidebarBreakpoint;
  const boardView = canShowBoard && view === 'board';

  const visible = useMemo(() => filterCronJobs(jobs, query, filter), [jobs, query, filter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  const filters: SegmentOption<StatusFilter>[] = [
    { value: 'all', label: t('filter.all'), badge: total },
    { value: 'active', label: t('filter.active'), badge: activeCount },
    { value: 'paused', label: t('filter.paused'), badge: total - activeCount },
  ];
  const columns = partitionBoard(
    visible,
    (['active', 'paused', 'error', 'manual'] as JobStatus[])
      .filter(
        (status) => status !== 'manual' || visible.some((job) => jobStatusOf(job) === 'manual'),
      )
      .map((status) => ({
        key: status,
        title: t(`status.${status}`),
        danger: status === 'error',
      })),
    jobStatusOf,
  );

  const header = (
    <View style={styles.header}>
      <PageHeading
        title={tc('tabs.tasks')}
        onRefresh={onRefresh}
        refreshing={refreshing}
        action={
          <IconButton
            icon="add"
            variant="primary"
            label={t('actions.new')}
            onPress={() => router.push('/task/new')}
          />
        }
      />
      {wsStatus === 'reconnecting' ? (
        <Notice tone="warning" icon="cloud-offline-outline">
          {tc('state.reconnecting')}
        </Notice>
      ) : null}

      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <SearchField
            placeholder={t('searchPlaceholder')}
            value={query}
            onChangeText={setQuery}
            onClear={() => setQuery('')}
            containerStyle={styles.field}
          />
        </View>
        {canShowBoard ? <ViewSwitch value={view} onChange={setView} /> : null}
      </View>

      <SegmentedControl options={filters} value={filter} onChange={setFilter} />
      <View style={styles.hostHint}>
        <Ionicons name="desktop-outline" size={14} color={colors.textSecondary} />
        <Text style={[styles.hostHintText, { color: colors.textSecondary }]}>
          {t('hostAwakeHint')}
        </Text>
      </View>

      {errorCount > 0 ? (
        <Text style={[styles.summary, { color: colors.danger }]}>
          {t('errorSummary', { errors: errorCount })}
        </Text>
      ) : null}
    </View>
  );

  const empty = () => {
    if (isLoading) return <Loading label={tc('state.loading')} />;
    if (error && !jobs.length) {
      return (
        <ErrorState
          message={tc('feedback.networkError')}
          retryLabel={tc('actions.retry')}
          onRetry={onRefresh}
        />
      );
    }
    if (jobs.length) {
      return (
        <EmptyState
          icon="search-outline"
          title={t('empty.noResults')}
          description={t('empty.noResultsHint')}
        />
      );
    }
    return (
      <EmptyState icon="alarm-outline" title={t('empty.title')} description={t('empty.hint')} />
    );
  };

  const renderItem = ({ item }: { item: CronJob }) => (
    <TaskCard
      job={item}
      onPress={() => router.push(`/task/${item.cron_job_id}`)}
      onToggle={(enabled) => void setEnabled(item, enabled)}
    />
  );

  return (
    <Screen scroll={false} padded={false} wide={boardView}>
      {header}
      {boardView && visible.length > 0 ? (
        <View style={styles.board}>
          <WorkBoard
            columns={columns}
            keyExtractor={(job) => job.cron_job_id}
            renderItem={(job) => renderItem({ item: job })}
          />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.cron_job_id}
          renderItem={renderItem}
          ListEmptyComponent={empty}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              showButton={false}
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textTertiary}
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xs,
    paddingBottom: Spacing.xl,
    flexGrow: 1,
  },
  header: { gap: Spacing.sm, padding: Spacing.lg, paddingBottom: Spacing.md },
  searchRow: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center' },
  searchField: { flex: 1, minWidth: 0 },
  field: { marginBottom: 0 },
  board: { flex: 1, minHeight: 0, paddingHorizontal: Spacing.lg },
  hostHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: Spacing.xs,
  },
  hostHintText: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.body,
    lineHeight: 18,
  },
  summary: { fontSize: FontSize.xs },
});
