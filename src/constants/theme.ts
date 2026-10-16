/** Shared monochrome tokens. Feature screens use semantic names, never local colors. */
import { Platform } from 'react-native';

export const Palette = {
  light: {
    background: '#fafafa',
    surface: '#ffffff',
    surfaceMuted: '#f1f1f1',
    bgHover: '#f5f5f5',
    bgActive: '#e9e9e9',
    border: '#dedede',
    borderLight: '#ededed',
    text: '#101010',
    textSecondary: '#3f3f3f',
    textTertiary: '#595959',
    textDisabled: '#a3a3a3',
    primary: '#171717',
    primaryHover: '#333333',
    primarySoft: '#ededed',
    onPrimary: '#ffffff',
    brand: '#404040',
    brandLight: '#ededed',
    messageUserBg: '#eaeaea',
    messageTipsBg: '#f1f1f1',
    success: '#404040',
    successSoft: '#ededed',
    warning: '#525252',
    warningSoft: '#f1f1f1',
    danger: '#b42332',
    dangerSoft: '#fff0f1',
    onDanger: '#ffffff',
    focusRing: 'rgba(23, 23, 23, 0.16)',
    shadow: 'rgba(0, 0, 0, 0.12)',
    overlay: 'rgba(0, 0, 0, 0.4)',
  },
  dark: {
    background: '#111111',
    surface: '#191919',
    surfaceMuted: '#252525',
    bgHover: '#222222',
    bgActive: '#303030',
    border: '#353535',
    borderLight: '#262626',
    text: '#fafafa',
    textSecondary: '#dedede',
    textTertiary: '#b7b7b7',
    textDisabled: '#737373',
    primary: '#fafafa',
    primaryHover: '#dddddd',
    primarySoft: '#303030',
    onPrimary: '#171717',
    brand: '#d4d4d4',
    brandLight: '#303030',
    messageUserBg: '#303030',
    messageTipsBg: '#252525',
    success: '#d4d4d4',
    successSoft: '#2b2b2b',
    warning: '#c2c2c2',
    warningSoft: '#252525',
    danger: '#ff8b97',
    dangerSoft: '#382026',
    onDanger: '#171717',
    focusRing: 'rgba(250, 250, 250, 0.2)',
    shadow: 'rgba(0, 0, 0, 0.36)',
    overlay: 'rgba(0, 0, 0, 0.64)',
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
  sm: 4,
  md: 8,
  lg: 8,
  xl: 12,
  full: 999,
} as const;

export const FontSize = {
  xs: 12,
  control: 13,
  sm: 14,
  md: 15,
  lg: 17,
  xl: 18,
  title: 16,
} as const;

export const FontWeight = { body: '500', heading: '600' } as const;

export const Fonts = Platform.select({
  ios: { sans: 'system-ui', mono: 'ui-monospace' },
  web: {
    sans: "-apple-system, 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Segoe UI', Roboto, sans-serif",
    mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  },
  default: { sans: 'normal', mono: 'monospace' },
})!;

export const MaxContentWidth = 880;
export const MaxWorkspaceWidth = 1320;

export const Layout = {
  sidebarBreakpoint: 1000,
  sidebarWidth: 292,
  boardColumnWidth: 260,
  promptMinHeight: 64,
  dialogBreakpoint: 720,
  dialogWidth: 560,
  controlHeight: 44,
  buttonHeight: 36,
  searchHeight: 36,
  compactControlHeight: 32,
} as const;

export const Motion = {
  fast: 140,
  normal: 220,
  responseFade: 250,
  responseCadence: 40,
} as const;
