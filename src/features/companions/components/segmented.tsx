/** In-screen tab switcher and filter chips (feature-local, not shared UI kit). */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

export interface SegmentItem<T extends string> {
  key: T;
  label: string;
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segmented, { backgroundColor: colors.surfaceMuted }]}>
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            {...a11yState({ selected: active })}
            onPress={() => onChange(item.key)}
            style={[
              styles.segment,
              active && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.segmentLabel,
                { color: active ? colors.primary : colors.textSecondary },
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Horizontally scrollable single-choice chip row. */
export function ChipRow<T extends string>({
  items,
  value,
  onChange,
}: {
  items: SegmentItem<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chipRow}
      keyboardShouldPersistTaps="handled"
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <Pressable
            key={item.key}
            accessibilityRole="button"
            {...a11yState({ selected: active })}
            onPress={() => onChange(item.key)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primarySoft : colors.surface,
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
          >
            <Text
              style={[styles.chipLabel, { color: active ? colors.primary : colors.textSecondary }]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  segmented: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.sm,
  },
  segmentLabel: { fontSize: FontSize.sm, fontWeight: '600' },
  chipRow: { gap: Spacing.sm, paddingVertical: 2 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: '500' },
});
