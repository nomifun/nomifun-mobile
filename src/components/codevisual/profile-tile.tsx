import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Interactive } from '@/components/ui/interactive';

/** Compact profile card with a horizontal identity row and wrapping status metadata. */
export function ProfileTile({
  name,
  subtitle,
  figure,
  badge,
  metadata,
  onPress,
}: {
  name: string;
  subtitle: string;
  figure: ReactNode;
  badge?: ReactNode;
  metadata: ReactNode;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        {
          backgroundColor: pressed ? colors.bgHover : colors.surface,
          borderColor: colors.borderLight,
        },
      ]}
    >
      <View style={styles.header}>
        <View style={styles.figure}>{figure}</View>
        <View style={styles.identity}>
          <View style={styles.titleRow}>
            <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
              {name}
            </Text>
            {badge}
          </View>
          <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textTertiary }]}>
            {subtitle}
          </Text>
        </View>
        <Ionicons name="arrow-forward-outline" size={16} color={colors.textTertiary} />
      </View>
      <View style={[styles.metadata, { borderTopColor: colors.borderLight }]}>{metadata}</View>
    </Interactive>
  );
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  figure: { flexShrink: 0 },
  identity: { flex: 1, minWidth: 0, gap: Spacing.xs },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { flexShrink: 1, fontSize: FontSize.md, lineHeight: 22, fontWeight: '600' },
  subtitle: {
    fontSize: FontSize.xs,
    lineHeight: 18,
  },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: Spacing.xs,
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    marginTop: Spacing.md,
  },
});
