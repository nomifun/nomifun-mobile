import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Switch, View } from 'react-native';

import { Layout, Motion, Radius } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from './interactive';

interface ToggleProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel: string;
}

/** Native switch semantics with consistent monochrome styling and web hit area. */
export function Toggle({ value, onValueChange, disabled, accessibilityLabel }: ToggleProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const position = useRef(new Animated.Value(value ? 20 : 0)).current;
  useEffect(() => {
    const animation = Animated.timing(position, {
      toValue: value ? 20 : 0,
      duration: reduced ? 0 : Motion.fast,
      useNativeDriver: Platform.OS !== 'web',
    });
    animation.start();
    return () => animation.stop();
  }, [position, reduced, value]);

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.target}>
        <Switch
          value={value}
          disabled={disabled}
          accessibilityLabel={accessibilityLabel}
          onValueChange={onValueChange}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={value ? colors.onPrimary : colors.surface}
          ios_backgroundColor={colors.border}
        />
      </View>
    );
  }
  return (
    <Interactive
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      {...a11yState({ checked: value, disabled: !!disabled })}
      {...{
        // RNW maps Space to button roles, not switches; Enter already uses onPress.
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
          if (event.key !== ' ' && event.key !== 'Spacebar') return;
          event.preventDefault();
          event.stopPropagation();
          if (!disabled && !event.repeat) onValueChange?.(!value);
        },
      }}
      disabled={disabled}
      feedback={false}
      onPress={(event) => {
        event.stopPropagation();
        onValueChange?.(!value);
      }}
      style={[styles.target, { opacity: disabled ? 0.45 : 1 }]}
    >
      <View style={[styles.track, { backgroundColor: value ? colors.primary : colors.border }]}>
        <Animated.View
          style={[
            styles.thumb,
            {
              backgroundColor: value ? colors.onPrimary : colors.surface,
              transform: [{ translateX: position }],
            },
          ]}
        />
      </View>
    </Interactive>
  );
}

const styles = StyleSheet.create({
  target: {
    minWidth: 48,
    minHeight: Layout.controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: Radius.sm,
  },
  track: { width: 46, height: 26, borderRadius: Radius.full, padding: 3 },
  thumb: { width: 20, height: 20, borderRadius: Radius.full },
});
