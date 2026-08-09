/**
 * 信任横幅 — the product's security promise, stated verbatim from the desktop:
 * a customer-service turn only ever gets three read-only tools, and high-risk
 * capabilities are never registered. The security story IS the product story
 * here, so this is not decoration.
 *
 * The desktop uses a CSS gradient strip; without a gradient dependency we fake
 * the same left-to-right fade with three tinted bands built from theme colors.
 */
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const BANDS = [0.14, 0.08, 0.03];

export function TrustBanner() {
  const { colors } = useTheme();
  const { t } = useTranslation('customerService');

  return (
    <View style={[styles.wrap, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      <View style={styles.bands} pointerEvents="none">
        {BANDS.map((opacity, index) => (
          <View
            key={index}
            style={[styles.band, { backgroundColor: colors.primary, opacity }]}
          />
        ))}
      </View>

      <View style={styles.body}>
        <View style={[styles.badge, { backgroundColor: colors.primary }]}>
          <Ionicons name="shield-checkmark" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.lines}>
          <Text style={[styles.lead, { color: colors.text }]}>{t('trust.lead')}</Text>
          <View style={styles.line}>
            <Ionicons name="search-outline" size={13} color={colors.primary} />
            <Text style={[styles.lineText, { color: colors.textSecondary }]}>
              {t('trust.readonly')}
            </Text>
          </View>
          <View style={styles.line}>
            <Ionicons name="lock-closed-outline" size={13} color={colors.primary} />
            <Text style={[styles.lineText, { color: colors.textSecondary }]}>
              {t('trust.locked')}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  bands: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, flexDirection: 'row' },
  band: { flex: 1 },
  body: { flexDirection: 'row', gap: Spacing.md, padding: Spacing.lg },
  badge: {
    width: 36,
    height: 36,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lines: { flex: 1, gap: Spacing.xs },
  lead: { fontSize: FontSize.sm, fontWeight: '700', lineHeight: 20, marginBottom: 2 },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  lineText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
});
