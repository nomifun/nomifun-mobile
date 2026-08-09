/**
 * One companion: 总览 / 记忆 / 设置. The desktop workspace has seven tabs; the
 * phone keeps the three that read well on a small screen and points at the
 * desktop for the rest (figure library, models, knowledge bases, migration).
 */
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, Loading, Screen } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { MemoryTab } from '@/features/companions/components/memory-tab';
import { OverviewTab } from '@/features/companions/components/overview-tab';
import { Segmented, type SegmentItem } from '@/features/companions/components/segmented';
import { SettingsTab } from '@/features/companions/components/settings-tab';
import { useCompanionDetail } from '@/features/companions/hooks';

type TabKey = 'overview' | 'memory' | 'settings';

export default function CompanionDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const companionId = typeof params.id === 'string' ? params.id : '';
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');
  const [tab, setTab] = useState<TabKey>('overview');

  const detail = useCompanionDetail(companionId);
  const companion = detail.companion;

  const tabs = useMemo<SegmentItem<TabKey>[]>(
    () => [
      { key: 'overview', label: t('tabs.overview') },
      { key: 'memory', label: t('tabs.memory') },
      { key: 'settings', label: t('tabs.settings') },
    ],
    [t],
  );

  const header = (
    <Stack.Screen options={{ title: companion?.name ?? t('title') }} />
  );

  if (detail.isLoading) {
    return (
      <Screen scroll={false}>
        {header}
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (detail.error && !companion) {
    return (
      <Screen scroll={false}>
        {header}
        <ErrorState
          message={detail.error instanceof Error ? detail.error.message : t('detail.loadFailed')}
          onRetry={detail.refresh}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  if (!companion) {
    return (
      <Screen scroll={false}>
        {header}
        <EmptyState
          icon="help-circle-outline"
          title={t('detail.notFound')}
          description={t('detail.notFoundHint')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      {header}
      <View style={styles.tabBar}>
        <Segmented items={tabs} value={tab} onChange={setTab} />
      </View>

      <View style={styles.body}>
        {tab === 'overview' ? (
          <OverviewTab
            companion={companion}
            learning={detail.learning}
            setLearning={detail.setLearning}
            refreshProfile={() => detail.mutate()}
          />
        ) : null}
        {tab === 'memory' ? <MemoryTab companionId={companionId} /> : null}
        {tab === 'settings' ? (
          <SettingsTab
            companion={companion}
            refreshProfile={() => detail.mutate()}
            refreshing={detail.refreshing}
            onRefresh={detail.refresh}
            onDeleted={() => router.back()}
          />
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabBar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.xs },
  body: { flex: 1 },
});
