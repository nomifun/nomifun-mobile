import { Pressable, StyleSheet } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/**
 * Expo generates its typed-route union into `.expo/types` (gitignored), and
 * that map only learns about a brand-new route once Metro has run. The cast
 * keeps `tsc` honest in a fresh checkout and stays correct afterwards.
 */
const SEARCH_ROUTE = '/search' as Href;

/**
 * Header entry for global message search (`/search`).
 *
 * Lives here rather than inline in the session-list screen so the list header
 * stays a one-liner; drop it into that screen's `headerRight` next to `＋`:
 *
 * ```tsx
 * headerRight: () => (
 *   <View style={{ flexDirection: 'row' }}>
 *     <SearchButton />
 *     … the existing add button …
 *   </View>
 * )
 * ```
 */
export function SearchButton() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('search.action')}
      onPress={() => router.push(SEARCH_ROUTE)}
      style={({ pressed }) => [styles.button, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Ionicons name="search" size={22} color={colors.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.xs,
  },
});
