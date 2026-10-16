import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { NavigationPanel } from '@/components/navigation-panel';
import { NavigationDrawer } from '@/components/navigation-drawer';
import { Layout } from '@/constants/theme';
import { createConversation } from '@/features/sessions/api';
import { useConversationList } from '@/features/sessions/hooks';
import { SessionListContext } from '@/features/sessions/list-context';
import { AppNavigationContext } from '@/hooks/use-app-navigation';
import { useTheme } from '@/hooks/use-theme';

/** Owns shared conversation state and navigation commands; rendering lives in the panel/drawer. */
export function AppNavigation({ children }: PropsWithChildren) {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const { t } = useTranslation('sessions');
  const { t: tc } = useTranslation('common');
  const permanent = width >= Layout.sidebarBreakpoint;
  const [opened, setOpened] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const creatingRef = useRef(false);
  const list = useConversationList();
  const close = useCallback(() => {
    if (!creatingRef.current) setOpened(false);
  }, []);
  const navigate = useCallback((path: Href) => {
    if (creatingRef.current) return;
    setOpened(false);
    router.navigate(path);
  }, []);
  const create = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(true);
    setError('');
    try {
      const created = await createConversation(t('create.defaultName'));
      list.retry();
      if (created?.conversation_id) {
        setOpened(false);
        router.push(`/session/${created.conversation_id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tc('feedback.requestFailed'));
    } finally {
      creatingRef.current = false;
      setCreating(false);
    }
  }, [list, t, tc]);
  const navigationState = useMemo(() => ({ permanent, open: () => setOpened(true) }), [permanent]);
  useEffect(() => {
    if (permanent) setOpened(false);
  }, [permanent]);
  const panel = (
    <NavigationPanel
      permanent={permanent}
      onClose={close}
      navigate={navigate}
      onCreate={() => void create()}
      creating={creating}
      error={error}
    />
  );
  return (
    <AppNavigationContext.Provider value={navigationState}>
      <SessionListContext.Provider value={list}>
        <View style={[styles.shell, { backgroundColor: colors.background }]}>
          {permanent ? (
            <View style={[styles.sidebar, { borderRightColor: colors.borderLight }]}>{panel}</View>
          ) : null}
          <View style={styles.main}>{children}</View>
        </View>
        {!permanent ? (
          <NavigationDrawer visible={opened} onClose={close}>
            {panel}
          </NavigationDrawer>
        ) : null}
      </SessionListContext.Provider>
    </AppNavigationContext.Provider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, minHeight: 0, flexDirection: 'row' },
  main: { flex: 1, minWidth: 0, minHeight: 0 },
  sidebar: { width: Layout.sidebarWidth, borderRightWidth: 1 },
});
