import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Screen, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { SegmentedPills, type PillOption } from '@/features/tasks/components/segmented-pills';
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

  const { jobs, total, activeCount, errorCount, isLoading, error, refresh } = useCronJobs();
  const { setEnabled } = useCronActions();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [refreshing, setRefreshing] = useState(false);

  const visible = useMemo(() => filterCronJobs(jobs, query, filter), [jobs, query, filter]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  const filters: PillOption<StatusFilter>[] = [
    { value: 'all', label: t('filter.all'), badge: total },
    { value: 'active', label: t('filter.active'), badge: activeCount },
    { value: 'paused', label: t('filter.paused'), badge: total - activeCount },
  ];

  const header = (
    <View style={styles.header}>
      {wsStatus === 'reconnecting' ? (
        <View style={[styles.banner, { backgroundColor: colors.warningSoft }]}>
          <Ionicons name="cloud-offline-outline" size={14} color={colors.warning} />
          <Text style={[styles.bannerText, { color: colors.warning }]}>
            {tc('state.reconnecting')}
          </Text>
        </View>
      ) : null}

      <View style={[styles.banner, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="desktop-outline" size={14} color={colors.textTertiary} />
        <Text style={[styles.bannerText, { color: colors.textSecondary }]}>
          {t('hostAwakeHint')}
        </Text>
      </View>

      <TextField
        placeholder={t('searchPlaceholder')}
        value={query}
        onChangeText={setQuery}
        returnKeyType="search"
        clearButtonMode="while-editing"
      />

      <SegmentedPills options={filters} value={filter} onChange={setFilter} />

      <View style={styles.summaryRow}>
        <Text style={[styles.summary, { color: colors.textTertiary }]}>
          {t('summary', { total, active: activeCount })}
        </Text>
        {errorCount > 0 ? (
          <Text style={[styles.summary, { color: colors.danger }]}>
            {t('errorSummary', { errors: errorCount })}
          </Text>
        ) : null}
      </View>
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
    <Screen
      scroll={false}
      padded={false}
      footer={
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button onPress={() => router.push('/task/new')}>{t('actions.new')}</Button>
        </View>
      }
    >
      <FlatList
        data={visible}
        keyExtractor={(item) => item.cron_job_id}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.textTertiary}
          />
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing.xl, flexGrow: 1 },
  header: { gap: Spacing.md, marginBottom: Spacing.lg },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  bannerText: { fontSize: FontSize.xs, flex: 1, lineHeight: 16 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.sm },
  summary: { fontSize: FontSize.xs },
  footer: { padding: Spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
