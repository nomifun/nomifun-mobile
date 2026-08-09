import '@/global.css';
import '@/i18n';

import { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useTranslation } from 'react-i18next';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SWRConfig } from 'swr';

import { connectionStore } from '@/api/connection';
import { apiFetcher } from '@/api/client';
import { nomifunSocket } from '@/api/ws';
import { ToastHost } from '@/components/ui';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const connection = useConnection();
  const { t } = useTranslation('connect');

  useEffect(() => {
    void connectionStore.hydrate();
  }, []);

  useEffect(() => {
    if (connection.phase !== 'loading') void SplashScreen.hideAsync();
  }, [connection.phase]);

  const connected = connection.phase === 'connected';

  useEffect(() => {
    if (connected) nomifunSocket.start();
    else nomifunSocket.stop();
  }, [connected]);

  if (connection.phase === 'loading') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SWRConfig
          value={{
            fetcher: apiFetcher,
            revalidateOnFocus: true,
            shouldRetryOnError: false,
            errorRetryCount: 2,
          }}
        >
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              headerTitleStyle: { fontWeight: '600' },
              headerShadowVisible: false,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Protected guard={connected}>
              <Stack.Screen name="(app)" options={{ headerShown: false }} />
            </Stack.Protected>
            <Stack.Protected guard={!connected}>
              <Stack.Screen name="connect" options={{ headerShown: false }} />
              <Stack.Screen
                name="scan"
                options={{ title: t('scanQr'), presentation: 'modal' }}
              />
            </Stack.Protected>
          </Stack>
          <ToastHost />
        </SWRConfig>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
