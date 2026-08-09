/**
 * 客服笔记 editor — one sheet serves create and edit, mirroring the desktop's
 * single modal.
 *
 * Scope (共享 vs 私有) is a create-only decision: `cs_agent_id` has no PATCH
 * path, so in edit mode the checkbox is replaced by a locked row.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { confirmDestructive } from '../confirm';
import { asNoteKind } from '../normalize';
import type { CsNote, CsNoteKind } from '../types';
import { CS_NOTE_KINDS } from '../types';
import { CheckRow, Chips } from './controls';
import { Sheet } from './sheet';

export interface NoteDraftResult {
  kind: CsNoteKind;
  content: string;
  /** Only meaningful on create. */
  shared: boolean;
}

export function NoteEditorSheet({
  visible,
  note,
  onClose,
  onSubmit,
  onDelete,
}: {
  visible: boolean;
  /** undefined = create mode. */
  note?: CsNote;
  onClose: () => void;
  onSubmit: (draft: NoteDraftResult) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');

  const [kind, setKind] = useState<CsNoteKind>('faq');
  const [content, setContent] = useState('');
  const [shared, setShared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setKind(note ? asNoteKind(note.kind) : 'faq');
    setContent(note?.content ?? '');
    setShared(note ? note.cs_agent_id == null : false);
    setError('');
    setBusy(false);
  }, [visible, note]);

  const submit = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      setError(t('notes.contentRequired'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await onSubmit({ kind, content: trimmed, shared });
    } catch (err) {
      setError(err instanceof Error ? err.message : tc('feedback.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = () => {
    if (!onDelete) return;
    confirmDestructive({
      title: tc('confirm.deleteTitle'),
      message: t('notes.deleteConfirm'),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        setBusy(true);
        void onDelete()
          .catch((err: unknown) => {
            toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
          })
          .finally(() => setBusy(false));
      },
    });
  };

  return (
    <Sheet
      visible={visible}
      title={note ? t('notes.editTitle') : t('notes.add')}
      subtitle={note ? undefined : t('notes.createHint')}
      onClose={onClose}
      closeLabel={tc('actions.close')}
      footer={
        <View style={styles.footer}>
          {onDelete ? (
            <View style={styles.footerSecondary}>
              <Button variant="danger" onPress={remove} disabled={busy}>
                {tc('actions.delete')}
              </Button>
            </View>
          ) : null}
          <View style={styles.footerPrimary}>
            <Button onPress={submit} loading={busy} disabled={!content.trim()}>
              {tc('actions.save')}
            </Button>
          </View>
        </View>
      }
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>{t('notes.kind')}</Text>
      <Chips
        value={kind}
        options={CS_NOTE_KINDS.map((value) => ({ value, label: t(`notes.kind_${value}`) }))}
        onChange={setKind}
      />

      <View style={styles.spacer} />
      <TextField
        label={t('notes.content')}
        placeholder={t('notes.contentPlaceholder')}
        value={content}
        onChangeText={(next) => {
          setContent(next);
          if (error) setError('');
        }}
        error={error || undefined}
        multiline
        style={styles.content}
      />

      {note ? (
        <View style={[styles.locked, { backgroundColor: colors.surfaceMuted }]}>
          <Ionicons name="lock-closed-outline" size={15} color={colors.textTertiary} />
          <Text style={[styles.lockedText, { color: colors.textTertiary }]}>
            {`${note.cs_agent_id == null ? t('notes.shared') : t('notes.private')} · ${t('notes.scopeLocked')}`}
          </Text>
        </View>
      ) : (
        <CheckRow
          title={t('notes.shared')}
          subtitle={t('notes.sharedHint')}
          checked={shared}
          onPress={() => setShared((prev) => !prev)}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.sm },
  spacer: { height: Spacing.lg },
  content: { minHeight: 140, paddingTop: 12, textAlignVertical: 'top' },
  locked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    marginBottom: Spacing.sm,
  },
  lockedText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  footer: { flexDirection: 'row', gap: Spacing.md },
  footerSecondary: { flex: 1 },
  footerPrimary: { flex: 2 },
});
