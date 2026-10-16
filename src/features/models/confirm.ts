import { Platform, Alert } from 'react-native';

/**
 * Destructive confirmation that also works on web.
 *
 * `Alert.alert` is a no-op under react-native-web, so the web path falls back
 * to `window.confirm` — same pattern as `(tabs)/more.tsx`.
 */
export function confirmDestructive(options: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
}): void {
  const { title, message, confirmLabel, cancelLabel, onConfirm } = options;
  if (Platform.OS === 'web') {
    if (window.confirm(message ? `${title}\n\n${message}` : title)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
