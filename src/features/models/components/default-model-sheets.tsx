import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ModelPickerSheet } from './model-picker-sheet';
import type {
  ModelRef,
  ProviderResponse,
  SpeechToTextConfig,
  TextToSpeechConfig,
} from '@/features/models/types';

interface ModelPickerBaseProps {
  visible: boolean;
  providers: readonly ProviderResponse[];
  busy?: boolean;
  onClose: () => void;
}

export function ImageDefaultModelSheet({
  visible,
  current,
  providers,
  busy,
  onClose,
  onSave,
  error,
}: ModelPickerBaseProps & {
  current?: ModelRef;
  onSave: (value: ModelRef | null) => Promise<void>;
  error?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  return (
    <ModelPickerSheet
      visible={visible}
      task="image_generation"
      title={t('defaults.image')}
      current={current}
      providers={providers}
      busy={busy}
      onClose={onClose}
      onSelect={(value) => void onSave(value)}
      onClear={() => void onSave(null)}
    >
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </ModelPickerSheet>
  );
}

export function SpeechToTextDefaultModelSheet({
  visible,
  config,
  providers,
  busy = false,
  onClose,
  onSave,
  error,
}: ModelPickerBaseProps & {
  config?: SpeechToTextConfig;
  onSave: (value: SpeechToTextConfig | null) => Promise<void>;
  error?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [draft, setDraft] = useState<SpeechToTextConfig>({
    enabled: false,
    language: '',
  });
  const [draftRef, setDraftRef] = useState<ModelRef | undefined>();
  const [clearRequested, setClearRequested] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const next = config ?? { enabled: false, language: '' };
    setDraft({ ...next });
    setDraftRef(
      next.provider_id && next.model
        ? { provider_id: next.provider_id, model: next.model }
        : undefined,
    );
    setClearRequested(false);
  }, [config, visible]);

  const save = async () => {
    if (clearRequested) {
      await onSave(null);
      return;
    }
    if (!draftRef) {
      const next: SpeechToTextConfig = {
        enabled: false,
        ...(draft.language === undefined ? {} : { language: draft.language }),
        ...(draft.auto_send === undefined ? {} : { auto_send: draft.auto_send }),
      };
      await onSave(next);
      return;
    }
    await onSave({
      ...draft,
      provider_id: draftRef.provider_id,
      model: draftRef.model,
    });
  };

  return (
    <ModelPickerSheet
      visible={visible}
      task="speech_recognition"
      title={t('defaults.asr')}
      current={draftRef}
      providers={providers}
      busy={busy}
      onClose={onClose}
      onSelect={(value) => {
        setDraftRef(value);
        setClearRequested(false);
        setDraft((current) => ({ ...current, enabled: true }));
      }}
      onClear={() => {
        setDraftRef(undefined);
        setClearRequested(true);
        setDraft((current) => ({ ...current, enabled: false }));
      }}
      footer={
        <View style={styles.footer}>
          <Button variant="ghost" disabled={busy} onPress={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button loading={busy} disabled={busy} onPress={() => void save()}>
            {tc('actions.save')}
          </Button>
        </View>
      }
    >
      <TextField
        label={t('defaults.language')}
        value={draft.language ?? ''}
        editable={!busy}
        onChangeText={(language) => setDraft((current) => ({ ...current, language }))}
        placeholder={t('defaults.languagePlaceholder')}
        hint={t('defaults.languageHint')}
      />
      <View style={styles.switchRow}>
        <View style={styles.switchText}>
          <Text style={[styles.title, { color: colors.text }]}>{t('defaults.enabled')}</Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t('defaults.enabledHint')}
          </Text>
        </View>
        <Switch
          accessibilityLabel={t('defaults.enabled')}
          value={draft.enabled && !!draftRef}
          disabled={busy || !draftRef}
          onValueChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
          trackColor={{ true: colors.primary, false: colors.border }}
        />
      </View>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </ModelPickerSheet>
  );
}

export function TextToSpeechDefaultModelSheet({
  visible,
  config,
  providers,
  busy = false,
  onClose,
  onSave,
  error,
}: ModelPickerBaseProps & {
  config?: TextToSpeechConfig;
  onSave: (value: TextToSpeechConfig | null) => Promise<void>;
  error?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [draftRef, setDraftRef] = useState<ModelRef | undefined>();
  const [voice, setVoice] = useState('');
  const [clearRequested, setClearRequested] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setDraftRef(
      config?.provider_id && config.model
        ? { provider_id: config.provider_id, model: config.model }
        : undefined,
    );
    setVoice(config?.voice ?? '');
    setClearRequested(false);
  }, [config, visible]);

  const selectedProtocol = useMemo(() => {
    if (!draftRef) return undefined;
    return providers
      .find((provider) => provider.provider_id === draftRef.provider_id)
      ?.models.find((model) => model.model === draftRef.model)
      ?.capabilities.find((capability) => capability.task === 'speech_synthesis')
      ?.protocol;
  }, [draftRef, providers]);
  const modelIdIsVoice = selectedProtocol === 'deepgram.speak_rest';

  const save = async () => {
    if (clearRequested || !draftRef) {
      await onSave(null);
      return;
    }
    await onSave({
      provider_id: draftRef.provider_id,
      model: draftRef.model,
      voice: modelIdIsVoice ? null : voice.trim() || null,
    });
  };

  return (
    <ModelPickerSheet
      visible={visible}
      task="speech_synthesis"
      title={t('defaults.tts')}
      current={draftRef}
      providers={providers}
      busy={busy}
      onClose={onClose}
      onSelect={(value) => {
        setDraftRef(value);
        setClearRequested(false);
        if (draftRef?.provider_id !== value.provider_id) setVoice('');
        else {
          const nextProtocol = providers
            .find((provider) => provider.provider_id === value.provider_id)
            ?.models.find((model) => model.model === value.model)
            ?.capabilities.find((capability) => capability.task === 'speech_synthesis')
            ?.protocol;
          if (nextProtocol === 'deepgram.speak_rest') setVoice('');
        }
      }}
      onClear={() => {
        setDraftRef(undefined);
        setClearRequested(true);
        setVoice('');
      }}
      footer={
        <View style={styles.footer}>
          <Button variant="ghost" disabled={busy} onPress={onClose}>
            {tc('actions.cancel')}
          </Button>
          <Button loading={busy} disabled={busy} onPress={() => void save()}>
            {tc('actions.save')}
          </Button>
        </View>
      }
    >
      {!modelIdIsVoice ? (
        <TextField
          label={t('defaults.voice')}
          value={voice}
          editable={!busy}
          onChangeText={setVoice}
          placeholder={t('defaults.voicePlaceholder')}
          hint={t('defaults.voiceHint')}
        />
      ) : (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('defaults.voiceFromModelHint')}
        </Text>
      )}
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </ModelPickerSheet>
  );
}

const styles = StyleSheet.create({
  footer: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 48,
  },
  switchText: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: '600' },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.xs },
});
