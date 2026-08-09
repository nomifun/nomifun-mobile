/**
 * Cross-platform confirmation for destructive actions.
 *
 * `Alert.alert` is a no-op on react-native-web, so web falls back to
 * `window.confirm` (same pattern as (tabs)/more.tsx).
 */
import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}

export function confirmDestructive({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
}: ConfirmOptions): void {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.confirm(`${title}\n\n${message}`)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
