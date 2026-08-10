import { useState } from 'react';
import {
  ActivityIndicator,
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
import { MAX_ATTACHMENTS } from '@/features/fs/upload';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import type { AttachmentsState } from '../attachments';
import { canPickFiles, pickImageFiles } from '../file-picker';

interface ComposerProps {
  /** A turn is running: the primary action becomes 停止. */
  streaming: boolean;
  /** Server-reported `runtime.can_send_message`. */
  canSend: boolean;
  disabledHint?: string;
  /**
   * The hint states a hard block, not "the agent is busy", so it must stay
   * visible mid-turn. A pending tool approval is exactly that case: the agent
   * still holds the turn (`turn.completed` fires only when it releases it), so
   * `streaming` is true the whole time the approval is on screen and gating the
   * hint on `!streaming` would hide the one line that explains the dead input.
   */
  hintWhileStreaming?: boolean;
  /** Omit to hide the attachment affordance entirely. */
  attachments?: AttachmentsState;
  /** Resolve `false` to keep the text in the box (failed send). */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}

/** Multiline input, attachment chips, and one primary action (send / stop). */
export function Composer({
  streaming,
  canSend,
  disabledHint,
  hintWhileStreaming,
  attachments,
  onSend,
  onStop,
}: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('sessions');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  /** Native has no picker yet — the hint replaces the disabled button. */
  const [nativeHint, setNativeHint] = useState(false);

  const attached = attachments?.items ?? [];
  const readyCount = attachments?.readyPaths.length ?? 0;
  const uploading = attachments?.uploading === true;
  const empty = value.trim().length === 0;
  // An image on its own is a valid turn; an empty box with nothing attached is not.
  const nothingToSend = empty && readyCount === 0;
  // Sending mid-upload would silently drop the attachment. The chip's ✕ is the
  // escape hatch if an upload stalls.
  const blocked = nothingToSend || !canSend || uploading;

  const submit = async () => {
    if (busy || streaming || blocked) return;
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

  const pick = () => {
    if (!attachments) return;
    if (!canPickFiles) {
      setNativeHint(true);
      return;
    }
    if (attachments.remaining <= 0) return;
    void pickImageFiles(attachments.remaining).then((files) => {
      if (files.length > 0) attachments.add(files);
    });
  };

  const actionDisabled = streaming ? false : blocked || busy;
  const actionColor = streaming ? colors.danger : colors.primary;
  const attachDisabled = !!attachments && canPickFiles && attachments.remaining <= 0;

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
      {!canSend && (!streaming || hintWhileStreaming) && disabledHint ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{disabledHint}</Text>
      ) : null}

      {nativeHint ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('attachments.nativeUnsupported')}
        </Text>
      ) : null}

      {uploading ? (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('attachments.uploading')}
        </Text>
      ) : null}

      {attachments?.rejected ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('attachments.dismiss')}
          onPress={attachments.dismissRejection}
          style={styles.hintRow}
        >
          <Text style={[styles.hint, { color: colors.danger }]}>
            {t(`attachments.reject.${attachments.rejected.reason}`, {
              name: attachments.rejected.name,
              max: MAX_ATTACHMENTS,
            })}
          </Text>
        </Pressable>
      ) : null}

      {attached.length > 0 ? (
        <View style={styles.chips}>
          {attached.map((item) => {
            const failed = item.status === 'error';
            return (
              <View
                key={item.id}
                style={[
                  styles.chip,
                  {
                    backgroundColor: colors.surfaceMuted,
                    borderColor: failed ? colors.danger : 'transparent',
                  },
                ]}
              >
                {item.status === 'uploading' ? (
                  <ActivityIndicator size="small" color={colors.textTertiary} />
                ) : (
                  <Ionicons
                    name={failed ? 'alert-circle-outline' : 'image-outline'}
                    size={13}
                    color={failed ? colors.danger : colors.textTertiary}
                  />
                )}
                <Text
                  style={[styles.chipText, { color: colors.textSecondary }]}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                {failed ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('attachments.retry')}
                    onPress={() => attachments?.retry(item.id)}
                    // The chip stays compact; hitSlop carries the target to 44.
                    hitSlop={10}
                    style={styles.chipButton}
                  >
                    <Ionicons name="refresh" size={13} color={colors.primary} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('attachments.remove', { name: item.name })}
                  onPress={() => attachments?.remove(item.id)}
                  hitSlop={10}
                  style={styles.chipButton}
                >
                  <Ionicons name="close" size={14} color={colors.textTertiary} />
                </Pressable>
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={styles.inputRow}>
        {attachments ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('attachments.add')}
            {...a11yState({ disabled: attachDisabled })}
            disabled={attachDisabled}
            onPress={pick}
            style={({ pressed }) => [
              styles.attach,
              { opacity: attachDisabled ? 0.4 : pressed ? 0.6 : 1 },
            ]}
          >
            <Ionicons name="image-outline" size={22} color={colors.textTertiary} />
          </Pressable>
        ) : null}
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
          {...a11yState({ disabled: actionDisabled })}
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
  hintRow: { minHeight: 24, justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    borderWidth: 1,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.xs,
    paddingVertical: 4,
    maxWidth: '100%',
  },
  chipText: { fontSize: FontSize.xs, fontWeight: '500', flexShrink: 1, maxWidth: 140 },
  chipButton: { minWidth: 24, minHeight: 24, alignItems: 'center', justifyContent: 'center' },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.sm },
  attach: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
