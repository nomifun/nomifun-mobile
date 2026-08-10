import { useSyncExternalStore } from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/hooks/use-theme';

import { ToastPill, styles } from './toast-pill';
import { toast, toastStore } from './toast-store';

export { toast };

/**
 * Minimal toast: `toast.success('已保存')` from anywhere; <ToastHost /> renders
 * at the app root.
 *
 * KNOWN LIMIT (native): a toast fired while an RN `Modal` is open renders
 * underneath it, because Modal presents its own native view above the React
 * tree. Screens that toast from inside a modal should also show inline
 * feedback — see the directory picker's footer notice. The web build works
 * around this with a body-level portal (`toast.web.tsx`).
 */
export function ToastHost() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const items = useSyncExternalStore(toastStore.subscribe, toastStore.snapshot, toastStore.snapshot);

  if (items.length === 0) return null;
  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + 8 }]}>
      {items.map((item) => (
        <ToastPill key={item.id} item={item} colors={colors} />
      ))}
    </View>
  );
}
