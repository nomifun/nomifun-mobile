import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { FontSize, Fonts, Radius, Spacing } from '@/constants/theme';
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
  const text = tone === 'user' ? '#FFFFFF' : tone === 'muted' ? colors.textSecondary : colors.text;
  const subtle =
    tone === 'user' ? 'rgba(255,255,255,0.75)' : colors.textTertiary;
  const codeBackground =
    tone === 'user' ? 'rgba(255,255,255,0.16)' : colors.surfaceMuted;
  const rule = tone === 'user' ? 'rgba(255,255,255,0.3)' : colors.border;

  return {
    body: { color: text, fontSize: FontSize.md, lineHeight: 22 },
    paragraph: { marginTop: 0, marginBottom: Spacing.sm, flexWrap: 'wrap' },
    heading1: { color: text, fontSize: FontSize.xl, fontWeight: '700', marginBottom: Spacing.sm },
    heading2: { color: text, fontSize: FontSize.lg, fontWeight: '700', marginBottom: Spacing.sm },
    heading3: { color: text, fontSize: FontSize.md, fontWeight: '700', marginBottom: Spacing.xs },
    heading4: { color: text, fontSize: FontSize.md, fontWeight: '600' },
    heading5: { color: text, fontSize: FontSize.sm, fontWeight: '600' },
    heading6: { color: subtle, fontSize: FontSize.sm, fontWeight: '600' },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    s: { textDecorationLine: 'line-through' },
    link: { color: tone === 'user' ? '#FFFFFF' : colors.primary, textDecorationLine: 'underline' },
    blockquote: {
      backgroundColor: codeBackground,
      borderLeftWidth: 3,
      borderLeftColor: rule,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      marginBottom: Spacing.sm,
      borderRadius: Radius.sm,
    },
    hr: { backgroundColor: rule, height: StyleSheet.hairlineWidth, marginVertical: Spacing.sm },
    code_inline: {
      color: text,
      backgroundColor: codeBackground,
      fontFamily: Fonts.mono,
      fontSize: FontSize.sm,
      borderRadius: Radius.sm,
      paddingHorizontal: 4,
    },
    code_block: {
      color: text,
      backgroundColor: codeBackground,
      fontFamily: Fonts.mono,
      fontSize: FontSize.sm,
      lineHeight: 19,
      borderRadius: Radius.md,
      borderWidth: 0,
      padding: Spacing.md,
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
      padding: Spacing.md,
      marginBottom: Spacing.sm,
    },
    bullet_list: { marginBottom: Spacing.sm },
    ordered_list: { marginBottom: Spacing.sm },
    list_item: { marginBottom: 2 },
    bullet_list_icon: { color: subtle, marginRight: Spacing.sm, marginLeft: 0 },
    ordered_list_icon: { color: subtle, marginRight: Spacing.sm, marginLeft: 0 },
    table: { borderColor: rule, borderRadius: Radius.sm, marginBottom: Spacing.sm },
    thead: { backgroundColor: codeBackground },
    th: { color: text, padding: Spacing.sm, fontWeight: '600' },
    td: { color: text, padding: Spacing.sm },
    tr: { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: rule },
  };
}
