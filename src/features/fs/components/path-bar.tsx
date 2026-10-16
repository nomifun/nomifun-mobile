/**
 * Path bar for the directory picker: up / start navigation plus the current
 * absolute path, which scrolls horizontally because deep paths do not fit on a
 * phone and truncating them hides the part that matters (the tail).
 */
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

interface PathBarProps {
  /** Canonical path, or a screen label when no directory is listed. */
  text: string;
  /** Mirrors the server's `canGoUp` + `parentPath`. */
  canGoUp: boolean;
  onUp: () => void;
  /** Omitted on the start screen itself. */
  onStart?: () => void;
}

export function PathBar({ text, canGoUp, onUp, onStart }: PathBarProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('fs');

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('picker.up')}
        {...a11yState({ disabled: !canGoUp })}
        // `disabled` (not just a null onPress) is what makes react-native-web
        // emit aria-disabled and drop the control out of the tab order — its
        // Pressable overwrites any aria-disabled we pass with this prop.
        disabled={!canGoUp}
        onPress={canGoUp ? onUp : undefined}
        style={({ pressed }) => [styles.iconButton, { opacity: canGoUp ? (pressed ? 0.6 : 1) : 0.35 }]}
      >
        <Ionicons name="arrow-up" size={22} color={colors.primary} />
      </Pressable>

      {onStart ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('picker.start')}
          onPress={onStart}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="home-outline" size={20} color={colors.primary} />
        </Pressable>
      ) : null}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={[styles.pathWrap, { backgroundColor: colors.surfaceMuted }]}
        contentContainerStyle={styles.pathContent}
      >
        <Text style={[styles.path, { color: colors.textSecondary }]} numberOfLines={1}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pathWrap: { flex: 1, borderRadius: Radius.md, maxHeight: 40 },
  pathContent: { alignItems: 'center', paddingHorizontal: Spacing.md, minHeight: 40 },
  path: { fontSize: FontSize.sm },
});
