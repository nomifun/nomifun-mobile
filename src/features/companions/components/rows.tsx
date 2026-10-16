/** Small read-only presentation rows shared by the companion detail tabs. */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Label on the left, value (or a hint when unset) on the right. */
export function InfoRow({
  label,
  value,
  muted,
  right,
}: {
  label: string;
  value?: string;
  muted?: boolean;
  right?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      {right ?? (
        <Text
          style={[styles.infoValue, { color: muted ? colors.textTertiary : colors.text }]}
          numberOfLines={1}
        >
          {value}
        </Text>
      )}
    </View>
  );
}

export function StatCell({ label, value }: { label: string; value: string | number }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: colors.surfaceMuted }]}>
      <Text style={[styles.statValue, { color: colors.text }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.textTertiary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

/** Footnote explaining that something is only editable on the desktop. */
export function DesktopHint({ text }: { text: string }) {
  const { colors } = useTheme();
  return <Text style={[styles.hint, { color: colors.textTertiary }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    minHeight: 32,
  },
  infoLabel: { fontSize: FontSize.sm, flexShrink: 0 },
  infoValue: { fontSize: FontSize.sm, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  stat: {
    flexGrow: 1,
    flexBasis: '46%',
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.md,
    gap: 2,
  },
  statValue: { fontSize: FontSize.xl, fontWeight: '700' },
  statLabel: { fontSize: FontSize.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
});
