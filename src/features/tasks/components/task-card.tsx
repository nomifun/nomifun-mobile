import { useTranslation } from 'react-i18next';
import { Platform, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { describeSchedule, formatDateTime, isManualOnly } from '../cron';
import type { CronJob } from '../types';
import { JobStatusTag, RunStatusTag } from './status-tag';

interface TaskCardProps {
  job: CronJob;
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
}

/**
 * On web `Pressable.onPress` is driven by the DOM `click` event, so a click on
 * the switch bubbles to the card and opens the detail screen as a side effect
 * of toggling. Swallow it on the switch's wrapper; React Native has no event
 * bubbling, so this is a no-op there.
 */
const swallowWebClick: object =
  Platform.OS === 'web'
    ? { onClick: (event: { stopPropagation: () => void }) => event.stopPropagation() }
    : {};

/** One scheduled task: name, human schedule, status, next run, enable switch. */
export function TaskCard({ job, onPress, onToggle }: TaskCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('tasks');

  const manual = isManualOnly(job);
  const schedule = describeSchedule(job.schedule, t);
  const nextRun = job.state.next_run_at_ms ? formatDateTime(job.state.next_run_at_ms) : '';
  const lastStatus = job.state.last_status;

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
      <View style={styles.header}>
        <View style={styles.headerBody}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {job.name}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons name="repeat-outline" size={13} color={colors.textTertiary} />
            <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>
              {schedule}
            </Text>
          </View>
        </View>
        {manual ? (
          <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
        ) : (
          <View {...swallowWebClick}>
            <Switch
              value={job.enabled}
              onValueChange={onToggle}
              trackColor={{ false: colors.border, true: colors.primary }}
              ios_backgroundColor={colors.border}
            />
          </View>
        )}
      </View>

      <View style={styles.footer}>
        <JobStatusTag job={job} />
        {lastStatus ? <RunStatusTag status={lastStatus} /> : null}
        <View style={styles.spacer} />
        {nextRun ? (
          <Text style={[styles.next, { color: colors.textTertiary }]} numberOfLines={1}>
            {t('nextRunShort', { time: nextRun })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
    minHeight: 84,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  headerBody: { flex: 1, gap: 4 },
  name: { fontSize: FontSize.md, fontWeight: '600' },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  meta: { fontSize: FontSize.sm, flexShrink: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  spacer: { flex: 1 },
  next: { fontSize: FontSize.xs, flexShrink: 1 },
});
