import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** Three pulsing dots shown while a turn is streaming. */
export function TypingIndicator() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 3,
        duration: 1200,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View style={styles.row}>
      <View style={[styles.bubble, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        {[0, 1, 2].map((index) => (
          <Animated.View
            key={index}
            style={[
              styles.dot,
              {
                backgroundColor: colors.textTertiary,
                opacity: progress.interpolate({
                  inputRange: [index, index + 0.5, index + 1, 3],
                  outputRange: [0.3, 1, 0.3, 0.3],
                  extrapolate: 'clamp',
                }),
              },
            ]}
          />
        ))}
        <Text style={[styles.label, { color: colors.textTertiary }]}>{t('detail.typing')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: Spacing.sm },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  label: { fontSize: FontSize.xs, marginLeft: Spacing.xs },
});
