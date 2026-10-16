/** Shared formatting + confirmation helpers for the requirements screens. */
import { useCallback } from 'react';
import { Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

/** Relative time for list rows, falling back to a date past a week. */
export function useRelativeTime(): (ms?: number) => string {
  const { t } = useTranslation('common');
  return useCallback(
    (ms?: number) => {
      if (!ms) return '—';
      const diff = Date.now() - ms;
      if (diff < 60_000) return t('time.justNow');
      const minutes = Math.floor(diff / 60_000);
      if (minutes < 60) return t('time.minutesAgo', { count: minutes });
      const hours = Math.floor(minutes / 60);
      if (hours < 24) return t('time.hoursAgo', { count: hours });
      const days = Math.floor(hours / 24);
      if (days < 7) return t('time.daysAgo', { count: days });
      return dayjs(ms).format('YYYY-MM-DD');
    },
    [t],
  );
}

/** Absolute timestamp for the detail metadata rows. */
export function formatTimestamp(ms?: number): string {
  if (!ms) return '—';
  return dayjs(ms).format('YYYY-MM-DD HH:mm');
}

interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
}

/** Alert on native, window.confirm on web (RN Alert is a no-op there). */
export function confirmAction({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  onConfirm,
}: ConfirmOptions): void {
  if (Platform.OS === 'web') {
    const text = message ? `${title}\n\n${message}` : title;
    if (typeof window !== 'undefined' && window.confirm(text)) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelLabel, style: 'cancel' },
    { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: onConfirm },
  ]);
}
