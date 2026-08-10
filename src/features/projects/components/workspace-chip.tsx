/**
 * The workspace pill shown under the chat header.
 *
 * Project session → 📁 + folder name (never the full path; the panel behind the
 * tap shows that). Temporary workspace → the neutral "临时空间" label, because
 * the authoritative signal is `extra.is_temporary_workspace` and the uuid-ish
 * directory name would be meaningless to a user.
 */
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface WorkspaceChipProps {
  label: string;
  /** Auto-provisioned workspace: muted styling, no rebind. */
  temporary: boolean;
  accessibilityLabel: string;
  onPress: () => void;
}

export function WorkspaceChip({
  label,
  temporary,
  accessibilityLabel,
  onPress,
}: WorkspaceChipProps) {
  const { colors } = useTheme();
  const tint = temporary ? colors.textTertiary : colors.primary;
  const background = temporary ? colors.surfaceMuted : colors.primarySoft;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      // A 44pt-tall pill would dominate the chat header, so the visual height
      // stays compact and hitSlop carries the touch target past 44pt.
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: background, opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <Ionicons
        name={temporary ? 'time-outline' : 'folder-open-outline'}
        size={14}
        color={tint}
      />
      <Text style={[styles.label, { color: tint }]} numberOfLines={1}>
        {label}
      </Text>
      <Ionicons name="chevron-forward" size={12} color={tint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 5,
    minHeight: 28,
    maxWidth: '100%',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: Radius.full,
  },
  label: { fontSize: FontSize.xs, fontWeight: '600', flexShrink: 1 },
});
