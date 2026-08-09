/**
 * The one place a companion is drawn. The desktop's characters are inline SVG
 * with CSS `@keyframes` (no Live2D, no sprites) and `react-native-svg` is not a
 * dependency here — so a built-in character renders as a tinted glyph badge and
 * a DIY figure renders its library image (that route is auth-exempt).
 */
import { Image, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Radius } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { CompanionProfile } from '../types';
import { CHARACTER_ICONS, MOOD_VISUALS, characterOf, figureImageUri, moodOf } from '../utils';

interface CompanionFigureProps {
  companion: CompanionProfile;
  size?: number;
  /** Live mood; omit to hide the mood badge. */
  mood?: string;
  /** Show a "thinking" ring while a learn pass runs. */
  busy?: boolean;
}

export function CompanionFigure({ companion, size = 48, mood, busy }: CompanionFigureProps) {
  const { colors } = useTheme();
  const character = characterOf(companion.character);

  const tint: Record<typeof character, { bg: string; fg: string }> = {
    mochi: { bg: colors.dangerSoft, fg: colors.danger },
    ink: { bg: colors.surfaceMuted, fg: colors.brand },
    bolt: { bg: colors.primarySoft, fg: colors.primary },
    custom: { bg: colors.successSoft, fg: colors.success },
  };
  const { bg, fg } = tint[character];
  const uri = character === 'custom' ? figureImageUri(companion.appearance?.custom_figure) : null;
  const badge = Math.round(size * 0.36);
  const showBadge = !!mood && size >= 40;

  return (
    <View style={{ width: size, height: size }}>
      <View
        style={[
          styles.frame,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            backgroundColor: bg,
            borderColor: busy ? colors.primary : 'transparent',
            borderWidth: busy ? 2 : 0,
          },
        ]}
      >
        {uri ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            resizeMode="cover"
            accessibilityLabel={companion.name}
          />
        ) : (
          <Ionicons name={CHARACTER_ICONS[character]} size={Math.round(size * 0.5)} color={fg} />
        )}
      </View>

      {showBadge ? (
        <View
          style={[
            styles.badge,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        >
          <Ionicons
            name={MOOD_VISUALS[moodOf(mood)].icon}
            size={Math.round(badge * 0.66)}
            color={colors.textSecondary}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: Radius.full,
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
