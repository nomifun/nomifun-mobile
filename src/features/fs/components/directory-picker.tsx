/**
 * Full-screen directory picker over the desktop filesystem.
 *
 * The desktop app opens a native OS dialog; a phone cannot, so this is the
 * mobile twin of the desktop WebUI fallback (`DirectorySelectionModal`) built on
 * `GET /api/fs/browse`. Behaviours that come straight from the API contract
 * (docs/research/fs-browse-api.md):
 *
 * - The picked value is ALWAYS the server's `currentPath`, never a string the
 *   user typed: the conversation API stores `extra.workspace` verbatim without
 *   validating it, so an unresolved path would only fail when the agent starts.
 * - Hidden directories (`.`-prefixed) are filtered out of every listing
 *   server-side and there is no flag to include them, so "type a path" is not a
 *   power-user extra — it is the only way to reach `~/.config/x`. The copy says so.
 * - Listings are capped at 500 entries with no pagination; `truncated` gets its
 *   own footer note pointing at manual input.
 * - `parentPath === '__ROOT__'` is the Windows "back to drive list" sentinel,
 *   and `canGoUp === false` still ships a `parentPath` for display only — so the
 *   up button follows `canGoUp`, not the presence of a parent.
 * - A workspace is NOT a sandbox, hence the risky-path warning bar. It warns,
 *   never blocks: the user may genuinely want a broad directory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, EmptyState, ErrorState, Loading, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, MaxContentWidth, Radius, Spacing } from '@/constants/theme';
import { createDirectory, fsErrorMessage, resolveDirectory } from '@/features/fs/api';
import { DirectoryEntryRow } from '@/features/fs/components/entry-row';
import { PathBar } from '@/features/fs/components/path-bar';
import { PromptOverlay } from '@/features/fs/components/prompt-overlay';
import { useBrowse, useInvalidateBrowse, useSystemInfo } from '@/features/fs/hooks';
import { hasEdgeWhitespaceSegment, isRiskyWorkspacePath } from '@/features/fs/risky-path';
import { MAX_BROWSE_ITEMS, WINDOWS_ROOT_SENTINEL } from '@/features/fs/types';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

export interface DirectoryPickerProps {
  visible: boolean;
  onClose: () => void;
  /** User confirmed a directory; `path` is the server's canonical absolute path. */
  onPick: (path: string) => void;
  /** Where to open (e.g. the project path picked last time). Defaults to the start screen. */
  initialPath?: string;
  /** Extra start-screen entries, e.g. recent projects. */
  shortcuts?: { label: string; path: string }[];
}

type PromptKind = 'newFolder' | 'manual';

interface StartItem {
  key: string;
  label: string;
  hint?: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Value to hand to `browseDirectory` — `''` is the Windows drive page. */
  target: string;
}

export function DirectoryPicker({
  visible,
  onClose,
  onPick,
  initialPath,
  shortcuts,
}: DirectoryPickerProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation('fs');
  const { t: tc } = useTranslation('common');

  /** `null` = start screen (no directory listed yet). */
  const [path, setPath] = useState<string | null>(initialPath ?? null);
  const [prompt, setPrompt] = useState<PromptKind | null>(null);
  const [promptBusy, setPromptBusy] = useState(false);
  /** Name of the folder just created, shown inline in the footer for a moment. */
  const [createdNotice, setCreatedNotice] = useState('');
  const [promptError, setPromptError] = useState('');
  /** Set once the user navigates, so the Windows auto-jump never fights them. */
  const navigated = useRef(false);
  const autoJumped = useRef(false);

  const { info, isRefreshing: infoRefreshing, refresh: refreshInfo } = useSystemInfo(visible);
  const workDir = info?.work_dir && info.work_dir.trim() !== '' ? info.work_dir : undefined;
  const isWindows = info?.platform === 'win32';

  const browse = useBrowse(visible ? path : null);
  const invalidateBrowse = useInvalidateBrowse();
  const data = browse.data;
  const onStart = path === null;
  const onDrivePage = data?.isRoot === true;
  const currentPath = data?.currentPath ?? '';

  useEffect(() => {
    if (!visible) return;
    navigated.current = false;
    autoJumped.current = false;
    setPath(initialPath ?? null);
    setPrompt(null);
    setPromptError('');
    setPromptBusy(false);
    setCreatedNotice('');
  }, [visible, initialPath]);

  // The inline "folder created" line is a transient confirmation, not state.
  useEffect(() => {
    if (!createdNotice) return;
    const timer = setTimeout(() => setCreatedNotice(''), 4000);
    return () => clearTimeout(timer);
  }, [createdNotice]);

  // Windows has no meaningful default directory, so open on the drive list.
  // `platform` arrives asynchronously, hence the effect rather than lazy state.
  useEffect(() => {
    if (!visible || initialPath || !isWindows) return;
    if (navigated.current || autoJumped.current || path !== null) return;
    autoJumped.current = true;
    setPath('');
  }, [visible, initialPath, isWindows, path]);

  const goTo = useCallback((next: string) => {
    navigated.current = true;
    setPath(next);
  }, []);

  const goStart = useCallback(() => {
    navigated.current = true;
    setPath(null);
  }, []);

  const goUp = useCallback(() => {
    const parent = data?.parentPath;
    if (!data?.canGoUp || !parent) return;
    goTo(parent === WINDOWS_ROOT_SENTINEL ? '' : parent);
  }, [data, goTo]);

  const startItems = useMemo<StartItem[]>(() => {
    const items: StartItem[] = [];
    if (isWindows) {
      items.push({
        key: 'drives',
        label: t('picker.drives'),
        hint: t('picker.drivesHint'),
        icon: 'hardware-chip-outline',
        target: '',
      });
    }
    items.push({
      key: 'home',
      label: t('picker.home'),
      hint: t('picker.homeHint'),
      icon: 'home-outline',
      target: '~',
    });
    if (workDir) {
      items.push({
        key: 'workspace',
        label: t('picker.workspace'),
        hint: workDir,
        icon: 'folder-open-outline',
        target: workDir,
      });
    }
    (shortcuts ?? []).forEach((shortcut, index) => {
      items.push({
        key: `shortcut:${index}:${shortcut.path}`,
        label: shortcut.label,
        hint: shortcut.path,
        icon: 'time-outline',
        target: shortcut.path,
      });
    });
    return items;
  }, [isWindows, shortcuts, t, workDir]);

  const directories = useMemo(
    () => (data?.items ?? []).filter((item) => item.isDirectory),
    [data],
  );

  const canSelect = !onStart && !!data && !onDrivePage && currentPath !== '';
  const canCreate = canSelect;
  const risky = canSelect && isRiskyWorkspacePath(currentPath);
  const edgeWhitespace = canSelect && hasEdgeWhitespaceSegment(currentPath);

  const select = useCallback(() => {
    if (!canSelect) return;
    // Always the server's canonical path — never `path`, which may be `~`.
    onPick(currentPath);
    onClose();
  }, [canSelect, currentPath, onClose, onPick]);

  const openPrompt = useCallback((kind: PromptKind) => {
    setPromptError('');
    setPrompt(kind);
  }, []);

  const submitPrompt = useCallback(
    async (value: string) => {
      const kind = prompt;
      if (!kind) return;
      setPromptError('');
      setPromptBusy(true);
      try {
        if (kind === 'manual') {
          const resolved = await resolveDirectory(value);
          setPrompt(null);
          onPick(resolved);
          onClose();
          return;
        }
        const entry = await createDirectory(currentPath, value);
        setPrompt(null);
        // The parent listing no longer matches disk — refetch it so walking back
        // up shows the folder we just made.
        invalidateBrowse(currentPath);
        // Inline, not only `toast`: this picker is an RN Modal, and a toast
        // fired while a modal is open renders underneath it on native (the web
        // build portals above it). Without this the only success signal would
        // be the path bar quietly moving.
        setCreatedNotice(entry.name);
        toast.success(t('newFolder.created', { name: entry.name }));
        goTo(entry.path);
      } catch (error) {
        setPromptError(fsErrorMessage(error, kind === 'newFolder' ? 'create' : 'browse'));
      } finally {
        setPromptBusy(false);
      }
    },
    [currentPath, goTo, invalidateBrowse, onClose, onPick, prompt, t],
  );

  const pathText = onStart
    ? t('picker.startTitle')
    : onDrivePage
      ? t('picker.drives')
      : currentPath || (path ?? '');

  const renderBody = () => {
    if (onStart) {
      return (
        <ScrollView
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={infoRefreshing}
              onRefresh={refreshInfo}
              tintColor={colors.textTertiary}
            />
          }
        >
          <Text style={[styles.groupLabel, { color: colors.textSecondary }]}>
            {t('picker.startTitle')}
          </Text>
          {startItems.map((item) => (
            <DirectoryEntryRow
              key={item.key}
              name={item.label}
              hint={item.hint}
              icon={item.icon}
              onPress={() => goTo(item.target)}
            />
          ))}
          <Text style={[styles.note, { color: colors.textTertiary }]}>{t('picker.manualHint')}</Text>
        </ScrollView>
      );
    }

    if (browse.isLoading && !data) return <Loading label={tc('state.loading')} />;

    if (browse.error && !data) {
      return (
        <ErrorState
          message={fsErrorMessage(browse.error)}
          onRetry={browse.refresh}
          retryLabel={tc('actions.retry')}
        />
      );
    }

    return (
      <FlatList
        data={directories}
        keyExtractor={(item) => item.path}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          // A failed *refresh* keeps the cached listing on screen; say so instead
          // of silently showing possibly-stale content.
          browse.error ? (
            <Text style={[styles.note, { color: colors.danger }]}>
              {fsErrorMessage(browse.error)}
            </Text>
          ) : null
        }
        renderItem={({ item }) => (
          <DirectoryEntryRow
            name={item.name}
            modified={item.modified}
            onPress={() => goTo(item.path)}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={browse.isRefreshing}
            onRefresh={browse.refresh}
            tintColor={colors.textTertiary}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="folder-open-outline"
            title={t('picker.emptyTitle')}
            description={t('picker.emptyHint')}
          />
        }
        ListFooterComponent={
          data?.truncated ? (
            <Text style={[styles.note, { color: colors.warning }]}>
              {t('picker.truncated', { count: MAX_BROWSE_ITEMS })}
            </Text>
          ) : null
        }
      />
    );
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.fill, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.column}>
          <View style={[styles.header, { borderColor: colors.border }]}>
            <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
              {t('picker.title')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tc('actions.close')}
              onPress={onClose}
              style={styles.iconButton}
            >
              <Ionicons name="close" size={24} color={colors.textTertiary} />
            </Pressable>
          </View>

          <PathBar
            text={pathText}
            canGoUp={!onStart && !!data?.canGoUp && !!data.parentPath}
            onUp={goUp}
            onStart={onStart ? undefined : goStart}
          />

          <View style={styles.tools}>
            <ToolButton
              icon="create-outline"
              label={t('picker.manual')}
              onPress={() => openPrompt('manual')}
            />
            <ToolButton
              icon="add-circle-outline"
              label={t('picker.newFolder')}
              onPress={() => openPrompt('newFolder')}
              disabled={!canCreate}
            />
          </View>

          <View style={styles.body}>{renderBody()}</View>

          <View
            style={[
              styles.footer,
              { borderColor: colors.border, paddingBottom: Math.max(insets.bottom, Spacing.md) },
            ]}
          >
            {risky ? <WarningBar text={t('risky.warning')} /> : null}
            {edgeWhitespace ? <WarningBar text={t('risky.whitespace')} /> : null}
            {createdNotice ? (
              <Text style={[styles.note, { color: colors.success }]}>
                {t('newFolder.created', { name: createdNotice })}
              </Text>
            ) : null}
            {onDrivePage ? (
              <Text style={[styles.note, { color: colors.textTertiary }]}>{t('picker.driveHint')}</Text>
            ) : null}
            <Button onPress={select} disabled={!canSelect}>
              {t('picker.select')}
            </Button>
          </View>
        </View>

        <PromptOverlay
          visible={prompt !== null}
          title={prompt === 'manual' ? t('manual.title') : t('newFolder.title')}
          label={prompt === 'manual' ? t('manual.label') : t('newFolder.label')}
          placeholder={prompt === 'manual' ? t('manual.placeholder') : t('newFolder.placeholder')}
          hint={prompt === 'manual' ? t('manual.hint') : t('newFolder.hint')}
          confirmLabel={prompt === 'manual' ? t('manual.submit') : t('newFolder.submit')}
          busy={promptBusy}
          error={promptError}
          onCancel={() => {
            setPrompt(null);
            setPromptError('');
          }}
          onSubmit={(value) => void submitPrompt(value)}
        />
      </View>
    </Modal>
  );
}

/** Secondary action chip in the picker toolbar (≥44px tall). */
function ToolButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      {...a11yState({ disabled: !!disabled })}
      // See path-bar: RNW derives aria-disabled from this prop, not from ours.
      disabled={!!disabled}
      onPress={disabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.tool,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={16} color={colors.primary} />
      <Text style={[styles.toolText, { color: colors.text }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function WarningBar({ text }: { text: string }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.warning, { backgroundColor: colors.warningSoft }]}>
      <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
      <Text style={[styles.warningText, { color: colors.warning }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  column: { flex: 1, width: '100%', maxWidth: MaxContentWidth, alignSelf: 'center' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingLeft: Spacing.lg,
    paddingRight: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginBottom: Spacing.sm,
  },
  title: { flex: 1, fontSize: FontSize.lg, fontWeight: '700' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tools: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  tool: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: StyleSheet.hairlineWidth,
  },
  toolText: { fontSize: FontSize.sm, fontWeight: '600', flexShrink: 1 },
  body: { flex: 1 },
  listContent: { flexGrow: 1, paddingHorizontal: Spacing.lg, paddingBottom: Spacing.lg },
  groupLabel: {
    fontSize: FontSize.xs,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: Spacing.sm,
  },
  note: { fontSize: FontSize.xs, lineHeight: 18, paddingVertical: Spacing.sm },
  footer: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: Spacing.sm,
  },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  warningText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
});
