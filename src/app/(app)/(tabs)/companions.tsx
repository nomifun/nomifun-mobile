/**
 * 桌面伙伴 roster. The desktop keeps a drag-reorderable sidebar here; on a phone
 * the family reads better as a card list, and reordering stays on the desktop.
 */
import { useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Screen } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';
import { CompanionCard } from '@/features/companions/components/companion-card';
import { CreateCompanionSheet } from '@/features/companions/components/create-companion-sheet';
import { useCompanionRoster } from '@/features/companions/hooks';
import { pushPath } from '@/features/companions/navigation';

export default function CompanionsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');
  const wsStatus = useWsStatus();
  const { companions, defaultCompanionId, error, isLoading, refreshing, refresh, mutate } =
    useCompanionRoster();
  const [creating, setCreating] = useState(false);

  const openDetail = (companionId: string) => pushPath(`/companion/${companionId}`);

  const createButton = (
    <Button onPress={() => setCreating(true)}>{t('roster.create')}</Button>
  );

  const sheet = (
    <CreateCompanionSheet
      visible={creating}
      onClose={() => setCreating(false)}
      onCreated={(profile) => {
        setCreating(false);
        void mutate();
        openDetail(profile.companion_id);
      }}
    />
  );

  if (isLoading) {
    return (
      <Screen scroll={false}>
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (error && companions.length === 0) {
    return (
      <Screen scroll={false}>
        <ErrorState
          message={error instanceof Error ? error.message : t('roster.loadFailed')}
          onRetry={refresh}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  return (
    <Screen
      scroll={false}
      padded={false}
      footer={companions.length > 0 ? <View style={styles.footer}>{createButton}</View> : undefined}
    >
      <FlatList
        data={companions}
        keyExtractor={(item) => item.companion_id}
        contentContainerStyle={[styles.list, companions.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
          />
        }
        ListHeaderComponent={
          companions.length > 0 ? (
            <View style={styles.header}>
              <Text style={[styles.count, { color: colors.textTertiary }]}>
                {t('roster.count', { count: companions.length })}
              </Text>
              {wsStatus !== 'open' ? (
                <View style={[styles.live, { backgroundColor: colors.warningSoft }]}>
                  <Ionicons name="cloud-offline-outline" size={12} color={colors.warning} />
                  <Text style={[styles.liveText, { color: colors.warning }]}>
                    {wsStatus === 'reconnecting' || wsStatus === 'connecting'
                      ? t('roster.wsReconnecting')
                      : t('roster.wsOffline')}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="sparkles-outline"
            title={t('roster.emptyTitle')}
            description={t('roster.emptyHint')}
            action={createButton}
          />
        }
        renderItem={({ item }) => (
          <CompanionCard
            companion={item}
            isDefault={item.companion_id === defaultCompanionId}
            onPress={() => openDetail(item.companion_id)}
          />
        )}
      />
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing.sm },
  listEmpty: { flexGrow: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  count: { fontSize: FontSize.sm, fontWeight: '500' },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  liveText: { fontSize: FontSize.xs, fontWeight: '600' },
  footer: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg, paddingTop: Spacing.sm },
});
