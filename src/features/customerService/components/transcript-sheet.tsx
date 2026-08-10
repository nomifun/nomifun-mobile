/**
 * Read-only visitor transcript. Visitor bubbles left, agent right, system rows
 * centered — the backend has no human-operator role, so there is nothing to
 * reply with here by design.
 */
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { EmptyState, ErrorState, Loading } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { clockLabel } from '../format';
import { useCsDialogueMessages } from '../hooks';
import { dialogueVisitorLabel } from '../normalize';
import type { CsDialogue, CsMessage } from '../types';
import { Sheet } from './sheet';

export function TranscriptSheet({
  dialogue,
  onClose,
}: {
  /** null = closed. */
  dialogue: CsDialogue | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const { messages, isLoading, error, refresh } = useCsDialogueMessages(
    dialogue?.cs_dialogue_id ?? null,
  );

  const renderRow = ({ item }: { item: CsMessage }) => {
    if (item.role === 'system') {
      return (
        <View style={styles.systemRow}>
          <Text style={[styles.systemText, { color: colors.textTertiary }]}>{item.content}</Text>
        </View>
      );
    }
    const fromAgent = item.role === 'agent';
    return (
      <View style={[styles.row, fromAgent ? styles.rowRight : styles.rowLeft]}>
        <View
          style={[
            styles.bubble,
            fromAgent
              ? { backgroundColor: colors.primary, borderBottomRightRadius: Radius.sm }
              : {
                  backgroundColor: colors.surfaceMuted,
                  borderBottomLeftRadius: Radius.sm,
                },
          ]}
        >
          <Text style={[styles.bubbleText, { color: fromAgent ? '#FFFFFF' : colors.text }]}>
            {item.content}
          </Text>
        </View>
        <Text style={[styles.clock, { color: colors.textTertiary }]}>
          {`${fromAgent ? t('dialogues.roleAgent') : t('dialogues.roleVisitor')} · ${clockLabel(item.created_at)}`}
        </Text>
      </View>
    );
  };

  const body = () => {
    if (isLoading && messages.length === 0) return <Loading label={tc('state.loading')} />;
    if (error && messages.length === 0) {
      return (
        <ErrorState
          message={error.message || tc('feedback.requestFailed')}
          onRetry={() => void refresh()}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    if (messages.length === 0) {
      return (
        <EmptyState
          icon="chatbubble-ellipses-outline"
          title={t('dialogues.emptyTranscript')}
          description={t('dialogues.emptyTranscriptHint')}
        />
      );
    }
    return (
      <FlatList
        data={messages}
        keyExtractor={(item) => item.cs_message_id}
        renderItem={renderRow}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={isLoading}
            onRefresh={() => void refresh()}
            tintColor={colors.textTertiary}
          />
        }
      />
    );
  };

  return (
    <Sheet
      visible={dialogue !== null}
      tall
      scroll={false}
      title={dialogue ? t('dialogues.visitor', { id: dialogueVisitorLabel(dialogue) }) : ''}
      subtitle={
        dialogue
          ? `${dialogue.state === 'open' ? t('dialogues.stateOpen') : t('dialogues.stateClosed')} · ${t('dialogues.messageCount', { count: messages.length })}`
          : undefined
      }
      onClose={onClose}
      closeLabel={tc('actions.close')}
    >
      {body()}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingVertical: Spacing.md, gap: Spacing.md },
  row: { maxWidth: '86%', gap: 3 },
  rowLeft: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  rowRight: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  bubble: {
    borderRadius: Radius.lg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm + 2,
  },
  bubbleText: { fontSize: FontSize.sm, lineHeight: 20 },
  clock: { fontSize: FontSize.xs, paddingHorizontal: Spacing.xs },
  systemRow: { alignItems: 'center', paddingVertical: Spacing.xs },
  systemText: { fontSize: FontSize.xs, lineHeight: 17, textAlign: 'center' },
});
