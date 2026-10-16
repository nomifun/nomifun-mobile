import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Label/value pair used by the task detail info cards. */
export function InfoRow({
  label,
  value,
  children,
}: {
  label: string;
  value?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { color: colors.textTertiary }]}>{label}</Text>
      <View style={styles.value}>
        {children ?? (
          <Text style={[styles.valueText, { color: colors.text }]} selectable>
            {value || '—'}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  label: { fontSize: FontSize.sm, width: 84, flexShrink: 0 },
  value: { flex: 1, alignItems: 'flex-end' },
  valueText: { fontSize: FontSize.sm, textAlign: 'right', lineHeight: 20 },
});
