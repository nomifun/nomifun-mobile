import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Layout, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from './interactive';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';

interface ButtonProps extends PropsWithChildren {
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  small?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  /** Explicit feature palette; ordinary callers retain the existing theme. */
  themeColors?: ThemeColors;
}

export function Button({
  children,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  small,
  icon,
  accessibilityLabel,
  style,
  themeColors,
}: ButtonProps) {
  const { colors: defaultColors } = useTheme();
  const colors = themeColors ?? defaultColors;
  const inactive = disabled || loading;

  const background =
    variant === 'primary'
      ? colors.primary
      : variant === 'danger'
        ? colors.danger
        : variant === 'secondary'
          ? colors.surfaceMuted
          : 'transparent';
  const textColor =
    variant === 'danger'
      ? colors.onDanger
      : variant === 'primary'
        ? colors.onPrimary
        : variant === 'ghost'
          ? colors.primary
          : colors.text;

  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel ?? (typeof children === 'string' ? children : undefined)
      }
      {...a11yState({ disabled: !!inactive, busy: !!loading })}
      disabled={!!inactive}
      onPress={inactive ? undefined : onPress}
      style={[styles.target, { opacity: inactive ? 0.45 : 1 }, style]}
    >
      {({ pressed, hovered }) => (
        <View
          style={[
            styles.base,
            small ? styles.small : styles.regular,
            {
              backgroundColor:
                (pressed || hovered) && !inactive
                  ? variant === 'primary'
                    ? colors.primaryHover
                    : variant === 'danger'
                      ? colors.danger
                      : colors.bgActive
                  : background,
              borderColor: variant === 'secondary' ? colors.border : 'transparent',
            },
          ]}
        >
          {icon ? (
            <Ionicons
              name={icon}
              size={small ? 16 : 18}
              color={textColor}
              style={{ opacity: loading ? 0 : 1 }}
            />
          ) : null}
          <Text
            style={[
              styles.label,
              {
                color: textColor,
                fontSize: small ? FontSize.control : FontSize.sm,
                lineHeight: small ? 18 : 20,
                opacity: loading ? 0 : 1,
              },
            ]}
          >
            {children}
          </Text>
          {loading ? (
            <ActivityIndicator style={styles.spinner} size="small" color={textColor} />
          ) : null}
        </View>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  target: {
    minHeight: Layout.controlHeight,
    minWidth: Layout.controlHeight,
    justifyContent: 'center',
  },
  base: {
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    borderWidth: 1,
    gap: 6,
    minWidth: 0,
    alignSelf: 'stretch',
  },
  regular: {
    paddingVertical: 6,
    paddingHorizontal: Spacing.md,
    minHeight: Layout.buttonHeight,
  },
  small: {
    paddingVertical: 4,
    paddingHorizontal: Spacing.sm,
    minHeight: Layout.compactControlHeight,
  },
  label: { fontWeight: FontWeight.heading, textAlign: 'center', flexShrink: 1 },
  spinner: { position: 'absolute', alignSelf: 'center' },
});
