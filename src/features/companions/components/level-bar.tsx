/** XP progress toward the next level. Level math lives in `../utils`. */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { levelNameKey, levelOf } from '../utils';

export function LevelBar({ xp }: { xp: number }) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { level, next, ratio } = levelOf(xp);

  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={[styles.level, { color: colors.text }]}>
          {t('card.level', { level, name: t(levelNameKey(level)) })}
        </Text>
        <Text style={[styles.xp, { color: colors.textTertiary }]}>
          {t('overview.xpProgress', { xp: Math.max(0, Math.round(xp)), next })}
        </Text>
      </View>
      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.fill,
            { backgroundColor: colors.primary, width: `${Math.round(ratio * 100)}%` },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.xs, width: '100%' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  level: { fontSize: FontSize.sm, fontWeight: '600' },
  xp: { fontSize: FontSize.xs },
  track: { height: 6, borderRadius: Radius.full, overflow: 'hidden' },
  fill: { height: 6, borderRadius: Radius.full },
});
