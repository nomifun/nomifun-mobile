import { StyleSheet, Text, View } from 'react-native';

import { FontSize, Radius, Spacing } from '@/constants/theme';

import type { ToastItem } from './toast-store';

/**
 * Shared pill rendering for both toast hosts. Lives apart from `toast.tsx` so
 * the web host can import it without `./toast` resolving back to itself
 * (`toast.web.tsx` IS `./toast` on web).
 */
export function ToastPill({
  item,
  colors,
}: {
  item: ToastItem;
  colors: { danger: string; success: string; text: string };
}) {
  return (
    <View
      style={[
        styles.toast,
        {
          backgroundColor:
            item.kind === 'error'
              ? colors.danger
              : item.kind === 'success'
                ? colors.success
                : colors.text,
        },
      ]}
    >
      <Text style={styles.text} numberOfLines={2}>
        {item.text}
      </Text>
    </View>
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
    maxWidth: 480,
    marginHorizontal: Spacing.xl,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.lg,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  text: { color: '#FFF', fontSize: FontSize.sm, fontWeight: '500', textAlign: 'center' },
});
