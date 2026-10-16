import { useEffect, useState } from 'react';
import { Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Notice, Screen, SectionTitle, SegmentedControl, Tag, TextField } from '@/components/ui';
import { connectionStore } from '@/api/connection';
import { changeConnectionRoute, revokeCurrentDevice, useConnectionHealth, verifyConnection } from '@/api/connections';
import { connectionErrorKey } from '@/api/connection-errors';
import { nomifunSocket } from '@/api/ws';
import { normalizeServerBaseUrl } from '@/api/utils';
import { useConnection } from '@/hooks/use-connection';
import { useWsStatus } from '@/hooks/use-ws';
import { useTheme } from '@/hooks/use-theme';
import { FontSize, Spacing } from '@/constants/theme';
import { voiceCapabilities } from '@/features/voice/api';

export default function ConnectionsScreen() {
  const { t } = useTranslation('connect');
  const { colors } = useTheme();
  const connection = useConnection();
  const health = useConnectionHealth();
  const ws = useWsStatus();
  const binding = connection.phase === 'connected' ? connection.binding : null;
  const [address, setAddress] = useState('');
  const [kind, setKind] = useState<'direct' | 'relay'>('direct');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [voice, setVoice] = useState<'unknown' | 'available' | 'unsupported'>('unknown');
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setVoice('unknown');
    if (connection.phase === 'connected' && connection.verified) {
      void voiceCapabilities().then(result => {
        if (active) setVoice(result.supported && result.api_version === 1 ? 'available' : 'unsupported');
      }).catch(() => { if (active) setVoice('unknown'); });
    }
    return () => { active = false; };
  }, [connection.epoch, connection.phase === 'connected' && connection.verified]);

  const run = async (action: () => Promise<unknown>) => {
    const epoch = connection.epoch;
    if (connectionStore.epoch() !== epoch || busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (cause) { if (connectionStore.epoch() === epoch) setError(t(connectionErrorKey(cause))); }
    finally { if (connectionStore.epoch() === epoch) setBusy(false); }
  };
  const repair = () => run(async () => {
    const epoch = await verifyConnection(connection.epoch);
    if (connectionStore.epoch() === epoch) nomifunSocket.reconnect();
  });
  const choose = (baseUrl: string, routeKind: 'direct' | 'relay') => run(() => changeConnectionRoute(baseUrl, routeKind, connection.epoch));
  const revokeDevice = () => revokeCurrentDevice(connection.epoch);
  const revoke = () => {
    if (Platform.OS === 'web') { setConfirmed(true); return; }
    Alert.alert(t('revokeTitle'), t('revokeHint'), [
      { text: t('actions.cancel', { ns: 'common' }) },
      { text: t('revokeAction'), style: 'destructive', onPress: () => void run(revokeDevice) },
    ]);
  };
  const row = (label: string, value: string) => <View style={styles.row}>
    <Text style={[styles.label, { color: colors.textTertiary }]}>{label}</Text>
    <Text selectable style={[styles.value, { color: colors.text }]}>{value}</Text>
  </View>;
  const isWeb = Platform.OS === 'web';
  return <Screen>
    <View style={styles.column}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{t('devicesTitle')}</Text>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('devicesHint')}</Text>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <SectionTitle>{t('pairedDesktop')}</SectionTitle>
      <Card>
        {row(t('desktopName'), binding?.desktop?.desktop_name ?? t('notPaired'))}
        {binding?.desktop ? row(t('desktopIdentity'), binding.desktop.desktop_id) : null}
        {row(t('deviceName'), binding ? binding.device?.device_name ?? t('accountCredential') : t('notPaired'))}
        {row(t('routeTitle'), t(`route.${binding?.routeKind ?? (isWeb ? 'site' : 'direct')}`))}
        {row(t('address'), isWeb ? globalThis.location?.origin ?? t('webSameOrigin') : binding?.baseUrl ?? '—')}
        <View style={styles.tags}>
          <Tag tone={health.phase === 'ready' ? 'success' : 'warning'}>{t(`health.${health.phase}`)}</Tag>
          <Tag tone={ws === 'open' ? 'success' : 'warning'}>{t(`realtime.${ws}`)}</Tag>
        </View>
        <Button variant="secondary" icon="refresh-outline" loading={busy} onPress={() => void repair()}>{t('diagnose')}</Button>
      </Card>
      {health.phase === 'offline' ? <Notice tone="warning">{t('networkHelp')}</Notice> : null}
      {health.phase === 'blocked' ? <Notice tone="danger">{t(health.errorCode === 'DESKTOP_IDENTITY_CHANGED' ? 'identityChanged' : health.errorCode === 'DESKTOP_IDENTITY_UNAVAILABLE' ? 'devicePairRequired' : 'updateRequired')}</Notice> : null}
      {binding?.system ? <>
        <SectionTitle>{t('capabilitiesTitle')}</SectionTitle>
        <Card>
          {row(t('chatCapability'), binding.desktop?.capabilities.includes('agent_session') ? t('available') : t('unavailable'))}
          {row(t('voiceCapability'), t(`voiceState.${voice}`))}
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('voiceCapabilityHint')}</Text>
          {row(t('platform'), `${binding.system.platform} / ${binding.system.arch}`)}
          {row(t('protocol'), String(binding.desktop?.protocol_version ?? '—'))}
          {row(t('dataGeneration'), binding.system.storage_generation)}
        </Card>
      </> : null}
      {!isWeb && binding ? <>
        <SectionTitle>{t('routeTitle')}</SectionTitle>
        <Card>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('routeIdentityHint')}</Text>
          {(binding.routes ?? []).map(route => route.baseUrl === binding.baseUrl ? null :
            <Button key={route.baseUrl} variant="secondary" disabled={busy} onPress={() => void choose(route.baseUrl, route.kind === 'relay' ? 'relay' : 'direct')}>{route.baseUrl}</Button>)}
          <SegmentedControl value={kind} options={[{ value: 'direct', label: t('route.direct') }, { value: 'relay', label: t('route.relay') }]} onChange={setKind} />
          <TextField label={t('alternateAddress')} value={address} onChangeText={setAddress} keyboardType="url" autoComplete="off" placeholder={kind === 'direct' ? 'http://192.168.1.42:25808' : 'https://relay.example.com'} />
          <Button disabled={busy || !normalizeServerBaseUrl(address)} onPress={() => void choose(normalizeServerBaseUrl(address)!, kind)}>{t('verifyRoute')}</Button>
        </Card>
      </> : null}
      {isWeb ? <Notice>{t('webDeploymentHint')}</Notice> : null}
      <SectionTitle>{t('repairTitle')}</SectionTitle>
      {!isWeb ? <Button icon="qr-code-outline" variant="secondary" onPress={() => router.push('/scan')}>{t('rescanDesktop')}</Button> : null}
      <Button icon="link-outline" variant="secondary" onPress={() => router.push({ pathname: '/connect', params: { repair: '1', method: 'link' } })}>{t('pasteLink')}</Button>
      {binding?.device ? <>
        <Button variant="danger" disabled={busy} onPress={revoke}>{t('revokeAction')}</Button>
        {confirmed ? <Notice tone="warning">{t('revokeHint')}<Button variant="danger" loading={busy} onPress={() => void run(revokeDevice)}>{t('revokeAction')}</Button></Notice> : null}
      </> : binding ? <Notice tone="warning">{t('accountCredentialHint')}</Notice> : null}
      <Button variant="ghost" onPress={() => void run(() => connectionStore.disconnect(undefined, connection.epoch))}>{t('forgetLocal')}</Button>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('forgetLocalHint')}</Text>
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  column: { maxWidth: 640, width: '100%', alignSelf: 'center', gap: Spacing.md },
  title: { fontSize: FontSize.title, fontWeight: '700' },
  hint: { fontSize: FontSize.sm, lineHeight: 21 },
  row: { gap: Spacing.xs, marginBottom: Spacing.md },
  label: { fontSize: FontSize.xs }, value: { fontSize: FontSize.sm, lineHeight: 21 },
  tags: { flexDirection: 'row', gap: Spacing.sm, flexWrap: 'wrap', marginBottom: Spacing.md },
});
