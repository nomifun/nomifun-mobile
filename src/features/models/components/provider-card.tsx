import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Avatar, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isManagedProvider } from '@/features/models/platforms';
import type { ProviderResponse } from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

interface ProviderCardProps {
  provider: ProviderResponse;
  busy?: boolean;
  onPress: () => void;
  onToggle: (enabled: boolean) => void;
}

export function ProviderCard({ provider, busy, onPress, onToggle }: ProviderCardProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const managed = isManagedProvider(provider.platform);
  const models = provider.models ?? [];
  const unhealthy = models.reduce(
    (count, model) =>
      count +
      model.capabilities.filter((capability) => capability.health?.status === 'unhealthy').length,
    0,
  );
  const displayName = managed ? t('list.managedName') : provider.name || provider.platform;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Pressable
        accessibilityRole="button"
        disabled={!!busy}
        {...a11yState({ disabled: !!busy })}
        onPress={onPress}
        style={({ pressed }) => [styles.body, { opacity: pressed ? 0.7 : 1 }]}
      >
        <Avatar name={displayName} size={40} />
        <View style={styles.text}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.meta, { color: colors.textTertiary }]} numberOfLines={1}>
            {managed ? t('list.managed') : provider.platform} ·{' '}
            {t('list.modelCount', { count: models.length })}
            {!managed && provider.has_credentials
              ? ` · ${t('list.credentialsConfigured')}`
              : !managed
                ? ` · ${t('list.credentialsMissing')}`
                : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
      </Pressable>

      <View style={styles.foot}>
        <View style={styles.tags}>
          <Tag tone={provider.enabled ? 'success' : 'neutral'}>
            {provider.enabled ? t('provider.on') : t('provider.off')}
          </Tag>
          {unhealthy > 0 ? (
            <Tag tone="danger">{t('list.unhealthy', { count: unhealthy })}</Tag>
          ) : null}
          {managed ? <Tag tone="primary">{t('list.managed')}</Tag> : null}
        </View>
        {managed ? (
          <Text style={[styles.managedHint, { color: colors.textTertiary }]} numberOfLines={2}>
            {t('list.managedHint')}
          </Text>
        ) : (
          <Switch
            accessibilityLabel={t('provider.enabled')}
            value={provider.enabled}
            disabled={!!busy}
            onValueChange={onToggle}
            trackColor={{ true: colors.primary, false: colors.border }}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: Radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  body: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 48 },
  text: { flex: 1, gap: 2 },
  name: { fontSize: FontSize.md, fontWeight: '700' },
  meta: { fontSize: FontSize.sm },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    minHeight: 36,
  },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, flex: 1 },
  managedHint: { flex: 1, fontSize: FontSize.xs, lineHeight: 16, textAlign: 'right' },
});
