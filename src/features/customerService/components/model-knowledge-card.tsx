/**
 * 模型与知识库 — every control here PATCHes immediately (the desktop does the
 * same). Provider changes send `{provider_id, model: null}` because a model
 * from the old provider must not survive the switch: `model` is double-Option
 * server-side, so an explicit null is the only way to clear it.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Card, Tag, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useChatModels, useKnowledgeBases } from '../hooks';
import { MAX_MAX_CONCURRENT, MIN_MAX_CONCURRENT } from '../normalize';
import type { CsAgent, CsAgentPatch } from '../types';
import { SettingRow, Stepper } from './controls';
import { PickSheet } from './pick-sheet';

type OpenPicker = 'provider' | 'model' | 'knowledge' | null;

export function ModelKnowledgeCard({
  agent,
  patch,
}: {
  agent: CsAgent;
  patch: (next: CsAgentPatch) => Promise<CsAgent>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const [picker, setPicker] = useState<OpenPicker>(null);

  const models = useChatModels();
  const knowledge = useKnowledgeBases();

  const run = (next: CsAgentPatch) => {
    void patch(next).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
    });
  };

  const providerName = models.providerName(agent.provider_id);
  const providerLabel = agent.provider_id
    ? (providerName ?? t('fields.providerMissing'))
    : undefined;
  const providerModels = models.modelsOf(agent.provider_id);
  const modelOptions = agent.model && !providerModels.includes(agent.model)
    ? [agent.model, ...providerModels]
    : providerModels;

  const mountedBases = agent.knowledge_base_ids;

  const toggleBase = (id: string) => {
    const next = mountedBases.includes(id)
      ? mountedBases.filter((base) => base !== id)
      : [...mountedBases, id];
    run({ knowledge_base_ids: next });
  };

  return (
    <Card>
      <SettingRow
        label={t('fields.provider')}
        value={providerLabel}
        placeholder={models.isLoading ? tc('state.loading') : t('fields.providerPlaceholder')}
        onPress={() => setPicker('provider')}
      />
      <SettingRow
        label={t('fields.model')}
        value={agent.model ?? undefined}
        placeholder={
          agent.provider_id ? t('fields.modelPlaceholder') : t('fields.modelNeedsProvider')
        }
        disabled={!agent.provider_id}
        onPress={() => setPicker('model')}
      />
      <SettingRow
        label={t('fields.knowledgeBases')}
        value={
          mountedBases.length > 0
            ? t('detail.knowledgeBasesMountedCount', { count: mountedBases.length })
            : undefined
        }
        placeholder={t('detail.knowledgeBasesPlaceholder')}
        onPress={() => setPicker('knowledge')}
      />

      {mountedBases.length > 0 ? (
        <View style={styles.tags}>
          {mountedBases.map((id) => (
            <Tag key={id} tone="primary">
              {knowledge.nameOf(id) ?? t('fields.knowledgeBaseMissing')}
            </Tag>
          ))}
        </View>
      ) : null}

      <View style={[styles.divider, { borderTopColor: colors.border }]}>
        <Stepper
          label={t('fields.maxConcurrent')}
          hint={t('fields.maxConcurrentHint')}
          value={agent.max_concurrent}
          min={MIN_MAX_CONCURRENT}
          max={MAX_MAX_CONCURRENT}
          onChange={(value) => run({ max_concurrent: value })}
        />
      </View>

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        {t('fields.knowledgeFootnote')}
      </Text>

      <PickSheet
        visible={picker === 'provider'}
        title={t('fields.provider')}
        subtitle={t('fields.providerSheetHint')}
        items={models.groups.map((group) => ({
          id: group.provider.provider_id,
          title: group.provider.name,
          subtitle: t('fields.modelCount', { count: group.models.length }),
        }))}
        selected={agent.provider_id ? [agent.provider_id] : []}
        emptyText={t('fields.noProviders')}
        clearOption={{ title: t('fields.clearProvider'), subtitle: t('card.noModel') }}
        onPick={(id) =>
          // Clearing or switching provider always clears the model explicitly.
          run(id ? { provider_id: id, model: null } : { provider_id: null, model: null })
        }
        onClose={() => setPicker(null)}
      />

      <PickSheet
        visible={picker === 'model'}
        title={t('fields.model')}
        subtitle={providerLabel}
        items={modelOptions.map((model) => ({ id: model, title: model }))}
        selected={agent.model ? [agent.model] : []}
        emptyText={t('fields.noModels')}
        onPick={(model) => run({ model })}
        onClose={() => setPicker(null)}
      />

      <PickSheet
        visible={picker === 'knowledge'}
        multiple
        title={t('fields.knowledgeBases')}
        subtitle={t('detail.knowledgeBasesPlaceholder')}
        items={knowledge.bases.map((base) => ({
          id: base.knowledge_base_id,
          title: base.name,
          subtitle: base.description || t('fields.fileCount', { count: base.file_count }),
        }))}
        selected={mountedBases}
        emptyText={t('fields.noKnowledgeBases')}
        onPick={toggleBase}
        onClose={() => setPicker(null)}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: Spacing.md },
  footnote: { fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.sm },
});
