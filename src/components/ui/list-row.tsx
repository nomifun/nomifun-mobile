import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, FontWeight, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Interactive } from './interactive';
import { a11yState } from '@/utils/a11y';

interface ListRowProps {
  title: string;
  subtitle?: string;
  titleNumberOfLines?: number;
  compact?: boolean;
  left?: ReactNode;
  right?: ReactNode;
  chevron?: boolean;
  /**
   * Let ListGroup own the separators instead of adding a row divider.
   */
  seamless?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  action?: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}

/** Standard pressable row used by every list in the app. */
export function ListRow({
  title,
  subtitle,
  titleNumberOfLines = 2,
  compact = false,
  left,
  right,
  chevron,
  seamless,
  onPress,
  onLongPress,
  action,
  disabled,
  tone = 'default',
}: ListRowProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.container,
        { borderBottomColor: colors.borderLight },
        seamless && styles.grouped,
      ]}
    >
      <Interactive
        accessibilityRole={onPress ? 'button' : undefined}
        focusable={!!onPress || !!onLongPress}
        {...(onPress || onLongPress ? {} : { tabIndex: -1 })}
        {...a11yState({ disabled: !!disabled })}
        disabled={disabled}
        onPress={onPress}
        onLongPress={onLongPress}
        feedback={false}
        style={({ pressed }) => [
          styles.row,
          compact && styles.compactRow,
          compact && !subtitle && styles.compactActionRow,
          {
            backgroundColor: pressed ? colors.bgHover : 'transparent',
          },
        ]}
      >
        {left ? <View style={styles.left}>{left}</View> : null}
        <View style={styles.body}>
          <Text
            style={[
              styles.title,
              compact && styles.compactTitle,
              {
                color: tone === 'danger' ? colors.danger : colors.text,
                opacity: disabled ? 0.5 : 1,
              },
            ]}
            numberOfLines={titleNumberOfLines}
            ellipsizeMode="tail"
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                compact && styles.compactSubtitle,
                { color: colors.textTertiary },
              ]}
              numberOfLines={compact ? 1 : 2}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        {right ? <View style={styles.right}>{right}</View> : null}
        {chevron ? <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} /> : null}
      </Interactive>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

/** Monochrome monogram shared by identity rows. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const { colors } = useTheme();
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: colors.surfaceMuted,
        borderColor: colors.border,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.text, fontSize: size * 0.42, fontWeight: '600' }}>
        {initial}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  grouped: { borderBottomWidth: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderRadius: Radius.lg,
    flex: 1,
    minWidth: 0,
    minHeight: 72,
  },
  left: { flexShrink: 0 },
  body: { flex: 1, minWidth: 0, gap: Spacing.xs },
  right: { flexShrink: 0, alignItems: 'flex-end', gap: 4 },
  title: { fontSize: FontSize.md, fontWeight: '500', lineHeight: 22 },
  compactRow: {
    minHeight: 64,
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
  },
  compactTitle: { fontSize: FontSize.sm, lineHeight: 20 },
  compactActionRow: { minHeight: Layout.controlHeight + Spacing.xs },
  compactSubtitle: { fontSize: FontSize.xs, lineHeight: 18 },
  action: { flexShrink: 0, paddingRight: Spacing.xs },
  subtitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.body,
    lineHeight: 20,
  },
});
