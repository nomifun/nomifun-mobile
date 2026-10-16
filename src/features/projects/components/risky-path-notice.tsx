/**
 * Amber warning strip for a sensitive workspace path.
 *
 * Deliberately a *soft* gate: the server accepts any path, and the agent is not
 * confined to the workspace anyway (as the installation owner it has the OS
 * user's full authority), so the honest thing to do is warn and ask for one
 * extra tap rather than block.
 */
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface RiskyPathNoticeProps {
  title: string;
  body: string;
  /** Second-tap instruction, shown once the first tap armed the confirmation. */
  confirmHint?: string;
}

export function RiskyPathNotice({ title, body, confirmHint }: RiskyPathNoticeProps) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.warningSoft, borderColor: colors.warning },
      ]}
    >
      <Ionicons name="warning-outline" size={18} color={colors.warning} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.warning }]}>{title}</Text>
        <Text style={[styles.text, { color: colors.textSecondary }]}>{body}</Text>
        {confirmHint ? (
          <Text style={[styles.text, styles.confirmHint, { color: colors.warning }]}>
            {confirmHint}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.lg,
  },
  body: { flex: 1, gap: Spacing.xs },
  title: { fontSize: FontSize.sm, fontWeight: '700' },
  text: { fontSize: FontSize.sm, lineHeight: 19 },
  confirmHint: { fontWeight: '600' },
});
