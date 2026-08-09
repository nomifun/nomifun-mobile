import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { STATUS_FILTERS, type StatusFilter } from '../types';

interface StatusFilterBarProps {
  value: StatusFilter;
  /** Per-status totals from the tag summaries; omitted counts render bare. */
  counts?: Partial<Record<StatusFilter, number>>;
  onChange: (value: StatusFilter) => void;
}

/**
 * Segmented control across the top of the list. Scrolls horizontally because
 * the platform has six statuses plus "all".
 */
export function StatusFilterBar({ value, counts, onChange }: StatusFilterBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
    >
      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        {STATUS_FILTERS.map((option) => {
          const active = option === value;
          const count = counts?.[option];
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              hitSlop={6}
              onPress={() => onChange(option)}
              style={({ pressed }) => [
                styles.pill,
                active && { backgroundColor: colors.surface },
                { opacity: pressed && !active ? 0.6 : 1 },
              ]}
            >
              <Text
                style={[
                  styles.label,
                  { color: active ? colors.text : colors.textSecondary },
                  active && styles.labelActive,
                ]}
                numberOfLines={1}
              >
                {option === 'all' ? t('filter.all') : t(`status.${option}`)}
              </Text>
              {count !== undefined && count > 0 ? (
                <Text
                  style={[styles.count, { color: active ? colors.primary : colors.textTertiary }]}
                >
                  {count}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: Spacing.lg },
  track: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: Radius.full,
    padding: 4,
    gap: 2,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.full,
  },
  label: { fontSize: FontSize.sm, fontWeight: '500' },
  labelActive: { fontWeight: '700' },
  count: { fontSize: FontSize.xs, fontWeight: '600' },
});
