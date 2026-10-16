import { useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  type PressableProps,
  type PressableStateCallbackType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Motion } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

interface InteractiveState extends PressableStateCallbackType {
  hovered: boolean;
}

type InteractiveProps = Omit<PressableProps, 'style' | 'children'> & {
  feedback?: boolean;
  style?: StyleProp<ViewStyle> | ((state: InteractiveState) => StyleProp<ViewStyle>);
  children?: ReactNode | ((state: InteractiveState) => ReactNode);
};

/** One interaction boundary for pointer, touch, keyboard and reduced motion. */
export function Interactive({
  style,
  children,
  onPressIn,
  onPressOut,
  onHoverIn,
  onHoverOut,
  onFocus,
  onBlur,
  feedback = true,
  disabled,
  ...props
}: InteractiveProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const animate = (next: number) => {
    if (reduced || !feedback) {
      scale.setValue(1);
      return;
    }
    Animated.timing(scale, {
      toValue: next,
      duration: Motion.fast,
      easing: Easing.out(Easing.quad),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };
  const webStyle =
    Platform.OS === 'web'
      ? ({
          transitionProperty: 'background-color, border-color, opacity, box-shadow',
          transitionDuration: `${Motion.fast}ms`,
        } as ViewStyle)
      : undefined;

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      {...(Platform.OS === 'web'
        ? {
            dataSet: {
              interactive: '',
              hovered: hovered ? 'true' : undefined,
              focused: focused ? 'true' : undefined,
            },
          }
        : {})}
      onPressIn={(event) => {
        setPressed(true);
        animate(0.98);
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        setPressed(false);
        animate(1);
        onPressOut?.(event);
      }}
      onHoverIn={(event) => {
        setHovered(true);
        onHoverIn?.(event);
      }}
      onHoverOut={(event) => {
        setHovered(false);
        onHoverOut?.(event);
      }}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        setPressed(false);
        animate(1);
        onBlur?.(event);
      }}
      style={[
        webStyle,
        typeof style === 'function'
          ? style({ pressed: pressed || (hovered && !disabled), hovered })
          : style,
        feedback && { transform: [{ scale }] },
      ]}
    >
      {typeof children === 'function' ? children({ pressed, hovered }) : children}
    </AnimatedPressable>
  );
}
