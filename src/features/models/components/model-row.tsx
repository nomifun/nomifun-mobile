import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { HealthDot } from '@/features/models/components/health-dot';
import type { ProviderModelResponse } from '@/features/models/types';

interface ModelRowProps {
  row: ProviderModelResponse;
  /** Provider-level switch is off — the row cannot be called at all. */
  providerDisabled?: boolean;
  /** Managed provider: display only. */
  readOnly?: boolean;
  busy?: boolean;
  checking?: boolean;
  onToggle?: (enabled: boolean) => void;
  onHeartbeat?: () => void;
  onDelete?: () => void;
}

/**
 * One catalog row. The desktop packs 9 controls onto a single line; on a phone
 * we keep the three that matter (enabled / heartbeat / delete) and show the
 * rest — tasks, traits, inferred-vs-user — as read-only tags.
 */
export function ModelRow({
  row,
  providerDisabled,
  readOnly,
  busy,
  checking,
  onToggle,
  onHeartbeat,
  onDelete,
}: ModelRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');

  const health = row.health?.status ?? 'unknown';
  const untagged = row.tasks.length === 0;
  const healthText =
    health === 'healthy'
      ? t('models.healthy', { latency: row.health?.latency ?? 0 })
      : health === 'unhealthy'
        ? t('models.unhealthy')
        : t('models.unknown');

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.headRow}>
        <HealthDot status={health} />
        <Text
          style={[styles.name, { color: row.enabled ? colors.text : colors.textTertiary }]}
          numberOfLines={2}
        >
          {row.model}
        </Text>
        {readOnly ? null : (
          <Switch
            value={row.enabled}
            disabled={busy}
            onValueChange={(next) => onToggle?.(next)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        )}
      </View>

      <View style={styles.tags}>
        {row.tasks.map((task) => (
          <Tag key={task} tone={task === 'chat' ? 'neutral' : 'primary'}>
            {t(`task.${task}`)}
          </Tag>
        ))}
        {row.traits.map((trait) => (
          <Tag key={trait} tone="neutral">
            {t(`trait.${trait}`)}
          </Tag>
        ))}
        {untagged ? <Tag tone="warning">{t('models.untagged')}</Tag> : null}
        {row.source === 'inferred' && !untagged ? <Tag tone="neutral">{t('models.inferred')}</Tag> : null}
      </View>

      {untagged ? (
        <Text style={[styles.hint, { color: colors.warning }]}>{t('models.untaggedHint')}</Text>
      ) : null}
      {row.description ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]} numberOfLines={2}>
          {row.description}
        </Text>
      ) : null}

      <View style={styles.footRow}>
        <Text style={[styles.health, { color: colors.textTertiary }]} numberOfLines={1}>
          {checking ? t('models.checking') : healthText}
          {health === 'unhealthy' && row.health?.error ? ` · ${row.health.error}` : ''}
        </Text>
        {readOnly ? null : (
          <View style={styles.actions}>
            <Button
              small
              variant="secondary"
              loading={checking}
              disabled={providerDisabled}
              onPress={onHeartbeat}
            >
              {t('models.heartbeat')}
            </Button>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('models.delete')}
              onPress={onDelete}
              hitSlop={8}
              style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
            >
              <Ionicons name="trash-outline" size={18} color={colors.danger} />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 32 },
  name: { flex: 1, fontSize: FontSize.md, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 36,
  },
  health: { flex: 1, fontSize: FontSize.xs },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconButton: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
});
