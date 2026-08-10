import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/types';
import { Button, EmptyState, ErrorState, ListRow, Loading, Screen, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import {
  createConversation,
  deleteConversation,
  patchConversation,
  type Conversation,
} from '@/features/sessions/api';
import { ProjectSection } from '@/features/sessions/components/project-section';
import { SessionActions } from '@/features/sessions/components/session-actions';
import { SessionRow } from '@/features/sessions/components/session-row';
import { useCollapsedWorkpaths, useConversationList } from '@/features/sessions/hooks';
import type { ConversationGroup } from '@/features/sessions/workpath';
import { useTheme } from '@/hooks/use-theme';
import { useWsStatus } from '@/hooks/use-ws';

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

/**
 * One flat FlatList over section headers + rows. A flattened list (rather than
 * SectionList) keeps `onEndReached` paging, pull-to-refresh and the existing
 * key extractor working unchanged, and lets a collapsed section drop its rows
 * without touching the data source.
 */
type ListItem =
  | { kind: 'header'; group: ConversationGroup }
  | { kind: 'session'; conversation: Conversation };

export default function SessionListScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const list = useConversationList();
  const wsStatus = useWsStatus();
  const { collapsed, toggle } = useCollapsedWorkpaths();

  const [creating, setCreating] = useState(false);
  const [target, setTarget] = useState<Conversation | null>(null);

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const created = await createConversation(t('create.defaultName'));
      list.retry();
      if (created?.conversation_id) router.push(`/session/${created.conversation_id}`);
    } catch (error) {
      toast.error(t('list.createFailed', { message: errorText(error, tc('feedback.requestFailed')) }));
    } finally {
      setCreating(false);
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

  const headerOptions = useMemo(
    () => ({
      headerRight: () => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('create.action')}
          onPress={() => void create()}
          disabled={creating}
          style={({ pressed }) => [styles.headerButton, { opacity: creating ? 0.4 : pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="add" size={26} color={colors.primary} />
        </Pressable>
      ),
    }),
    [colors.primary, create, creating, t],
  );

  const runAction = useCallback(
    async (action: () => Promise<unknown>, successText: string) => {
      try {
        await action();
        toast.success(successText);
        list.retry();
      } catch (error) {
        toast.error(t('actions.failed', { message: errorText(error, tc('feedback.requestFailed')) }));
      }
    },
    [list, t, tc],
  );

  const rows = useMemo<ListItem[]>(() => {
    const groups = list.groups;
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
  }, [collapsed, list.groups]);

  const renderFooter = () => {
    if (list.isLoadingMore) {
      return <Text style={[styles.footer, { color: colors.textTertiary }]}>{t('list.loadingMore')}</Text>;
    }
    if (!list.hasMore && list.items.length > 6) {
      return <Text style={[styles.footer, { color: colors.textTertiary }]}>{t('list.noMore')}</Text>;
    }
    return <View style={styles.footerSpacer} />;
  };

  if (list.isLoading) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={headerOptions} />
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (list.error && list.items.length === 0) {
    return (
      <Screen scroll={false}>
        <Stack.Screen options={headerOptions} />
        <ErrorState
          message={errorText(list.error, t('list.loadFailed'))}
          onRetry={list.retry}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  return (
    <Screen scroll={false}>
      <Stack.Screen options={headerOptions} />
      {wsStatus === 'reconnecting' ? (
        <Text style={[styles.wsHint, { color: colors.warning }]}>{t('list.wsOffline')}</Text>
      ) : null}
      <FlatList
        data={rows}
        keyExtractor={(item) =>
          item.kind === 'header' ? `group:${item.group.key}` : item.conversation.conversation_id
        }
        contentContainerStyle={styles.content}
        renderItem={({ item }) =>
          item.kind === 'header' ? (
            <ProjectSection
              group={item.group}
              collapsed={collapsed[item.group.key] === true}
              onToggle={() => toggle(item.group.key)}
              onCreate={
                item.group.isDefault
                  ? undefined
                  : () => createProject(item.group.path ?? item.group.key)
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
            refreshing={list.isRefreshing}
            onRefresh={() => void list.refresh()}
            tintColor={colors.textTertiary}
          />
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.4}
        /**
         * The header `＋` stays "plain session" (one tap, unchanged habit); the
         * project entry gets a labelled row instead of hiding behind a menu,
         * because "bind a directory" needs the explanation and is the rarer of
         * the two actions.
         */
        ListHeaderComponent={
          rows.length === 0 ? null : (
            <ListRow
              title={t('create.projectAction')}
              subtitle={t('create.projectHint')}
              left={
                <View style={[styles.projectIcon, { backgroundColor: colors.primarySoft }]}>
                  <Ionicons name="folder-open-outline" size={18} color={colors.primary} />
                </View>
              }
              chevron
              onPress={() => createProject()}
            />
          )
        }
        ListFooterComponent={renderFooter}
        ListEmptyComponent={
          <EmptyState
            icon="chatbubbles-outline"
            title={t('list.emptyTitle')}
            description={t('list.emptyHint')}
            action={
              <View style={styles.emptyActions}>
                <Button onPress={() => void create()} loading={creating}>
                  {t('create.action')}
                </Button>
                <Button variant="secondary" onPress={() => createProject()}>
                  {t('create.projectAction')}
                </Button>
              </View>
            }
          />
        }
      />

      <SessionActions
        conversation={target}
        onClose={() => setTarget(null)}
        onRename={async (name) => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(() => patchConversation(id, { name }), t('actions.renamed'));
        }}
        onTogglePin={async (pinned) => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(
            () => patchConversation(id, { pinned }),
            pinned ? t('actions.pinned') : t('actions.unpinned'),
          );
        }}
        onDelete={async () => {
          const id = target?.conversation_id;
          if (!id) return;
          await runAction(() => deleteConversation(id), tc('feedback.deleted'));
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, padding: Spacing.lg },
  wsHint: { fontSize: FontSize.xs, paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
  footer: { fontSize: FontSize.xs, textAlign: 'center', paddingVertical: Spacing.lg },
  footerSpacer: { height: Spacing.lg },
  headerButton: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.xs,
  },
  projectIcon: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyActions: { gap: Spacing.sm, alignSelf: 'stretch', minWidth: 220 },
});
