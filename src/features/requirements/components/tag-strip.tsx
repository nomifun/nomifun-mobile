import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { TagSummary } from '../types';

interface TagStripProps {
  tags: TagSummary[];
  /** Undefined = no tag filter. */
  selected?: string;
  onSelect: (tag?: string) => void;
}

/**
 * Compact tag summary strip: one chip per queue with its total, plus a pause
 * marker when AutoWork stopped claiming that tag.
 */
export function TagStrip({ tags, selected, onSelect }: TagStripProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  if (tags.length === 0) return null;

  const total = tags.reduce((sum, item) => sum + item.total, 0);

  const chip = (
    key: string,
    label: string,
    count: number,
    active: boolean,
    onPress: () => void,
    paused?: boolean,
  ) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? colors.primarySoft : colors.surface,
          borderColor: active ? colors.primary : colors.border,
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      {paused ? <Ionicons name="pause-circle" size={13} color={colors.warning} /> : null}
      <Text
        style={[styles.chipLabel, { color: active ? colors.primary : colors.textSecondary }]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <Text style={[styles.chipCount, { color: active ? colors.primary : colors.textTertiary }]}>
        {count}
      </Text>
    </Pressable>
  );

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      {chip('__all__', t('filter.allTags'), total, selected === undefined, () => onSelect(undefined))}
      {tags.map((item) =>
        chip(
          item.tag,
          item.tag,
          item.total,
          selected === item.tag,
          () => onSelect(selected === item.tag ? undefined : item.tag),
          item.paused,
        ),
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.lg, gap: Spacing.sm, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 200,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: '600', flexShrink: 1 },
  chipCount: { fontSize: FontSize.xs, fontWeight: '600' },
});
