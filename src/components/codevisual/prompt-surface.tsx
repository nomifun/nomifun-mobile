import type { PropsWithChildren, ReactNode } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from '@/components/ui/interactive';

/** PromptBox port: freeform input above a separate model, attachment and send toolbar. */
export function PromptSurface({ focused, children }: PropsWithChildren<{ focused: boolean }>) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.surface,
        {
          backgroundColor: colors.surface,
          borderColor: focused ? colors.primary : colors.border,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function PromptToolbar({ model, children }: PropsWithChildren<{ model?: ReactNode }>) {
  const { colors } = useTheme();
  return (
    <View style={[styles.toolbar, { borderTopColor: colors.borderLight }]}>
      <View style={styles.modelSlot}>{model}</View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

export function PromptModelButton({
  model,
  label,
  onPress,
}: {
  model: string;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? { title: label } : {})}
      onPress={onPress}
      style={styles.modelTarget}
    >
      {({ pressed, hovered }) => (
        <View
          style={[
            styles.modelPill,
            {
              backgroundColor: pressed || hovered ? colors.bgActive : colors.surfaceMuted,
            },
          ]}
        >
          <Text numberOfLines={1} style={[styles.modelLabel, { color: colors.textSecondary }]}>
            {model}
          </Text>
          <Ionicons name="chevron-down" size={13} color={colors.textTertiary} />
        </View>
      )}
    </Interactive>
  );
}

/** PromptBox's circular action, with a 44 px target and clear disabled/busy/stop states. */
export function PromptSubmitButton({
  label,
  stopping,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  stopping: boolean;
  loading: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const inactive = disabled || loading;
  const foreground = inactive && !loading ? colors.textDisabled : colors.onPrimary;
  return (
    <Interactive
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11yState({ disabled: inactive, busy: loading })}
      {...(Platform.OS === 'web' ? { title: label } : {})}
      disabled={inactive}
      onPress={onPress}
      style={styles.submitTarget}
    >
      {({ pressed, hovered }) => (
        <View
          style={[
            styles.submitCircle,
            {
              backgroundColor:
                inactive && !loading
                  ? colors.surfaceMuted
                  : pressed || hovered
                    ? colors.primaryHover
                    : colors.primary,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={foreground} />
          ) : (
            <Ionicons name={stopping ? 'stop' : 'arrow-up'} size={20} color={foreground} />
          )}
        </View>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  surface: {
    borderWidth: 1,
    borderRadius: Radius.md,
    marginTop: Spacing.xs,
    overflow: 'hidden',
  },
  toolbar: {
    borderTopWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  modelSlot: { flex: 1, minWidth: 0, alignItems: 'flex-start' },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 0,
  },
  modelTarget: {
    minHeight: Layout.controlHeight,
    maxWidth: '100%',
    justifyContent: 'center',
  },
  modelPill: {
    minHeight: Layout.compactControlHeight,
    maxWidth: '100%',
    borderRadius: Radius.full,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  modelLabel: {
    fontSize: FontSize.xs,
    fontWeight: '500',
    minWidth: 0,
    flexShrink: 1,
  },
  submitTarget: {
    width: Layout.controlHeight,
    height: Layout.controlHeight,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitCircle: {
    width: Layout.buttonHeight,
    height: Layout.buttonHeight,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
