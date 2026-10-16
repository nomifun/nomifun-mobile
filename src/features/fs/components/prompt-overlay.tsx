/**
 * Single-field prompt drawn *inside* the picker (absolute overlay, not a nested
 * `Modal`): stacking two RN modals is unreliable on iOS and react-native-web,
 * and the picker itself is already a full-screen modal.
 *
 * Used for both "new folder" and "type a path".
 */
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface PromptOverlayProps {
  visible: boolean;
  title: string;
  label: string;
  placeholder?: string;
  hint?: string;
  initialValue?: string;
  confirmLabel: string;
  busy?: boolean;
  /** Already-localized failure text from the last submit attempt. */
  error?: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}

export function PromptOverlay({
  visible,
  title,
  label,
  placeholder,
  hint,
  initialValue,
  confirmLabel,
  busy,
  error,
  onCancel,
  onSubmit,
}: PromptOverlayProps) {
  const { colors } = useTheme();
  const { t: tc } = useTranslation('common');
  const [value, setValue] = useState(initialValue ?? '');

  useEffect(() => {
    if (visible) setValue(initialValue ?? '');
  }, [visible, initialValue]);

  if (!visible) return null;

  const submit = () => {
    if (busy || value.trim() === '') return;
    onSubmit(value);
  };

  return (
    <View style={StyleSheet.absoluteFill}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tc('actions.cancel')}
        style={[styles.backdrop, { backgroundColor: colors.overlay }]}
        onPress={busy ? undefined : onCancel}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.dock}
        pointerEvents="box-none"
      >
        <View
          style={[styles.card, { backgroundColor: colors.background, borderColor: colors.border }]}
        >
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <TextField
            label={label}
            placeholder={placeholder}
            hint={hint}
            error={error}
            value={value}
            onChangeText={setValue}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          <View style={styles.actions}>
            <View style={styles.action}>
              <Button variant="secondary" onPress={onCancel} disabled={busy}>
                {tc('actions.cancel')}
              </Button>
            </View>
            <View style={styles.action}>
              <Button onPress={submit} loading={busy} disabled={value.trim() === ''}>
                {confirmLabel}
              </Button>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  dock: { flex: 1, justifyContent: 'center', padding: Spacing.lg },
  card: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
  },
  title: { fontSize: FontSize.lg, fontWeight: '700', marginBottom: Spacing.md },
  actions: { flexDirection: 'row', gap: Spacing.md },
  action: { flex: 1 },
});
