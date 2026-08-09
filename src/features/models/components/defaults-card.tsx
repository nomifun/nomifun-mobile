import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Card, Tag } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isManagedProvider } from '@/features/models/platforms';
import type { ClientDefaults, ModelRef, ProviderResponse } from '@/features/models/types';

interface DefaultsCardProps {
  defaults: ClientDefaults | undefined;
  providers: readonly ProviderResponse[];
  /** Chat is the one install-wide default this app writes. */
  onEditChat: () => void;
}

/**
 * The install-wide defaults (client-preference keys).
 *
 * Only 对话 / 语音识别 / 语音合成 have a global default at all — every other
 * modality is chosen per surface, which is a product decision, not an omission.
 * ASR/TTS are read-only here: their stored shapes carry extra fields (voice,
 * language, enabled) that belong to the desktop's dedicated panels.
 */
export function DefaultsCard({ defaults, providers, onEditChat }: DefaultsCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');

  const label = (ref?: ModelRef | { provider_id?: string; model?: string }): string | null => {
    if (!ref?.provider_id || !ref.model) return null;
    const provider = providers.find((p) => p.provider_id === ref.provider_id);
    const providerName = provider
      ? isManagedProvider(provider.platform)
        ? t('list.managedName')
        : provider.name || provider.platform
      : t('defaults.unknownProvider');
    return `${providerName} · ${ref.model}`;
  };

  const chat = label(defaults?.chat);
  const tts = label(defaults?.tts);
  const asr = label(defaults?.asr);

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        onPress={onEditChat}
        style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
      >
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.text }]}>{t('defaults.chat')}</Text>
          <Text
            style={[styles.value, { color: chat ? colors.textSecondary : colors.textTertiary }]}
            numberOfLines={2}
          >
            {chat ?? t('defaults.none')}
          </Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('defaults.chatHint')}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.text }]}>{t('defaults.asr')}</Text>
          <Text
            style={[styles.value, { color: asr ? colors.textSecondary : colors.textTertiary }]}
            numberOfLines={2}
          >
            {asr ?? t('defaults.none')}
            {defaults?.asr?.language ? ` · ${defaults.asr.language}` : ''}
          </Text>
        </View>
        <Tag tone="neutral">{t('defaults.desktopOnly')}</Tag>
      </View>

      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      <View style={styles.row}>
        <View style={styles.text}>
          <Text style={[styles.title, { color: colors.text }]}>{t('defaults.tts')}</Text>
          <Text
            style={[styles.value, { color: tts ? colors.textSecondary : colors.textTertiary }]}
            numberOfLines={2}
          >
            {tts ?? t('defaults.none')}
            {defaults?.tts?.voice ? ` · ${defaults.tts.voice}` : ''}
          </Text>
        </View>
        <Tag tone="neutral">{t('defaults.desktopOnly')}</Tag>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 48,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: '600' },
  value: { fontSize: FontSize.sm, lineHeight: 18 },
  hint: { fontSize: FontSize.xs, lineHeight: 16 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.xs },
});
