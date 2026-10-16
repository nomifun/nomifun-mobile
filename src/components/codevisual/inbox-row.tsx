import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Interactive } from '@/components/ui/interactive';

/** Native port of Inbox's single-line subject, trailing time and secondary metadata. */
export function InboxRow({
  title,
  subtitle,
  avatar,
  meta,
  detail,
  action,
  pinned,
  onPress,
  onLongPress,
}: {
  title: string;
  subtitle: string;
  avatar?: ReactNode;
  meta?: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  pinned?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.row, { borderBottomColor: colors.borderLight }]}>
      <Interactive
        feedback={false}
        accessibilityRole="button"
        accessibilityLabel={title}
        onPress={onPress}
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [
          styles.content,
          {
            backgroundColor: pressed ? colors.bgHover : pinned ? colors.primarySoft : 'transparent',
          },
        ]}
      >
        {avatar}
        <View style={styles.copy}>
          <View style={styles.line}>
            <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>
              {title}
            </Text>
            {meta}
          </View>
          <View style={styles.line}>
            <Text numberOfLines={1} style={[styles.subtitle, { color: colors.textTertiary }]}>
              {subtitle}
            </Text>
            {detail}
          </View>
        </View>
      </Interactive>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  content: {
    flex: 1,
    minWidth: 0,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.md,
  },
  copy: { flex: 1, minWidth: 0, gap: Spacing.xs },
  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minWidth: 0,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.sm,
    lineHeight: 20,
    fontWeight: '500',
  },
  subtitle: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.xs,
    fontWeight: FontWeight.body,
    lineHeight: 18,
  },
  action: { paddingLeft: Spacing.xs },
});
