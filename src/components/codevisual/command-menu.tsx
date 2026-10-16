import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from '@/components/ui/interactive';

export interface PaletteItem {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onSelect: () => void;
}
export interface PaletteGroup {
  label: string;
  items: PaletteItem[];
}

/** Port of CommandPalette's grouped results, selection highlight and enter affordance. */
export function CommandMenu({
  groups,
  selectedIndex,
  onSelect,
  disabled,
}: {
  groups: readonly PaletteGroup[];
  selectedIndex: number;
  onSelect: (item: PaletteItem) => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  let index = -1;
  return (
    <View>
      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={[styles.groupLabel, { color: colors.textTertiary }]}>{group.label}</Text>
          {group.items.map((item) => {
            index += 1;
            const selected = index === selectedIndex;
            return (
              <Interactive
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                {...a11yState({ selected })}
                disabled={disabled}
                onPress={() => onSelect(item)}
                style={({ pressed }) => [
                  styles.item,
                  { backgroundColor: selected || pressed ? colors.surfaceMuted : 'transparent' },
                ]}
              >
                <Ionicons name={item.icon} size={18} color={colors.textSecondary} />
                <Text numberOfLines={1} style={[styles.label, { color: colors.text }]}>
                  {item.label}
                </Text>
                {selected ? (
                  <Ionicons name="return-down-back-outline" size={14} color={colors.textTertiary} />
                ) : null}
              </Interactive>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: Spacing.md, gap: Spacing.xs },
  groupLabel: { fontSize: FontSize.xs, padding: Spacing.sm, fontWeight: '500' },
  item: {
    minHeight: Layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  label: { flex: 1, minWidth: 0, fontSize: FontSize.sm },
});
