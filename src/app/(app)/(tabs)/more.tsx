import { useState } from 'react';
import { Alert, Platform, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';

import { logout } from '@/api/auth';
import { Avatar, Button, Card, ListRow, Screen, SectionTitle, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { notificationService } from '@/features/notifications/service';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';

export default function MoreScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('settings');
  const { t: tc } = useTranslation('connect');
  const connection = useConnection();
  const [notifyOn, setNotifyOn] = useState(notificationService.isEnabled());

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
      if (window.confirm(tc('disconnectConfirm'))) void logout();
      return;
    }
    Alert.alert(tc('disconnect'), tc('disconnectConfirm'), [
      { text: t('actions.cancel', { ns: 'common' }), style: 'cancel' },
      { text: tc('disconnect'), style: 'destructive', onPress: () => void logout() },
    ]);
  };

  return (
    <Screen>
      <Card style={styles.profile}>
        <Avatar name={username} size={52} />
        <View style={styles.profileBody}>
          <Text style={[styles.username, { color: colors.text }]}>{username}</Text>
          <View style={styles.addressRow}>
            <Ionicons name="wifi-outline" size={13} color={colors.success} />
            <Text style={[styles.address, { color: colors.textTertiary }]} numberOfLines={1}>
              {address}
            </Text>
          </View>
        </View>
      </Card>

      <SectionTitle>{t('features')}</SectionTitle>
      <ListRow
        title={t('models')}
        left={<Ionicons name="cube-outline" size={22} color={colors.primary} />}
        chevron
        onPress={() => router.push('/models')}
      />
      <ListRow
        title={t('customerService')}
        left={<Ionicons name="headset-outline" size={22} color={colors.primary} />}
        chevron
        onPress={() => router.push('/customer-service')}
      />

      <SectionTitle>{t('notifications')}</SectionTitle>
      <ListRow
        title={t('notificationsEnable')}
        subtitle={t('notificationsHint')}
        left={<Ionicons name="notifications-outline" size={22} color={colors.primary} />}
        right={
          <Switch
            value={notifyOn}
            onValueChange={(v) => void toggleNotifications(v)}
            trackColor={{ true: colors.primary }}
          />
        }
      />

      <SectionTitle>{t('about')}</SectionTitle>
      <Card>
        <View style={styles.aboutRow}>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.sm }}>{t('version')}</Text>
          <Text style={{ color: colors.text, fontSize: FontSize.sm }}>
            {Constants.expoConfig?.version ?? '0.1.0'}
          </Text>
        </View>
        <Text style={[styles.powered, { color: colors.textTertiary }]}>{t('poweredBy')}</Text>
      </Card>

      <View style={{ marginTop: Spacing.xxl }}>
        <Button variant="danger" onPress={confirmDisconnect}>
          {tc('disconnect')}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  profileBody: { flex: 1, gap: 4 },
  username: { fontSize: FontSize.xl, fontWeight: '700' },
  addressRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  address: { fontSize: FontSize.sm, flexShrink: 1 },
  aboutRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: Spacing.sm },
  powered: { fontSize: FontSize.xs },
});
