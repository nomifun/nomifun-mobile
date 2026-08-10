/**
 * 设置 — light editing only, in the spirit of a companion app to a desktop
 * product: identity fields save explicitly, the two state switches apply
 * immediately (optimistic, then re-read the authoritative profile), and anything
 * that needs a desktop dialog says so instead of shipping a broken control.
 */
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { mutate as globalMutate } from 'swr';

import { Button, Card, SectionTitle, TextField, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { ROSTER_KEY, deleteCompanion, patchCompanion } from '../api';
import type { CompanionProfilePatch, CompanionWithStatus } from '../types';
import { PERSONA_PRESETS, confirmDestructive, isValidClockTime } from '../utils';
import { DesktopHint } from './rows';
import { ChipRow } from './segmented';

interface SettingsTabProps {
  companion: CompanionWithStatus;
  refreshProfile: () => Promise<unknown>;
  refreshing: boolean;
  onRefresh: () => void;
  onDeleted: () => void;
}

export function SettingsTab({
  companion,
  refreshProfile,
  refreshing,
  onRefresh,
  onDeleted,
}: SettingsTabProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');

  const companionId = companion.companion_id;
  const [name, setName] = useState(companion.name);
  const [preset, setPreset] = useState(companion.persona?.preset ?? 'lively');
  const [custom, setCustom] = useState(companion.persona?.custom ?? '');
  const [quietStart, setQuietStart] = useState(companion.appearance?.quiet_start ?? '');
  const [quietEnd, setQuietEnd] = useState(companion.appearance?.quiet_end ?? '');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingDesk, setPendingDesk] = useState<boolean | null>(null);
  const [pendingLearn, setPendingLearn] = useState<boolean | null>(null);

  // Re-seed the form when the profile changes underneath us (WS or refresh).
  useEffect(() => {
    setName(companion.name);
    setPreset(companion.persona?.preset ?? 'lively');
    setCustom(companion.persona?.custom ?? '');
    setQuietStart(companion.appearance?.quiet_start ?? '');
    setQuietEnd(companion.appearance?.quiet_end ?? '');
  }, [
    companion.companion_id,
    companion.name,
    companion.persona?.preset,
    companion.persona?.custom,
    companion.appearance?.quiet_start,
    companion.appearance?.quiet_end,
  ]);

  const trimmedName = name.trim();
  // Quiet hours are optional: the server stores "" for "never quiet", so a blank
  // field is valid input — only a half-typed time blocks the save.
  const quietFieldValid = (value: string) => value.trim() === '' || isValidClockTime(value);
  const quietValid = quietFieldValid(quietStart) && quietFieldValid(quietEnd);
  const dirty =
    trimmedName !== companion.name ||
    preset !== (companion.persona?.preset ?? '') ||
    custom !== (companion.persona?.custom ?? '') ||
    quietStart !== (companion.appearance?.quiet_start ?? '') ||
    quietEnd !== (companion.appearance?.quiet_end ?? '');
  // An emptied name commits nothing (desktop AppearanceSection.tsx:88-94).
  const canSave = dirty && !!trimmedName && quietValid && !saving;

  const save = () => {
    if (!canSave) return;
    const patch: CompanionProfilePatch = {};
    if (trimmedName !== companion.name) patch.name = trimmedName;
    if (preset !== companion.persona?.preset || custom !== companion.persona?.custom) {
      patch.persona = { preset, custom };
    }
    if (
      quietStart !== companion.appearance?.quiet_start ||
      quietEnd !== companion.appearance?.quiet_end
    ) {
      patch.appearance = { quiet_start: quietStart, quiet_end: quietEnd };
    }
    setSaving(true);
    void (async () => {
      try {
        await patchCompanion(companionId, patch);
        await Promise.all([refreshProfile(), globalMutate(ROSTER_KEY)]);
        toast.success(tc('feedback.saved'));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
        await refreshProfile();
      } finally {
        setSaving(false);
      }
    })();
  };

  const applyToggle = (
    patch: CompanionProfilePatch,
    clear: (value: boolean | null) => void,
  ) => {
    void (async () => {
      try {
        await patchCompanion(companionId, patch);
        await Promise.all([refreshProfile(), globalMutate(ROSTER_KEY)]);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
        await refreshProfile();
      } finally {
        clear(null);
      }
    })();
  };

  const deskEnabled = pendingDesk ?? !!companion.appearance?.companion_enabled;
  const learnEnabled = pendingLearn ?? !!companion.learn?.enabled;

  const remove = () => {
    confirmDestructive({
      title: t('settings.deleteConfirmTitle', { name: companion.name }),
      message: t('settings.deleteConfirmBody', { name: companion.name }),
      confirmLabel: t('settings.deleteConfirmOk'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        setDeleting(true);
        void (async () => {
          try {
            await deleteCompanion(companionId);
            await globalMutate(ROSTER_KEY);
            toast.success(t('settings.deleted', { name: companion.name }));
            onDeleted();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
          } finally {
            setDeleting(false);
          }
        })();
      },
    });
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.textTertiary}
        />
      }
    >
      <SectionTitle>{t('settings.basicTitle')}</SectionTitle>
      <Card style={styles.card}>
        <TextField
          label={t('settings.nameLabel')}
          hint={t('settings.nameHint')}
          value={name}
          onChangeText={setName}
          maxLength={24}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {t('settings.personaLabel')}
        </Text>
        <ChipRow
          items={PERSONA_PRESETS.map((key) => ({ key, label: t(`settings.persona.${key}`) }))}
          value={preset as (typeof PERSONA_PRESETS)[number]}
          onChange={(next) => setPreset(next)}
        />
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('settings.personaHint', { name: companion.name })}
        </Text>

        <TextField
          label={t('settings.personaCustomLabel')}
          placeholder={t('settings.personaCustomPlaceholder')}
          value={custom}
          onChangeText={setCustom}
          multiline
          style={styles.textarea}
        />

        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {t('settings.quietTitle')}
        </Text>
        <View style={styles.quietRow}>
          <View style={styles.quietField}>
            <TextField
              label={t('settings.quietStart')}
              value={quietStart}
              onChangeText={setQuietStart}
              placeholder="23:00"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              error={quietFieldValid(quietStart) ? undefined : t('settings.quietInvalid')}
            />
          </View>
          <View style={styles.quietField}>
            <TextField
              label={t('settings.quietEnd')}
              value={quietEnd}
              onChangeText={setQuietEnd}
              placeholder="08:00"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              error={quietFieldValid(quietEnd) ? undefined : t('settings.quietInvalid')}
            />
          </View>
        </View>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('settings.quietHint')}
        </Text>

        <Button onPress={save} loading={saving} disabled={!canSave}>
          {tc('actions.save')}
        </Button>
      </Card>

      <SectionTitle>{t('settings.togglesTitle')}</SectionTitle>
      <Card style={styles.card}>
        <ToggleRow
          title={t('settings.deskVisible')}
          hint={t('settings.deskVisibleHint')}
          value={deskEnabled}
          onValueChange={(next) => {
            setPendingDesk(next);
            applyToggle({ appearance: { companion_enabled: next } }, setPendingDesk);
          }}
        />
        <ToggleRow
          title={t('settings.learnEnabled')}
          hint={t('settings.learnEnabledHint', {
            minutes: companion.learn?.interval_minutes ?? 60,
          })}
          value={learnEnabled}
          onValueChange={(next) => {
            setPendingLearn(next);
            applyToggle({ learn: { enabled: next } }, setPendingLearn);
          }}
        />
      </Card>

      <SectionTitle>{t('settings.desktopOnlyTitle')}</SectionTitle>
      <Card>
        <DesktopHint text={t('settings.desktopOnlyBody')} />
      </Card>

      <SectionTitle>{t('settings.dangerTitle')}</SectionTitle>
      <Card style={styles.card}>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('settings.deleteHint', { name: companion.name })}
        </Text>
        <Button variant="danger" onPress={remove} loading={deleting}>
          {t('settings.delete')}
        </Button>
      </Card>
    </ScrollView>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onValueChange,
}: {
  title: string;
  hint: string;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleBody}>
        <Text style={[styles.toggleTitle, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: colors.surfaceMuted, true: colors.primarySoft }}
        thumbColor={value ? colors.primary : colors.textTertiary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  card: { gap: Spacing.sm },
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  textarea: { minHeight: 88, paddingTop: Spacing.md, textAlignVertical: 'top' },
  quietRow: { flexDirection: 'row', gap: Spacing.md },
  quietField: { flex: 1 },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 52 },
  toggleBody: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: FontSize.md, fontWeight: '600' },
});
