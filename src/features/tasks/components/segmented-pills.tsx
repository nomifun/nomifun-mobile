import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface PillOption<T extends string> {
  value: T;
  label: string;
  /** Small trailing count, e.g. the number of tasks in this bucket. */
  badge?: number;
}

interface SegmentedPillsProps<T extends string> {
  options: PillOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Horizontally scrollable when the options do not fit (frequency presets). */
  scrollable?: boolean;
}

/** Row of selectable pills — 44px tall so it is comfortable on a phone. */
export function SegmentedPills<T extends string>({
  options,
  value,
  onChange,
  scrollable,
}: SegmentedPillsProps<T>) {
  const { colors } = useTheme();

  const row = options.map((option) => {
    const selected = option.value === value;
    return (
      <Pressable
        key={option.value}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        onPress={() => onChange(option.value)}
        style={({ pressed }) => [
          styles.pill,
          {
            backgroundColor: selected ? colors.primarySoft : colors.surface,
            borderColor: selected ? colors.primary : colors.border,
            opacity: pressed ? 0.75 : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[styles.label, { color: selected ? colors.primary : colors.textSecondary }]}
        >
          {option.label}
          {option.badge !== undefined ? ` ${option.badge}` : ''}
        </Text>
      </Pressable>
    );
  });

  if (!scrollable) return <View style={styles.row}>{row}</View>;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {row}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'nowrap' },
  pill: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  label: { fontSize: FontSize.sm, fontWeight: '600' },
});
