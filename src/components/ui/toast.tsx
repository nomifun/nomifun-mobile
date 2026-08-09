/**
 * Minimal toast: `toast.success('已保存')` from anywhere; <ToastHost /> renders
 * at the app root. No external dependency, works on native + web.
 */
import { useEffect, useState } from 'react';
import { Animated, Platform, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type ToastKind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

let push: ((kind: ToastKind, text: string) => void) | null = null;
let nextId = 1;

export const toast = {
  success: (text: string) => push?.('success', text),
  error: (text: string) => push?.('error', text),
  info: (text: string) => push?.('info', text),
};

export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    push = (kind, text) => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-2), { id, kind, text }]);
      setTimeout(() => setItems((prev) => prev.filter((t) => t.id !== id)), 2600);
    };
    return () => {
      push = null;
    };
  }, []);

  if (items.length === 0) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.host, { top: insets.top + (Platform.OS === 'web' ? 16 : 8) }]}
    >
      {items.map((t) => (
        <Animated.View
          key={t.id}
          style={[
            styles.toast,
            {
              backgroundColor:
                t.kind === 'error'
                  ? colors.danger
                  : t.kind === 'success'
                    ? colors.success
                    : colors.text,
            },
          ]}
        >
          <Text style={styles.text} numberOfLines={2}>
            {t.text}
          </Text>
        </Animated.View>
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
