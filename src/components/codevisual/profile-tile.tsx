import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Interactive } from '@/components/ui/interactive';

/** ProfileCard port with real character imagery, centered identity and status metadata. */
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
      <View style={styles.top}>
        {badge}
        <View style={styles.spacer} />
        <Ionicons name="arrow-forward-outline" size={16} color={colors.textTertiary} />
      </View>
      <View style={styles.figure}>{figure}</View>
      <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
        {name}
      </Text>
      <Text numberOfLines={2} style={[styles.subtitle, { color: colors.textTertiary }]}>
        {subtitle}
      </Text>
      <View style={[styles.metadata, { borderTopColor: colors.borderLight }]}>{metadata}</View>
    </Interactive>
  );
}

const styles = StyleSheet.create({
  tile: { borderWidth: 1, borderRadius: Radius.md, padding: Spacing.md, minHeight: 248 },
  top: { height: 24, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  spacer: { flex: 1 },
  figure: { height: 104, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: FontSize.md, lineHeight: 22, fontWeight: '600', textAlign: 'center' },
  subtitle: {
    fontSize: FontSize.xs,
    lineHeight: 18,
    minHeight: 36,
    textAlign: 'center',
    marginTop: Spacing.xs,
  },
  metadata: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    borderTopWidth: 1,
    paddingTop: Spacing.sm,
    marginTop: Spacing.md,
  },
});
