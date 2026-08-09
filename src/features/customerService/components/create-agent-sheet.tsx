/**
 * Create-agent quick form: name only. Everything else (model, knowledge bases,
 * persona, policy) defaults server-side and is edited on the detail screen —
 * the desktop's dense single modal does not belong on a phone.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { Sheet } from './sheet';

export function CreateAgentSheet({
  visible,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  onClose: () => void;
  /** Resolves once the agent exists; rejects to keep the sheet open. */
  onSubmit: (name: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (visible) {
      setName('');
      setError('');
      setBusy(false);
    }
  }, [visible]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('fields.nameRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('feedback.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('create.title')}
      subtitle={t('create.hint')}
      closeLabel={tc('actions.close')}
      footer={
        <Button onPress={submit} loading={busy} disabled={!name.trim()}>
          {tc('actions.create')}
        </Button>
      }
    >
      <TextField
        label={t('fields.name')}
        placeholder={t('fields.namePlaceholder')}
        value={name}
        onChangeText={(next) => {
          setName(next);
          if (error) setError('');
        }}
        error={error || undefined}
        autoFocus
        onSubmitEditing={submit}
        returnKeyType="done"
      />
      <View style={[styles.note, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="information-circle-outline" size={16} color={colors.textTertiary} />
        <Text style={[styles.noteText, { color: colors.textTertiary }]}>
          {t('create.defaultsHint')}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  note: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Spacing.md,
    marginBottom: Spacing.sm,
  },
  noteText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
});
