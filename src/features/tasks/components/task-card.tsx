import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { Toggle } from '@/components/ui/toggle';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { IconBadge, Interactive } from '@/components/ui';

import { describeSchedule, formatDateTime, isManualOnly } from '../cron';
import type { CronJob } from '../types';
import { JobStatusTag, RunStatusTag } from './status-tag';

interface TaskCardProps {
  job: CronJob;
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
}

/** Inbox-style task identity and metadata, with an independent enable target. */
export function TaskCard({ job, onPress, onToggle }: TaskCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('tasks');

  const manual = isManualOnly(job);
  const schedule = describeSchedule(job.schedule, t);
  const nextRun = job.state.next_run_at_ms ? formatDateTime(job.state.next_run_at_ms) : '';
  const lastStatus = job.state.last_status;

  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
    >
      <View style={styles.top}>
        <Interactive
          accessibilityRole="button"
          accessibilityLabel={job.name}
          onPress={onPress}
          feedback={false}
          style={({ pressed }) => [
            styles.open,
            { backgroundColor: pressed ? colors.bgHover : 'transparent' },
          ]}
        >
          <IconBadge
            icon={manual ? 'play-outline' : 'time-outline'}
            tone="neutral"
            size={Layout.compactControlHeight}
          />
          <View style={styles.copy}>
            <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
              {job.name}
            </Text>
            <Text style={[styles.schedule, { color: colors.textSecondary }]} numberOfLines={1}>
              {schedule}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.textTertiary} />
        </Interactive>
        {!manual ? (
          <Toggle
            value={job.enabled}
            accessibilityLabel={`${t(job.enabled ? 'actions.pause' : 'actions.resume')} ${job.name}`}
            onValueChange={onToggle}
          />
        ) : null}
      </View>
      <View style={[styles.footer, { borderTopColor: colors.borderLight }]}>
        <View style={styles.status}>
          <JobStatusTag job={job} />
          {lastStatus ? <RunStatusTag status={lastStatus} /> : null}
        </View>
        {nextRun ? (
          <Text style={[styles.next, { color: colors.textSecondary }]} numberOfLines={1}>
            {t('nextRunShort', { time: nextRun })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  open: {
    flex: 1,
    minWidth: 0,
    minHeight: Layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.sm,
  },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: FontSize.sm, fontWeight: FontWeight.heading, lineHeight: 20 },
  schedule: { fontSize: FontSize.control, fontWeight: FontWeight.body, lineHeight: 18 },
  footer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.sm,
  },
  status: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, flexShrink: 1 },
  next: {
    flex: 1,
    minWidth: 120,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.body,
    textAlign: 'right',
  },
});
