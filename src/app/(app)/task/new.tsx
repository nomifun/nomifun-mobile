import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Loading, Screen, SectionTitle, TextField } from '@/components/ui';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { SegmentedPills, type PillOption } from '@/features/tasks/components/segmented-pills';
import {
  buildCronSchedule,
  describeSchedule,
  formatClock,
  validateCronExpression,
} from '@/features/tasks/cron';
import {
  useCronActions,
  useCronConversationOptions,
  useCronJob,
  useCronJobs,
} from '@/features/tasks/hooks';
import {
  PRESET_EXPRESSIONS,
  PRESET_ORDER,
  presetForExpression,
  type FrequencyPreset,
} from '@/features/tasks/schedule-presets';
import { useTheme } from '@/hooks/use-theme';

/**
 * Create (`/task/new`) and edit (`/task/new?id=…`) in one screen, mirroring the
 * desktop dialog which also serves both modes.
 *
 * Mobile deliberately creates only conversation-bound tasks: reusing an
 * existing chat inherits its agent, model and project folder, so the phone
 * never has to pick an agent — and it must NOT send `agent_config`, because
 * `agent_config.workspace` would override the chat's own working directory.
 */
export default function TaskFormScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = !!id;
  const { colors } = useTheme();
  const { t } = useTranslation('tasks');
  const { t: tc } = useTranslation('common');

  const { job, isLoading } = useCronJob(isEdit ? id : undefined);
  const { jobs } = useCronJobs();
  const { conversations, isLoading: loadingConversations } = useCronConversationOptions(!isEdit);
  const { create, save } = useCronActions();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [prompt, setPrompt] = useState('');
  const [preset, setPreset] = useState<FrequencyPreset>('daily9');
  const [customExpr, setCustomExpr] = useState(PRESET_EXPRESSIONS.daily9);
  const [conversationId, setConversationId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [touched, setTouched] = useState(false);

  // Prefill exactly once, when the edited job lands.
  const hydrated = useRef(false);
  useEffect(() => {
    if (!job || hydrated.current) return;
    hydrated.current = true;
    setName(job.name);
    setDescription(job.description ?? '');
    setPrompt(job.message);
    if (job.schedule.kind === 'cron') {
      const next = presetForExpression(job.schedule.expr);
      setPreset(next);
      setCustomExpr(job.schedule.expr.trim() || PRESET_EXPRESSIONS.daily9);
    }
  }, [job]);

  /** `every` / `at` schedules have no mobile editor — keep them untouched. */
  const scheduleLocked = isEdit && !!job && job.schedule.kind !== 'cron';

  const expr = preset === 'custom' ? customExpr.trim() : PRESET_EXPRESSIONS[preset];
  const validation = useMemo(
    () => (preset === 'manual' ? null : validateCronExpression(expr, 3)),
    [expr, preset],
  );

  /** A chat may back only one continuing task (desktop hides bound targets). */
  const options = useMemo(() => {
    const bound = new Set(
      jobs
        .filter((item) => item.execution_mode === 'existing' && item.metadata.conversation_id)
        .map((item) => item.metadata.conversation_id as string),
    );
    return conversations.filter((item) => !bound.has(item.conversation_id));
  }, [conversations, jobs]);

  const selected = options.find((item) => item.conversation_id === conversationId);

  const nameError = touched && !name.trim() ? t('form.nameRequired') : undefined;
  const promptError = touched && !prompt.trim() ? t('form.promptRequired') : undefined;
  const cronError =
    touched && validation && !validation.valid && !scheduleLocked
      ? t(`form.cron.${validation.error ?? 'invalid'}`)
      : undefined;
  const conversationError =
    touched && !isEdit && !conversationId ? t('form.conversationRequired') : undefined;

  const presets: PillOption<FrequencyPreset>[] = PRESET_ORDER.map((value) => ({
    value,
    label: t(`freq.${value}`),
  }));

  const submit = () => {
    setTouched(true);
    if (!name.trim() || !prompt.trim()) return;
    if (!scheduleLocked && validation && !validation.valid) return;
    if (!isEdit && !conversationId) return;

    const trimmedDescription = description.trim();
    const nextSchedule = buildCronSchedule(expr, describeSchedule({ kind: 'cron', expr }, t));

    setSubmitting(true);
    if (isEdit && id) {
      void save(id, {
        name: name.trim(),
        description: trimmedDescription,
        message: prompt.trim(),
        // `every` / `at` schedules stay untouched — mobile has no editor for them.
        ...(scheduleLocked ? {} : { schedule: nextSchedule }),
      })
        .then((updated) => {
          if (updated && router.canGoBack()) router.back();
        })
        .finally(() => setSubmitting(false));
      return;
    }

    void create({
      name: name.trim(),
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      schedule: nextSchedule,
      prompt: prompt.trim(),
      conversation_id: conversationId,
      ...(selected ? { conversation_title: selected.name } : {}),
      agent_type: selected?.agent_type ?? 'claude',
      created_by: 'user',
      execution_mode: 'existing',
    })
      .then((created) => {
        if (created && router.canGoBack()) router.back();
      })
      .finally(() => setSubmitting(false));
  };

  if (isEdit && isLoading) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={{ title: t('form.editTitle') }} />
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  return (
    <Screen
      keyboardAvoiding
      footer={
        <View style={[styles.footer, { borderTopColor: colors.border }]}>
          <Button onPress={submit} loading={submitting}>
            {isEdit ? t('form.save') : t('form.create')}
          </Button>
        </View>
      }
    >
      <Stack.Screen options={{ title: isEdit ? t('form.editTitle') : t('form.createTitle') }} />

      <TextField
        label={t('form.name')}
        placeholder={t('form.namePlaceholder')}
        value={name}
        onChangeText={setName}
        error={nameError}
        autoCapitalize="sentences"
      />
      <TextField
        label={t('form.description')}
        placeholder={t('form.descriptionPlaceholder')}
        value={description}
        onChangeText={setDescription}
        autoCapitalize="sentences"
      />
      <TextField
        label={t('form.prompt')}
        placeholder={t('form.promptPlaceholder')}
        hint={t('form.promptHint')}
        error={promptError}
        value={prompt}
        onChangeText={setPrompt}
        multiline
        autoCapitalize="sentences"
        style={styles.multiline}
      />

      <SectionTitle>{t('form.frequency')}</SectionTitle>
      {scheduleLocked && job ? (
        <Card>
          <Text style={[styles.note, { color: colors.textSecondary }]}>
            {t('form.scheduleLocked', { schedule: describeSchedule(job.schedule, t) })}
          </Text>
        </Card>
      ) : (
        <>
          <SegmentedPills options={presets} value={preset} onChange={setPreset} scrollable />
          <Card style={styles.previewCard}>
            {preset === 'custom' ? (
              <TextField
                label={t('form.cronExpr')}
                placeholder={t('form.cronPlaceholder')}
                hint={t('form.cronHint')}
                error={cronError}
                value={customExpr}
                onChangeText={setCustomExpr}
                style={[styles.mono, { fontFamily: Fonts.mono }]}
              />
            ) : null}

            {preset === 'manual' ? (
              <Text style={[styles.note, { color: colors.textSecondary }]}>
                {t('form.manualNote')}
              </Text>
            ) : validation?.valid ? (
              <View style={styles.preview}>
                <Text style={[styles.previewLabel, { color: colors.textTertiary }]}>
                  {t('form.nextRuns')}
                </Text>
                {validation.nextRuns.map((date) => (
                  <View key={date.getTime()} style={styles.previewRow}>
                    <Ionicons name="time-outline" size={13} color={colors.textTertiary} />
                    <Text style={[styles.previewText, { color: colors.text }]}>
                      {formatClock(date)}
                    </Text>
                  </View>
                ))}
                {validation.subMinute ? (
                  <Text style={[styles.warning, { color: colors.warning }]}>
                    {t('form.cron.subMinuteWarning')}
                  </Text>
                ) : null}
              </View>
            ) : (
              <Text style={[styles.warning, { color: colors.danger }]}>
                {t(`form.cron.${validation?.error ?? 'invalid'}`)}
              </Text>
            )}
          </Card>
        </>
      )}

      {isEdit ? (
        <Card style={styles.hintCard}>
          <Text style={[styles.note, { color: colors.textTertiary }]}>
            {t('mode.immutable')} · {t('detail.desktopHint')}
          </Text>
        </Card>
      ) : (
        <>
          <SectionTitle>{t('form.conversation')}</SectionTitle>
          <Text style={[styles.note, { color: colors.textTertiary, marginBottom: Spacing.sm }]}>
            {t('form.conversationHint')}
          </Text>
          {loadingConversations ? (
            <Card>
              <Text style={[styles.note, { color: colors.textTertiary }]}>
                {tc('state.loading')}
              </Text>
            </Card>
          ) : options.length ? (
            <View>
              {options.map((option) => {
                const active = option.conversation_id === conversationId;
                return (
                  <Pressable
                    key={option.conversation_id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setConversationId(option.conversation_id)}
                    style={({ pressed }) => [
                      styles.option,
                      {
                        backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                        borderColor: active ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <View style={styles.optionBody}>
                      <Text style={[styles.optionTitle, { color: colors.text }]} numberOfLines={1}>
                        {option.name}
                      </Text>
                      <Text style={[styles.optionMeta, { color: colors.textTertiary }]}>
                        {option.agent_type}
                      </Text>
                    </View>
                    <Ionicons
                      name={active ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={active ? colors.primary : colors.textTertiary}
                    />
                  </Pressable>
                );
              })}
              {conversationError ? (
                <Text style={[styles.warning, { color: colors.danger }]}>{conversationError}</Text>
              ) : null}
            </View>
          ) : (
            <Card>
              <Text style={[styles.optionTitle, { color: colors.text }]}>
                {conversations.length ? t('form.allBound') : t('form.noConversations')}
              </Text>
              <Text style={[styles.note, { color: colors.textTertiary, marginTop: Spacing.xs }]}>
                {conversations.length ? t('form.allBoundHint') : t('form.noConversationsHint')}
              </Text>
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  multiline: { minHeight: 116, paddingTop: Spacing.md, textAlignVertical: 'top' },
  mono: { fontSize: FontSize.sm },
  previewCard: { marginTop: Spacing.md },
  hintCard: { marginTop: Spacing.md },
  preview: { gap: Spacing.xs },
  previewLabel: { fontSize: FontSize.xs, marginBottom: Spacing.xs },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  previewText: { fontSize: FontSize.sm },
  warning: { fontSize: FontSize.xs, lineHeight: 16, marginTop: Spacing.sm },
  note: { fontSize: FontSize.xs, lineHeight: 18 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  optionBody: { flex: 1, gap: 2 },
  optionTitle: { fontSize: FontSize.md, fontWeight: '600' },
  optionMeta: { fontSize: FontSize.xs },
  footer: { padding: Spacing.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
