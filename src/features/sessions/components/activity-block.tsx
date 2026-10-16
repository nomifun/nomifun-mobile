import { memo, useMemo, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import Markdown from 'react-native-markdown-display';

import { ActivityPanel, type ActivityStep } from '@/components/codevisual/activity-panel';
import { FontSize } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { thinkingBody, toolEntries, type ChatMessage } from '../stream';
import { markdownStyles } from './markdown-styles';

export const ActivityBlock = memo(function ActivityBlock({
  messages,
  streaming,
}: {
  messages: readonly ChatMessage[];
  streaming: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const [open, setOpen] = useState(false);
  const markdownStyle = useMemo(() => {
    const base = markdownStyles(colors, 'muted');
    return { ...base, body: { ...base.body, fontSize: FontSize.sm, lineHeight: 22 } };
  }, [colors]);

  let thoughtCount = 0;
  let toolCount = 0;
  let duration = 0;
  let running = false;
  const steps: ActivityStep[] = [];
  for (const [messageIndex, message] of messages.entries()) {
    if (message.type === 'thinking') {
      const body = thinkingBody(message.content);
      const text = body.content?.trim() ?? '';
      const active = streaming && message.streaming === true && body.status !== 'done';
      if (!text && !active) continue;
      thoughtCount += 1;
      running ||= active;
      const milliseconds = body.duration && Number.isFinite(body.duration) && body.duration > 0
        ? body.duration
        : 0;
      duration += milliseconds;
      steps.push({
        key: `${message.key}:${messageIndex}`,
        kind: 'thinking',
        title: body.subject?.trim() || t('message.thoughtStep', { count: thoughtCount }),
        state: active ? 'running' : 'done',
        meta: milliseconds
          ? t('message.activityDuration', { seconds: Math.max(1, Math.round(milliseconds / 1000)) })
          : undefined,
        content: open && text ? <Markdown style={markdownStyle}>{text}</Markdown> : undefined,
      });
    } else {
      for (const [index, tool] of toolEntries(message).entries()) {
        if (!tool?.name && !tool?.description) continue;
        toolCount += 1;
        const status = (tool.status ?? '').toLowerCase();
        const error = !!tool.error || ['error', 'failed'].includes(status);
        const done = ['success', 'completed', 'done', 'finish'].includes(status);
        const canceled = ['canceled', 'cancelled'].includes(status);
        const queued = status === 'pending' || status === 'confirming';
        const active = streaming && !error && !done && !canceled && !queued;
        running ||= active;
        const statusKey = error ? 'toolError'
          : done ? 'toolSuccess'
            : canceled ? 'toolCanceled'
              : status === 'confirming' ? 'toolConfirming'
                : queued ? 'toolPending'
                  : active ? 'toolRunning' : 'toolUnknown';
        steps.push({
          key: `${message.key}:${messageIndex}:${tool.call_id || index}`,
          kind: 'tool',
          title: tool.name || t('message.tool'),
          meta: t(`message.${statusKey}`),
          state: error ? 'error' : done ? 'done' : active ? 'running' : 'pending',
          content: open && tool.description?.trim() ? (
            <Text style={[styles.description, { color: colors.textTertiary }]}>
              {tool.description.trim()}
            </Text>
          ) : undefined,
        });
      }
    }
  }
  if (steps.length === 0) return null;
  const summary = [
    thoughtCount ? t('message.activityThoughts', { count: thoughtCount }) : '',
    toolCount ? t('message.activityTools', { count: toolCount }) : '',
    duration ? t('message.activityDuration', { seconds: Math.max(1, Math.round(duration / 1000)) }) : '',
  ].filter(Boolean).join(' · ');
  const title = running ? t('message.thinking')
    : thoughtCount ? t('message.thought') : t('message.toolActivity');

  return (
    <ActivityPanel
      title={title}
      summary={summary}
      running={running}
      open={open}
      toggleLabel={t(open ? 'message.collapse' : 'message.expand')}
      onToggle={() => setOpen((previous) => !previous)}
      steps={steps}
    />
  );
});

const styles = StyleSheet.create({
  description: { fontSize: FontSize.xs, lineHeight: 18 },
});
