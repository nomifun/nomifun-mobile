/**
 * 访客对话监控 — the mobile-first win: the backend read surface
 * (`/dialogues`, `/dialogues/{id}/messages`) exists and no desktop screen uses
 * it. "Who is my bot talking to right now" fits a phone far better than the
 * desktop's config-dense layout.
 *
 * There are NO customer-service WS events, so this is strictly poll-on-demand:
 * pull-to-refresh plus a refresh when the screen regains focus. No timers.
 */
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, ErrorState, ListRow, Loading, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { relativeTimeLabel } from '../format';
import { useCsDialogues } from '../hooks';
import { dialogueVisitorLabel } from '../normalize';
import type { CsDialogue } from '../types';
import { TranscriptSheet } from './transcript-sheet';

export function DialoguesPanel({ csAgentId }: { csAgentId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const { dialogues, isLoading, error, refresh } = useCsDialogues(csAgentId);
  const [open, setOpen] = useState<CsDialogue | null>(null);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  if (isLoading && dialogues.length === 0) return <Loading label={tc('state.loading')} />;

  if (error && dialogues.length === 0) {
    return (
      <ErrorState
        message={error.message || tc('feedback.requestFailed')}
        onRetry={() => void refresh()}
        retryLabel={tc('actions.retry')}
      />
    );
  }

  return (
    <View>
      <View style={[styles.notice, { backgroundColor: colors.surfaceMuted }]}>
        <Ionicons name="cloud-download-outline" size={15} color={colors.textTertiary} />
        <Text style={[styles.noticeText, { color: colors.textTertiary }]}>
          {t('dialogues.pollHint')}
        </Text>
      </View>

      {dialogues.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title={t('dialogues.emptyTitle')}
          description={t('dialogues.emptyHint')}
        />
      ) : (
        dialogues.map((dialogue) => (
          <ListRow
            key={dialogue.cs_dialogue_id}
            title={t('dialogues.visitor', { id: dialogueVisitorLabel(dialogue) })}
            subtitle={t('dialogues.lastActivity', {
              time: relativeTimeLabel(dialogue.last_activity, tc),
            })}
            left={
              <View style={[styles.avatar, { backgroundColor: colors.surfaceMuted }]}>
                <Ionicons
                  name="person-outline"
                  size={18}
                  color={dialogue.state === 'open' ? colors.success : colors.textTertiary}
                />
              </View>
            }
            right={
              <Tag tone={dialogue.state === 'open' ? 'success' : 'neutral'}>
                {dialogue.state === 'open' ? t('dialogues.stateOpen') : t('dialogues.stateClosed')}
              </Tag>
            }
            chevron
            onPress={() => setOpen(dialogue)}
          />
        ))
      )}

      <TranscriptSheet dialogue={open} onClose={() => setOpen(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.md,
  },
  noticeText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
