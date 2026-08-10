/**
 * 客服详情 — three segments instead of the desktop's dense two-column grid:
 *
 * - 配置: 模型与知识库 (PATCHes immediately) + 身份与话术 (draft + explicit 保存)
 *   + 渠道机器人 (read-only) + 删除.
 * - 笔记: FAQ / 话术 / 业务事实 CRUD.
 * - 对话: read-only visitor transcripts (poll on demand — no WS events exist).
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import { Button, Card, EmptyState, ErrorState, Loading, Screen, SectionTitle, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useWsTopic } from '@/hooks/use-ws';
import {
  AgentHero,
  BotsCard,
  DialoguesPanel,
  IdentityCard,
  ModelKnowledgeCard,
  NotesPanel,
  Segments,
  confirmDestructive,
  csKeys,
  modelLabelOf,
  useChatModels,
  useCsAgent,
  type SegmentOption,
} from '@/features/customerService';

type Tab = 'config' | 'notes' | 'dialogues';

export default function CsAgentDetailScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const { mutate } = useSWRConfig();

  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = Array.isArray(params.id) ? params.id[0] : params.id;
  const agentId = rawId && rawId.length > 0 ? rawId : undefined;

  const { agent, isLoading, error, refresh, patch, remove } = useCsAgent(agentId);
  const models = useChatModels();

  const [tab, setTab] = useState<Tab>('config');
  const [refreshing, setRefreshing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const refreshAll = () => {
    setRefreshing(true);
    const jobs: Promise<unknown>[] = [refresh(), models.refresh()];
    if (agentId) {
      jobs.push(mutate(csKeys.notes(agentId)), mutate(csKeys.dialogues(agentId)));
    }
    jobs.push(mutate(csKeys.channelPlugins));
    void Promise.all(jobs).finally(() => setRefreshing(false));
  };

  // No CS-specific topics exist. `channel.plugin-status-changed` keeps the bot
  // card honest; `ws.reconnected` means "refetch everything".
  useWsTopic(['ws.reconnected', 'channel.plugin-status-changed'], () => {
    void refresh();
    void mutate(csKeys.channelPlugins);
  });

  const confirmDelete = () => {
    confirmDestructive({
      title: t('detail.delete'),
      message: t('detail.deleteConfirm'),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        setDeleting(true);
        void remove()
          .then(() => {
            toast.success(t('detail.deleted'));
            // Deep-linked / refreshed pages have no history entry to pop, and
            // staying on a deleted agent's config screen is a dead end.
            if (router.canGoBack()) router.back();
            else router.replace('/customer-service');
          })
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
          })
          .finally(() => setDeleting(false));
      },
    });
  };

  const tabs: SegmentOption<Tab>[] = [
    { value: 'config', label: t('tabs.config') },
    { value: 'notes', label: t('tabs.notes') },
    { value: 'dialogues', label: t('tabs.dialogues') },
  ];

  if (!agentId) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('title') }} />
        <EmptyState icon="help-circle-outline" title={t('detail.notFound')} />
      </Screen>
    );
  }

  if (isLoading && !agent) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('title') }} />
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (!agent) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('title') }} />
        {error ? (
          <ErrorState
            message={error.message || t('detail.notFound')}
            onRetry={() => void refresh()}
            retryLabel={tc('actions.retry')}
          />
        ) : (
          <EmptyState icon="help-circle-outline" title={t('detail.notFound')} />
        )}
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={refreshAll}>
      <Stack.Screen options={{ title: agent.name || t('title') }} />

      <AgentHero
        agent={agent}
        modelLabel={modelLabelOf(agent, models.providerName)}
        patch={patch}
      />

      <View style={styles.segments}>
        <Segments value={tab} options={tabs} onChange={setTab} />
      </View>

      {tab === 'config' ? (
        <>
          <SectionTitle>{t('sections.modelKnowledge')}</SectionTitle>
          <ModelKnowledgeCard agent={agent} patch={patch} />

          <SectionTitle>{t('sections.identity')}</SectionTitle>
          <IdentityCard agent={agent} patch={patch} />

          <SectionTitle>{t('sections.bindings')}</SectionTitle>
          <BotsCard csAgentId={agent.cs_agent_id} />

          <SectionTitle>{t('sections.danger')}</SectionTitle>
          <Card>
            <Text style={[styles.dangerText, { color: colors.textSecondary }]}>
              {t('detail.deleteConfirm')}
            </Text>
            <Button variant="danger" onPress={confirmDelete} loading={deleting}>
              {t('detail.delete')}
            </Button>
          </Card>
        </>
      ) : null}

      {tab === 'notes' ? (
        <View style={styles.panel}>
          <NotesPanel csAgentId={agent.cs_agent_id} />
        </View>
      ) : null}

      {tab === 'dialogues' ? (
        <View style={styles.panel}>
          <DialoguesPanel csAgentId={agent.cs_agent_id} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  segments: { marginTop: Spacing.lg },
  panel: { marginTop: Spacing.xl },
  dangerText: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.md },
});
