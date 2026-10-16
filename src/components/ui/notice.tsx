import type { PropsWithChildren } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type NoticeTone = 'info' | 'success' | 'warning' | 'danger' | 'muted';

interface NoticeProps extends PropsWithChildren {
  tone?: NoticeTone;
  icon?: keyof typeof Ionicons.glyphMap;
}

const DEFAULT_ICON: Record<NoticeTone, keyof typeof Ionicons.glyphMap> = {
  info: 'information-circle-outline',
  success: 'checkmark-circle-outline',
  warning: 'alert-circle-outline',
  danger: 'close-circle-outline',
  muted: 'information-circle-outline',
};

/** Inline banner for hints, warnings and offline states inside a screen. */
export function Notice({ tone = 'muted', icon, children }: NoticeProps) {
  const { colors } = useTheme();
  const palette: Record<NoticeTone, { bg: string; fg: string }> = {
    info: { bg: colors.messageTipsBg, fg: colors.primary },
    success: { bg: colors.successSoft, fg: colors.success },
    warning: { bg: colors.warningSoft, fg: colors.warning },
    danger: { bg: colors.dangerSoft, fg: colors.danger },
    muted: { bg: colors.surfaceMuted, fg: colors.textSecondary },
  };
  const { bg, fg } = palette[tone];
  return (
    <View
      accessibilityRole={tone === 'danger' ? 'alert' : undefined}
      accessibilityLiveRegion={tone === 'danger' ? 'polite' : 'none'}
      style={[
        styles.notice,
        {
          backgroundColor: bg,
          borderColor: tone === 'danger' ? colors.danger : colors.borderLight,
        },
      ]}
    >
      <Ionicons name={icon ?? DEFAULT_ICON[tone]} size={17} color={fg} />
      <Text style={[styles.text, { color: tone === 'muted' ? colors.textSecondary : fg }]}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderRadius: Radius.sm,
    borderWidth: 1,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
  },
  text: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.body,
    lineHeight: 20,
    flex: 1,
    minWidth: 0,
  },
});
