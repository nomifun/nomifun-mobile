import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Layout, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from '@/components/ui/interactive';

/** Native port of codevisual-share FileExplorer's folder, count and indented branch. */
export function ExplorerSection({
  title,
  count,
  icon,
  compact = false,
  expanded = true,
  onToggle,
  action,
  children,
}: PropsWithChildren<{
  title: string;
  count?: number;
  icon?: keyof typeof Ionicons.glyphMap;
  compact?: boolean;
  expanded?: boolean;
  onToggle?: () => void;
  action?: ReactNode;
}>) {
  const { colors } = useTheme();
  const heading = (
    <>
      {icon ? <Ionicons name={icon} size={16} color={colors.textTertiary} /> : null}
      <Text numberOfLines={1} style={[styles.title, { color: colors.textSecondary }]}>
        {title}
      </Text>
      {count !== undefined ? (
        <Text style={[styles.count, { color: colors.textTertiary }]}>{count}</Text>
      ) : null}
      {onToggle ? (
        <Ionicons
          name={expanded ? 'chevron-down' : 'chevron-forward'}
          size={13}
          color={colors.textTertiary}
        />
      ) : null}
    </>
  );
  return (
    <View style={[styles.section, compact && styles.compactSection]}>
      <View style={styles.heading}>
        {onToggle ? (
          <Interactive
            feedback={false}
            accessibilityRole="button"
            accessibilityLabel={title}
            {...a11yState({ expanded })}
            onPress={onToggle}
            style={styles.headingBody}
          >
            {heading}
          </Interactive>
        ) : (
          <View style={styles.headingBody}>{heading}</View>
        )}
        {action}
      </View>
      {expanded ? (
        <View
          style={[
            styles.branch,
            compact && styles.compactBranch,
            icon && {
              borderLeftWidth: 1,
              borderLeftColor: colors.borderLight,
              marginLeft: Spacing.sm,
              paddingLeft: Spacing.sm,
            },
          ]}
        >
          {children}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: Spacing.md },
  compactSection: { marginTop: Spacing.xs },
  heading: { flexDirection: 'row', alignItems: 'center' },
  headingBody: {
    flex: 1,
    minWidth: 0,
    minHeight: Layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  title: { flex: 1, minWidth: 0, fontSize: FontSize.xs, fontWeight: '600' },
  count: { fontSize: FontSize.xs, fontVariant: ['tabular-nums'] },
  branch: { gap: Spacing.xs },
  compactBranch: { gap: 0 },
});
