import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface ComposerProps {
  /** A turn is running: the primary action becomes 停止. */
  streaming: boolean;
  /** Server-reported `runtime.can_send_message`. */
  canSend: boolean;
  disabledHint?: string;
  /** Resolve `false` to keep the text in the box (failed send). */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}

/** Multiline input + one primary action (send / stop). */
export function Composer({ streaming, canSend, disabledHint, onSend, onStop }: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('sessions');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const empty = value.trim().length === 0;

  const submit = async () => {
    if (empty || busy) return;
    const text = value;
    setBusy(true);
    setValue('');
    try {
      const ok = await onSend(text);
      if (!ok) setValue((current) => (current.length > 0 ? current : text));
    } finally {
      setBusy(false);
    }
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    const native = event.nativeEvent as TextInputKeyPressEventData & { shiftKey?: boolean };
    if (native.key !== 'Enter' || native.shiftKey) return;
    (event as unknown as { preventDefault?: () => void }).preventDefault?.();
    void submit();
  };

  const actionDisabled = streaming ? false : empty || busy || !canSend;
  const actionColor = streaming ? colors.danger : colors.primary;

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      {!canSend && !streaming && disabledHint ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{disabledHint}</Text>
      ) : null}
      <View style={styles.inputRow}>
        <TextInput
          style={[
            styles.input,
            { backgroundColor: colors.surfaceMuted, color: colors.text, borderColor: colors.border },
          ]}
          value={value}
          onChangeText={setValue}
          onKeyPress={onKeyPress}
          placeholder={t('composer.placeholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          submitBehavior="newline"
          maxLength={20000}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={streaming ? t('composer.stop') : t('composer.send')}
          onPress={streaming ? onStop : () => void submit()}
          disabled={actionDisabled}
          style={({ pressed }) => [
            styles.action,
            {
              backgroundColor: actionColor,
              opacity: actionDisabled ? 0.4 : pressed ? 0.8 : 1,
            },
          ]}
        >
          <Ionicons name={streaming ? 'stop' : 'arrow-up'} size={20} color="#FFFFFF" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  hint: { fontSize: FontSize.xs, marginBottom: Spacing.xs, marginLeft: Spacing.xs },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 132,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: FontSize.md,
    lineHeight: 21,
  },
  action: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
