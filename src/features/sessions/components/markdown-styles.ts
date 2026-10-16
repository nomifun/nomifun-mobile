import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { FontSize, FontWeight, Fonts, Radius, Spacing } from '@/constants/theme';
import type { ThemeColors } from '@/constants/theme';

export type MarkdownTone = 'user' | 'assistant' | 'muted';

/**
 * Compact markdown stylesheet for chat bubbles. Keys are the rule names of
 * `react-native-markdown-display`; only the ones a chat transcript actually
 * hits are overridden. Colors always come from the theme.
 */
export function markdownStyles(
  colors: ThemeColors,
  tone: MarkdownTone,
): Record<string, TextStyle | ViewStyle> {
  const text = tone === 'muted' ? colors.textSecondary : colors.text;
  const subtle = colors.textTertiary;
  const codeBackground = tone === 'user' ? colors.primarySoft : colors.surfaceMuted;
  const rule = colors.border;

  return {
    body: {
      color: text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.body,
      lineHeight: 25,
    },
    paragraph: { marginTop: 0, marginBottom: Spacing.sm, flexWrap: 'wrap' },
    heading1: {
      color: text,
      fontSize: FontSize.xl,
      fontWeight: '700',
      marginBottom: Spacing.sm,
    },
    heading2: {
      color: text,
      fontSize: FontSize.lg,
      fontWeight: '700',
      marginBottom: Spacing.sm,
    },
    heading3: {
      color: text,
      fontSize: FontSize.md,
      fontWeight: '700',
      marginBottom: Spacing.xs,
    },
    heading4: { color: text, fontSize: FontSize.md, fontWeight: '600' },
    heading5: { color: text, fontSize: FontSize.sm, fontWeight: '600' },
    heading6: { color: subtle, fontSize: FontSize.sm, fontWeight: '600' },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through' },
    link: { color: colors.primary, textDecorationLine: 'underline' },
    blockquote: {
      backgroundColor: codeBackground,
      borderLeftWidth: 3,
      borderLeftColor: rule,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.sm,
      borderRadius: Radius.sm,
    },
    hr: {
      backgroundColor: rule,
      height: StyleSheet.hairlineWidth,
      marginVertical: Spacing.sm,
    },
    code_inline: {
      color: text,
      backgroundColor: codeBackground,
      fontFamily: Fonts.mono,
      fontSize: FontSize.sm,
      borderRadius: Radius.sm,
      // The library merges its default 10px padding and border into inline code.
      // Clear them so wrapped code stays within the surrounding text line.
      borderWidth: 0,
      padding: 0,
      paddingHorizontal: Spacing.xs,
    },
    code_block: {
      color: text,
      backgroundColor: codeBackground,
      fontFamily: Fonts.mono,
      fontSize: FontSize.sm,
      lineHeight: 19,
      borderRadius: Radius.md,
      borderWidth: 0,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    fence: {
      color: text,
      backgroundColor: codeBackground,
      fontFamily: Fonts.mono,
      fontSize: FontSize.sm,
      lineHeight: 19,
      borderRadius: Radius.md,
      borderWidth: 0,
      padding: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    bullet_list: { marginBottom: Spacing.sm },
    ordered_list: { marginBottom: Spacing.sm },
    list_item: { marginBottom: 2 },
    bullet_list_icon: { color: subtle, marginRight: Spacing.sm, marginLeft: 0 },
    ordered_list_icon: {
      color: subtle,
      marginRight: Spacing.sm,
      marginLeft: 0,
    },
    table: {
      borderColor: rule,
      borderRadius: Radius.sm,
      marginBottom: Spacing.sm,
    },
    thead: { backgroundColor: codeBackground },
    th: { color: text, padding: Spacing.sm, fontWeight: '600' },
    td: { color: text, padding: Spacing.sm },
    tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: rule },
  };
}
