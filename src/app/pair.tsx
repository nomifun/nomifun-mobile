import { useMemo, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { resolveConnectionPayload, redeemConnectionPayload, PairingOriginMismatchError } from '@/api/pairing';
import { PairingAttemptLock } from '@/api/pairing-intake';
import { connectionErrorKey } from '@/api/connection-errors';
import { Button, Notice, Screen } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { FontSize, Spacing } from '@/constants/theme';
import { useConnection } from '@/hooks/use-connection';
import { connectionStore } from '@/api/connection';

export default function PairScreen() {
  const connection = useConnection();
  const params = useLocalSearchParams<{ payload?: string; v?: string; url?: string }>();
  const { t } = useTranslation('connect');
  const { colors } = useTheme();
  const raw = params.payload ?? `nomifun://pair?v=${params.v ?? ''}&url=${encodeURIComponent(params.url ?? '')}`;
  const options = Platform.OS === 'web' ? { currentOrigin: globalThis.location?.origin ?? '' } : {};
  const parsed = useMemo(() => {
    try { return { value: resolveConnectionPayload(raw, options), error: '' }; }
    catch (cause) { return { value: undefined, error: t(cause instanceof PairingOriginMismatchError ? 'webOriginMismatch' : 'qrInvalid') }; }
  }, [raw]);
  const lock = useRef(new PairingAttemptLock());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const connect = async () => {
    const epoch = connection.epoch;
    if (connectionStore.epoch() !== epoch) return;
    if (!lock.current.tryStart()) return;
    setBusy(true); setError('');
    try {
      const receipt = await redeemConnectionPayload(raw, epoch, undefined, options);
      if (connectionStore.epoch() !== receipt.epoch) return;
      lock.current.succeed(); router.replace('/');
    }
    catch (cause) {
      if (connectionStore.epoch() !== epoch) return;
      lock.current.fail(); setError(t(connectionErrorKey(cause)));
    }
    finally { if (connectionStore.epoch() === epoch) setBusy(false); }
  };
  return <Screen><View style={{ maxWidth: 480, width: '100%', alignSelf: 'center', gap: Spacing.lg }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontSize: FontSize.title, fontWeight: '700' }}>{t('pairTitle')}</Text>
    <Text style={{ color: colors.textSecondary, lineHeight: 22 }}>{t('pairHint')}</Text>
    {parsed.value ? <Text selectable style={{ color: colors.text }}>{parsed.value.baseUrl || globalThis.location?.origin}</Text> : null}
    {parsed.error || error ? <Notice tone="danger">{parsed.error || error}</Notice> : null}
    <Button loading={busy} disabled={!parsed.value || lock.current.status === 'failed'} onPress={() => void connect()}>{t('connect')}</Button>
    {lock.current.status === 'failed' ? <Button variant="secondary" onPress={() => { lock.current.resetForRescan(); setError(''); }}>{t('actions.retry', { ns: 'common' })}</Button> : null}
    <Button variant="ghost" onPress={() => router.replace('/connections')}>{t('devicesTitle')}</Button>
  </View></Screen>;
}
