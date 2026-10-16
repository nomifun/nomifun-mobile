import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Layout, Radius, type ThemeColors } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from './interactive';

export interface IconButtonProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: number;
  variant?: 'ghost' | 'primary' | 'secondary' | 'danger';
  style?: StyleProp<ViewStyle>;
  themeColors?: ThemeColors;
}

export function IconButton({
  icon,
  label,
  onPress,
  disabled,
  loading,
  size = 18,
  variant = 'ghost',
  style,
  themeColors,
}: IconButtonProps) {
  const { colors: defaults } = useTheme();
  const colors = themeColors ?? defaults;
  const inactive = !!disabled || !!loading;
  const foreground =
    variant === 'primary'
      ? colors.onPrimary
      : variant === 'danger'
        ? colors.danger
        : colors.textSecondary;
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11yState({ disabled: inactive, busy: !!loading })}
      {...(Platform.OS === 'web' ? { title: label } : {})}
      disabled={inactive}
      onPress={onPress}
      style={[styles.target, { opacity: inactive ? 0.4 : 1 }, style]}
    >
      {({ pressed, hovered }) => (
        <View
          style={[
            styles.button,
            {
              backgroundColor:
                variant === 'primary'
                  ? pressed || hovered
                    ? colors.primaryHover
                    : colors.primary
                  : pressed || hovered
                    ? colors.bgActive
                    : variant === 'secondary'
                      ? colors.surfaceMuted
                      : 'transparent',
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={foreground} />
          ) : (
            <Ionicons name={icon} size={size} color={foreground} />
          )}
        </View>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  target: {
    width: Layout.controlHeight,
    height: Layout.controlHeight,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  button: {
    width: Layout.compactControlHeight,
    height: Layout.compactControlHeight,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
