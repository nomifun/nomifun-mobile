import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
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

import { ErrorState, Loading, Tag, toast } from '@/components/ui';
import { FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import type { Conversation } from '../api';
import { patchConversationModel, useModelOptions } from '../model-options';
import { isSameModel, type ModelGroup } from '../model-switch';

interface ModelSheetProps {
  visible: boolean;
  conversation: Conversation | undefined;
  onClose: () => void;
  /** Called after a successful PATCH so the caller can refetch the row. */
  onChanged: () => void;
}

type Row =
  | { kind: 'header'; group: ModelGroup }
  | { kind: 'model'; group: ModelGroup; model: string };

/**
 * Bottom-sheet model picker for one conversation.
 *
 * Switching a model terminates the cached agent runtime server-side, so the new
 * one takes effect from the next message — the footer says so rather than
 * pretending it applies retroactively.
 */
export function ModelSheet({ visible, conversation, onClose, onChanged }: ModelSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const options = useModelOptions(conversation, visible);
  const [saving, setSaving] = useState<string | null>(null);

  const rows: Row[] = [];
  for (const group of options.groups) {
    rows.push({ kind: 'header', group });
    for (const model of group.models) rows.push({ kind: 'model', group, model });
  }

  const choose = async (group: ModelGroup, model: string) => {
    if (!conversation || saving) return;
    if (isSameModel(options.current, { providerId: group.providerId, model })) {
      onClose();
      return;
    }
    const key = `${group.providerId}:${model}`;
    setSaving(key);
    try {
      await patchConversationModel(conversation.conversation_id, {
        providerId: group.providerId,
        model,
      });
      onChanged();
      toast.success(t('model.switched', { model }));
      onClose();
    } catch (error) {
      toast.error(
        t('model.switchFailed', {
          message: error instanceof Error ? error.message : tc('feedback.requestFailed'),
        }),
      );
    } finally {
      setSaving(null);
    }
  };

  const body = () => {
    if (options.isLoading && options.groups.length === 0) return <Loading label={tc('state.loading')} />;
    if (options.unresolved && options.groups.length === 0) {
      return (
        <ErrorState
          message={t('model.loadFailed')}
          onRetry={options.refresh}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    if (options.groups.length === 0) {
      return (
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={30} color={colors.textTertiary} />
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t('model.emptyTitle')}</Text>
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>{t('model.emptyHint')}</Text>
        </View>
      );
    }
    return (
      <FlatList
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'header' ? `h:${row.group.providerId}` : `m:${row.group.providerId}:${row.model}`
        }
        contentContainerStyle={styles.list}
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return (
              <View style={styles.groupHeader}>
                <Text style={[styles.groupName, { color: colors.textSecondary }]} numberOfLines={1}>
                  {item.group.providerName}
                </Text>
                {item.group.managed ? <Tag tone="primary">{t('model.managed')}</Tag> : null}
              </View>
            );
          }
          const active = isSameModel(options.current, {
            providerId: item.group.providerId,
            model: item.model,
          });
          const key = `${item.group.providerId}:${item.model}`;
          const busy = saving === key;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.model}
              {...a11yState({ selected: active, disabled: saving !== null })}
              disabled={saving !== null}
              onPress={() => void choose(item.group, item.model)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: active ? colors.primarySoft : pressed ? colors.surfaceMuted : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.modelName, { color: active ? colors.primary : colors.text }]}
                numberOfLines={1}
              >
                {item.model}
              </Text>
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : active ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : null}
            </Pressable>
          );
        }}
      />
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      {...(Platform.OS === 'android' ? { statusBarTranslucent: true } : {})}
    >
      <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
        <Pressable accessibilityLabel={tc('actions.close')} style={styles.backdropFill} onPress={onClose} />
        <View
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: Math.max(insets.bottom, Spacing.md),
            },
          ]}
        >
          <View style={styles.head}>
            <View style={styles.headText}>
              <Text style={[styles.title, { color: colors.text }]}>{t('model.title')}</Text>
              <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{t('model.subtitle')}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tc('actions.close')}
              onPress={onClose}
              hitSlop={8}
              style={styles.close}
            >
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </Pressable>
          </View>
          <View style={styles.body}>{body()}</View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { flex: 1 },
  sheet: {
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    maxHeight: '78%',
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: Spacing.lg,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  headText: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.lg, fontWeight: '700' },
  subtitle: { fontSize: FontSize.xs, lineHeight: 17 },
  close: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  body: { minHeight: 180 },
  list: { paddingHorizontal: Spacing.lg, paddingBottom: Spacing.md },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  groupName: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: 48,
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.xs,
  },
  modelName: { flex: 1, fontSize: FontSize.md, fontWeight: '500' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.md, fontWeight: '600' },
  emptyHint: { fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
});
