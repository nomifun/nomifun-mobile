import { memo, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';

import { Button } from '@/components/ui';
import { AiResponse } from '@/components/codevisual/ai-response';
import { ApiError } from '@/api/types';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { baseName, parseMessageContent } from '../attachments';
import {
  actionableTruncatedRecovery,
  textBody,
  tipsBody,
  type ChatMessage,
} from '../stream';
import { markdownStyles } from './markdown-styles';

interface MessageItemProps {
  message: ChatMessage;
  streaming?: boolean;
  recoveryDisabled?: boolean;
  /** Re-send the last user prompt — the canonical-API recovery for a broken turn. */
  onRetryRecovery?: () => Promise<void>;
  onRecoveryAccepted?: () => void;
}

/** One transcript bubble. Unrenderable payloads collapse to `null`. */
export const MessageItem = memo(function MessageItem({
  message,
  streaming = message.streaming === true,
  recoveryDisabled,
  onRetryRecovery,
  onRecoveryAccepted,
}: MessageItemProps) {
  if (message.type === 'tips') {
    return (
      <TipsBanner
        message={message}
        recoveryDisabled={recoveryDisabled}
        onRetryRecovery={onRetryRecovery}
        onRecoveryAccepted={onRecoveryAccepted}
      />
    );
  }
  // Reasoning and tools render together through the transcript's ActivityBlock.
  if (message.type !== 'text') return null;
  return <TextBubble message={message} streaming={streaming} />;
});

// ── text ───────────────────────────────────────────────────────────

function TextBubble({ message, streaming }: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const raw = textBody(message.content);
  const isUser = message.position === 'right';
  const isSystem = message.position === 'center' || message.position === 'pop';
  const markdownStyle = useMemo(
    () => markdownStyles(colors, isUser ? 'user' : 'assistant'),
    [colors, isUser],
  );
  // Only user text may carry the attachment marker. Decoding it on assistant
  // output would let a model fake attachment chips for files nobody sent —
  // the desktop gates on position for the same reason.
  const { text: body, files } = isUser
    ? parseMessageContent(raw)
    : { text: raw, files: [] as string[] };

  if (!body.trim() && files.length === 0) return null;

  if (isSystem) {
    return (
      <View style={styles.centerWrap}>
        <Text style={[styles.centerText, { color: colors.textTertiary }]}>{body}</Text>
      </View>
    );
  }

  return (
    <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
      <View
        style={[
          styles.bubble,
          isUser
            ? {
                backgroundColor: colors.messageUserBg,
                borderTopRightRadius: Radius.sm,
              }
            : {
                backgroundColor: 'transparent',
                paddingHorizontal: 0,
                paddingTop: 0,
              },
          message.pending ? styles.pending : null,
        ]}
      >
        {body.trim() ? (
          isUser ? (
            <Markdown style={markdownStyle}>{body}</Markdown>
          ) : (
            <AiResponse
              text={body}
              streaming={!!streaming && !message.messageId}
              style={markdownStyle}
            />
          )
        ) : null}
        {files.length > 0 ? (
          <View style={styles.attachments}>
            {files.map((path) => (
              <View key={path} style={[styles.attachment, { backgroundColor: colors.primarySoft }]}>
                <Ionicons name="image-outline" size={12} color={colors.primary} />
                <Text style={[styles.attachmentText, { color: colors.primary }]} numberOfLines={1}>
                  {baseName(path)}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {message.pending ? (
          <Text style={[styles.pendingLabel, { color: colors.textTertiary }]}>
            {t('message.sending')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── tips / notices ─────────────────────────────────────────────────

function TipsBanner({
  message,
  recoveryDisabled = false,
  onRetryRecovery,
  onRecoveryAccepted,
}: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const [continuing, setContinuing] = useState(false);
  const [continued, setContinued] = useState(false);
  const [stale, setStale] = useState(false);
  const [continueError, setContinueError] = useState('');
  const body = tipsBody(message.content);
  if (!body.content.trim()) return null;

  const palette =
    body.type === 'error'
      ? { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle-outline' as const }
      : body.type === 'success'
        ? { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle-outline' as const }
        : body.type === 'warning'
          ? { bg: colors.warningSoft, fg: colors.warning, icon: 'warning-outline' as const }
          : {
              bg: colors.messageTipsBg,
              fg: colors.primary,
              icon: 'information-circle-outline' as const,
            };

  const title =
    body.type === 'error'
      ? t('message.noticeError')
      : body.type === 'success'
        ? t('message.noticeSuccess')
        : body.type === 'warning'
          ? t('message.noticeWarning')
          : t('message.noticeInfo');

  const recovery = actionableTruncatedRecovery(message.content);
  const showContinue = !!recovery && !!onRetryRecovery && !continued && !stale;

  return (
    <View
      accessibilityRole={body.type === 'error' ? 'alert' : undefined}
      style={[styles.tips, { backgroundColor: palette.bg }]}
    >
      <Ionicons name={palette.icon} size={16} color={palette.fg} />
      <View style={styles.tipsBody}>
        <Text style={[styles.tipsTitle, { color: palette.fg }]}>{title}</Text>
        <Text style={[styles.tipsText, { color: colors.textSecondary }]}>
          {body.content.trim()}
        </Text>
        {showContinue ? (
          <Button
            icon="refresh-outline"
            small
            variant="secondary"
            loading={continuing}
            disabled={recoveryDisabled || continuing}
            onPress={() => {
              if (!onRetryRecovery || recoveryDisabled || continuing) {
                return;
              }
              setContinuing(true);
              setContinueError('');
              void onRetryRecovery()
                .then(() => {
                  setContinued(true);
                  onRecoveryAccepted?.();
                })
                .catch((error: unknown) => {
                  if (error instanceof ApiError && error.status === 409) {
                    setStale(true);
                    setContinueError(t('message.continueStale'));
                  } else {
                    setContinueError(t('message.continueFailed'));
                  }
                })
                .finally(() => setContinuing(false));
            }}
          >
            {t('message.continue')}
          </Button>
        ) : continued ? (
          <Text style={[styles.tipsText, { color: palette.fg }]}>
            {t('message.continueStarted')}
          </Text>
        ) : null}
        {continueError ? (
          <Text style={[styles.tipsText, { color: colors.danger }]}>{continueError}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: Spacing.md, minWidth: 0 },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end', paddingLeft: Spacing.xxl },
  bubble: {
    maxWidth: '100%',
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: 2,
    flexShrink: 1,
  },
  pending: { opacity: 0.72 },
  pendingLabel: { fontSize: FontSize.xs, textAlign: 'right', marginBottom: Spacing.xs },
  // Attachment chips only ever render inside the (tinted) user bubble.
  attachments: { gap: Spacing.xs, marginBottom: Spacing.sm, marginTop: 2 },
  attachment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    maxWidth: '100%',
    borderRadius: Radius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  attachmentText: {
    fontSize: FontSize.xs,
    fontWeight: '500',
    flexShrink: 1,
  },
  centerWrap: { alignItems: 'center', marginBottom: Spacing.sm, paddingHorizontal: Spacing.xl },
  centerText: { fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
  tips: {
    flexDirection: 'row',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  tipsBody: { flex: 1, gap: 2 },
  tipsTitle: { fontSize: FontSize.sm, fontWeight: '600' },
  tipsText: { fontSize: FontSize.sm, lineHeight: 22 },
});
