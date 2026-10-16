import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
  type TextStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Layout, Radius, Spacing } from '@/constants/theme';
import {
  PromptModelButton,
  PromptSubmitButton,
  PromptSurface,
  PromptToolbar,
} from '@/components/codevisual/prompt-surface';
import { IconButton } from '@/components/ui/icon-button';
import { Interactive } from '@/components/ui/interactive';
import { toast } from '@/components/ui/toast';
import { MAX_ATTACHMENTS } from '@/features/fs/upload';
import { useTheme } from '@/hooks/use-theme';
import { shouldSubmitOnEnter } from '@/utils/keyboard';

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

/** Text, attachments and model selection share one input surface. */
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
  const [inputHeight, setInputHeight] = useState<number>(Layout.promptMinHeight);
  const inputRef = useRef<TextInput>(null);
  const { width } = useWindowDimensions();
  const [modelSheet, setModelSheet] = useState(false);
  /** Native has no picker yet — the hint replaces the disabled button. */
  const [nativeHint, setNativeHint] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || !inputRef.current) return;
    const input = inputRef.current as unknown as HTMLTextAreaElement;
    // RNW reports scrollHeight, which cannot shrink until the assigned height resets.
    input.style.height = 'auto';
    const height = Math.min(144, Math.max(Layout.promptMinHeight, input.scrollHeight));
    input.style.height = `${height}px`;
    setInputHeight(height);
  }, [value, width]);

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
    } catch (error) {
      setValue((current) => (current.length > 0 ? current : text));
      toast.error(
        t('composer.sendFailed', {
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    } finally {
      setBusy(false);
    }
  };

  const onKeyPress = (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
    if (Platform.OS !== 'web') return;
    if (!shouldSubmitOnEnter(event.nativeEvent)) return;
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

  const notice = (text: string, tone: 'muted' | 'danger', onPress?: () => void) => {
    const body = (
      <Text
        style={[styles.notice, { color: tone === 'danger' ? colors.danger : colors.textTertiary }]}
      >
        {text}
      </Text>
    );
    if (!onPress) return body;
    return (
      <Interactive
        accessibilityRole="button"
        accessibilityLabel={t('attachments.dismiss')}
        onPress={onPress}
        style={styles.noticeRow}
      >
        {body}
      </Interactive>
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

      <PromptSurface focused={focused}>
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
                    <IconButton
                      icon="refresh-outline"
                      label={t('attachments.retry')}
                      onPress={() => attachments?.retry(item.id)}
                      size={16}
                    />
                  ) : null}
                  <IconButton
                    icon="close"
                    label={t('attachments.remove', { name: item.name })}
                    onPress={() => attachments?.remove(item.id)}
                    size={16}
                  />
                </View>
              );
            })}
          </View>
        ) : null}

        <TextInput
          ref={inputRef}
          style={[styles.input, { color: colors.text, height: inputHeight }, webInputReset]}
          value={value}
          onChangeText={setValue}
          onKeyPress={onKeyPress}
          onContentSizeChange={
            Platform.OS === 'web'
              ? undefined
              : (event) =>
                  setInputHeight(
                    Math.min(
                      144,
                      Math.max(Layout.promptMinHeight, event.nativeEvent.contentSize.height),
                    ),
                  )
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t('composer.placeholder')}
          accessibilityLabel={t('composer.placeholder')}
          placeholderTextColor={colors.textTertiary}
          multiline
          {...(Platform.OS === 'web' ? { rows: 1 } : {})}
          autoCapitalize="sentences"
          autoCorrect
          submitBehavior="newline"
          maxLength={20000}
        />

        <PromptToolbar
          model={
            canSwitchModel ? (
              <PromptModelButton
                model={currentModel ?? t('model.unset')}
                label={
                  currentModel ? t('model.changeFrom', { model: currentModel }) : t('model.choose')
                }
                onPress={() => setModelSheet(true)}
              />
            ) : undefined
          }
        >
          {attachments ? (
            <IconButton
              icon="image-outline"
              label={t('attachments.add')}
              disabled={attachDisabled}
              onPress={pick}
              style={styles.roundAction}
            />
          ) : null}
          <PromptSubmitButton
            label={streaming ? t('composer.stop') : t('composer.send')}
            stopping={streaming}
            loading={busy && !streaming}
            onPress={streaming ? onStop : () => void submit()}
            disabled={actionDisabled}
          />
        </PromptToolbar>
      </PromptSurface>

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
    borderTopWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  notice: { fontSize: FontSize.sm, lineHeight: 20 },
  noticeRow: { minHeight: 44, justifyContent: 'center' },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingLeft: Spacing.sm,
    paddingRight: Spacing.xs,
    minWidth: 0,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: FontSize.xs,
    fontWeight: '500',
    flexShrink: 1,
    maxWidth: 140,
  },
  input: {
    // No own background or border: the prompt surface is the field.
    minHeight: Layout.promptMinHeight,
    maxHeight: 144,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    fontSize: FontSize.md,
    fontWeight: FontWeight.body,
    lineHeight: 22,
  },
  roundAction: { borderRadius: Radius.full },
});
