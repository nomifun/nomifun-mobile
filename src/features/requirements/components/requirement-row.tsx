import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { Requirement } from '../types';
import { useRelativeTime } from '../utils';
import { StatusTag } from './status-tag';

interface RequirementRowProps {
  item: Requirement;
  onPress: () => void;
}

/**
 * Two-line list row: identity + status on top, queue metadata below. Metrics
 * mirror the UI kit's ListRow so lists stay visually consistent.
 */
export function RequirementRow({ item, onPress }: RequirementRowProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const relative = useRelativeTime();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? colors.surfaceMuted : colors.surface, borderColor: colors.border },
      ]}
    >
      <View style={styles.headline}>
        <Text style={[styles.displayNo, { color: colors.textTertiary }]}>#{item.display_no}</Text>
        <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
          {item.title}
        </Text>
        <StatusTag status={item.status} />
        <Ionicons name="chevron-forward" size={15} color={colors.textTertiary} />
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
  headline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  displayNo: { fontSize: FontSize.xs, fontWeight: '700' },
  title: { flex: 1, fontSize: FontSize.md, fontWeight: '600' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  spacer: { flex: 1 },
  time: { fontSize: FontSize.xs },
});
