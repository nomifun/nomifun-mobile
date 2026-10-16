/**
 * Multi-select action bar for the requirements list.
 *
 * Sits above the list while select mode is on: count, 全选/取消全选, 删除, 取消.
 * Delete is the only destructive action and it confirms in the parent — this
 * component stays presentational so the reducer keeps all the state rules.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, IconButton } from '@/components/ui';
import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

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
    <View
      style={[styles.bar, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
    >
      <Text style={[styles.count, { color: colors.text }]} numberOfLines={1}>
        {t('select.count', { count })}
      </Text>

      <Button variant="ghost" small onPress={onToggleAll} disabled={busy}>
        {allSelected ? t('select.clearAll') : t('select.selectAll')}
      </Button>

      <IconButton
        icon="trash-outline"
        variant="danger"
        label={tc('actions.delete')}
        onPress={onDelete}
        disabled={busy || count === 0}
        loading={busy}
      />

      <IconButton icon="close" label={tc('actions.cancel')} onPress={onCancel} disabled={busy} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginHorizontal: Spacing.lg,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    minHeight: Layout.controlHeight,
  },
  count: { flex: 1, minWidth: 0, fontSize: FontSize.control, fontWeight: '600' },
});
