/**
 * 记忆 — the single best mobile surface: what this companion remembers about you.
 * Search / kind / status filters map straight onto the list endpoint's query
 * params, and the window grows instead of paging so one SWR key always describes
 * exactly what is on screen (live memory events stay consistent).
 *
 * Every mutation carries `companion_id`: the store 404s a foreign row.
 */
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, EmptyState, ErrorState, Loading, Tag, TextField } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useCompanionMemories } from '../hooks';
import type { CompanionMemory, MemoryKind, MemoryStatus } from '../types';
import { MEMORY_KINDS, MEMORY_KIND_ICONS, formatTimestamp, plainSnippet } from '../utils';
import { MemorySheet } from './memory-sheet';
import { ChipRow, type SegmentItem } from './segmented';

const PAGE = 20;

export function MemoryTab({ companionId }: { companionId: string }) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<MemoryKind | 'all'>('all');
  const [status, setStatus] = useState<MemoryStatus>('active');
  const [limit, setLimit] = useState(PAGE);
  const [editing, setEditing] = useState<CompanionMemory | null>(null);
  const [composing, setComposing] = useState(false);

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    setLimit(PAGE);
  }, [query, kind, status]);

  const memories = useCompanionMemories({
    companionId,
    status,
    kind: kind === 'all' ? null : kind,
    q: query || undefined,
    limit,
  });

  const kindItems = useMemo<SegmentItem<MemoryKind | 'all'>[]>(
    () => [
      { key: 'all', label: t('memory.filterAll') },
      ...MEMORY_KINDS.map((k) => ({ key: k, label: t(`kinds.${k}`) })),
    ],
    [t],
  );
  const statusItems = useMemo<SegmentItem<MemoryStatus>[]>(
    () => [
      { key: 'active', label: t('memory.statusActive') },
      { key: 'archived', label: t('memory.statusArchived') },
    ],
    [t],
  );

  const filtered = !!query || kind !== 'all' || status !== 'active';
  const remaining = Math.max(0, memories.total - memories.items.length);

  const header = (
    <View style={styles.header}>
      <View style={styles.searchRow}>
        <View style={styles.searchField}>
          <TextField
            placeholder={t('memory.searchPlaceholder')}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('memory.compose')}
          onPress={() => setComposing(true)}
          style={[styles.composeButton, { backgroundColor: colors.primarySoft }]}
        >
          <Ionicons name="add" size={24} color={colors.primary} />
        </Pressable>
      </View>
      <ChipRow items={kindItems} value={kind} onChange={setKind} />
      <ChipRow items={statusItems} value={status} onChange={setStatus} />
      {memories.total > 0 ? (
        <Text style={[styles.total, { color: colors.textTertiary }]}>
          {t('memory.total', { count: memories.total })}
        </Text>
      ) : null}
    </View>
  );

  const body = () => {
    if (memories.isLoading) return <Loading label={tc('state.loading')} />;
    if (memories.error && memories.items.length === 0) {
      return (
        <ErrorState
          message={memories.error instanceof Error ? memories.error.message : t('memory.loadFailed')}
          onRetry={memories.refresh}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    return (
      <EmptyState
        icon="bookmark-outline"
        title={filtered ? t('memory.emptyFilteredTitle') : t('memory.emptyTitle')}
        description={filtered ? t('memory.emptyFilteredHint') : t('memory.emptyHint')}
      />
    );
  };

  return (
    <>
      <FlatList
        data={memories.items}
        keyExtractor={(item) => item.memory_id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={memories.refreshing}
            onRefresh={memories.refresh}
            tintColor={colors.textTertiary}
          />
        }
        ListHeaderComponent={header}
        ListEmptyComponent={<View style={styles.emptyWrap}>{body()}</View>}
        ListFooterComponent={
          remaining > 0 ? (
            <Button variant="secondary" onPress={() => setLimit((n) => n + PAGE)}>
              {t('memory.loadMore', { count: remaining })}
            </Button>
          ) : null
        }
        renderItem={({ item }) => (
          <MemoryRow memory={item} onPress={() => setEditing(item)} />
        )}
      />

      <MemorySheet
        companionId={companionId}
        memory={editing}
        visible={!!editing}
        onClose={() => setEditing(null)}
        onChanged={() => void memories.mutate()}
      />
      <MemorySheet
        companionId={companionId}
        memory={null}
        visible={composing}
        onClose={() => setComposing(false)}
        onChanged={() => void memories.mutate()}
      />
    </>
  );
}

function MemoryRow({ memory, onPress }: { memory: CompanionMemory; onPress: () => void }) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const text = plainSnippet(memory.snippet) || memory.content;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        {
          backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={styles.rowHead}>
        <Ionicons
          name={MEMORY_KIND_ICONS[memory.kind] ?? 'bookmark-outline'}
          size={16}
          color={colors.textTertiary}
        />
        <Text style={[styles.rowKind, { color: colors.textTertiary }]}>
          {t(`kinds.${memory.kind}`)}
        </Text>
        <Text style={[styles.rowTime, { color: colors.textTertiary }]}>
          {formatTimestamp(memory.updated_at)}
        </Text>
        {memory.pinned ? (
          <Ionicons name="pin" size={14} color={colors.primary} />
        ) : null}
      </View>
      <Text style={[styles.rowContent, { color: colors.text }]} numberOfLines={3}>
        {text}
      </Text>
      {memory.status === 'archived' ? (
        <View style={styles.rowTags}>
          <Tag>{t('memory.statusArchived')}</Tag>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  header: { gap: Spacing.sm, marginBottom: Spacing.xs },
  searchRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  searchField: { flex: 1 },
  composeButton: {
    width: 46,
    height: 46,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  total: { fontSize: FontSize.xs, marginTop: 2 },
  emptyWrap: { minHeight: 260 },
  row: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.md,
    gap: 6,
    minHeight: 64,
  },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rowKind: { fontSize: FontSize.xs, fontWeight: '600', flex: 1 },
  rowTime: { fontSize: FontSize.xs },
  rowContent: { fontSize: FontSize.sm, lineHeight: 20 },
  rowTags: { flexDirection: 'row', gap: Spacing.xs },
});
