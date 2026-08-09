/**
 * 客服笔记 list — FAQ / 话术 / 业务事实 the agent may quote. The runtime only
 * ever reads them (`cs_notes_search`), so this is the one place they are
 * authored.
 *
 * Enable toggles are optimistic; a failed write refetches the authoritative
 * list so the switch cannot lie.
 */
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Tag, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import * as csApi from '../api';
import { useCsNotes } from '../hooks';
import { asNoteKind } from '../normalize';
import type { CsNote } from '../types';
import { NoteEditorSheet, type NoteDraftResult } from './note-editor-sheet';

export function NotesPanel({ csAgentId }: { csAgentId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const { notes, isLoading, error, refresh, mutateLocal } = useCsNotes(csAgentId);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CsNote | null>(null);

  const fail = (err: unknown) =>
    toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));

  const toggle = (note: CsNote, enabled: boolean) => {
    mutateLocal(
      notes.map((row) => (row.cs_note_id === note.cs_note_id ? { ...row, enabled } : row)),
    );
    void csApi
      .patchNote(note.cs_note_id, { enabled })
      .then(() => void refresh())
      .catch((err: unknown) => {
        fail(err);
        void refresh();
      });
  };

  const create = async (draft: NoteDraftResult) => {
    await csApi.createNote({
      // Scope is decided here and can never be changed afterwards.
      cs_agent_id: draft.shared ? null : csAgentId,
      kind: draft.kind,
      content: draft.content,
      enabled: true,
    });
    setCreating(false);
    await refresh();
    toast.success(t('notes.created'));
  };

  const update = async (draft: NoteDraftResult) => {
    if (!editing) return;
    await csApi.patchNote(editing.cs_note_id, { kind: draft.kind, content: draft.content });
    setEditing(null);
    await refresh();
    toast.success(t('notes.updated'));
  };

  const remove = async () => {
    if (!editing) return;
    await csApi.deleteNote(editing.cs_note_id);
    setEditing(null);
    await refresh();
    toast.success(t('notes.deleted'));
  };

  const addButton = (
    <Button small onPress={() => setCreating(true)}>
      {t('notes.add')}
    </Button>
  );

  if (isLoading && notes.length === 0) return <Loading label={tc('state.loading')} />;

  if (error && notes.length === 0) {
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
      {notes.length === 0 ? (
        <EmptyState
          icon="document-text-outline"
          title={t('notes.emptyTitle')}
          description={t('notes.empty')}
          action={<Button onPress={() => setCreating(true)}>{t('notes.add')}</Button>}
        />
      ) : (
        <>
          <View style={styles.head}>
            <Text style={[styles.count, { color: colors.textTertiary }]}>
              {t('notes.count', { count: notes.length })}
            </Text>
            {addButton}
          </View>

          {notes.map((note) => (
            <Pressable
              key={note.cs_note_id}
              accessibilityRole="button"
              onPress={() => setEditing(note)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                  borderColor: colors.border,
                  opacity: note.enabled ? 1 : 0.6,
                },
              ]}
            >
              <View style={styles.cardHead}>
                <Tag tone="primary">{t(`notes.kind_${asNoteKind(note.kind)}`)}</Tag>
                <Tag tone={note.cs_agent_id == null ? 'warning' : 'neutral'}>
                  {note.cs_agent_id == null ? t('notes.shared') : t('notes.private')}
                </Tag>
                <View style={styles.spacer} />
                <Switch
                  value={note.enabled}
                  onValueChange={(next) => toggle(note, next)}
                  trackColor={{ true: colors.primary, false: colors.surfaceMuted }}
                  thumbColor={colors.background}
                  ios_backgroundColor={colors.surfaceMuted}
                />
              </View>
              <Text style={[styles.content, { color: colors.text }]} numberOfLines={3}>
                {note.content}
              </Text>
              <View style={styles.cardFoot}>
                <Ionicons name="create-outline" size={13} color={colors.textTertiary} />
                <Text style={[styles.footText, { color: colors.textTertiary }]}>
                  {t('notes.tapToEdit')}
                </Text>
              </View>
            </Pressable>
          ))}
        </>
      )}

      <NoteEditorSheet visible={creating} onClose={() => setCreating(false)} onSubmit={create} />
      <NoteEditorSheet
        visible={editing !== null}
        note={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSubmit={update}
        onDelete={remove}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  count: { fontSize: FontSize.sm },
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    gap: Spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  spacer: { flex: 1 },
  content: { fontSize: FontSize.sm, lineHeight: 20 },
  cardFoot: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  footText: { fontSize: FontSize.xs },
});
