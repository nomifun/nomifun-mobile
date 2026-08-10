/**
 * Multi-select action bar for the requirements list.
 *
 * Sits above the list while select mode is on: count, 全选/取消全选, 删除, 取消.
 * Delete is the only destructive action and it confirms in the parent — this
 * component stays presentational so the reducer keeps all the state rules.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

interface SelectionBarProps {
  count: number;
  allSelected: boolean;
  busy?: boolean;
  onToggleAll: () => void;
  onDelete: () => void;
  onCancel: () => void;
}

export function SelectionBar({
  count,
  allSelected,
  busy,
  onToggleAll,
  onDelete,
  onCancel,
}: SelectionBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');

  return (
    <View style={[styles.bar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}>
      <Text style={[styles.count, { color: colors.text }]} numberOfLines={1}>
        {t('select.count', { count })}
      </Text>

      <Pressable
        accessibilityRole="button"
        onPress={onToggleAll}
        disabled={busy}
        hitSlop={6}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Text style={[styles.actionText, { color: colors.primary }]}>
          {allSelected ? t('select.clearAll') : t('select.selectAll')}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tc('actions.delete')}
        {...a11yState({ busy: !!busy })}
        onPress={onDelete}
        disabled={busy}
        hitSlop={6}
        style={({ pressed }) => [styles.action, { opacity: pressed || busy ? 0.6 : 1 }]}
      >
        <Ionicons name="trash-outline" size={18} color={colors.danger} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={tc('actions.cancel')}
        onPress={onCancel}
        disabled={busy}
        hitSlop={6}
        style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}
      >
        <Ionicons name="close" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginHorizontal: Spacing.lg,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: 48,
  },
  count: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  action: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: Spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: { fontSize: FontSize.sm, fontWeight: '600' },
});
