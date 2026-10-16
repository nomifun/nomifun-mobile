/**
 * Roster card for one 客服员工: name, 服务中/已停用, model and mounted
 * knowledge-base count. The whole card navigates to the detail screen.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Avatar, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { CsAgent } from '../types';

export function AgentCard({
  agent,
  modelLabel,
  onPress,
}: {
  agent: CsAgent;
  /** Resolved "provider · model" label, or undefined when unconfigured. */
  modelLabel?: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.head}>
        <Avatar name={agent.name} size={44} />
        <View style={styles.headText}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {agent.name}
          </Text>
          <View style={styles.tagRow}>
            <Tag tone={agent.enabled ? 'success' : 'neutral'}>
              {agent.enabled ? t('status.enabled') : t('status.disabled')}
            </Tag>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </View>

      <View style={[styles.meta, { borderTopColor: colors.border }]}>
        <View style={styles.metaItem}>
          <Ionicons
            name="cube-outline"
            size={13}
            color={modelLabel ? colors.textTertiary : colors.warning}
          />
          <Text
            style={[
              styles.metaText,
              { color: modelLabel ? colors.textSecondary : colors.warning },
            ]}
            numberOfLines={1}
          >
            {modelLabel ?? t('card.noModel')}
          </Text>
        </View>
        <View style={styles.metaItem}>
          <Ionicons name="library-outline" size={13} color={colors.textTertiary} />
          <Text style={[styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('card.kbCount', { count: agent.knowledge_base_ids.length })}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headText: { flex: 1, gap: Spacing.xs },
  name: { fontSize: FontSize.lg, fontWeight: '700' },
  tagRow: { flexDirection: 'row', gap: Spacing.sm },
  meta: {
    marginTop: Spacing.md,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.xs,
  },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { flex: 1, fontSize: FontSize.xs },
});
