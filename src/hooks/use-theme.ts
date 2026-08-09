import { useColorScheme } from 'react-native';

import { Palette, type ThemeColors } from '@/constants/theme';

export function useTheme(): { colors: ThemeColors; scheme: 'light' | 'dark' } {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  return { colors: Palette[scheme], scheme };
}
