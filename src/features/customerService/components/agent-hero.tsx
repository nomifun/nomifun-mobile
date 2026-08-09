/**
 * Detail header: identity at a glance plus the 启用 switch, which PATCHes
 * immediately (optimistically, so the toggle never lags behind the finger).
 */
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar, Card, Tag, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { CsAgent, CsAgentPatch } from '../types';

export function AgentHero({
  agent,
  modelLabel,
  patch,
}: {
  agent: CsAgent;
  modelLabel?: string;
  patch: (next: CsAgentPatch) => Promise<CsAgent>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');

  const toggle = (enabled: boolean) => {
    void patch({ enabled }).catch((err: unknown) => {
      toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
    });
  };

  return (
    <Card>
      <View style={styles.head}>
        <Avatar name={agent.name} size={52} />
        <View style={styles.headText}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {agent.name}
          </Text>
          <Text style={[styles.meta, { color: colors.textTertiary }]} numberOfLines={1}>
            {[
              modelLabel ?? t('card.noModel'),
              t('card.kbCount', { count: agent.knowledge_base_ids.length }),
            ].join(' · ')}
          </Text>
        </View>
        <Tag tone={agent.enabled ? 'success' : 'neutral'}>
          {agent.enabled ? t('status.enabled') : t('status.disabled')}
        </Tag>
      </View>

      <View style={[styles.toggle, { borderTopColor: colors.border }]}>
        <View style={styles.toggleText}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{t('detail.enabled')}</Text>
          <Text style={[styles.toggleHint, { color: colors.textTertiary }]}>
            {agent.enabled ? t('detail.enabledHint') : t('detail.disabledHint')}
          </Text>
        </View>
        <Switch
          value={agent.enabled}
          onValueChange={toggle}
          trackColor={{ true: colors.primary, false: colors.surfaceMuted }}
          thumbColor={colors.background}
          ios_backgroundColor={colors.surfaceMuted}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headText: { flex: 1, gap: 3 },
  name: { fontSize: FontSize.xl, fontWeight: '700' },
  meta: { fontSize: FontSize.xs },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleText: { flex: 1, gap: 2 },
  toggleLabel: { fontSize: FontSize.md, fontWeight: '600' },
  toggleHint: { fontSize: FontSize.xs, lineHeight: 16 },
});
