/** One companion on the roster: figure, name, persona snippet and live badges. */
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Card, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { CompanionWithStatus } from '../types';
import { MOOD_VISUALS, characterOf, levelNameKey, levelOf, moodOf } from '../utils';
import { CompanionFigure } from './companion-figure';

export function CompanionCard({
  companion,
  isDefault,
  onPress,
}: {
  companion: CompanionWithStatus;
  isDefault: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');

  const status = companion.status;
  const mood = moodOf(status?.mood);
  const { level } = levelOf(status?.xp ?? 0);
  const character = characterOf(companion.character);
  const snippet =
    companion.persona?.custom?.trim() ||
    t(`characters.${character}.style`) ||
    '';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.press, pressed && { opacity: 0.75 }]}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <CompanionFigure companion={companion} size={54} mood={status?.mood} />
          <View style={styles.body}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
                {companion.name}
              </Text>
              {isDefault ? <Tag tone="primary">{t('roster.default')}</Tag> : null}
            </View>
            <Text style={[styles.snippet, { color: colors.textTertiary }]} numberOfLines={2}>
              {snippet}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </View>

        <View style={styles.tags}>
          <Tag tone={MOOD_VISUALS[mood].tone}>{t(`moods.${mood}`)}</Tag>
          <Tag>{t('card.level', { level, name: t(levelNameKey(level)) })}</Tag>
          <Tag>{t('card.memories', { count: status?.memories_active ?? 0 })}</Tag>
          {status && !status.model_configured ? (
            <Tag tone="warning">{t('card.modelMissing')}</Tag>
          ) : null}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  press: { marginBottom: Spacing.md, borderRadius: Radius.lg },
  card: { gap: Spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  body: { flex: 1, gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  name: { fontSize: FontSize.lg, fontWeight: '700', flexShrink: 1 },
  snippet: { fontSize: FontSize.sm, lineHeight: 18 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
});
