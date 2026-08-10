import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import type { Requirement } from '../types';
import { useRelativeTime } from '../utils';
import { StatusTag } from './status-tag';

interface RequirementRowProps {
  item: Requirement;
  /** Tap opens the detail — except in select mode, where the parent toggles. */
  onPress: () => void;
  /** Long-press enters multi-select (omit to disable the feature). */
  onLongPress?: () => void;
  selecting?: boolean;
  selected?: boolean;
}

/**
 * Two-line list row: identity + status on top, queue metadata below. Metrics
 * mirror the UI kit's ListRow so lists stay visually consistent.
 *
 * In select mode the chevron becomes a checkbox and the row must NOT navigate —
 * the parent passes a toggling `onPress` for exactly that reason.
 */
export function RequirementRow({
  item,
  onPress,
  onLongPress,
  selecting,
  selected,
}: RequirementRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const relative = useRelativeTime();

  return (
    <Pressable
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      {...(selecting ? a11yState({ checked: !!selected, selected: !!selected }) : null)}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed || selected ? colors.surfaceMuted : colors.surface,
          borderColor: selected ? colors.primary : colors.border,
        },
        selected && styles.rowSelected,
      ]}
    >
      <View style={styles.headline}>
        {selecting ? (
          <Ionicons
            name={selected ? 'checkbox' : 'square-outline'}
            size={20}
            color={selected ? colors.primary : colors.textTertiary}
          />
        ) : null}
        <Text style={[styles.displayNo, { color: colors.textTertiary }]}>#{item.display_no}</Text>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <StatusTag status={item.status} />
        {selecting ? null : (
          <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
        )}
      </View>
      <View style={styles.meta}>
        <Tag tone="primary">{item.tag}</Tag>
        {item.attempt_count > 1 ? (
          <Tag tone="warning">{t('list.attempt', { count: item.attempt_count })}</Tag>
        ) : null}
        <View style={styles.spacer} />
        <Text style={[styles.time, { color: colors.textTertiary }]}>
          {relative(item.updated_at)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
    minHeight: 72,
    justifyContent: 'center',
  },
  rowSelected: { borderWidth: 1 },
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  displayNo: { fontSize: FontSize.xs, fontWeight: '700' },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  spacer: { flex: 1 },
  time: { fontSize: FontSize.xs },
});
