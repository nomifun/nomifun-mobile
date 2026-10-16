import { useSyncExternalStore } from 'react';
import { useColorScheme } from 'react-native';

import { Palette, type ThemeColors } from '@/constants/theme';
import { themeStore, type ThemeMode } from './theme-store';

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark'; mode: ThemeMode } {
  const mode = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.snapshot,
    themeStore.serverSnapshot,
  );
  const system = useColorScheme() === 'dark' ? 'dark' : 'light';
  const scheme = mode === 'system' ? system : mode;
  return { colors: Palette[scheme], scheme, mode };
}
