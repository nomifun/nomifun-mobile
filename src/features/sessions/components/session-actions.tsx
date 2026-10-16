import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, ListRow, Notice, Sheet, TextField } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { Conversation } from '../api';

type Mode = 'menu' | 'rename' | 'confirmDelete';

interface SessionActionsProps {
  conversation: Conversation | null;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
  onTogglePin: (pinned: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
}

/**
 * Bottom action sheet for a long-pressed session row. Confirmation lives
 * inside the sheet so the destructive path behaves identically on iOS,
 * Android and web (`Alert.alert` is a no-op in the browser).
 */
export function SessionActions({
  conversation,
  onClose,
  onRename,
  onTogglePin,
  onDelete,
}: SessionActionsProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');

  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [inlineError, setInlineError] = useState('');

  useEffect(() => {
    if (conversation) {
      setMode('menu');
      setName(conversation.name ?? '');
      setBusy(false);
      setInlineError('');
    }
  }, [conversation]);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setInlineError('');
    try {
      await action();
      onClose();
    } catch (error) {
      setInlineError(error instanceof Error ? error.message : tc('feedback.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  const pinned = conversation?.pinned === true;

  return (
    <Sheet
      visible={!!conversation}
      title={conversation?.name?.trim() || t('list.untitled')}
      onClose={onClose}
      closeDisabled={busy}
    >
      {inlineError ? <Notice tone="danger">{inlineError}</Notice> : null}
      {mode === 'menu' ? (
        <View>
          <ListRow
            title={t('actions.rename')}
            compact
            titleNumberOfLines={1}
            left={<Ionicons name="pencil-outline" size={18} color={colors.textSecondary} />}
            disabled={busy}
            onPress={() => setMode('rename')}
          />
          <ListRow
            title={pinned ? t('actions.unpin') : t('actions.pin')}
            compact
            titleNumberOfLines={1}
            left={
              <Ionicons
                name={pinned ? 'remove-circle-outline' : 'pin-outline'}
                size={18}
                color={colors.textSecondary}
              />
            }
            onPress={() => void run(() => onTogglePin(!pinned))}
            disabled={busy}
          />
          <ListRow
            title={t('actions.delete')}
            compact
            titleNumberOfLines={1}
            seamless
            left={<Ionicons name="trash-outline" size={18} color={colors.danger} />}
            tone="danger"
            disabled={busy}
            onPress={() => setMode('confirmDelete')}
          />
        </View>
      ) : null}

      {mode === 'rename' ? (
        <View>
          <TextField
            label={t('actions.renameLabel')}
            placeholder={t('actions.renamePlaceholder')}
            value={name}
            onChangeText={setName}
            autoFocus
            autoCapitalize="sentences"
            maxLength={120}
            editable={!busy}
          />
          <View style={styles.formActions}>
            <Button variant="secondary" onPress={onClose} disabled={busy} style={styles.formButton}>
              {tc('actions.cancel')}
            </Button>
            <Button
              onPress={() => void run(() => onRename(name.trim()))}
              loading={busy}
              disabled={!name.trim() || name.trim() === conversation?.name}
              style={styles.formButton}
            >
              {tc('actions.save')}
            </Button>
          </View>
        </View>
      ) : null}

      {mode === 'confirmDelete' ? (
        <View>
          <Text style={[styles.warning, { color: colors.textSecondary }]}>
            {t('actions.deleteConfirm')}
          </Text>
          <View style={styles.formActions}>
            <Button variant="secondary" onPress={onClose} disabled={busy} style={styles.formButton}>
              {tc('actions.cancel')}
            </Button>
            <Button
              variant="danger"
              onPress={() => void run(onDelete)}
              loading={busy}
              style={styles.formButton}
            >
              {tc('actions.delete')}
            </Button>
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  formActions: { flexDirection: 'row', gap: Spacing.sm },
  formButton: { flex: 1 },
  warning: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.md },
});
