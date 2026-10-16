import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Layout, Motion, Radius, Spacing } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from './interactive';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  badge?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  variant?: 'segmented' | 'chips';
  scrollable?: boolean;
  label?: string;
  style?: StyleProp<ViewStyle>;
}

/** Adapts CodeVisual's selected filter state into a real, keyboard-operable control. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'segmented',
  scrollable = false,
  label,
  style,
}: SegmentedControlProps<T>) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [positions, setPositions] = useState<Record<string, { x: number; width: number }>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  const chips = variant === 'chips';
  const position = positions[value];

  useEffect(() => {
    if (!position || chips) return;
    const animation = Animated.parallel([
      Animated.timing(left, {
        toValue: position.x,
        duration: reduced ? 0 : Motion.normal,
        useNativeDriver: false,
      }),
      Animated.timing(width, {
        toValue: position.width,
        duration: reduced ? 0 : Motion.normal,
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [chips, left, position, reduced, width]);

  const row = (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      style={[styles.track, chips && styles.chips]}
    >
      {!chips ? (
        <View
          pointerEvents="none"
          style={[styles.rail, { backgroundColor: colors.surfaceMuted }]}
        />
      ) : null}
      {!chips && position ? (
        <Animated.View
          style={[
            styles.indicator,
            {
              left,
              width,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            },
          ]}
        />
      ) : null}
      {options.map((option, index) => {
        const selected = option.value === value;
        const foreground =
          chips && selected ? colors.onPrimary : selected ? colors.text : colors.textSecondary;
        return (
          <Interactive
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            {...a11yState({ selected, disabled: !!option.disabled })}
            disabled={option.disabled}
            feedback={chips}
            onLayout={({ nativeEvent: { layout } }) => {
              setPositions((current) =>
                current[option.value]?.x === layout.x &&
                current[option.value]?.width === layout.width
                  ? current
                  : {
                      ...current,
                      [option.value]: { x: layout.x, width: layout.width },
                    },
              );
            }}
            {...(Platform.OS === 'web'
              ? {
                  title: option.label,
                  tabIndex: selected ? 0 : -1,
                  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                    event.preventDefault();
                    const enabled = options
                      .map((item, i) => ({ ...item, index: i }))
                      .filter((item) => !item.disabled);
                    const at = enabled.findIndex((item) => item.index === index);
                    const next =
                      event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? enabled.length - 1
                          : (at + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) %
                            enabled.length;
                    const target = enabled[next];
                    if (!target) return;
                    onChange(target.value);
                    (
                      event.currentTarget.parentElement?.querySelectorAll('[role="tab"]')[
                        target.index
                      ] as HTMLElement | undefined
                    )?.focus();
                  },
                }
              : {})}
            onPress={() => onChange(option.value)}
            style={[
              styles.option,
              !chips && !scrollable && styles.equal,
              { opacity: option.disabled ? 0.45 : 1 },
            ]}
          >
            {({ pressed, hovered }) => (
              <View
                pointerEvents="none"
                style={[
                  styles.content,
                  chips && {
                    borderWidth: 1,
                    borderColor: selected ? colors.primary : colors.border,
                    backgroundColor: selected
                      ? colors.primary
                      : pressed || hovered
                        ? colors.bgHover
                        : colors.surface,
                  },
                ]}
              >
                {option.icon ? <Ionicons name={option.icon} size={15} color={foreground} /> : null}
                <Text numberOfLines={1} style={[styles.label, { color: foreground }]}>
                  {option.label}
                </Text>
                {option.badge !== undefined ? (
                  <Text style={[styles.count, { color: foreground }]}>{option.badge}</Text>
                ) : null}
              </View>
            )}
          </Interactive>
        );
      })}
    </View>
  );

  return scrollable ? (
    <ScrollView
      horizontal
      style={[styles.viewport, style]}
      contentContainerStyle={styles.scroll}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {row}
    </ScrollView>
  ) : (
    <View style={style}>{row}</View>
  );
}

const styles = StyleSheet.create({
  viewport: { flexGrow: 0, flexShrink: 0 },
  scroll: { paddingVertical: 2 },
  track: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    paddingHorizontal: 2,
    gap: 2,
    position: 'relative',
  },
  chips: { paddingHorizontal: 0, gap: Spacing.xs },
  rail: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
    right: 0,
    borderRadius: Radius.md,
  },
  indicator: {
    pointerEvents: 'none',
    position: 'absolute',
    top: 6,
    bottom: 6,
    borderRadius: Radius.sm,
    borderWidth: 1,
  },
  option: {
    minHeight: Layout.controlHeight,
    justifyContent: 'center',
    borderRadius: Radius.sm,
    minWidth: 0,
  },
  content: {
    minHeight: Layout.compactControlHeight,
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.sm,
    minWidth: 0,
  },
  equal: { flex: 1 },
  label: {
    fontSize: FontSize.control,
    fontWeight: FontWeight.body,
    flexShrink: 1,
  },
  count: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.body,
    fontVariant: ['tabular-nums'],
  },
});
