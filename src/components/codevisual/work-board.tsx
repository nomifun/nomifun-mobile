import { useState, type ReactNode } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Layout, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { Interactive } from '@/components/ui/interactive';

export interface BoardColumn<T> {
  key: string;
  title: string;
  items: T[];
  danger?: boolean;
}

/** Kanban port: status lanes and real cards; never infers or changes execution state. */
export function WorkBoard<T>({
  columns,
  keyExtractor,
  renderItem,
}: {
  columns: BoardColumn<T>[];
  keyExtractor: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  const [width, setWidth] = useState(0);
  const laneWidth = Math.min(
    340,
    Math.max(
      Math.min(width - Spacing.xl, Layout.boardColumnWidth),
      (width - (columns.length - 1) * Spacing.md) / columns.length,
    ),
  );
  return (
    <View style={styles.fill} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
      <ScrollView
        horizontal
        style={styles.fill}
        contentContainerStyle={styles.columns}
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {columns.map((column) => (
          <View
            key={column.key}
            style={[
              styles.lane,
              {
                width: Math.max(200, laneWidth),
                borderColor: colors.borderLight,
              },
            ]}
          >
            <View style={styles.laneHeading}>
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: column.danger ? colors.danger : colors.textSecondary,
                  },
                ]}
              />
              <Text
                accessibilityRole="header"
                numberOfLines={1}
                style={[styles.laneTitle, { color: colors.textSecondary }]}
              >
                {column.title}
              </Text>
              <Text style={[styles.count, { color: colors.textTertiary }]}>
                {column.items.length}
              </Text>
            </View>
            <FlatList
              data={column.items}
              keyExtractor={keyExtractor}
              renderItem={({ item }) => <>{renderItem(item)}</>}
              contentContainerStyle={styles.cards}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={[styles.empty, { color: colors.textTertiary }]}>
                  {t('views.emptyLane')}
                </Text>
              }
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function ViewSwitch({
  value,
  onChange,
}: {
  value: 'list' | 'board';
  onChange: (value: 'list' | 'board') => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View accessibilityRole="tablist" accessibilityLabel={t('views.title')} style={styles.switch}>
      <View
        pointerEvents="none"
        style={[styles.switchRail, { borderColor: colors.border, backgroundColor: colors.surface }]}
      />
      {(['list', 'board'] as const).map((mode) => (
        <Interactive
          key={mode}
          feedback={false}
          accessibilityRole="tab"
          accessibilityLabel={t(`views.${mode}`)}
          {...a11yState({ selected: value === mode })}
          onPress={() => onChange(mode)}
          style={styles.switchItem}
        >
          {({ pressed, hovered }) => (
            <View
              style={[
                styles.switchVisual,
                {
                  backgroundColor:
                    value === mode
                      ? colors.primary
                      : pressed || hovered
                        ? colors.bgHover
                        : 'transparent',
                },
              ]}
            >
              <Ionicons
                name={mode === 'list' ? 'list-outline' : 'albums-outline'}
                size={16}
                color={value === mode ? colors.onPrimary : colors.textSecondary}
              />
            </View>
          )}
        </Interactive>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  columns: { gap: Spacing.md, alignItems: 'stretch', flexGrow: 1 },
  lane: { borderLeftWidth: 1, minHeight: 0 },
  laneHeading: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  dot: { width: 6, height: 6, borderRadius: Radius.full },
  laneTitle: { flex: 1, minWidth: 0, fontSize: FontSize.sm, fontWeight: '600' },
  count: { fontSize: FontSize.xs, fontVariant: ['tabular-nums'] },
  cards: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.lg },
  empty: { fontSize: FontSize.xs, paddingTop: Spacing.lg, textAlign: 'center' },
  switch: {
    flexDirection: 'row',
    flexShrink: 0,
  },
  switchRail: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 2,
    right: 2,
    borderWidth: 1,
    borderRadius: Radius.md,
  },
  switchItem: {
    width: Layout.controlHeight,
    height: Layout.controlHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchVisual: {
    width: Layout.compactControlHeight,
    height: Layout.compactControlHeight,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
