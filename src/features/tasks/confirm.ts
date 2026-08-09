/**
 * Destructive-action confirmation that works on every platform.
 * `Alert.alert` is a no-op on react-native-web, so web falls back to
 * `window.confirm` (same pattern as `(tabs)/more.tsx`).
 */
import { Alert, Platform } from 'react-native';

export function confirmDestructive(options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}) {
  const { title, message, confirmLabel, cancelLabel, onConfirm } = options;
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
