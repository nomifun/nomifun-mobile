import { useCallback, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Loading,
  Notice,
  PageHeading,
  Screen,
  SearchField,
  SegmentedControl,
  toast,
} from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Spacing } from '@/constants/theme';
import type { Conversation } from '@/features/sessions/api';
import { isStaleSessionError, sessionErrorText } from '@/features/sessions/errors';
import { ExplorerSection } from '@/components/codevisual/explorer-section';
import { SessionActions } from '@/features/sessions/components/session-actions';
import { SessionRow } from '@/features/sessions/components/session-row';
import { useCollapsedWorkpaths } from '@/features/sessions/hooks';
import { useSessionList } from '@/features/sessions/list-context';
import { filterConversations, type SessionScope } from '@/features/sessions/presentation';
import { buildConversationGroups, type ConversationGroup } from '@/features/sessions/workpath';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';

/**
 * One flat FlatList over section headers + rows. A flattened list (rather than
 * SectionList) keeps `onEndReached` paging, pull-to-refresh and the existing
 * key extractor working unchanged, and lets a collapsed section drop its rows
 * without touching the data source.
 */
type ListItem =
  { kind: 'header'; group: ConversationGroup } | { kind: 'session'; conversation: Conversation };

export default function SessionListScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const list = useSessionList();
  const wsStatus = useWsStatus();
  const { collapsed, toggle } = useCollapsedWorkpaths();

  const creating = list.creating;
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<SessionScope>('all');
  const [target, setTarget] = useState<Conversation | null>(null);

  const create = useCallback(async () => {
    if (creating) return;
    try {
      const created = await list.create(t('create.defaultName'));
      if (!list.isCurrent() || created.epoch !== list.epoch) return;
      if (created?.conversation_id) router.push(`/session/${created.conversation_id}`);
    } catch (error) {
      if (!list.isCurrent() || isStaleSessionError(error)) return;
      toast.error(
        t('list.createFailed', {
          message: sessionErrorText(error, tc('feedback.requestFailed')),
        }),
      );
    }
  }, [creating, list, t, tc]);

  /**
   * Project sessions are created by unit 3's wizard, which needs a directory
   * before it can POST. `workspace` pre-selects the directory so "another
   * session in this project" is a single tap.
   */
  const createProject = useCallback((workspace?: string) => {
    router.push(
      workspace
        ? `/session/new-project?workspace=${encodeURIComponent(workspace)}`
        : '/session/new-project',
    );
  }, []);

  const heading = (
    <PageHeading
      title={tc('tabs.sessions')}
      onRefresh={() => void list.refresh()}
      refreshing={list.isRefreshing}
      action={
        <View style={styles.headerActions}>
          <IconButton
            icon="add"
            label={t('create.action')}
            variant="primary"
            onPress={() => void create()}
            loading={creating}
          />
        </View>
      }
    />
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>, successText: string) => {
      try {
        await action();
        if (!list.isCurrent()) return;
        toast.success(successText);
      } catch (error) {
        if (!list.isCurrent() || isStaleSessionError(error)) return;
        toast.error(
          t('actions.failed', {
            message: sessionErrorText(error, tc('feedback.requestFailed')),
          }),
        );
        throw error;
      }
    },
    [list, t, tc],
  );

  const rows = useMemo<ListItem[]>(() => {
    const visible = filterConversations(list.items, query, scope);
    if (scope !== 'projects')
      return visible.map((conversation) => ({ kind: 'session', conversation }));
    const groups = buildConversationGroups(visible);
    // With no project at all, a lone "unbound" header would be pure chrome.
    const onlyDefault = groups.length === 1 && groups[0]?.isDefault === true;
    const out: ListItem[] = [];
    for (const group of groups) {
      const headed = !(group.isDefault && onlyDefault);
      if (headed) out.push({ kind: 'header', group });
      if (headed && collapsed[group.key]) continue;
      for (const conversation of group.items) out.push({ kind: 'session', conversation });
    }
    return out;
  }, [collapsed, list.items, query, scope]);

  const renderFooter = () => {
    if (list.isLoadingMore) {
      return (
        <Text style={[styles.footer, { color: colors.textTertiary }]}>{t('list.loadingMore')}</Text>
      );
    }
    if (!list.hasMore && !list.isRefreshing && !list.error && list.items.length > 6) {
      return (
        <Text style={[styles.footer, { color: colors.textTertiary }]}>{t('list.noMore')}</Text>
      );
    }
    return <View style={styles.footerSpacer} />;
  };

  if (list.isLoading) {
    return (
      <Screen scroll={false}>
        <View style={styles.loadingHeading}>{heading}</View>
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (list.error && list.items.length === 0) {
    return (
      <Screen scroll={false}>
        <View style={styles.loadingHeading}>{heading}</View>
        <ErrorState
          message={sessionErrorText(list.error, t('list.loadFailed'))}
          onRetry={list.retry}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <View style={[styles.toolbar, { borderBottomColor: colors.borderLight }]}>
        {heading}
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <SearchField
              placeholder={t('list.searchPlaceholder')}
              value={query}
              onChangeText={setQuery}
              onClear={() => setQuery('')}
              containerStyle={styles.field}
            />
          </View>
          <IconButton
            icon="chatbox-ellipses-outline"
            label={t('search.title')}
            onPress={() => router.push('/search')}
          />
        </View>
        <SegmentedControl
          value={scope}
          onChange={setScope}
          label={t('list.filterTitle')}
          options={[
            { value: 'all', label: t('list.all') },
            { value: 'pinned', label: t('list.pinned') },
            { value: 'projects', label: t('list.projects') },
            { value: 'companions', label: t('meta.companion') },
          ]}
        />
      </View>
      {wsStatus === 'reconnecting' ? (
        <View style={styles.wsBanner}>
          <Notice tone="warning" icon="cloud-offline-outline">
            {t('list.wsOffline')}
          </Notice>
        </View>
      ) : null}
      {list.error && list.items.length > 0 ? (
        <View style={styles.wsBanner}>
          <Notice tone="danger">{sessionErrorText(list.error, t('list.loadFailed'))}</Notice>
          <Button variant="ghost" onPress={list.retry}>{tc('actions.retry')}</Button>
        </View>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) =>
          item.kind === 'header' ? `group:${item.group.key}` : item.conversation.conversation_id
        }
        contentContainerStyle={styles.content}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <ExplorerSection
              title={item.group.displayName}
              count={item.group.items.length}
              icon={collapsed[item.group.key] ? 'folder-outline' : 'folder-open-outline'}
              expanded={collapsed[item.group.key] !== true}
              onToggle={() => toggle(item.group.key)}
              action={
                <IconButton
                  icon="add"
                  label={t('groups.newInProject')}
                  onPress={() => createProject(item.group.path ?? item.group.key)}
                />
              }
            />
          ) : (
            <SessionRow
              conversation={item.conversation}
              generating={list.isGenerating(item.conversation.conversation_id)}
              onPress={() => router.push(`/session/${item.conversation.conversation_id}`)}
              onLongPress={() => setTarget(item.conversation)}
            />
          )
        }
        refreshControl={
          <RefreshControl
            showButton={false}
            refreshing={list.isRefreshing}
            onRefresh={() => void list.refresh()}
            tintColor={colors.textTertiary}
          />
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          query.trim() || scope !== 'all' ? (
            <EmptyState
              icon="search-outline"
              title={list.hasMore ? t('list.noLoadedMatches') : t('list.noMatches')}
              action={
                <View style={styles.emptyActions}>
                <Button
                  variant="secondary"
                  onPress={() => {
                    setQuery('');
                    setScope('all');
                  }}
                >
                  {t('list.clearFilters')}
                </Button>
                {list.hasMore ? (
                  <Button variant="secondary" loading={list.isLoadingMore} onPress={() => void list.loadMore()}>
                    {tc('navigation.loadMore')}
                  </Button>
                ) : null}
                </View>
              }
            />
          ) : (
            <EmptyState
              icon="chatbubbles-outline"
              title={t('list.emptyTitle')}
              description={t('list.emptyHint')}
              action={
                <View style={styles.emptyActions}>
                  <Button icon="add" onPress={() => void create()} loading={creating}>
                    {t('create.action')}
                  </Button>
                  <Button
                    icon="folder-open-outline"
                    variant="secondary"
                    onPress={() => createProject()}
                  >
                    {t('create.projectAction')}
                  </Button>
                </View>
              }
            />
          )
        }
      />

      <SessionActions
        conversation={target}
        onClose={() => setTarget(null)}
        onRename={async (name) => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(() => list.patch(id, { name }), t('actions.renamed'));
        }}
        onTogglePin={async (pinned) => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(
            () => list.patch(id, { pinned }),
            pinned ? t('actions.pinned') : t('actions.unpinned'),
          );
        }}
        onDelete={async () => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(() => list.remove(id), tc('feedback.deleted'));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  toolbar: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.md,
    borderBottomWidth: 1,
    gap: Spacing.sm,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  searchField: { flex: 1, minWidth: 0 },
  field: { marginBottom: 0 },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
  },
  loadingHeading: { padding: Spacing.lg },
  wsBanner: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  footer: {
    fontSize: FontSize.xs,
    textAlign: 'center',
    paddingVertical: Spacing.lg,
  },
  footerSpacer: { height: Spacing.lg },
  emptyActions: { gap: Spacing.sm, alignSelf: 'stretch', minWidth: 220 },
});
