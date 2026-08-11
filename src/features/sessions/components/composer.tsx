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
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { MAX_ATTACHMENTS } from '@/features/fs/upload';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import type { AttachmentsState } from '../attachments';
import type { Conversation } from '../api';
import { canPickFiles, pickImageFiles } from '../file-picker';
import { modelLabel, supportsModelSwitch } from '../model-switch';
import { ModelSheet } from './model-sheet';

/**
 * The browser draws its own focus outline on the bare TextInput, which would
 * sit inside the card's own focus ring. RN's TS types only allow the RN subset
 * of outline styles, so the web-only reset is cast at the boundary.
 */
const webInputReset =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : undefined;

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
  /** Drives the model chip; omit to hide model switching. */
  conversation?: Conversation;
  onModelChanged?: () => void;
  /** Resolve `false` to keep the text in the box (failed send). */
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
}

/**
 * One rounded card holding the text area and a toolbar row beneath it
 * (attach · model · send), the pattern phone chat apps converged on. The
 * earlier layout put three unrelated controls side by side, which left a wide
 * dead gap and made the send button read as the loudest thing on screen.
 */
export function Composer({
  streaming,
  canSend,
  disabledHint,
  hintWhileStreaming,
  attachments,
  conversation,
  onModelChanged,
  onSend,
  onStop,
}: ComposerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('sessions');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [focused, setFocused] = useState(false);
  const [modelSheet, setModelSheet] = useState(false);
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

  const canSwitchModel = supportsModelSwitch(conversation);
  const currentModel = modelLabel(conversation);

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
  const attachDisabled = !!attachments && canPickFiles && attachments.remaining <= 0;

  // Disabled sends read better as a quiet grey circle than as a washed-out
  // blue one, and keep the card from shouting when there is nothing to send.
  const actionBackground = streaming
    ? colors.danger
    : actionDisabled
      ? colors.surfaceMuted
      : colors.primary;
  const actionIcon = streaming ? colors.surface : actionDisabled ? colors.textTertiary : '#FFFFFF';

  const notice = (text: string, tone: 'muted' | 'danger', onPress?: () => void) => {
    const body = (
      <Text style={[styles.notice, { color: tone === 'danger' ? colors.danger : colors.textTertiary }]}>
        {text}
      </Text>
    );
    if (!onPress) return body;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('attachments.dismiss')}
        onPress={onPress}
        style={styles.noticeRow}
      >
        {body}
      </Pressable>
    );
  };

  return (
    <View
      style={[
        styles.wrap,
        {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      {!canSend && (!streaming || hintWhileStreaming) && disabledHint
        ? notice(disabledHint, 'muted')
        : null}
      {nativeHint ? notice(t('attachments.nativeUnsupported'), 'muted') : null}
      {uploading ? notice(t('attachments.uploading'), 'muted') : null}
      {attachments?.rejected
        ? notice(
            t(`attachments.reject.${attachments.rejected.reason}`, {
              name: attachments.rejected.name,
              max: MAX_ATTACHMENTS,
            }),
            'danger',
            attachments.dismissRejection,
          )
        : null}

      <View
        style={[
          styles.card,
          {
            backgroundColor: colors.surface,
            // A focus ring is the only state the card needs; without it the
            // whole thing reads as static chrome while you are typing.
            borderColor: focused ? colors.primary : colors.border,
          },
        ]}
      >
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
                  <Text style={[styles.chipText, { color: colors.textSecondary }]} numberOfLines={1}>
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

        <TextInput
          style={[styles.input, { color: colors.text }, webInputReset]}
          value={value}
          onChangeText={setValue}
          onKeyPress={onKeyPress}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('composer.placeholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          autoCapitalize="sentences"
          autoCorrect
          submitBehavior="newline"
          maxLength={20000}
        />

        <View style={styles.toolbar}>
          {attachments ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('attachments.add')}
              {...a11yState({ disabled: attachDisabled })}
              disabled={attachDisabled}
              onPress={pick}
              hitSlop={8}
              style={({ pressed }) => [
                styles.tool,
                { opacity: attachDisabled ? 0.4 : pressed ? 0.6 : 1 },
              ]}
            >
              <Ionicons name="image-outline" size={20} color={colors.textTertiary} />
            </Pressable>
          ) : null}

          {canSwitchModel ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                currentModel ? t('model.changeFrom', { model: currentModel }) : t('model.choose')
              }
              onPress={() => setModelSheet(true)}
              hitSlop={6}
              style={({ pressed }) => [
                styles.modelChip,
                { backgroundColor: colors.surfaceMuted, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons
                name="cube-outline"
                size={13}
                color={currentModel ? colors.textSecondary : colors.warning}
              />
              <Text
                style={[
                  styles.modelText,
                  { color: currentModel ? colors.textSecondary : colors.warning },
                ]}
                numberOfLines={1}
              >
                {currentModel ?? t('model.unset')}
              </Text>
              <Ionicons name="chevron-up" size={11} color={colors.textTertiary} />
            </Pressable>
          ) : null}

          <View style={styles.spacer} />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={streaming ? t('composer.stop') : t('composer.send')}
            {...a11yState({ disabled: actionDisabled })}
            onPress={streaming ? onStop : () => void submit()}
            disabled={actionDisabled}
            style={({ pressed }) => [
              styles.action,
              { backgroundColor: actionBackground, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name={streaming ? 'stop' : 'arrow-up'} size={18} color={actionIcon} />
          </Pressable>
        </View>
      </View>

      {canSwitchModel ? (
        <ModelSheet
          visible={modelSheet}
          conversation={conversation}
          onClose={() => setModelSheet(false)}
          onChanged={() => onModelChanged?.()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  notice: { fontSize: FontSize.xs, lineHeight: 17 },
  noticeRow: { minHeight: 24, justifyContent: 'center' },
  card: {
    borderRadius: Radius.xl,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.xs,
    marginTop: Spacing.xs,
  },
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
  input: {
    // No own background or border: the card is the field.
    minHeight: 30,
    maxHeight: 132,
    paddingTop: 2,
    paddingBottom: 2,
    fontSize: FontSize.md,
    lineHeight: 22,
  },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  tool: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 28,
    maxWidth: 190,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.full,
  },
  modelText: { fontSize: FontSize.xs, fontWeight: '600', flexShrink: 1 },
  spacer: { flex: 1 },
  action: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
