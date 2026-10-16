import { useEffect, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FontSize, Motion, Radius, Spacing, type ThemeColors } from '@/constants/theme';
import { useReducedMotion } from '@/hooks/use-reduced-motion';
import { IconButton } from './icon-button';

import { toastStore, type ToastItem } from './toast-store';

/**
 * Shared pill rendering for both toast hosts. Lives apart from `toast.tsx` so
 * the web host can import it without `./toast` resolving back to itself
 * (`toast.web.tsx` IS `./toast` on web).
 */
export function ToastPill({ item, colors }: { item: ToastItem; colors: ThemeColors }) {
  const { t } = useTranslation('common');
  const reduced = useReducedMotion();
  const entrance = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: reduced ? 0 : Motion.normal,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
    return () => entrance.stopAnimation();
  }, [entrance, reduced]);
  return (
    <Animated.View
      accessibilityRole={item.kind === 'error' ? 'alert' : undefined}
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          ...(Platform.OS === 'web'
            ? { boxShadow: `0 4px 8px ${colors.shadow}` }
            : { shadowColor: colors.shadow }),
          opacity: entrance,
          transform: [
            { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) },
          ],
        },
      ]}
    >
      <Ionicons
        name={
          item.kind === 'error'
            ? 'alert-circle-outline'
            : item.kind === 'success'
              ? 'checkmark-circle-outline'
              : 'information-circle-outline'
        }
        size={20}
        color={item.kind === 'error' ? colors.danger : colors.text}
      />
      <Text style={[styles.text, { color: colors.text }]} numberOfLines={3}>
        {item.text}
      </Text>
      <IconButton
        icon="close"
        label={t('actions.close')}
        onPress={() => toastStore.dismiss(item.id)}
        size={16}
      />
    </Animated.View>
  );
}

export const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: Spacing.sm,
    zIndex: 1000,
  },
  toast: {
    pointerEvents: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    maxWidth: 480,
    width: '90%',
    borderRadius: Radius.md,
    borderWidth: 1,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.xs,
    paddingVertical: Spacing.xs,
    ...Platform.select({
      default: {
        shadowOpacity: 1,
        shadowRadius: 8,
        shadowOffset: { width: 0, height: 4 },
        elevation: 4,
      },
      web: {},
    }),
  },
  text: { flex: 1, minWidth: 0, fontSize: FontSize.sm, lineHeight: 20, fontWeight: '500' },
});
