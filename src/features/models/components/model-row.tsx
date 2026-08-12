import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { HealthDot } from '@/features/models/components/health-dot';
import { MODEL_TASK_ORDER, type HealthStatus, type ModelTask, type ProviderModelCapabilityResponse, type ProviderModelResponse } from '@/features/models/types';

interface ModelRowProps {
  row: ProviderModelResponse;
  providerDisabled?: boolean;
  readOnly?: boolean;
  busy?: boolean;
  checkingTask?: ModelTask | null;
  onToggle?: (enabled: boolean) => void;
  onHeartbeat?: (task: ModelTask) => void;
  onEdit?: () => void;
  onDelete?: () => void;
}

function primaryCapability(row: ProviderModelResponse): ProviderModelCapabilityResponse | undefined {
  return MODEL_TASK_ORDER.map((task) => row.capabilities.find((capability) => capability.task === task)).find(
    (capability): capability is ProviderModelCapabilityResponse => capability !== undefined,
  );
}

function capabilityHealth(capability: ProviderModelCapabilityResponse | undefined): HealthStatus {
  return capability?.health?.status ?? 'unknown';
}

export function ModelRow({
  row,
  providerDisabled,
  readOnly,
  busy,
  checkingTask = null,
  onToggle,
  onHeartbeat,
  onEdit,
  onDelete,
}: ModelRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const primary = primaryCapability(row);
  const health = capabilityHealth(primary);
  const capabilities = [...row.capabilities].sort(
    (a, b) => MODEL_TASK_ORDER.indexOf(a.task) - MODEL_TASK_ORDER.indexOf(b.task),
  );
  const unhealthy = capabilities.filter((capability) => capability.health?.status === 'unhealthy');
  const healthText =
    health === 'healthy'
      ? t('models.healthy', { latency: primary?.health?.latency ?? 0 })
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
            accessibilityLabel={t('models.enabled')}
            value={row.enabled}
            disabled={!!busy}
            onValueChange={(next) => onToggle?.(next)}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        )}
      </View>

      {row.description ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]} numberOfLines={2}>
          {row.description}
        </Text>
      ) : null}

      <View style={styles.tags}>
        {capabilities.map((capability) => (
          <Tag
            key={capability.task}
            tone={capability.task === 'chat' ? 'neutral' : 'primary'}
          >
            {t(`task.${capability.task}`)}
          </Tag>
        ))}
      </View>

      <View style={styles.capabilityList}>
        {capabilities.map((capability) => {
          const status = capabilityHealth(capability);
          const isChecking = checkingTask === capability.task;
          return (
            <View
              key={capability.task}
              style={[styles.capabilityRow, { borderTopColor: colors.border }]}
            >
              <HealthDot status={status} size={8} />
              <View style={styles.capabilityText}>
                <Text style={[styles.capabilityName, { color: colors.text }]}>
                  {t(`task.${capability.task}`)}
                </Text>
                <Text style={[styles.hint, { color: colors.textTertiary }]} numberOfLines={1}>
                  {capability.protocol || t('editor.protocolPending')} ·{' '}
                  {capability.connection_role || 'default'}
                </Text>
              </View>
              {readOnly ? null : (
                <Button
                  small
                  variant="secondary"
                  loading={isChecking}
                  disabled={!!providerDisabled || !!busy}
                  onPress={() => onHeartbeat?.(capability.task)}
                >
                  {t('models.heartbeat')}
                </Button>
              )}
            </View>
          );
        })}
      </View>

      {unhealthy.length > 0 ? (
        <Text style={[styles.hint, { color: colors.danger }]} numberOfLines={2}>
          {unhealthy
            .map((capability) => capability.health?.error)
            .filter((message): message is string => !!message)
            .join(' · ')}
        </Text>
      ) : null}

      <View style={styles.footRow}>
        <Text style={[styles.health, { color: colors.textTertiary }]} numberOfLines={2}>
          {checkingTask ? t('models.checking') : healthText}
        </Text>
        {readOnly ? null : (
          <View style={styles.actions}>
            <Button small variant="secondary" disabled={!!busy} onPress={onEdit}>
              {t('models.editTasks')}
            </Button>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('models.delete')}
              disabled={!!busy}
              {...a11yState({ disabled: !!busy })}
              onPress={onDelete}
              hitSlop={8}
              style={({ pressed }) => [
                styles.iconButton,
                { opacity: busy ? 0.4 : pressed ? 0.6 : 1 },
              ]}
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
  capabilityList: { gap: Spacing.xs },
  capabilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
  },
  capabilityText: { flex: 1, gap: 1 },
  capabilityName: { fontSize: FontSize.sm, fontWeight: '600' },
  footRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    minHeight: 36,
  },
  health: { flexGrow: 1, flexBasis: 140, fontSize: FontSize.xs, lineHeight: 16 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconButton: { width: 44, height: 36, alignItems: 'center', justifyContent: 'center' },
});
