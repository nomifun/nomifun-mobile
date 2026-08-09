/**
 * Memory detail / compose sheet.
 *
 * `memory === null` is compose mode (POST); otherwise the row is edited in place
 * (PUT content/pinned/status, DELETE). Ownership is fixed at write time — the
 * `companion_id` sent on every mutation is the actor, not a new owner.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { createMemory, deleteMemory, updateMemory } from '../api';
import type { CompanionMemory, MemoryKind } from '../types';
import { MEMORY_KINDS, confirmDestructive, formatTimestamp } from '../utils';
import { InfoRow } from './rows';
import { ChipRow } from './segmented';
import { Sheet } from './sheet';

export function MemorySheet({
  companionId,
  memory,
  visible,
  onClose,
  onChanged,
}: {
  companionId: string;
  memory: CompanionMemory | null;
  visible: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');

  const [content, setContent] = useState('');
  const [kind, setKind] = useState<MemoryKind>('preference');
  const [pinned, setPinned] = useState(false);
  const [busy, setBusy] = useState(false);

  const memoryId = memory?.memory_id ?? null;

  // Re-seed the draft whenever the sheet opens on a different row.
  useEffect(() => {
    if (!visible) return;
    setContent(memory?.content ?? '');
    setKind(memory?.kind ?? 'preference');
    setPinned(memory?.pinned ?? false);
  }, [visible, memoryId, memory?.content, memory?.kind, memory?.pinned]);

  const close = () => {
    if (busy) return;
    onClose();
  };

  const run = (action: () => Promise<unknown>, successText: string, closeAfter = true) => {
    if (busy) return;
    setBusy(true);
    void (async () => {
      try {
        await action();
        toast.success(successText);
        onChanged();
        if (closeAfter) onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : t('memory.saveFailed'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const save = () => {
    const text = content.trim();
    if (!text) return;
    if (!memory) {
      run(() => createMemory(companionId, kind, text), tc('feedback.saved'));
      return;
    }
    run(
      () => updateMemory(memory.memory_id, companionId, { content: text, pinned }),
      tc('feedback.saved'),
    );
  };

  const toggleArchive = () => {
    if (!memory) return;
    const next = memory.status === 'archived' ? 'active' : 'archived';
    run(
      () => updateMemory(memory.memory_id, companionId, { status: next }),
      next === 'archived' ? t('memory.archived') : t('memory.restored'),
    );
  };

  const remove = () => {
    if (!memory) return;
    confirmDestructive({
      title: t('memory.deleteConfirmTitle'),
      message: t('memory.deleteConfirmBody'),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () =>
        run(() => deleteMemory(memory.memory_id, companionId), tc('feedback.deleted')),
    });
  };

  const dirty = memory
    ? content.trim() !== memory.content || pinned !== memory.pinned
    : content.trim().length > 0;

  return (
    <Sheet
      visible={visible}
      title={memory ? t('memory.detailTitle') : t('memory.composeTitle')}
      onClose={close}
      closeLabel={tc('actions.close')}
      footer={
        <>
          <Button onPress={save} loading={busy} disabled={!dirty}>
            {tc('actions.save')}
          </Button>
          {memory ? (
            <View style={styles.actions}>
              <View style={styles.action}>
                <Button variant="secondary" onPress={toggleArchive} disabled={busy}>
                  {memory.status === 'archived' ? t('memory.restore') : t('memory.archive')}
                </Button>
              </View>
              <View style={styles.action}>
                <Button variant="danger" onPress={remove} disabled={busy}>
                  {tc('actions.delete')}
                </Button>
              </View>
            </View>
          ) : null}
        </>
      }
    >
      {!memory ? (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('memory.kindLabel')}
          </Text>
          <View style={styles.chips}>
            <ChipRow
              items={MEMORY_KINDS.map((k) => ({ key: k, label: t(`kinds.${k}`) }))}
              value={kind}
              onChange={setKind}
            />
          </View>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t('memory.composeKindHint')}
          </Text>
        </>
      ) : null}

      <TextField
        label={t('memory.contentLabel')}
        placeholder={t('memory.contentPlaceholder')}
        value={content}
        onChangeText={setContent}
        multiline
        style={styles.textarea}
      />

      {memory ? (
        <>
          <View style={styles.switchRow}>
            <View style={styles.switchBody}>
              <Text style={[styles.switchLabel, { color: colors.text }]}>
                {t('memory.pinLabel')}
              </Text>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t('memory.pinHint')}
              </Text>
            </View>
            <Switch
              value={pinned}
              onValueChange={setPinned}
              trackColor={{ false: colors.surfaceMuted, true: colors.primarySoft }}
              thumbColor={pinned ? colors.primary : colors.textTertiary}
            />
          </View>

          <View style={styles.meta}>
            <InfoRow label={t('memory.metaKind')} value={t(`kinds.${memory.kind}`)} />
            <InfoRow label={t('memory.metaImportance')} value={String(memory.importance)} />
            <InfoRow label={t('memory.metaSource')} value={memory.source || '—'} muted />
            <InfoRow
              label={t('memory.metaCreatedAt')}
              value={formatTimestamp(memory.created_at)}
              muted
            />
            <InfoRow
              label={t('memory.metaUpdatedAt')}
              value={formatTimestamp(memory.updated_at)}
              muted
            />
          </View>
        </>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '500', marginBottom: Spacing.sm },
  chips: { marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  textarea: { minHeight: 110, paddingTop: Spacing.md, textAlignVertical: 'top' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 44,
    marginBottom: Spacing.md,
  },
  switchBody: { flex: 1, gap: 2 },
  switchLabel: { fontSize: FontSize.md, fontWeight: '600' },
  meta: { gap: 2 },
  actions: { flexDirection: 'row', gap: Spacing.sm },
  action: { flex: 1 },
});
