import { useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { Toggle } from '@/components/ui/toggle';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { logout } from '@/api/auth';
import {
  Avatar,
  Button,
  IconBadge,
  ListGroup,
  ListRow,
  Screen,
  PageHeading,
  SegmentedControl,
  SectionTitle,
  toast,
} from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { notificationService } from '@/features/notifications/service';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';
import { themeStore } from '@/hooks/theme-store';
import { useWsStatus } from '@/hooks/use-ws';
import { getInstalledApp } from '@/features/app-update/installed';

export default function MoreScreen() {
  const { colors, mode } = useTheme();
  const wsStatus = useWsStatus();
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('connect');
  const connection = useConnection();
  const [notifyOn, setNotifyOn] = useState(notificationService.isEnabled());
  const installed = getInstalledApp();

  const toggleNotifications = async (next: boolean) => {
    const effective = await notificationService.setEnabled(next);
    setNotifyOn(effective);
    if (next && !effective) toast.error(t('permissionNeeded', { ns: 'notifications' }));
  };

  const binding = connection.phase === 'connected' ? connection.binding : null;
  const username = binding?.user?.username ?? '—';
  const address =
    Platform.OS === 'web' ? t('currentSite') : binding?.baseUrl.replace(/^https?:\/\//, '') || '—';

  const confirmDisconnect = () => {
    if (Platform.OS === 'web') {
      // RN Alert is a no-op on web.
      if (window.confirm(tc('disconnectConfirm'))) void logout(connection.epoch);
      return;
    }
    Alert.alert(tc('disconnect'), tc('disconnectConfirm'), [
      { text: t('actions.cancel', { ns: 'common' }), style: 'cancel' },
      { text: tc('disconnect'), style: 'destructive', onPress: () => void logout(connection.epoch) },
    ]);
  };

  return (
    <Screen>
      <PageHeading title={t('tabs.more', { ns: 'common' })} />
      <View style={[styles.profile, { borderBottomColor: colors.borderLight }]}>
        <Avatar name={username} size={52} />
        <View style={styles.profileBody}>
          <Text style={[styles.username, { color: colors.text }]}>{username}</Text>
          <View style={styles.addressRow}>
            <Ionicons
              name={wsStatus === 'open' ? 'wifi-outline' : 'cloud-offline-outline'}
              size={15}
              color={colors.textTertiary}
            />
            <Text style={[styles.address, { color: colors.textTertiary }]} numberOfLines={1}>
              {address}
            </Text>
          </View>
        </View>
      </View>

      <SectionTitle>{t('appearance.title')}</SectionTitle>
      <SegmentedControl
        label={t('appearance.title')}
        value={mode}
        options={[
          { value: 'system', label: t('appearance.system'), icon: 'phone-portrait-outline' },
          { value: 'light', label: t('appearance.light'), icon: 'sunny-outline' },
          { value: 'dark', label: t('appearance.dark'), icon: 'moon-outline' },
        ]}
        onChange={(next) =>
          void themeStore
            .setMode(next)
            .catch(() => toast.error(t('feedback.requestFailed', { ns: 'common' })))
        }
      />

      <SectionTitle>{t('features')}</SectionTitle>
      <ListGroup>
        <ListRow seamless title={tc('devicesTitle')} subtitle={binding?.desktop?.desktop_name ?? address}
          left={<IconBadge icon="phone-portrait-outline" tone="primary" />} chevron onPress={() => router.push('/connections')} />
        <ListRow
          seamless
          title={t('models')}
          left={<IconBadge icon="cube-outline" tone="primary" />}
          chevron
          onPress={() => router.push('/models')}
        />
        <ListRow
          seamless
          title={t('customerService')}
          left={<IconBadge icon="headset-outline" tone="brand" />}
          chevron
          onPress={() => router.push('/customer-service')}
        />
      </ListGroup>

      <SectionTitle>{t('notifications')}</SectionTitle>
      <ListGroup>
        <ListRow
          seamless
          title={t('notificationsEnable')}
          subtitle={t('notificationsHint')}
          left={<IconBadge icon="notifications-outline" tone="warning" />}
          right={
            <Toggle
              value={notifyOn}
              accessibilityLabel={t('notificationsEnable')}
              onValueChange={(v) => void toggleNotifications(v)}
            />
          }
        />
      </ListGroup>

      <SectionTitle>{t('about')}</SectionTitle>
      <ListGroup>
        <ListRow
          seamless
          title={t('version')}
          subtitle={t('update.title')}
          left={<IconBadge icon="information-circle-outline" tone="neutral" />}
          right={
            <Text style={{ color: colors.textTertiary, fontSize: FontSize.sm }}>
              {installed.version ?? t('update.unknownVersion')}
            </Text>
          }
          chevron
          onPress={() => router.push('/update')}
        />
      </ListGroup>
      <Text style={[styles.powered, { color: colors.textTertiary }]}>{t('poweredBy')}</Text>

      <View style={styles.disconnect}>
        <Button icon="log-out-outline" variant="secondary" onPress={confirmDisconnect}>
          {tc('disconnect')}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.lg,
    paddingBottom: Spacing.xl,
    borderBottomWidth: 1,
  },
  profileBody: { flex: 1, gap: 4 },
  username: { fontSize: FontSize.xl, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  address: { fontSize: FontSize.sm, flexShrink: 1 },
  powered: { fontSize: FontSize.xs, textAlign: 'center', marginTop: Spacing.xs },
  disconnect: { marginTop: Spacing.xxl },
});
