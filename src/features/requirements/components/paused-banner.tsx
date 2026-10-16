import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { TagSummary } from '../types';

interface PausedBannerProps {
  tags: TagSummary[];
  /** When a tag filter is active, only that tag's pause state is reported. */
  selectedTag?: string;
}

/**
 * AutoWork pauses a whole tag when a requirement exhausts its retries; nothing
 * in that queue moves until it is resumed on the desktop.
 */
export function PausedBanner({ tags, selectedTag }: PausedBannerProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');

  const paused = tags.filter((item) => item.paused && (!selectedTag || item.tag === selectedTag));
  if (paused.length === 0) return null;

  const single = paused.length === 1 ? paused[0] : undefined;
  const title = single
    ? t('paused.title', { tag: single.tag })
    : t('paused.titleMany', { count: paused.length });
  const reason = single?.paused_reason
    ? t(`paused.reasons.${single.paused_reason}`, { defaultValue: single.paused_reason })
    : undefined;

  return (
    <Card style={[styles.card, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
      <Ionicons name="pause-circle-outline" size={20} color={colors.warning} />
      <View style={styles.body}>
        <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
        {reason ? (
          <Text style={[styles.line, { color: colors.textSecondary }]}>
            {t('paused.reason', { reason })}
          </Text>
        ) : null}
        {!single ? (
          <Text style={[styles.line, { color: colors.textSecondary }]} numberOfLines={2}>
            {paused.map((item) => item.tag).join('、')}
          </Text>
        ) : null}
        <Text style={[styles.line, { color: colors.textTertiary }]}>{t('paused.hint')}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  body: { flex: 1, gap: 2 },
  title: { fontSize: FontSize.sm, fontWeight: '700' },
  line: { fontSize: FontSize.xs, lineHeight: 17 },
});
