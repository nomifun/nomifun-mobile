import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { usePathname, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommandMenu, type PaletteGroup } from '@/components/codevisual/command-menu';
import { filterPaletteGroups, nextCommandIndex } from '@/components/codevisual/command-data';
import { ExplorerSection } from '@/components/codevisual/explorer-section';
import { Avatar } from '@/components/ui/list-row';
import { IconButton } from '@/components/ui/icon-button';
import { Interactive } from '@/components/ui/interactive';
import { Notice } from '@/components/ui/notice';
import { SearchField } from '@/components/ui/text-field';
import { FontSize, FontWeight, Layout, Radius, Spacing } from '@/constants/theme';
import { useSessionList } from '@/features/sessions/list-context';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';
import { themeStore } from '@/hooks/theme-store';
import { useWsStatus } from '@/hooks/use-ws';
import { a11yState } from '@/utils/a11y';
import { shouldSubmitOnEnter } from '@/utils/keyboard';

const destinations = [
  { path: '/' as const, key: 'sessions', icon: 'chatbubbles-outline' as const },
  { path: '/tasks' as const, key: 'tasks', icon: 'time-outline' as const },
  { path: '/requirements' as const, key: 'requirements', icon: 'clipboard-outline' as const },
  { path: '/companions' as const, key: 'companions', icon: 'sparkles-outline' as const },
];

export function NavigationPanel({
  permanent,
  onClose,
  navigate,
  onCreate,
  creating,
  error,
}: {
  permanent: boolean;
  onClose: () => void;
  navigate: (path: Href) => void;
  onCreate: () => void;
  creating: boolean;
  error: string;
}) {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation('common');
  const { t: ts } = useTranslation('sessions');
  const { t: settings } = useTranslation('settings');
  const { t: connect } = useTranslation('connect');
  const pathname = usePathname();
  const list = useSessionList();
  const connection = useConnection();
  const ws = useWsStatus();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(0);
  const [folded, setFolded] = useState<Record<string, boolean>>({ tools: true });
  const [themeError, setThemeError] = useState('');
  const username = connection.phase === 'connected' ? connection.binding.user?.username : undefined;
  const title = (name: string) => t(`tabs.${name}`);
  const pinned = list.items.filter((item) => item.pinned);
  const recent = list.items.filter((item) => !item.pinned).slice(0, 8);
  const projects = list.groups.filter((group) => !group.isDefault);
  const toggle = (key: string) => setFolded((current) => ({ ...current, [key]: !current[key] }));
  const go = (path: Href) => {
    setSearching(false);
    setQuery('');
    navigate(path);
  };
  const commands: PaletteGroup[] = [
    {
      label: t('navigation.quickActions'),
      items: [
        { id: 'new', label: ts('create.action'), icon: 'add', onSelect: onCreate },
        {
          id: 'project',
          label: ts('create.projectAction'),
          icon: 'folder-open-outline',
          onSelect: () => go('/session/new-project'),
        },
        {
          id: 'task-new',
          label: t('actions.new', { ns: 'tasks' }),
          icon: 'time-outline',
          onSelect: () => go('/task/new'),
        },
        {
          id: 'requirement-new',
          label: t('list.new', { ns: 'requirements' }),
          icon: 'clipboard-outline',
          onSelect: () => go('/requirement/new'),
        },
      ],
    },
    {
      label: t('navigation.workspace'),
      items: [
        ...destinations.map((route) => ({
          id: route.key,
          label: title(route.key),
          icon: route.icon,
          onSelect: () => go(route.path),
        })),
        {
          id: 'models',
          label: settings('models'),
          icon: 'cube-outline',
          onSelect: () => go('/models'),
        },
        {
          id: 'customer-service',
          label: settings('customerService'),
          icon: 'headset-outline',
          onSelect: () => go('/customer-service'),
        },
        {
          id: 'connections',
          label: connect('devicesTitle'),
          icon: 'phone-portrait-outline',
          onSelect: () => go('/connections'),
        },
        {
          id: 'settings',
          label: t('navigation.settings'),
          icon: 'settings-outline',
          onSelect: () => go('/more'),
        },
      ],
    },
    {
      label: t('navigation.sessions'),
      items: list.items.map((item) => ({
        id: item.conversation_id,
        label: item.name?.trim() || ts('list.untitled'),
        icon: 'chatbubble-outline',
        onSelect: () => go(`/session/${item.conversation_id}`),
      })),
    },
  ];
  const matches = filterPaletteGroups(commands, query);
  const flatCommands = matches.flatMap((group) => group.items);
  useEffect(() => setSelected(0), [query]);
  const sessionItem = (item: (typeof list.items)[number]) => (
    <NavigationItem
      key={item.conversation_id}
      label={item.name?.trim() || ts('list.untitled')}
      icon={item.pinned ? 'pin-outline' : 'chatbubble-outline'}
      selected={pathname === `/session/${item.conversation_id}`}
      disabled={creating}
      onPress={() => go(`/session/${item.conversation_id}`)}
    />
  );
  return (
    <View
      style={[
        styles.panel,
        {
          backgroundColor: colors.surface,
          paddingTop: Math.max(insets.top, Spacing.sm),
          paddingBottom: Math.max(insets.bottom, Spacing.sm),
        },
      ]}
    >
      <View style={styles.brand}>
        <Image
          source={require('../../assets/images/logo.png')}
          style={styles.mark}
          accessibilityLabel={t('appName')}
        />
        <Text style={[styles.brandName, { color: colors.text }]}>{t('appName')}</Text>
        {searching ? (
          <IconButton
            icon="arrow-back"
            label={t('actions.back')}
            onPress={() => {
              setSearching(false);
              setQuery('');
            }}
          />
        ) : null}
        {!permanent ? (
          <IconButton
            icon="close"
            label={t('navigation.close')}
            onPress={onClose}
            disabled={creating}
            size={20}
          />
        ) : null}
      </View>
      <View style={styles.search}>
        <SearchField
          placeholder={t('navigation.searchPlaceholder')}
          value={query}
          onFocus={() => setSearching(true)}
          editable={!creating}
          onChangeText={(value) => {
            setQuery(value);
            setSearching(true);
          }}
          onClear={() => {
            setQuery('');
            setSearching(false);
          }}
          onKeyPress={(event) => {
            const key = event.nativeEvent.key;
            if (key === 'ArrowDown' || key === 'ArrowUp') {
              (event as unknown as { preventDefault: () => void }).preventDefault?.();
              setSelected((index) =>
                nextCommandIndex(index, key === 'ArrowDown' ? 1 : -1, flatCommands.length),
              );
            } else if (Platform.OS === 'web' && shouldSubmitOnEnter(event.nativeEvent)) {
              (event as unknown as { preventDefault: () => void }).preventDefault?.();
              flatCommands[selected]?.onSelect();
            } else if (key === 'Escape') {
              setSearching(false);
              setQuery('');
            }
          }}
          onSubmitEditing={() => {
            if (Platform.OS !== 'web') flatCommands[selected]?.onSelect();
          }}
        />
      </View>
      <ScrollView
        style={styles.fill}
        contentContainerStyle={styles.panelContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {searching ? (
          <>
            <CommandMenu
              groups={matches}
              selectedIndex={selected}
              disabled={creating}
              onSelect={(item) => item.onSelect()}
            />
            {flatCommands.length === 0 ? (
              <Text style={[styles.empty, { color: colors.textTertiary }]}>
                {t('navigation.noResults')}
              </Text>
            ) : null}
            {query.trim() ? (
              <NavigationItem
                label={t('navigation.searchMessages')}
                icon="search-outline"
                onPress={() => go({ pathname: '/search', params: { q: query.trim() } })}
                disabled={creating}
              />
            ) : null}
          </>
        ) : (
          <>
            <NavigationItem
              label={ts('create.action')}
              icon="add"
              primary
              onPress={onCreate}
              disabled={creating}
              loading={creating}
            />
            <NavigationItem
              label={ts('create.projectAction')}
              icon="folder-open-outline"
              onPress={() => go('/session/new-project')}
              disabled={creating}
            />
            <View
              accessibilityLabel={t('navigation.workspace')}
              style={[styles.destinations, { borderBottomColor: colors.borderLight }]}
            >
              {destinations.map((route) => (
                <NavigationItem
                  key={route.key}
                  label={title(route.key)}
                  icon={route.icon}
                  selected={
                    pathname === route.path ||
                    (route.path === '/'
                      ? pathname.startsWith('/session/') || pathname === '/search'
                      : pathname.startsWith(
                          `/${route.key === 'tasks' ? 'task' : route.key === 'requirements' ? 'requirement' : 'companion'}/`,
                        ))
                  }
                  onPress={() => go(route.path)}
                  disabled={creating}
                />
              ))}
            </View>
            {pinned.length ? (
              <ExplorerSection
                title={t('navigation.pinned')}
                count={pinned.length}
                expanded={!folded.pinned}
                onToggle={() => toggle('pinned')}
              >
                {pinned.map(sessionItem)}
              </ExplorerSection>
            ) : null}
            <ExplorerSection
              title={t('navigation.recent')}
              expanded={!folded.recent}
              onToggle={() => toggle('recent')}
            >
              {list.isLoading ? <ActivityIndicator color={colors.textTertiary} /> : null}
              {recent.map(sessionItem)}
              {list.error ? (
                <NavigationItem
                  label={t('actions.retry')}
                  icon="refresh-outline"
                  onPress={list.retry}
                />
              ) : null}
              <NavigationItem
                label={t('navigation.allSessions')}
                icon="arrow-forward-outline"
                onPress={() => go('/')}
                disabled={creating}
              />
            </ExplorerSection>
            {projects.length ? (
              <ExplorerSection
                title={t('navigation.projects')}
                count={projects.length}
                expanded={!folded.projects}
                onToggle={() => toggle('projects')}
              >
                {projects.map((group) => (
                  <ExplorerSection
                    key={group.key}
                    title={group.displayName}
                    count={group.items.length}
                    icon={folded[group.key] ? 'folder-outline' : 'folder-open-outline'}
                    expanded={!folded[group.key]}
                    onToggle={() => toggle(group.key)}
                    action={
                      <IconButton
                        icon="add"
                        label={ts('groups.newInProject')}
                        disabled={creating}
                        onPress={() =>
                          go({
                            pathname: '/session/new-project',
                            params: { workspace: group.path ?? group.key },
                          })
                        }
                      />
                    }
                  >
                    {group.items.map(sessionItem)}
                  </ExplorerSection>
                ))}
              </ExplorerSection>
            ) : null}
            <ExplorerSection
              title={t('navigation.tools')}
              expanded={!folded.tools}
              onToggle={() => toggle('tools')}
            >
              <NavigationItem
                label={settings('models')}
                icon="cube-outline"
                selected={pathname === '/models' || pathname.startsWith('/model-provider/')}
                onPress={() => go('/models')}
                disabled={creating}
              />
              <NavigationItem
                label={settings('customerService')}
                icon="headset-outline"
                selected={pathname === '/customer-service' || pathname.startsWith('/cs-agent/')}
                onPress={() => go('/customer-service')}
                disabled={creating}
              />
            </ExplorerSection>
          </>
        )}
        {list.hasMore ? (
          <NavigationItem
            label={t('navigation.loadMore')}
            icon="chevron-down-outline"
            onPress={list.loadMore}
            loading={list.isLoadingMore}
            disabled={list.isLoadingMore || creating}
          />
        ) : null}
        {error || themeError ? <Notice tone="danger">{error || themeError}</Notice> : null}
      </ScrollView>
      <NavigationItem label={connect('devicesTitle')} icon="phone-portrait-outline"
        selected={pathname === '/connections'} onPress={() => go('/connections')} disabled={creating} />
      <View style={[styles.account, { borderTopColor: colors.borderLight }]}>
        <Interactive
          accessibilityRole="button"
          accessibilityLabel={t('navigation.account')}
          disabled={creating}
          onPress={() => go('/more')}
          style={styles.accountBody}
        >
          <Avatar name={username ?? t('appName')} size={32} />
          <View style={styles.accountCopy}>
            <Text numberOfLines={1} style={[styles.username, { color: colors.text }]}>
              {username ?? t('appName')}
            </Text>
            <Text numberOfLines={1} style={[styles.connection, { color: colors.textTertiary }]}>
              {t(
                ws === 'open'
                  ? 'state.connected'
                  : ws === 'connecting' || ws === 'reconnecting'
                    ? 'state.reconnecting'
                    : 'state.offline',
              )}
            </Text>
          </View>
        </Interactive>
        <IconButton
          icon={scheme === 'light' ? 'moon-outline' : 'sunny-outline'}
          label={settings(scheme === 'light' ? 'appearance.dark' : 'appearance.light')}
          disabled={creating}
          onPress={() =>
            void themeStore
              .setMode(scheme === 'light' ? 'dark' : 'light')
              .catch(() => setThemeError(t('feedback.requestFailed')))
          }
        />
        <IconButton
          icon="settings-outline"
          label={t('navigation.settings')}
          disabled={creating}
          onPress={() => go('/more')}
        />
      </View>
    </View>
  );
}

function NavigationItem({
  label,
  icon,
  selected,
  primary,
  loading,
  disabled,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  selected?: boolean;
  primary?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const foreground = primary ? colors.onPrimary : selected ? colors.text : colors.textSecondary;
  return (
    <Interactive
      feedback={false}
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      {...a11yState({ selected: !!selected, busy: !!loading })}
      onPress={onPress}
      {...(Platform.OS === 'web' ? { title: label } : {})}
      style={[styles.navTarget, { opacity: disabled && !loading ? 0.5 : 1 }]}
    >
      {({ pressed, hovered }) => (
        <View
          pointerEvents="none"
          style={[
            styles.navItem,
            {
              backgroundColor: primary
                ? pressed || hovered
                  ? colors.primaryHover
                  : colors.primary
                : selected
                  ? colors.primarySoft
                  : pressed || hovered
                    ? colors.bgHover
                    : 'transparent',
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={foreground} />
          ) : (
            <Ionicons name={icon} size={18} color={foreground} />
          )}
          <Text
            numberOfLines={1}
            style={[
              styles.navLabel,
              {
                color: foreground,
                fontWeight: selected || primary ? FontWeight.heading : FontWeight.body,
              },
            ]}
          >
            {label}
          </Text>
        </View>
      )}
    </Interactive>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
  panel: { flex: 1, minHeight: 0 },
  brand: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.lg,
  },
  mark: {
    width: 30,
    height: 30,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  brandName: { flex: 1, minWidth: 0, fontSize: FontSize.lg, fontWeight: '600' },
  search: { paddingHorizontal: Spacing.md },
  panelContent: { paddingHorizontal: Spacing.md, paddingBottom: Spacing.md, gap: Spacing.xs },
  destinations: { marginTop: Spacing.sm, paddingVertical: Spacing.sm, borderBottomWidth: 1 },
  navTarget: {
    minHeight: Layout.controlHeight,
    justifyContent: 'center',
    borderRadius: Radius.md,
  },
  navItem: {
    minHeight: Layout.buttonHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
  },
  navLabel: { flex: 1, minWidth: 0, fontSize: FontSize.sm },
  empty: { padding: Spacing.md, fontSize: FontSize.sm },
  account: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    borderTopWidth: 1,
  },
  accountBody: {
    flex: 1,
    minWidth: 0,
    minHeight: Layout.controlHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  accountCopy: { flex: 1, minWidth: 0, gap: 2 },
  username: { fontSize: FontSize.sm, fontWeight: '600' },
  connection: { fontSize: FontSize.xs },
});
