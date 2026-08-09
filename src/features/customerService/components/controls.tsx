/**
 * Small native controls this feature needs and the shared UI kit does not
 * provide: segmented tabs, a numeric stepper, in-card setting rows, selectable
 * chips and a check row for pick lists. Theme tokens only.
 */
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  badge?: number;
}

/** Segmented tab control (配置 / 笔记 / 对话). */
export function Segments<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly SegmentOption<T>[];
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.segments, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[
              styles.segment,
              active && { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <Text
              style={[
                styles.segmentLabel,
                { color: active ? colors.text : colors.textTertiary },
              ]}
              numberOfLines={1}
            >
              {option.label}
              {option.badge != null && option.badge > 0 ? ` ${option.badge}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Label + value row inside a card; pressable when `onPress` is given. */
export function SettingRow({
  label,
  value,
  placeholder,
  onPress,
  disabled,
  hint,
  last,
}: {
  label: string;
  value?: string;
  placeholder?: string;
  onPress?: () => void;
  disabled?: boolean;
  hint?: string;
  last?: boolean;
}) {
  const { colors } = useTheme();
  const hasValue = !!value;
  const content = (
    <>
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.settingHint, { color: colors.textTertiary }]}>{hint}</Text>
        ) : null}
      </View>
      <Text
        style={[
          styles.settingValue,
          { color: hasValue ? colors.text : colors.textTertiary },
        ]}
        numberOfLines={1}
      >
        {hasValue ? value : (placeholder ?? '—')}
      </Text>
      {onPress && !disabled ? (
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      ) : null}
    </>
  );

  if (!onPress || disabled) {
    return (
      <View
        style={[
          styles.settingRow,
          !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
          disabled && styles.dimmed,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {content}
    </Pressable>
  );
}

/** Numeric stepper with hard bounds (并发上限 is validated 1..=64 server-side). */
export function Stepper({
  label,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (next: number) => void;
}) {
  const { colors } = useTheme();
  const step = (delta: number) => {
    const next = value + delta;
    if (next < min || next > max) return;
    onChange(next);
  };
  const button = (icon: 'remove' | 'add', delta: number, inactive: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label} ${icon}`}
      disabled={inactive}
      onPress={() => step(delta)}
      style={({ pressed }) => [
        styles.stepButton,
        {
          backgroundColor: pressed ? colors.primarySoft : colors.surfaceMuted,
          opacity: inactive ? 0.4 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={colors.text} />
    </Pressable>
  );

  return (
    <View style={styles.stepperRow}>
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.settingHint, { color: colors.textTertiary }]}>{hint}</Text>
        ) : null}
      </View>
      <View style={styles.stepper}>
        {button('remove', -1, value <= min)}
        <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
        {button('add', 1, value >= max)}
      </View>
    </View>
  );
}

/** Selectable pill row (note kind). */
export function Chips<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.chips}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            style={[
              styles.chip,
              {
                backgroundColor: active ? colors.primarySoft : colors.surfaceMuted,
                borderColor: active ? colors.primary : 'transparent',
              },
            ]}
          >
            <Text
              style={[
                styles.chipLabel,
                { color: active ? colors.primary : colors.textSecondary },
              ]}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Row with a check mark — pick lists and the 共享 checkbox. */
export function CheckRow({
  title,
  subtitle,
  checked,
  disabled,
  onPress,
  icon,
}: {
  title: string;
  subtitle?: string;
  checked: boolean;
  disabled?: boolean;
  onPress: () => void;
  icon?: ReactNode;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.checkRow,
        {
          borderColor: checked ? colors.primary : colors.border,
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      {icon ? <View style={styles.checkIcon}>{icon}</View> : null}
      <View style={styles.settingText}>
        <Text style={[styles.checkTitle, { color: colors.text }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.settingHint, { color: colors.textTertiary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={checked ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={checked ? colors.primary : colors.border}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  segments: {
    flexDirection: 'row',
    borderRadius: Radius.md,
    padding: 3,
    gap: 3,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: Radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  segmentLabel: { fontSize: FontSize.sm, fontWeight: '600' },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 48,
    paddingVertical: Spacing.sm,
  },
  dimmed: { opacity: 0.6 },
  settingText: { flex: 1, gap: 2 },
  settingLabel: { fontSize: FontSize.sm, fontWeight: '500' },
  settingHint: { fontSize: FontSize.xs, lineHeight: 16 },
  settingValue: { fontSize: FontSize.sm, maxWidth: '52%', textAlign: 'right' },
  stepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingVertical: Spacing.sm,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepButton: {
    width: 48,
    height: 44,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: { fontSize: FontSize.md, fontWeight: '600', minWidth: 28, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    minHeight: 36,
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    borderRadius: Radius.full,
    borderWidth: 1,
  },
  chipLabel: { fontSize: FontSize.sm, fontWeight: '600' },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 56,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    marginBottom: Spacing.sm,
  },
  checkIcon: { width: 28, alignItems: 'center' },
  checkTitle: { fontSize: FontSize.md, fontWeight: '600' },
});
