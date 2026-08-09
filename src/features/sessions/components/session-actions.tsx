import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
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
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');

  const [mode, setMode] = useState<Mode>('menu');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (conversation) {
      setMode('menu');
      setName(conversation.name ?? '');
      setBusy(false);
    }
  }, [conversation]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const pinned = conversation?.pinned === true;

  return (
    <Modal
      visible={!!conversation}
      transparent
      animationType="fade"
      onRequestClose={busy ? undefined : onClose}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tc('actions.close')}
          style={styles.backdropFill}
          onPress={busy ? undefined : onClose}
        />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.surface,
                borderColor: colors.border,
                paddingBottom: Math.max(insets.bottom, Spacing.lg),
              },
            ]}
          >
            <View style={[styles.grabber, { backgroundColor: colors.border }]} />
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {conversation?.name?.trim() || t('list.untitled')}
            </Text>

            {mode === 'menu' ? (
              <View>
                <SheetRow
                  icon="pencil-outline"
                  label={t('actions.rename')}
                  onPress={() => setMode('rename')}
                />
                <SheetRow
                  icon={pinned ? 'remove-circle-outline' : 'pin-outline'}
                  label={pinned ? t('actions.unpin') : t('actions.pin')}
                  onPress={() => void run(() => onTogglePin(!pinned))}
                  disabled={busy}
                />
                <SheetRow
                  icon="trash-outline"
                  label={t('actions.delete')}
                  tone="danger"
                  onPress={() => setMode('confirmDelete')}
                />
              </View>
            ) : null}

            {mode === 'rename' ? (
              <View style={styles.form}>
                <TextField
                  label={t('actions.renameLabel')}
                  placeholder={t('actions.renamePlaceholder')}
                  value={name}
                  onChangeText={setName}
                  autoFocus
                  autoCapitalize="sentences"
                  maxLength={120}
                />
                <View style={styles.formActions}>
                  <Button variant="secondary" onPress={onClose} style={styles.formButton}>
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
              <View style={styles.form}>
                <Text style={[styles.warning, { color: colors.textSecondary }]}>
                  {t('actions.deleteConfirm')}
                </Text>
                <View style={styles.formActions}>
                  <Button variant="secondary" onPress={onClose} style={styles.formButton}>
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
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

function SheetRow({
  icon,
  label,
  onPress,
  tone,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'danger';
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  const color = tone === 'danger' ? colors.danger : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.sheetRow,
        { backgroundColor: pressed ? colors.surfaceMuted : 'transparent', opacity: disabled ? 0.5 : 1 },
      ]}
    >
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.sheetRowLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: {
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
  },
  grabber: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: Spacing.md },
  title: {
    fontSize: FontSize.md,
    fontWeight: '600',
    marginBottom: Spacing.sm,
    textAlign: 'center',
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    minHeight: 52,
    borderRadius: Radius.md,
  },
  sheetRowLabel: { fontSize: FontSize.md, fontWeight: '500' },
  form: { paddingTop: Spacing.sm },
  formActions: { flexDirection: 'row', gap: Spacing.md },
  formButton: { flex: 1 },
  warning: { fontSize: FontSize.sm, lineHeight: 20, marginBottom: Spacing.lg },
});
