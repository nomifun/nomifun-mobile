import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { FontSize, FontWeight, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AppMenuButton } from '@/components/app-menu-button';
import { IconButton } from './icon-button';

export function PageHeading({
  title,
  action,
  onRefresh,
  refreshing,
}: {
  title: string;
  action?: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('common');
  return (
    <View style={styles.header}>
      <AppMenuButton />
      <Text
        accessibilityRole="header"
        numberOfLines={1}
        style={[styles.title, { color: colors.text }]}
      >
        {title}
      </Text>
      {onRefresh || action ? (
        <View style={styles.action}>
          {onRefresh ? (
            <IconButton
              icon="refresh-outline"
              label={t('actions.refresh')}
              onPress={onRefresh}
              loading={refreshing}
              size={18}
            />
          ) : null}
          {action}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    marginBottom: Spacing.sm,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: FontSize.title,
    fontWeight: FontWeight.heading,
    lineHeight: 22,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    flexShrink: 0,
  },
});
