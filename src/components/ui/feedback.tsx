import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Button } from './button';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

export function Tag({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: Tone }>) {
  const { colors } = useTheme();
  const map: Record<Tone, { bg: string; fg: string }> = {
    primary: { bg: colors.primarySoft, fg: colors.primary },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    neutral: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  };
  const { bg, fg } = map[tone];
  return (
    <View
      style={[
        styles.tag,
        {
          backgroundColor: bg,
          borderColor: tone === 'danger' ? colors.dangerSoft : colors.borderLight,
        },
      ]}
    >
      <Text style={[styles.tagText, { color: fg }]} numberOfLines={1}>
        {children}
      </Text>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text style={[styles.centerText, { color: colors.textTertiary }]}>{label}</Text>
      ) : null}
    </View>
  );
}

interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  action?: ReactNode;
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  description,
  action,
}: EmptyStateProps) {
  const { colors } = useTheme();
  return (
    <View style={styles.center}>
      <View
        style={[styles.emptyIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Ionicons name={icon} size={26} color={colors.textSecondary} />
      </View>
      <Text style={[styles.emptyTitle, { color: colors.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.centerText, styles.emptyDescription, { color: colors.textSecondary }]}>
          {description}
        </Text>
      ) : null}
      {action ? <View style={styles.emptyAction}>{action}</View> : null}
    </View>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={34} color={colors.textTertiary} />
      <Text style={[styles.centerText, { color: colors.textSecondary }]}>{message}</Text>
      {onRetry ? (
        <Button onPress={onRetry} variant="secondary" style={styles.retry}>
          {retryLabel ?? t('actions.retry')}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    maxWidth: '100%',
    alignSelf: 'flex-start',
  },
  tagText: { fontSize: FontSize.xs, fontWeight: '500' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.xxl,
    gap: Spacing.sm,
    minHeight: 200,
  },
  centerText: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.body,
    textAlign: 'center',
    lineHeight: 22,
    maxWidth: 320,
  },
  emptyDescription: { marginTop: Spacing.xs },
  emptyAction: { marginTop: Spacing.lg, maxWidth: '100%' },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: Radius.xl,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  emptyTitle: {
    fontSize: FontSize.lg,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 24,
  },
  retry: {
    marginTop: Spacing.md,
  },
});
