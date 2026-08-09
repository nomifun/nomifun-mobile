import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Markdown from 'react-native-markdown-display';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { ToolCallContent } from '../api';
import { textBody, thinkingBody, tipsBody, toolEntries, type ChatMessage } from '../stream';
import { markdownStyles } from './markdown-styles';

interface MessageItemProps {
  message: ChatMessage;
}

/** One transcript bubble. Unrenderable payloads collapse to `null`. */
export const MessageItem = memo(function MessageItem({ message }: MessageItemProps) {
  if (message.type === 'tips') return <TipsBanner message={message} />;
  if (message.type === 'thinking') return <ThinkingBlock message={message} />;
  if (message.type === 'tool_call' || message.type === 'tool_group') {
    return <ToolChips message={message} />;
  }
  return <TextBubble message={message} />;
});

// ── text ───────────────────────────────────────────────────────────

function TextBubble({ message }: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const body = textBody(message.content);
  const isUser = message.position === 'right';
  const isSystem = message.position === 'center' || message.position === 'pop';

  if (!body.trim()) return null;

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
            ? { backgroundColor: colors.primary, borderTopRightRadius: Radius.sm }
            : {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                borderWidth: StyleSheet.hairlineWidth,
                borderTopLeftRadius: Radius.sm,
              },
          message.pending ? styles.pending : null,
        ]}
      >
        <Markdown style={markdownStyles(colors, isUser ? 'user' : 'assistant')}>{body}</Markdown>
        {message.pending ? (
          <Text style={[styles.pendingLabel, { color: 'rgba(255,255,255,0.8)' }]}>
            {t('message.sending')}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ── thinking ───────────────────────────────────────────────────────

function ThinkingBlock({ message }: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const [open, setOpen] = useState(false);
  const body = thinkingBody(message.content);
  const text = (body.content ?? '').trim();
  const done = body.status === 'done';
  const seconds = body.duration ? Math.max(1, Math.round(body.duration / 1000)) : undefined;

  if (!text && done) return null;

  const label = body.subject?.trim()
    ? body.subject.trim()
    : done
      ? seconds
        ? t('message.thoughtDuration', { seconds })
        : t('message.thought')
      : t('message.thinking');

  return (
    <View style={[styles.row, styles.rowLeft]}>
      <Pressable
        accessibilityRole="button"
        onPress={() => setOpen((prev) => !prev)}
        style={[styles.thinking, { backgroundColor: colors.surfaceMuted }]}
      >
        <View style={styles.thinkingHeader}>
          <Ionicons name="bulb-outline" size={14} color={colors.textTertiary} />
          <Text style={[styles.thinkingLabel, { color: colors.textTertiary }]} numberOfLines={1}>
            {label}
          </Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={14}
            color={colors.textTertiary}
          />
        </View>
        {open && text ? (
          <Text style={[styles.thinkingBody, { color: colors.textSecondary }]}>{text}</Text>
        ) : null}
      </Pressable>
    </View>
  );
}

// ── tips / notices ─────────────────────────────────────────────────

function TipsBanner({ message }: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const body = tipsBody(message.content);
  if (!body.content.trim()) return null;

  const palette =
    body.type === 'error'
      ? { bg: colors.dangerSoft, fg: colors.danger, icon: 'alert-circle-outline' as const }
      : body.type === 'success'
        ? { bg: colors.successSoft, fg: colors.success, icon: 'checkmark-circle-outline' as const }
        : { bg: colors.warningSoft, fg: colors.warning, icon: 'information-circle-outline' as const };

  const title =
    body.type === 'error'
      ? t('message.noticeError')
      : body.type === 'success'
        ? t('message.noticeSuccess')
        : t('message.noticeWarning');

  return (
    <View style={[styles.tips, { backgroundColor: palette.bg }]}>
      <Ionicons name={palette.icon} size={16} color={palette.fg} />
      <View style={styles.tipsBody}>
        <Text style={[styles.tipsTitle, { color: palette.fg }]}>{title}</Text>
        <Text style={[styles.tipsText, { color: colors.textSecondary }]}>{body.content.trim()}</Text>
      </View>
    </View>
  );
}

// ── tool calls ─────────────────────────────────────────────────────

function ToolChips({ message }: MessageItemProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const entries = toolEntries(message).filter((entry) => entry.name || entry.description);
  if (entries.length === 0) return null;

  return (
    <View style={[styles.row, styles.rowLeft]}>
      <View style={styles.chipWrap}>
        {entries.map((entry, index) => {
          const { fg, label } = toolStatus(entry, colors, t);
          return (
            <View
              key={entry.call_id ?? `${entry.name ?? 'tool'}-${index}`}
              style={[styles.chip, { backgroundColor: colors.surfaceMuted }]}
            >
              <Ionicons name="construct-outline" size={12} color={fg} />
              <Text style={[styles.chipName, { color: colors.textSecondary }]} numberOfLines={1}>
                {entry.name || t('message.tool')}
              </Text>
              <Text style={[styles.chipStatus, { color: fg }]}>{label}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function toolStatus(
  entry: ToolCallContent,
  colors: ReturnType<typeof useTheme>['colors'],
  t: (key: string) => string,
): { fg: string; label: string } {
  const status = (entry.status ?? '').toLowerCase();
  if (status === 'error' || entry.error) return { fg: colors.danger, label: t('message.toolError') };
  if (status === 'success' || status === 'completed') {
    return { fg: colors.success, label: t('message.toolSuccess') };
  }
  if (status === 'canceled') return { fg: colors.textTertiary, label: t('message.toolCanceled') };
  if (status === 'confirming') return { fg: colors.primary, label: t('message.toolConfirming') };
  if (status === 'pending') return { fg: colors.textTertiary, label: t('message.toolPending') };
  return { fg: colors.warning, label: t('message.toolRunning') };
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: Spacing.sm },
  rowLeft: { justifyContent: 'flex-start', paddingRight: Spacing.xxl },
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
  centerWrap: { alignItems: 'center', marginBottom: Spacing.sm, paddingHorizontal: Spacing.xl },
  centerText: { fontSize: FontSize.xs, textAlign: 'center', lineHeight: 18 },
  thinking: {
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    flexShrink: 1,
  },
  thinkingHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 24 },
  thinkingLabel: { fontSize: FontSize.sm, fontWeight: '500', flexShrink: 1 },
  thinkingBody: { fontSize: FontSize.sm, lineHeight: 20, marginTop: Spacing.sm },
  tips: {
    flexDirection: 'row',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  tipsBody: { flex: 1, gap: 2 },
  tipsTitle: { fontSize: FontSize.sm, fontWeight: '600' },
  tipsText: { fontSize: FontSize.sm, lineHeight: 19 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, flexShrink: 1 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    maxWidth: '100%',
  },
  chipName: { fontSize: FontSize.xs, fontWeight: '500', flexShrink: 1 },
  chipStatus: { fontSize: FontSize.xs, fontWeight: '600' },
});
