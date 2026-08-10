import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

import type { ConversationGroup } from '../workpath';

interface ProjectSectionProps {
  group: ConversationGroup;
  collapsed: boolean;
  onToggle: () => void;
  /**
   * Start another session in this same directory. Omitted for the default
   * section, which has no directory to reuse.
   */
  onCreate?: () => void;
}

/**
 * Collapsible section header for one workpath, mirroring the desktop sidebar
 * drawer: folder glyph, project name + session count, full path underneath, and
 * a `＋` that keeps binding the same directory.
 *
 * The path is shown here exactly once — rows inside the section only carry a
 * small folder badge, so a long absolute path never repeats down the list.
 */
export const ProjectSection = memo(function ProjectSection({
  group,
  collapsed,
  onToggle,
  onCreate,
}: ProjectSectionProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');

  const title = group.isDefault ? t('groups.defaultTitle') : group.displayName;
  const subtitle = group.isDefault ? t('groups.defaultHint') : (group.path ?? group.key);
  const count = group.items.length;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        {...a11yState({ expanded: !collapsed })}
        accessibilityLabel={`${title}, ${t('groups.count', { count })}`}
        accessibilityHint={collapsed ? t('groups.expand') : t('groups.collapse')}
        onPress={onToggle}
        style={({ pressed }) => [
          styles.header,
          { backgroundColor: pressed ? colors.surfaceMuted : 'transparent' },
        ]}
      >
        <Ionicons
          name={collapsed ? 'chevron-forward' : 'chevron-down'}
          size={14}
          color={colors.textTertiary}
        />
        <Ionicons
          name={group.isDefault ? 'chatbubbles-outline' : 'folder-outline'}
          size={16}
          color={group.isDefault ? colors.textTertiary : colors.primary}
        />
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <View style={[styles.count, { backgroundColor: colors.surfaceMuted }]}>
              <Text style={[styles.countText, { color: colors.textSecondary }]}>{count}</Text>
            </View>
          </View>
          <Text
            style={[styles.path, { color: colors.textTertiary }]}
            numberOfLines={1}
            ellipsizeMode="head"
          >
            {subtitle}
          </Text>
        </View>
      </Pressable>

      {onCreate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('groups.newInProject')}
          onPress={onCreate}
          style={({ pressed }) => [styles.add, { opacity: pressed ? 0.5 : 1 }]}
        >
          <Ionicons name="add" size={20} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: Spacing.md,
    marginBottom: Spacing.xs,
  },
  header: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    paddingHorizontal: Spacing.sm,
    borderRadius: Radius.md,
  },
  body: { flex: 1, gap: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  title: { fontSize: FontSize.sm, fontWeight: '700', flexShrink: 1 },
  count: {
    minWidth: 20,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: Radius.full,
    alignItems: 'center',
  },
  countText: { fontSize: FontSize.xs, fontWeight: '600' },
  path: { fontSize: FontSize.xs },
  add: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
