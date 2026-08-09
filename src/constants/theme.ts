/**
 * Nomifun mobile design tokens.
 *
 * Palette values mirror the desktop theme contract
 * (ui/src/renderer/styles/themes/default-color-scheme.css — see
 * docs/research/design-system.md) so the phone reads as a sibling of the
 * desktop app. Screens must not invent ad-hoc hex values.
 */
import { Platform } from 'react-native';

export const Palette = {
  light: {
    background: '#ffffff',
    surface: '#f9fafb',
    surfaceMuted: '#f2f3f5',
    border: '#e5e6eb',
    text: '#000000',
    textSecondary: '#454d5f',
    textTertiary: '#86909c',
    primary: '#165dff',
    primarySoft: '#e8f3ff',
    brand: '#7583b2',
    success: '#00b42a',
    successSoft: '#e8ffea',
    warning: '#ff7d00',
    warningSoft: '#fff7e8',
    danger: '#f53f3f',
    dangerSoft: '#ffece8',
    overlay: 'rgba(0, 0, 0, 0.45)',
  },
  dark: {
    background: '#0e0e0e',
    surface: '#1a1a1a',
    surfaceMuted: '#262626',
    border: '#333333',
    text: '#ffffff',
    textSecondary: '#ced3da',
    textTertiary: '#929293',
    primary: '#4d9fff',
    primarySoft: '#122e52',
    brand: '#a1aacb',
    success: '#23c343',
    successSoft: '#132f1a',
    warning: '#ff9a2e',
    warningSoft: '#3a2a12',
    danger: '#f76560',
    dangerSoft: '#3d1917',
    overlay: 'rgba(0, 0, 0, 0.6)',
  },
} as const;

export type ThemeColors = { [K in keyof typeof Palette.light]: string };
export type ColorName = keyof ThemeColors;

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  title: 24,
} as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  web: {
    sans: "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  },
  default: { sans: 'normal', mono: 'monospace' },
})!;

export const MaxContentWidth = 760;
