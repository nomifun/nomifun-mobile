import '@/global.css';
import '@/i18n';

import { useEffect } from 'react';
import { AppState, Platform, View } from 'react-native';
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
import { FontSize, FontWeight } from '@/constants/theme';
import { notificationService } from '@/features/notifications/service';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';
import { themeStore } from '@/hooks/theme-store';
import { VoiceLifecycle } from '@/features/voice/runtime';
import VoiceDock from '@/features/voice/components/VoiceDock';
import { verifyConnection } from '@/api/connections';
import { ConnectionCacheBridge } from '@/api/connection-cache';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const { colors, scheme } = useTheme();
  const connection = useConnection();
  const { t } = useTranslation('connect');

  useEffect(() => {
    void connectionStore.hydrate();
    void themeStore.hydrate();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    document.documentElement.style.colorScheme = scheme;
    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.color = colors.text;
  }, [colors, scheme]);

  useEffect(() => {
    if (connection.phase !== 'loading') void SplashScreen.hideAsync();
  }, [connection.phase]);

  const connected = connection.phase === 'connected' && connection.verified;

  useEffect(() => {
    const verify = () => { void verifyConnection().catch(() => undefined); };
    verify();
    const timer = setInterval(verify, 45_000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') verify(); });
    const visible = () => { if (document.visibilityState === 'visible') verify(); };
    if (Platform.OS === 'web') document.addEventListener('visibilitychange', visible);
    return () => { clearInterval(timer); app.remove(); if (Platform.OS === 'web') document.removeEventListener('visibilitychange', visible); };
  }, [connection.epoch]);

  useEffect(() => {
    if (connected) {
      nomifunSocket.start();
      void notificationService.start();
    } else {
      nomifunSocket.stop();
      notificationService.stop();
    }
  }, [connected]);

  if (connection.phase === 'loading') return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SWRConfig
          key={connection.epoch}
          value={{
            provider: () => new Map(),
            fetcher: apiFetcher,
            revalidateOnFocus: true,
            shouldRetryOnError: false,
            ...(Platform.OS === 'web' ? {} : {
              isVisible: () => AppState.currentState === 'active',
              initFocus: (callback: () => void) => {
                const subscription = AppState.addEventListener('change', state => {
                  if (state === 'active') callback();
                });
                return () => subscription.remove();
              },
            }),
          }}
        >
          <ConnectionCacheBridge />
          <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
          <View style={{ flex: 1, minHeight: 0 }}>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.surface },
                headerTintColor: colors.text,
                headerTitleStyle: {
                  fontSize: FontSize.title,
                  fontWeight: FontWeight.heading,
                },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: colors.background },
              }}
            >
              <Stack.Protected guard={connected}>
                <Stack.Screen name="(app)" options={{ headerShown: false }} />
              </Stack.Protected>
              <Stack.Screen name="connect" options={{ headerShown: false }} />
              <Stack.Screen name="scan" options={{ title: t('scanQr'), presentation: 'modal' }} />
              <Stack.Screen name="pair" options={{ title: t('scanQr') }} />
              <Stack.Screen name="connections" options={{ title: t('devicesTitle') }} />
            </Stack>
          </View>
          {connected && <VoiceDock />}
          <ToastHost />
          {connected && <VoiceLifecycle />}
        </SWRConfig>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
