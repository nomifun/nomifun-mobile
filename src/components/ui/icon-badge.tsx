import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type BadgeTone = 'primary' | 'brand' | 'success' | 'warning' | 'danger' | 'neutral';

interface IconBadgeProps {
  icon: keyof typeof Ionicons.glyphMap;
  tone?: BadgeTone;
  /** Tile edge length; the glyph scales with it. */
  size?: number;
}

/**
 * Rounded-square tinted icon tile — the recurring leading element in grouped
 * settings rows and feature lists. Softer than a bare glyph and quieter than
 * the letter avatars the lists used before.
 */
export function IconBadge({ icon, tone = 'primary', size = 36 }: IconBadgeProps) {
  const { colors } = useTheme();
  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    primary: { bg: colors.primarySoft, fg: colors.primary },
    brand: { bg: colors.brandLight, fg: colors.brand },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  };
  const { bg, fg } = map[tone];
  return (
    <View
      style={[
        styles.tile,
        {
          width: size,
          height: size,
          borderRadius: Radius.md,
          backgroundColor: bg,
        },
      ]}
    >
      <Ionicons name={icon} size={size * 0.55} color={fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: { alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md },
});
