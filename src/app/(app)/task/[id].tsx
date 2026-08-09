import { useCallback, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import {
  Button,
  Card,
  ErrorState,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { confirmDestructive } from '@/features/tasks/confirm';
import { describeSchedule, formatDateTime, isManualOnly } from '@/features/tasks/cron';
import { InfoRow } from '@/features/tasks/components/info-row';
import { JobStatusTag, RunStatusTag } from '@/features/tasks/components/status-tag';
import { useCronActions, useCronJob, useCronJobRuns } from '@/features/tasks/hooks';
import { useTheme } from '@/hooks/use-theme';

/** Task detail: status, run history and the light edits mobile can safely do. */
export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t } = useTranslation('tasks');
  const { t: tc } = useTranslation('common');

  // A delete triggers both our own navigation and a `cron.job-removed` event;
  // only the first of them may pop the screen.
  const leaving = useRef(false);
  const leave = useCallback(() => {
    if (leaving.current) return;
    leaving.current = true;
    if (router.canGoBack()) router.back();
  }, []);

  const { job, isLoading, error, refresh } = useCronJob(id, leave);
  const { runs, refresh: refreshRuns } = useCronJobRuns(id);
  const { setEnabled, runNow, remove } = useCronActions();

  const [refreshing, setRefreshing] = useState(false);
  const [running, setRunning] = useState(false);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([refresh(), refreshRuns()]).finally(() => setRefreshing(false));
  }, [refresh, refreshRuns]);

  const title = job?.name ?? t('detail.title');

  if (isLoading) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('detail.title') }} />
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('detail.title') }} />
        <ErrorState
          message={error ? t('detail.notFound') : tc('feedback.networkError')}
          retryLabel={tc('actions.retry')}
          onRetry={onRefresh}
        />
      </Screen>
    );
  }

  const manual = isManualOnly(job);
  const config = job.metadata.agent_config;
  const schedule = job.schedule;
  const modeKey = job.execution_mode === 'existing' ? 'existing' : 'new_conversation';
  const configOptions = config?.config_options
    ? Object.values(config.config_options).filter(Boolean).join(', ')
    : '';

  const onDelete = () => {
    confirmDestructive({
      title: t('confirmDelete.title'),
      message: t('confirmDelete.message'),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        void remove(job).then((ok) => {
          if (ok) leave();
        });
      },
    });
  };

  const onRunNow = () => {
    setRunning(true);
    void runNow(job).finally(() => setRunning(false));
  };

  return (
    <Screen refreshing={refreshing} onRefresh={onRefresh}>
      <Stack.Screen options={{ title }} />

      <Card style={styles.hero}>
        <Text style={[styles.name, { color: colors.text }]}>{job.name}</Text>
        {job.description ? (
          <Text style={[styles.description, { color: colors.textSecondary }]}>
            {job.description}
          </Text>
        ) : null}
        <View style={styles.tagRow}>
          <JobStatusTag job={job} />
          {job.state.last_status ? <RunStatusTag status={job.state.last_status} /> : null}
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="repeat-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {describeSchedule(schedule, t)}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.meta, { color: colors.textSecondary }]}>
            {job.state.next_run_at_ms
              ? t('nextRunShort', { time: formatDateTime(job.state.next_run_at_ms) })
              : t('detail.never')}
          </Text>
        </View>
      </Card>

      <Card style={styles.toggleCard}>
        <View style={styles.toggleBody}>
          <Text style={[styles.toggleTitle, { color: colors.text }]}>
            {manual ? t('status.manual') : t('detail.enabled')}
          </Text>
          <Text style={[styles.toggleHint, { color: colors.textTertiary }]}>
            {manual ? t('detail.manualOnlyHint') : t('detail.enabledHint')}
          </Text>
        </View>
        {manual ? null : (
          <Switch
            value={job.enabled}
            onValueChange={(next) => void setEnabled(job, next)}
            trackColor={{ false: colors.border, true: colors.primary }}
            ios_backgroundColor={colors.border}
          />
        )}
      </Card>

      <View style={{ marginTop: Spacing.lg }}>
        <Button onPress={onRunNow} loading={running}>
          {t('actions.runNow')}
        </Button>
      </View>

      <SectionTitle>{t('detail.instructions')}</SectionTitle>
      <Card>
        <Text
          selectable
          style={[styles.mono, { color: colors.text, fontFamily: Fonts.mono }]}
        >
          {job.message || '—'}
        </Text>
      </Card>

      {job.state.last_error ? (
        <>
          <SectionTitle>{t('detail.lastError')}</SectionTitle>
          <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft }}>
            <Text selectable style={[styles.errorText, { color: colors.danger }]}>
              {job.state.last_error}
            </Text>
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('detail.history')}</SectionTitle>
      <Card>
        {runs.length ? (
          runs.map((run, index) => (
            <View
              key={run.cron_job_run_id}
              style={[
                styles.runRow,
                index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
              ]}
            >
              <Text style={[styles.runTime, { color: colors.text }]}>
                {formatDateTime(run.executed_at_ms)}
              </Text>
              <RunStatusTag status={run.status} />
            </View>
          ))
        ) : (
          <Text style={[styles.placeholder, { color: colors.textTertiary }]}>
            {t('detail.noHistory')}
          </Text>
        )}
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {t('detail.historyHint')}
        </Text>
      </Card>

      <SectionTitle>{t('detail.info')}</SectionTitle>
      <Card>
        <InfoRow label={t('detail.schedule')} value={describeSchedule(schedule, t)} />
        {schedule.kind === 'cron' && schedule.expr ? (
          <InfoRow label={t('detail.expression')} value={schedule.expr} />
        ) : null}
        {schedule.kind === 'cron' && schedule.tz ? (
          <InfoRow label={t('detail.timezone')} value={schedule.tz} />
        ) : null}
        <InfoRow
          label={t('detail.lastRun')}
          value={
            job.state.last_run_at_ms ? formatDateTime(job.state.last_run_at_ms) : t('detail.never')
          }
        />
        <InfoRow
          label={t('detail.runCount')}
          value={t('detail.runCountValue', { n: job.state.run_count })}
        />
        <InfoRow label={t('detail.executionMode')} value={t(`mode.${modeKey}`)} />
        <InfoRow label={t('detail.agent')} value={config?.name || job.metadata.agent_type} />
        {config?.model ? <InfoRow label={t('detail.model')} value={config.model} /> : null}
        {config?.workspace ? (
          <InfoRow label={t('detail.workspace')} value={config.workspace} />
        ) : null}
        {configOptions ? (
          <InfoRow label={t('detail.configOptions')} value={configOptions} />
        ) : null}
        {config?.clear_context_each_run ? (
          <InfoRow label={t('detail.clearContext')} value={tc('state.enabled')} />
        ) : null}
        {job.metadata.conversation_id ? (
          <InfoRow
            label={t('detail.conversation')}
            value={job.metadata.conversation_title || job.metadata.conversation_id.slice(0, 8)}
          />
        ) : null}
        <InfoRow label={t('detail.createdAt')} value={formatDateTime(job.metadata.created_at)} />
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {modeKey === 'existing' ? t('mode.existingHint') : t('mode.newHint')}
        </Text>
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {t('mode.immutable')} · {t('detail.desktopHint')}
        </Text>
      </Card>

      <View style={styles.actions}>
        <Button
          variant="secondary"
          onPress={() => router.push(`/task/new?id=${job.cron_job_id}`)}
          style={styles.action}
        >
          {t('actions.edit')}
        </Button>
        <Button variant="danger" onPress={onDelete} style={styles.action}>
          {t('actions.delete')}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { gap: Spacing.sm },
  name: { fontSize: FontSize.xl, fontWeight: '700' },
  description: { fontSize: FontSize.sm, lineHeight: 20 },
  tagRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  meta: { fontSize: FontSize.sm, flex: 1 },
  toggleCard: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 64,
  },
  toggleBody: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: FontSize.md, fontWeight: '600' },
  toggleHint: { fontSize: FontSize.xs, lineHeight: 16 },
  mono: { fontSize: FontSize.sm, lineHeight: 21 },
  errorText: { fontSize: FontSize.sm, lineHeight: 20 },
  runRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    minHeight: 44,
  },
  runTime: { fontSize: FontSize.sm },
  placeholder: { fontSize: FontSize.sm, paddingVertical: Spacing.sm },
  footnote: { fontSize: FontSize.xs, lineHeight: 16, marginTop: Spacing.sm },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.xxl },
  action: { flex: 1 },
});
