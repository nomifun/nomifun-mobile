import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';

import { Card, Tag } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isManagedProvider } from '@/features/models/platforms';
import type {
  ClientDefaults,
  ModelRef,
  ProviderResponse,
} from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

interface DefaultsCardProps {
  defaults: ClientDefaults | undefined;
  providers: readonly ProviderResponse[];
  onEditChat: () => void;
  onEditImage: () => void;
  onEditAsr: () => void;
  onEditTts: () => void;
}

/**
 * Mobile-friendly projection of the desktop Model Hub defaults.
 *
 * The rows are deliberately task-specific: image, speech recognition and
 * speech synthesis all resolve against their own nested capability instead of
 * reusing the chat model or inferring support from provider names.
 */
export function DefaultsCard({
  defaults,
  providers,
  onEditChat,
  onEditImage,
  onEditAsr,
  onEditTts,
}: DefaultsCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');

  const label = (ref?: ModelRef): string | null => {
    if (!ref?.provider_id || !ref.model) return null;
    const provider = providers.find((item) => item.provider_id === ref.provider_id);
    const providerName = provider
      ? isManagedProvider(provider.platform)
        ? t('list.managedName')
        : provider.name || provider.platform
      : t('defaults.unknownProvider');
    return `${providerName} · ${ref.model}`;
  };

  const chat = label(defaults?.chat);
  const image = label(defaults?.imageGeneration);
  const asr = label(
    defaults?.asr?.provider_id && defaults.asr.model
      ? { provider_id: defaults.asr.provider_id, model: defaults.asr.model }
      : undefined,
  );
  const tts = label(
    defaults?.tts?.provider_id && defaults.tts.model
      ? { provider_id: defaults.tts.provider_id, model: defaults.tts.model }
      : undefined,
  );

  return (
    <Card>
      <DefaultRow
        title={t('defaults.chat')}
        value={chat}
        hint={t('defaults.chatHint')}
        colors={colors}
        onPress={onEditChat}
      />
      <Divider />
      <DefaultRow
        title={t('defaults.image')}
        value={image}
        hint={t('defaults.imageHint')}
        colors={colors}
        onPress={onEditImage}
      />
      <Divider />
      <DefaultRow
        title={t('defaults.asr')}
        value={asr}
        hint={
          defaults?.asr?.language
            ? `${t('defaults.asrHint')} · ${t('defaults.language')}: ${defaults.asr.language}`
            : t('defaults.asrHint')
        }
        colors={colors}
        onPress={onEditAsr}
        trailing={
          defaults?.asr ? (
            <Tag tone={defaults.asr.enabled ? 'success' : 'neutral'}>
              {defaults.asr.enabled ? t('defaults.enabled') : t('defaults.disabled')}
            </Tag>
          ) : null
        }
      />
      <Divider />
      <DefaultRow
        title={t('defaults.tts')}
        value={tts}
        hint={
          defaults?.tts?.voice
            ? `${t('defaults.ttsHint')} · ${t('defaults.voice')}: ${defaults.tts.voice}`
            : t('defaults.ttsHint')
        }
        colors={colors}
        onPress={onEditTts}
      />
    </Card>
  );
}

function DefaultRow({
  title,
  value,
  hint,
  colors,
  onPress,
  trailing,
}: {
  title: string;
  value: string | null;
  hint: string;
  colors: ReturnType<typeof useTheme>['colors'];
  onPress: () => void;
  trailing?: ReactNode;
}) {
  const { t } = useTranslation('models');
  return (
    <Pressable
      accessibilityRole="button"
      disabled={false}
      {...a11yState({ disabled: false })}
      onPress={onPress}
      style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}
    >
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text
          style={[styles.value, { color: value ? colors.textSecondary : colors.textTertiary }]}
          numberOfLines={2}
        >
          {value ?? t('defaults.none')}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{hint}</Text>
      </View>
      {trailing}
      <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
    </Pressable>
  );
}

function Divider() {
  const { colors } = useTheme();
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
    minHeight: 56,
  },
  text: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.md, fontWeight: '600' },
  value: { fontSize: FontSize.sm, lineHeight: 18 },
  hint: { fontSize: FontSize.xs, lineHeight: 16 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.xs },
});
