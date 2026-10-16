import { Children, isValidElement, type PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Unframed settings group owns separators between seamless ListRow children.
 */
export function ListGroup({ children }: PropsWithChildren) {
  const { colors } = useTheme();
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        <View key={(row as { key?: string }).key ?? index}>
          {index > 0 ? (
            <View style={[styles.separator, { backgroundColor: colors.borderLight }]} />
          ) : null}
          {row}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginBottom: Spacing.sm,
    overflow: 'hidden',
  },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.lg + 36 + Spacing.md },
});
