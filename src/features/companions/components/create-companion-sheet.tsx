/**
 * Create a companion: name + one of the three built-in characters. That is the
 * whole POST body — the desktop links a DIY figure with a follow-up PATCH, which
 * needs the ONNX matting wizard and stays desktop-only.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import { createCompanion } from '../api';
import type { CharacterId, CompanionProfile } from '../types';
import { BUILT_IN_CHARACTERS, CHARACTER_ICONS } from '../utils';
import { Sheet } from './sheet';

export function CreateCompanionSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: (profile: CompanionProfile) => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');

  const [name, setName] = useState('');
  const [character, setCharacter] = useState<CharacterId>('mochi');
  const [busy, setBusy] = useState(false);

  const close = () => {
    if (busy) return;
    setName('');
    setCharacter('mochi');
    onClose();
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    void (async () => {
      try {
        const profile = await createCompanion(trimmed, character);
        toast.success(t('create.created', { name: profile.name || trimmed }));
        setName('');
        setCharacter('mochi');
        onCreated(profile);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('create.failed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <Sheet
      visible={visible}
      title={t('create.title')}
      onClose={close}
      closeLabel={tc('actions.close')}
      footer={
        <Button onPress={submit} loading={busy} disabled={!name.trim()}>
          {t('create.submit')}
        </Button>
      }
    >
      <TextField
        label={t('create.nameLabel')}
        placeholder={t('create.namePlaceholder')}
        value={name}
        onChangeText={setName}
        maxLength={24}
        onSubmitEditing={submit}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('create.characterLabel')}
      </Text>
      <View style={styles.grid}>
        {BUILT_IN_CHARACTERS.map((id) => {
          const active = id === character;
          return (
            <Pressable
              key={id}
              accessibilityRole="button"
              {...a11yState({ selected: active })}
              onPress={() => setCharacter(id)}
              style={[
                styles.option,
                {
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <View
                style={[
                  styles.optionIcon,
                  { backgroundColor: active ? colors.surface : colors.surfaceMuted },
                ]}
              >
                <Ionicons
                  name={CHARACTER_ICONS[id]}
                  size={22}
                  color={active ? colors.primary : colors.textSecondary}
                />
              </View>
              <Text style={[styles.optionName, { color: colors.text }]} numberOfLines={1}>
                {t(`characters.${id}.name`)}
              </Text>
              <Text style={[styles.optionStyle, { color: colors.textTertiary }]} numberOfLines={2}>
                {t(`characters.${id}.style`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('create.hint')}</Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.sm },
  grid: { flexDirection: 'row', gap: Spacing.sm },
  option: {
    flex: 1,
    borderRadius: Radius.md,
    borderWidth: 1,
    padding: Spacing.md,
    gap: 4,
    alignItems: 'center',
    minHeight: 112,
  },
  optionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
  },
  optionName: { fontSize: FontSize.sm, fontWeight: '600', textAlign: 'center' },
  optionStyle: { fontSize: FontSize.xs, lineHeight: 15, textAlign: 'center' },
  hint: { fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.md },
});
