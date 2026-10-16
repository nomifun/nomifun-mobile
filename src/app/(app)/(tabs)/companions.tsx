/**
 * 桌面伙伴 roster. The desktop keeps a drag-reorderable sidebar here; on a phone
 * the family reads better as a card list, and reordering stays on the desktop.
 */
import { useState } from 'react';
import { FlatList, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Loading,
  PageHeading,
  Screen,
} from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Layout, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
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
  const { width } = useWindowDimensions();
  const contentWidth =
    Math.min(
      width - (width >= Layout.sidebarBreakpoint ? Layout.sidebarWidth : 0),
      MaxContentWidth,
    ) -
    Spacing.lg * 2;
  const columns = contentWidth >= 700 ? 3 : contentWidth >= 320 ? 2 : 1;
  const tileWidth = (contentWidth - (columns - 1) * Spacing.md) / columns;

  const openDetail = (companionId: string) => pushPath(`/companion/${companionId}`);

  const createButton = (
    <Button icon="add" onPress={() => setCreating(true)}>
      {t('roster.create')}
    </Button>
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
        <View style={styles.loadingHeading}>
          <PageHeading title={tc('tabs.companions')} />
        </View>
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (error && companions.length === 0) {
    return (
      <Screen scroll={false}>
        <View style={styles.loadingHeading}>
          <PageHeading title={tc('tabs.companions')} />
        </View>
        <ErrorState
          message={error instanceof Error ? error.message : t('roster.loadFailed')}
          onRetry={refresh}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false} padded={false}>
      <View style={styles.toolbar}>
        <PageHeading
          title={tc('tabs.companions')}
          onRefresh={refresh}
          refreshing={refreshing}
          action={
            <IconButton
              icon="add"
              variant="primary"
              label={t('roster.create')}
              onPress={() => setCreating(true)}
            />
          }
        />
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
      <FlatList
        key={columns}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
        data={companions}
        keyExtractor={(item) => item.companion_id}
        contentContainerStyle={[styles.list, companions.length === 0 && styles.listEmpty]}
        refreshControl={
          <RefreshControl
            showButton={false}
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={colors.textTertiary}
          />
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
          <View style={{ width: tileWidth, marginBottom: Spacing.md }}>
            <CompanionCard
              companion={item}
              isDefault={item.companion_id === defaultCompanionId}
              onPress={() => openDetail(item.companion_id)}
            />
          </View>
        )}
      />
      {sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.lg },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.sm },
  listEmpty: { flexGrow: 1 },
  gridRow: { gap: Spacing.md },
  loadingHeading: { padding: Spacing.lg },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  liveText: { fontSize: FontSize.xs, fontWeight: '600' },
});
