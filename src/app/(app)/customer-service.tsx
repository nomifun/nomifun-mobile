/**
 * 客服花名册 — opened from the 我的 tab.
 *
 * Read-first: the trust banner states the domain's security promise, then one
 * card per 客服员工. The single primary action is 创建客服 (name only; the rest
 * is configured on the detail screen).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, EmptyState, ErrorState, Loading, Screen, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWsTopic } from '@/hooks/use-ws';
import { AgentCard, CreateAgentSheet, TrustBanner, useCsAgents } from '@/features/customerService';

export default function CustomerServiceScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const { agents, isLoading, error, refresh, create } = useCsAgents();

  const [creating, setCreating] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // No customer-service WS events exist; the only realtime signal that matters
  // is "the socket came back, your cache may be stale".
  useWsTopic('ws.reconnected', () => void refresh());

  const onRefresh = () => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  };

  const submitCreate = async (name: string) => {
    const agent = await create(name);
    setCreating(false);
    toast.success(t('create.done'));
    router.push({ pathname: '/cs-agent/[id]', params: { id: agent.cs_agent_id } });
  };

  const createButton = (
    <Button onPress={() => setCreating(true)}>{t('create.action')}</Button>
  );

  const body = () => {
    if (isLoading && agents.length === 0) return <Loading label={tc('state.loading')} />;
    if (error && agents.length === 0) {
      return (
        <ErrorState
          message={error.message || tc('feedback.requestFailed')}
          onRetry={onRefresh}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    if (agents.length === 0) {
      return (
        <EmptyState
          icon="headset-outline"
          title={t('empty.title')}
          description={t('empty.desc')}
          action={<Button onPress={() => setCreating(true)}>{t('empty.action')}</Button>}
        />
      );
    }
    return (
      <View style={styles.list}>
        <Text style={[styles.count, { color: colors.textTertiary }]}>
          {t('roster.count', { count: agents.length })}
        </Text>
        {agents.map((agent) => (
          <AgentCard
            key={agent.cs_agent_id}
            agent={agent}
            modelLabel={agent.model ?? undefined}
            onPress={() =>
              router.push({ pathname: '/cs-agent/[id]', params: { id: agent.cs_agent_id } })
            }
          />
        ))}
      </View>
    );
  };

  return (
    <Screen
      refreshing={refreshing}
      onRefresh={onRefresh}
      footer={
        agents.length > 0 ? (
          <View
            style={[
              styles.footer,
              {
                borderTopColor: colors.border,
                backgroundColor: colors.surface,
                paddingBottom: Math.max(insets.bottom, Spacing.lg),
              },
            ]}
          >
            {createButton}
          </View>
        ) : null
      }
    >
      <Stack.Screen options={{ title: t('title') }} />

      <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{t('subtitle')}</Text>
      <TrustBanner />
      {body()}

      <CreateAgentSheet
        visible={creating}
        onClose={() => setCreating(false)}
        onSubmit={submitCreate}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  subtitle: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.lg },
  list: { marginTop: Spacing.xl },
  count: { fontSize: FontSize.xs, marginBottom: Spacing.sm },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
  },
});
