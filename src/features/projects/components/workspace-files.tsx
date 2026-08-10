/**
 * Read-only, one-level-at-a-time browser over
 * `GET /api/conversations/:id/workspace?path=…`.
 *
 * The endpoint returns `{name, type}` only — no size, no mtime, no recursion —
 * and there is no read/download surface on the phone, so this is deliberately a
 * viewer: tap a directory to drill in, nothing else.
 */
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/types';
import { EmptyState, ErrorState, ListRow, Loading } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { useWorkspaceBrowser } from '../hooks';

interface WorkspaceFilesProps {
  conversationId: string;
  /** Leaving the root goes back to the working-directory overview. */
  onExit: () => void;
}

function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

export function WorkspaceFiles({ conversationId, onExit }: WorkspaceFilesProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('project');
  const { t: tc } = useTranslation('common');
  const browser = useWorkspaceBrowser(conversationId);

  const crumb = browser.segments.length === 0 ? t('files.root') : `/${browser.segments.join('/')}`;

  const body = () => {
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
              chevron={openable}
              onPress={openable ? () => browser.openDirectory(item.name) : undefined}
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
          accessibilityLabel={browser.canGoUp ? t('files.up') : tc('actions.back')}
          onPress={browser.canGoUp ? browser.goUp : onExit}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
        </Pressable>
        <Text style={[styles.crumb, { color: colors.textSecondary }]} numberOfLines={1}>
          {crumb}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tc('actions.refresh')}
          onPress={() => void browser.refresh()}
          style={({ pressed }) => [styles.iconButton, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Ionicons name="refresh" size={18} color={colors.textTertiary} />
        </Pressable>
      </View>

      <Text style={[styles.footnote, { color: colors.textTertiary }]}>{t('files.readOnly')}</Text>

      <View style={styles.body}>{body()}</View>
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
});
