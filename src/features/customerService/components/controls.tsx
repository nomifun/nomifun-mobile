/**
 * Customer service form rows. Selection and icon actions use the shared UI kit.
 */
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { IconButton, Interactive } from '@/components/ui';
import { useTranslation } from 'react-i18next';

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
        style={[styles.settingValue, { color: hasValue ? colors.text : colors.textTertiary }]}
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
          !last && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: colors.border,
          },
          disabled && styles.dimmed,
        ]}
      >
        {content}
      </View>
    );
  }

  return (
    <Interactive
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.settingRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
        pressed && { backgroundColor: colors.surfaceMuted },
      ]}
    >
      {content}
    </Interactive>
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
  const { t } = useTranslation('common');
  const step = (delta: number) => {
    const next = value + delta;
    if (next < min || next > max) return;
    onChange(next);
  };
  return (
    <View style={styles.stepperRow}>
      <View style={styles.settingText}>
        <Text style={[styles.settingLabel, { color: colors.textSecondary }]}>{label}</Text>
        {hint ? (
          <Text style={[styles.settingHint, { color: colors.textTertiary }]}>{hint}</Text>
        ) : null}
      </View>
      <View style={styles.stepper}>
        <IconButton
          icon="remove"
          label={`${t('actions.decrease')} · ${label}`}
          variant="secondary"
          disabled={value <= min}
          onPress={() => step(-1)}
        />
        <Text style={[styles.stepValue, { color: colors.text }]}>{value}</Text>
        <IconButton
          icon="add"
          label={`${t('actions.increase')} · ${label}`}
          variant="secondary"
          disabled={value >= max}
          onPress={() => step(1)}
        />
      </View>
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
    <Interactive
      accessibilityRole="checkbox"
      {...a11yState({ checked, disabled: !!disabled })}
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
    </Interactive>
  );
}

const styles = StyleSheet.create({
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
  stepValue: { fontSize: FontSize.md, fontWeight: '600', minWidth: 28, textAlign: 'center' },
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
