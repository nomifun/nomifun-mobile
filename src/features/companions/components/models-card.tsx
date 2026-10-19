import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Notice, SectionTitle, Tag, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { connectionStore } from '@/api/connection';
import { useTheme } from '@/hooks/use-theme';
import { ModelPickerSheet } from '@/features/models/components/model-picker-sheet';
import { TextToSpeechDefaultModelSheet } from '@/features/models/components/default-model-sheets';
import { useProviders } from '@/features/models/hooks';
import { providerModelRefLabel } from '@/features/models/presentation';
import { isUsableModelRef } from '@/features/models/selectors';
import type { ModelRef, TextToSpeechConfig } from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

import {
  COMPANION_MODEL_SLOTS,
  companionModelPatch,
  companionModelRef,
  companionModelRequirements,
  type CompanionModelSlot,
} from '../model-settings';
import type { CompanionProfilePatch, CompanionWithStatus } from '../types';

interface ModelsCardProps {
  companion: CompanionWithStatus;
  saveProfile: (patch: CompanionProfilePatch) => Promise<void>;
  saving: boolean;
}

/** The same profile controls are available from Overview and Settings. */
export function ModelsCard({ companion, saveProfile, saving }: ModelsCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');
  const { providers } = useProviders('selector');
  const [slot, setSlot] = useState<CompanionModelSlot | null>(null);
  const [error, setError] = useState('');
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const close = () => {
    if (saving || submitting.current) return;
    setSlot(null);
    setError('');
  };

  const save = async (target: CompanionModelSlot, value: ModelRef | TextToSpeechConfig | null) => {
    if (saving || submitting.current) return;
    submitting.current = true;
    setError('');
    const epoch = connectionStore.epoch();
    try {
      await saveProfile(companionModelPatch(target, value));
      if (!mounted.current || connectionStore.epoch() !== epoch) return;
      setSlot(null);
      toast.success(tc('feedback.saved'));
    } catch (cause) {
      if (!mounted.current || connectionStore.epoch() !== epoch) return;
      const message = cause instanceof Error ? cause.message : tc('feedback.requestFailed');
      setError(message);
      toast.error(message);
    } finally {
      submitting.current = false;
    }
  };

  const manageModels = () => {
    close();
    router.push('/models');
  };
  const emptyAction = (
    <View testID="companion-manage-models">
      <Button variant="secondary" onPress={manageModels} disabled={saving}>
        {t('modelSettings.manageModels')}
      </Button>
    </View>
  );
  const feedback = error ? <Notice tone="danger">{error}</Notice> : null;
  const selectionHint = slot ? <Text style={[styles.hint, { color: colors.textTertiary }]}>
    {t(`modelSettings.hints.${slot}`)}
  </Text> : null;
  const clearLabel = slot === 'asr' || slot === 'tts'
    ? t('modelSettings.followGlobal')
    : slot === 'vision_model' ? t('modelSettings.followMain') : t('modelSettings.clear');
  const requirements = slot ? companionModelRequirements(slot) : undefined;

  return (
    <>
      <SectionTitle>{t('overview.modelsTitle')}</SectionTitle>
      <Card style={styles.card}>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('modelSettings.defaultHint')}</Text>
        {COMPANION_MODEL_SLOTS.map((target) => {
          const current = companionModelRef(companion, target);
          const needs = companionModelRequirements(target);
          const unavailable = !!current && !!providers &&
            !isUsableModelRef(providers, current, needs.task, needs.requiredTraits);
          const title = t(`modelSettings.slots.${target}`);
          const label = providerModelRefLabel(providers, current) ?? (
            target === 'asr' || target === 'tts' ? t('modelSettings.followGlobal') :
              target === 'vision_model' ? t('modelSettings.followMain') : t('overview.modelUnset')
          );
          return (
            <Pressable
              key={target}
              testID={`companion-model-${target}`}
              accessibilityRole="button"
              accessibilityLabel={t('modelSettings.configure', { model: title })}
              {...a11yState({ disabled: saving })}
              disabled={saving}
              onPress={() => { setError(''); setSlot(target); }}
              style={({ pressed }) => [styles.row, {
                borderBottomColor: colors.borderLight,
                backgroundColor: pressed ? colors.bgHover : colors.surface,
                opacity: saving ? 0.5 : 1,
              }]}
            >
              <View style={styles.rowBody}>
                <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
                <Text style={[styles.value, { color: colors.textSecondary }]}>{label}</Text>
                {target === 'tts' && companion.voice.tts ? (
                  <Text style={[styles.hint, { color: colors.textTertiary }]}>
                    {t('modelSettings.voice', { voice: companion.voice.tts.voice ?? t('modelSettings.defaultVoice') })}
                  </Text>
                ) : null}
              </View>
              {unavailable ? <Tag tone="warning">{t('modelSettings.unavailable')}</Tag> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
            </Pressable>
          );
        })}
        {feedback}
      </Card>

      {slot && slot !== 'tts' && requirements ? (
        <ModelPickerSheet
          visible
          title={t(`modelSettings.slots.${slot}`)}
          task={requirements.task}
          requiredTraits={requirements.requiredTraits}
          current={companionModelRef(companion, slot) ?? undefined}
          providers={providers}
          busy={saving}
          clearLabel={clearLabel}
          emptyAction={emptyAction}
          onClose={close}
          onSelect={(value) => void save(slot, value)}
          onClear={() => void save(slot, null)}
        >
          {selectionHint}
          {feedback}
        </ModelPickerSheet>
      ) : null}
      {slot === 'tts' ? (
        <TextToSpeechDefaultModelSheet
          visible
          title={t('modelSettings.slots.tts')}
          config={companion.voice.tts ?? undefined}
          providers={providers}
          busy={saving}
          clearLabel={clearLabel}
          emptyAction={emptyAction}
          hint={selectionHint}
          error={error || undefined}
          onClose={close}
          onSave={(value) => save('tts', value)}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.sm },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm,
    minHeight: 64, paddingVertical: Spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
  },
  rowBody: { flex: 1, minWidth: 0, gap: Spacing.xs },
  title: { fontSize: FontSize.sm, fontWeight: '500' },
  value: { fontSize: FontSize.sm, lineHeight: 20 },
  hint: { fontSize: FontSize.xs, lineHeight: 18 },
});
