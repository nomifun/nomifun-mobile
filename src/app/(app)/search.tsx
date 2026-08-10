import { useCallback, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/types';
import { EmptyState, ErrorState, ListRow, Loading, Screen, Tag } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import {
  previewSnippet,
  useDebouncedValue,
  useMessageSearch,
  type MessageSearchItem,
} from '@/features/sessions/search';
import { relativeTime } from '@/features/sessions/time';
import { useTheme } from '@/hooks/use-theme';

const DEBOUNCE_MS = 300;

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * Global message search.
 *
 * The endpoint is cross-conversation only (no `conversation_id` filter exists),
 * which is why this is a route of its own instead of a panel inside a chat.
 */
export default function SearchScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');

  const [input, setInput] = useState('');
  const keyword = useDebouncedValue(input.trim(), DEBOUNCE_MS);
  const search = useMessageSearch(keyword);

  // Typing again while the debounce is pending must not look like "0 results".
  const settling = input.trim() !== keyword;

  const open = useCallback((item: MessageSearchItem) => {
    const id = item.conversation?.conversation_id;
    if (!id) return;
    router.push(`/session/${id}`);
  }, []);

  const header = <Stack.Screen options={{ title: t('search.title') }} />;

  const field = (
    <View
      style={[styles.field, { backgroundColor: colors.surfaceMuted, borderColor: colors.border }]}
    >
      <Ionicons name="search" size={16} color={colors.textTertiary} />
      <TextInput
        style={[styles.input, { color: colors.text }]}
        value={input}
        onChangeText={setInput}
        placeholder={t('search.placeholder')}
        placeholderTextColor={colors.textTertiary}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        // The list is driven by the debounced value; Enter just dismisses.
        submitBehavior="blurAndSubmit"
        maxLength={200}
      />
      {input.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('search.clear')}
          onPress={() => setInput('')}
          // Compact glyph inside the field; hitSlop carries the target past 44.
          hitSlop={10}
          style={styles.clear}
        >
          <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );

  const rows = search.items;

  const body = () => {
    if (keyword === '') {
      return (
        <EmptyState
          icon="search-outline"
          title={t('search.idleTitle')}
          description={t('search.idleHint')}
        />
      );
    }
    if (search.isLoading || (settling && rows.length === 0)) {
      return <Loading label={tc('state.loading')} />;
    }
    if (search.error && rows.length === 0) {
      return (
        <ErrorState
          message={errorText(search.error, t('search.failed'))}
          onRetry={search.retry}
          retryLabel={tc('actions.retry')}
        />
      );
    }

    return (
      <FlatList
        data={rows}
        keyExtractor={(item) => item.message_id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ListRow
            title={item.conversation?.name?.trim() || t('list.untitled')}
            subtitle={previewSnippet(item.preview_text, keyword)}
            right={
              <View style={styles.rowMeta}>
                <Text style={[styles.time, { color: colors.textTertiary }]}>
                  {relativeTime(item.message_created_at, (key, options) => tc(key, options))}
                </Text>
                {item.message_type && item.message_type !== 'text' ? (
                  <Tag tone="neutral">{item.message_type}</Tag>
                ) : null}
              </View>
            }
            chevron
            onPress={() => open(item)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={search.isRefreshing}
            onRefresh={() => void search.refresh()}
            tintColor={colors.textTertiary}
          />
        }
        onEndReached={search.loadMore}
        onEndReachedThreshold={0.4}
        keyboardShouldPersistTaps="handled"
        ListFooterComponent={
          search.isLoadingMore ? (
            <Text style={[styles.footer, { color: colors.textTertiary }]}>
              {t('list.loadingMore')}
            </Text>
          ) : rows.length > 0 && !search.hasMore ? (
            <Text style={[styles.footer, { color: colors.textTertiary }]}>
              {t('search.count', { count: search.total })}
            </Text>
          ) : (
            <View style={styles.footerSpacer} />
          )
        }
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title={t('search.emptyTitle')}
            description={t('search.emptyHint', { keyword })}
          />
        }
      />
    );
  };

  return (
    <Screen scroll={false} padded={false}>
      {header}
      <View style={styles.fieldWrap}>{field}</View>
      {body()}
    </Screen>
  );
}

const styles = StyleSheet.create({
  fieldWrap: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md, paddingBottom: Spacing.sm },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    minHeight: 44,
    borderRadius: Radius.full,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.md,
  },
  input: { flex: 1, fontSize: FontSize.md, minHeight: 44, paddingVertical: 0 },
  clear: { minWidth: 28, minHeight: 28, alignItems: 'center', justifyContent: 'center' },
  list: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  rowMeta: { alignItems: 'flex-end', gap: 4 },
  time: { fontSize: FontSize.xs },
  footer: { fontSize: FontSize.xs, textAlign: 'center', paddingVertical: Spacing.lg },
  footerSpacer: { height: Spacing.lg },
});
