import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export function Card({ children, style }: PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { colors } = useTheme();
  return (
    <View
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }, style]}
    >
      {children}
    </View>
  );
}

export function SectionTitle({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  return <Text style={[styles.section, { color: colors.text }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: 1,
    padding: Spacing.lg,
  },
  section: {
    fontSize: FontSize.sm,
    fontWeight: '600',
    letterSpacing: 0,
    marginBottom: Spacing.sm,
    marginTop: Spacing.xl,
  },
});
