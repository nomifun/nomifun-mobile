import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ErrorState, Interactive, Loading, Notice, Sheet, Tag, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
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
  { kind: 'header'; group: ModelGroup } | { kind: 'model'; group: ModelGroup; model: string };

/**
 * Bottom-sheet model picker for one conversation.
 *
 * Switching a model terminates the cached agent runtime server-side, so the new
 * one takes effect from the next message — the footer says so rather than
 * pretending it applies retroactively.
 */
export function ModelSheet({ visible, conversation, onClose, onChanged }: ModelSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const options = useModelOptions(conversation, visible);
  const [saving, setSaving] = useState<string | null>(null);
  const [inlineError, setInlineError] = useState('');

  const rows: Row[] = [];
  for (const group of options.groups) {
    rows.push({ kind: 'header', group });
    for (const model of group.models) rows.push({ kind: 'model', group, model });
  }

  const choose = async (group: ModelGroup, model: string) => {
    if (!conversation || saving) return;
    if (isSameModel(options.current, { providerId: group.providerId, model })) {
      if (!saving) onClose();
      return;
    }
    const key = `${group.providerId}:${model}`;
    setSaving(key);
    setInlineError('');
    try {
      await patchConversationModel(conversation.conversation_id, {
        providerId: group.providerId,
        model,
      });
      onChanged();
      onClose();
      toast.success(t('model.switched', { model: group.labels?.[model] ?? model }));
    } catch (error) {
      const message = t('model.switchFailed', {
        message: error instanceof Error ? error.message : tc('feedback.requestFailed'),
      });
      setInlineError(message);
      toast.error(message);
    } finally {
      setSaving(null);
    }
  };

  const body = () => {
    if (options.isLoading && options.groups.length === 0)
      return <Loading label={tc('state.loading')} />;
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
          <Text style={[styles.emptyHint, { color: colors.textTertiary }]}>
            {t('model.emptyHint')}
          </Text>
        </View>
      );
    }
    return (
      <FlatList
        data={rows}
        keyExtractor={(row) =>
          row.kind === 'header'
            ? `h:${row.group.providerId}`
            : `m:${row.group.providerId}:${row.model}`
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
          const label = item.group.labels?.[item.model] ?? item.model;
          return (
            <Interactive
              accessibilityRole="button"
              accessibilityLabel={label === item.model ? label : `${label} · ${item.model}`}
              {...a11yState({ selected: active, disabled: saving !== null })}
              disabled={saving !== null}
              onPress={() => void choose(item.group, item.model)}
              style={({ pressed }) => [
                styles.row,
                {
                  backgroundColor: active
                    ? colors.primarySoft
                    : pressed
                      ? colors.surfaceMuted
                      : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={styles.modelLabel}>
                <Text style={[styles.modelName, { color: active ? colors.primary : colors.text }]} numberOfLines={1}>
                  {label}
                </Text>
                {label !== item.model ? <Text style={{ color: colors.textTertiary, fontSize: FontSize.xs }} numberOfLines={1}>{item.model}</Text> : null}
              </View>
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : active ? (
                <Ionicons name="checkmark-circle" size={20} color={colors.primary} />
              ) : null}
            </Interactive>
          );
        }}
      />
    );
  };

  const close = () => {
    if (saving) return;
    setInlineError('');
    onClose();
  };

  return (
    <Sheet
      visible={visible}
      title={t('model.title')}
      subtitle={t('model.subtitle')}
      onClose={close}
      closeDisabled={!!saving}
      scroll={rows.length === 0}
      contentHeight={
        rows.length > 0
          ? Math.min(
              480,
              rows.reduce<number>(
                (height, row) => height + (row.kind === 'header' ? 40 : 56),
                Spacing.sm * 2,
              ),
            )
          : undefined
      }
    >
      {inlineError ? <Notice tone="danger">{inlineError}</Notice> : null}
      {body()}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { paddingBottom: Spacing.md },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  groupName: { fontSize: FontSize.xs, fontWeight: '600', letterSpacing: 0 },
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
  modelLabel: { flex: 1, minWidth: 0 },
  modelName: { fontSize: FontSize.md, fontWeight: '500' },
  empty: { alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.xxl },
  emptyTitle: { fontSize: FontSize.md, fontWeight: '600' },
  emptyHint: { fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20 },
});
