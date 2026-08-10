/**
 * Read-only, one-level-at-a-time browser over
 * `GET /api/conversations/:id/workspace?path=…`, plus a text preview for a
 * single tapped file.
 *
 * The listing endpoint returns `{name, type}` only — no size, no mtime, no
 * recursion — so nothing about a file can be decided from it. Tapping one asks
 * `POST /api/fs/metadata` for size + MIME first and only then
 * `POST /api/fs/read`; both carry the conversation's absolute `workspace`,
 * which is what widens the server's `allowed_roots` sandbox to cover the
 * project directory for that one request (see `../api.ts`).
 *
 * The preview replaces the list *in place* instead of opening another modal:
 * this component already lives inside a `Modal`-based sheet, and stacking
 * modals is how iOS swallows the inner one. Editing stays desktop-only.
 */
import { FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/types';
import { Button, EmptyState, ErrorState, ListRow, Loading } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { Fonts, FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useFilePreview, useWorkspaceBrowser } from '../hooks';
import { MAX_PREVIEW_BYTES, MAX_PREVIEW_CHARS, formatBytes, isTextFileName } from '../preview';

interface WorkspaceFilesProps {
  conversationId: string;
  /** The conversation's absolute `extra.workspace`; without it no file can be read. */
  workspace?: string;
  /** Leaving the root goes back to the working-directory overview. */
  onExit: () => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export function WorkspaceFiles({ conversationId, workspace, onExit }: WorkspaceFilesProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('project');
  const { t: tc } = useTranslation('common');
  const browser = useWorkspaceBrowser(conversationId);
  const preview = useFilePreview(workspace, browser.segments);

  const state = preview.state;
  const previewing = state.kind !== 'idle';
  const canPreview = !!workspace && workspace.trim().length > 0;
  const crumb = browser.segments.length === 0 ? t('files.root') : `/${browser.segments.join('/')}`;

  const previewBody = () => {
    if (state.kind === 'idle') return null;
    if (state.kind === 'loading') return <Loading label={tc('state.loading')} />;
    if (state.kind === 'failed') {
      return (
        <ErrorState
          message={t(`preview.failed.${state.reason}`)}
          // A 403 (outside the sandbox / not the install owner) will not fix
          // itself, so no retry button is offered for it.
          onRetry={state.reason === 'forbidden' ? undefined : preview.retry}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    if (state.kind === 'refused') {
      return (
        <EmptyState
          icon={state.reason === 'binary' ? 'lock-closed-outline' : 'document-outline'}
          title={t(`preview.refused.${state.reason}Title`)}
          description={
            state.reason === 'tooLarge'
              ? t('preview.refused.tooLargeHint', {
                  size: formatBytes(state.size),
                  limit: formatBytes(MAX_PREVIEW_BYTES),
                })
              : t(`preview.refused.${state.reason}Hint`)
          }
        />
      );
    }
    return (
      <ScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
        {/* Long lines are code — sideways scrolling beats wrapping them. */}
        <ScrollView horizontal contentContainerStyle={styles.previewInner}>
          <Text style={[styles.code, { color: colors.text }]} selectable>
            {state.text}
          </Text>
        </ScrollView>
        <Text style={[styles.footnote, { color: colors.textTertiary }]}>
          {state.truncated
            ? t('preview.truncated', { chars: MAX_PREVIEW_CHARS, size: formatBytes(state.size) })
            : t('preview.meta', { lines: state.lines, size: formatBytes(state.size) })}
        </Text>
      </ScrollView>
    );
  };

  const listBody = () => {
    if (browser.isLoading) return <Loading label={tc('state.loading')} />;
    if (browser.unassigned) {
      return (
        <EmptyState
          icon="alert-circle-outline"
          title={t('files.noWorkspaceTitle')}
          description={t('files.noWorkspaceHint')}
        />
      );
    }
    if (browser.error) {
      return (
        <ErrorState
          message={errorText(browser.error, t('files.loadFailed'))}
          onRetry={browser.retry}
          retryLabel={tc('actions.retry')}
        />
      );
    }
    // 404 is "not on disk (yet)", not a failure — the server answers 404 on
    // purpose so a polling rail cannot produce a 500 storm.
    if (browser.missing) {
      return (
        <EmptyState
          icon="folder-outline"
          title={t('files.missingTitle')}
          description={t('files.missingHint')}
        />
      );
    }
    return (
      <FlatList
        data={browser.entries}
        keyExtractor={(item) => `${item.type}:${item.name}`}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={browser.isRefreshing}
            onRefresh={() => void browser.refresh()}
            tintColor={colors.textTertiary}
          />
        }
        renderItem={({ item }) => {
          const isDirectory = item.type === 'directory';
          const openable = isDirectory && !browser.atDepthLimit;
          // Every file is tappable, but only a text-looking one is fetched: the
          // hook refuses the rest from the name alone, without a round trip
          // (`/api/fs/read` 500s on non-UTF-8 input). An inert row would leave a
          // tap on a `.bin` answering nothing at all, so the row invites the tap
          // and the preview pane explains the refusal.
          const previewable = !isDirectory && canPreview;
          const readable = previewable && isTextFileName(item.name);
          return (
            <ListRow
              title={item.name}
              left={
                <Ionicons
                  name={isDirectory ? 'folder-outline' : 'document-outline'}
                  size={20}
                  color={isDirectory ? colors.primary : colors.textTertiary}
                />
              }
              right={
                previewable ? (
                  <Ionicons
                    name={readable ? 'eye-outline' : 'lock-closed-outline'}
                    size={16}
                    color={colors.textTertiary}
                  />
                ) : undefined
              }
              chevron={openable}
              onPress={
                openable
                  ? () => browser.openDirectory(item.name)
                  : previewable
                    ? () => preview.open(item.name)
                    : undefined
              }
            />
          );
        }}
        ListEmptyComponent={
          <EmptyState
            icon="document-outline"
            title={t('files.emptyTitle')}
            description={t('files.emptyHint')}
          />
        }
        ListFooterComponent={
          browser.atDepthLimit ? (
            <Text style={[styles.footnote, { color: colors.textTertiary }]}>
              {t('files.depthLimit')}
            </Text>
          ) : null
        }
      />
    );
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.crumbRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            previewing ? t('preview.back') : browser.canGoUp ? t('files.up') : tc('actions.back')
          }
          onPress={previewing ? preview.close : browser.canGoUp ? browser.goUp : onExit}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.crumb, { color: colors.textSecondary }]} numberOfLines={1}>
          {state.kind === 'idle' ? crumb : state.name}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tc('actions.refresh')}
          onPress={previewing ? preview.retry : () => void browser.refresh()}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="refresh" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>
        {previewing ? t('preview.readOnly') : t('files.readOnly')}
      </Text>

      <View
        style={[
          styles.body,
          previewing ? { backgroundColor: colors.surface, borderRadius: Radius.md } : null,
        ]}
      >
        {previewing ? previewBody() : listBody()}
      </View>

      {previewing ? (
        <Button variant="secondary" onPress={preview.close}>
          {t('preview.back')}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs },
  crumbRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  crumb: { flex: 1, fontSize: FontSize.sm, fontFamily: Fonts.mono },
  footnote: { fontSize: FontSize.xs, lineHeight: 17, paddingHorizontal: Spacing.xs },
  body: { minHeight: 260, maxHeight: 420, marginTop: Spacing.sm },
  list: { paddingBottom: Spacing.sm, flexGrow: 1 },
  previewScroll: { flex: 1 },
  previewContent: { padding: Spacing.md, gap: Spacing.sm },
  previewInner: { paddingRight: Spacing.md },
  code: { fontSize: FontSize.xs, lineHeight: 18, fontFamily: Fonts.mono },
});
