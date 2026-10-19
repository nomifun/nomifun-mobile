import { useMemo, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { passwordLogin, probeServer, setupAdmin } from '@/api/auth';
import { InvalidPairingUrlError, redeemConnectionPayload } from '@/api/pairing';
import { ApiError } from '@/api/types';
import { normalizeServerBaseUrl } from '@/api/utils';
import {
  Button,
  IconButton,
  Notice,
  Screen,
  SegmentedControl,
  TextField,
  toast,
} from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';
import { themeStore } from '@/hooks/theme-store';
import { connectionErrorKey } from '@/api/connection-errors';
import { connectionStore } from '@/api/connection';
import { verifyConnection, useConnectionHealth } from '@/api/connections';

const DEFAULT_PORT = '25808';

/** Map a login failure onto a user-actionable message. */
function loginErrorText(
  err: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  return t(connectionErrorKey(err));
}

export default function ConnectScreen() {
  const { colors, scheme } = useTheme();
  const { t } = useTranslation('connect');
  const connection = useConnection();
  const health = useConnectionHealth();
  const params = useLocalSearchParams<{ repair?: string; method?: string }>();
  const isWeb = Platform.OS === 'web';

  const lastBaseUrl = connection.phase === 'disconnected' ? connection.lastBaseUrl : undefined;
  const initial = useMemo(() => {
    return { address: lastBaseUrl ?? '' };
  }, [lastBaseUrl]);

  const [address, setAddress] = useState(initial.address);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [submitting, setBusy] = useState(false);
  const busy = submitting || connection.phase === 'loading';
  const [error, setError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pasted, setPasted] = useState('');
  const [method, setMethod] = useState<'account' | 'link'>(params.method === 'account' ? 'account' : 'link');

  const baseUrl = isWeb ? '' : normalizeServerBaseUrl(address, DEFAULT_PORT);

  const submit = async () => {
    const epoch = connection.epoch;
    if (connectionStore.epoch() !== epoch || busy || !password || !username.trim()) return;
    setError('');
    if (!isWeb && !baseUrl) {
      setError(t('addressPlaceholder'));
      return;
    }
    setBusy(true);
    try {
      const probe = await probeServer(baseUrl ?? '', epoch);
      if (connectionStore.epoch() !== epoch) return;
      if (!probe.reachable) {
        setError(t('probeFailed'));
        return;
      }
      if (probe.isNomifun === false) {
        setError(t('notNomifun'));
        return;
      }
      let receipt;
      if (probe.needsSetup) {
        setNeedsSetup(true);
        if (!password) return; // show setup hint, wait for credentials
        receipt = await setupAdmin(baseUrl ?? '', username.trim(), password, epoch);
      } else {
        receipt = await passwordLogin(baseUrl ?? '', username.trim(), password, epoch);
      }
      if (connectionStore.epoch() !== receipt.epoch) return;
      toast.success(t('connectedAs', { username: receipt.user.username }));
    } catch (err) {
      if (connectionStore.epoch() !== epoch) return;
      setError(loginErrorText(err, t));
    } finally {
      if (connectionStore.epoch() === epoch) setBusy(false);
    }
  };

  const submitPastedLink = async () => {
    const epoch = connection.epoch;
    if (connectionStore.epoch() !== epoch || busy || !pasted.trim()) return;
    setError('');
    setBusy(true);
    try {
      const receipt = await redeemConnectionPayload(
        pasted,
        epoch,
        undefined,
        isWeb ? { currentOrigin: globalThis.location?.origin ?? '' } : {},
      );
      if (connectionStore.epoch() !== receipt.epoch) return;
      toast.success(t('connectedAs', { username: receipt.user.username }));
      router.replace('/');
    } catch (err) {
      if (connectionStore.epoch() !== epoch) return;
      if (err instanceof InvalidPairingUrlError) {
        setError(t('qrInvalid'));
      } else {
        setError(loginErrorText(err, t));
      }
    } finally {
      if (connectionStore.epoch() === epoch) setBusy(false);
    }
  };

  if (connection.phase === 'connected' && connection.verified && params.repair !== '1') return <Redirect href="/" />;

  return (
    <Screen keyboardAvoiding>
      <View style={styles.column}>
        <View style={styles.brandRow}>
          <Image
            source={require('../../assets/images/logo.png')}
            style={styles.logo}
            accessibilityLabel={t('appName', { ns: 'common' })}
          />
          <Text style={[styles.brand, { color: colors.text }]}>
            {t('appName', { ns: 'common' })}
          </Text>
          <IconButton
            icon={scheme === 'light' ? 'moon-outline' : 'sunny-outline'}
            label={t(scheme === 'light' ? 'appearance.dark' : 'appearance.light', {
              ns: 'settings',
            })}
            onPress={() =>
              void themeStore
                .setMode(scheme === 'light' ? 'dark' : 'light')
                .catch(() => toast.error(t('feedback.requestFailed', { ns: 'common' })))
            }
          />
        </View>
        <View style={styles.heading}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
            {t('title')}
          </Text>
          <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{t('subtitle')}</Text>
        </View>
        {connection.phase === 'connected' && !connection.verified ? <View style={styles.notice}>
          <Notice tone="warning">{t(`health.${health.phase}`)}</Notice>
          <Button variant="secondary" loading={busy} onPress={() => {
            const epoch = connection.epoch;
            if (connectionStore.epoch() !== epoch) return;
            setBusy(true); setError(''); void verifyConnection(epoch).catch(cause => {
              if (connectionStore.epoch() === epoch) setError(t(connectionErrorKey(cause)));
            }).finally(() => { if (connectionStore.epoch() === epoch) setBusy(false); });
          }}>{t('diagnose')}</Button>
          <Button variant="ghost" onPress={() => router.push('/connections')}>{t('devicesTitle')}</Button>
        </View> : null}
        {!isWeb ? (
          <Button
            icon="qr-code-outline"
            variant="secondary"
            onPress={() => router.push('/scan')}
            style={styles.scan}
          >
            {t('scanQr')}
          </Button>
        ) : null}
        <SegmentedControl
          value={method}
          options={[
            { value: 'account', label: t('accountLogin'), disabled: busy },
            { value: 'link', label: t('pasteLink'), disabled: busy },
          ]}
          onChange={(next) => {
            setMethod(next);
            setError('');
          }}
        />
        <View style={styles.form}>
          {method === 'account' ? (
            <>
              {needsSetup ? (
                <View style={styles.notice}>
                  <Notice icon="person-add-outline">{t('setupHint')}</Notice>
                </View>
              ) : null}
              <View style={styles.notice}><Notice>{t('accountFormHint')}</Notice></View>
              {!isWeb ? (
                <TextField
                  label={t('address')}
                  leadingIcon="desktop-outline"
                  placeholder={t('addressPlaceholder')}
                  value={address}
                  onChangeText={setAddress}
                  keyboardType="url"
                  editable={!busy}
                  autoComplete="off"
                />
              ) : null}
              <TextField
                label={t('username')}
                leadingIcon="person-outline"
                value={username}
                onChangeText={setUsername}
                editable={!busy}
                autoComplete="username"
              />
              <TextField
                label={t('password')}
                leadingIcon="lock-closed-outline"
                hint={needsSetup ? undefined : t('passwordHint')}
                value={password}
                onChangeText={setPassword}
                editable={!busy}
                secureTextEntry
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                onSubmitEditing={submit}
              />
            </>
          ) : (
            <TextField
              label={t('pasteLink')}
              leadingIcon="link-outline"
              placeholder={t('linkPlaceholder')}
              hint={t('pasteLinkHint')}
              value={pasted}
              onChangeText={setPasted}
              editable={!busy}
              autoComplete="off"
              keyboardType="url"
              onSubmitEditing={submitPastedLink}
            />
          )}
          {error ? (
            <View style={styles.notice}>
              <Notice tone="danger">{error}</Notice>
            </View>
          ) : null}
          <Button
            icon="arrow-forward"
            onPress={method === 'account' ? submit : submitPastedLink}
            loading={busy}
            disabled={method === 'account' ? !password || !username.trim() : !pasted.trim()}
          >
            {t('connect')}
          </Button>
        </View>
        <View style={styles.connectionNote}>
          <Ionicons name="desktop-outline" size={15} color={colors.textTertiary} />
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {isWeb ? t('webSameOrigin') : t('scanHint')}
          </Text>
        </View>
        <Button icon="download-outline" variant="ghost" onPress={() => router.push('/update')}>
          {t('update.title', { ns: 'settings' })}
        </Button>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  column: { width: '100%', maxWidth: 420, alignSelf: 'center', paddingTop: Spacing.xl },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginBottom: Spacing.xxl,
  },
  brand: { fontSize: FontSize.xl, fontWeight: '600', flex: 1 },
  logo: {
    width: 40,
    height: 40,
    borderRadius: Radius.md,
    overflow: 'hidden',
  },
  title: { fontSize: FontSize.title, fontWeight: '700' },
  heading: { gap: Spacing.sm, marginBottom: Spacing.xl },
  subtitle: {
    fontSize: FontSize.sm,
    lineHeight: 22,
  },
  scan: { marginBottom: Spacing.lg },
  form: { marginTop: Spacing.xl },
  notice: { marginBottom: Spacing.lg },
  connectionNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    marginTop: Spacing.xl,
  },
  hint: { flex: 1, fontSize: FontSize.xs, lineHeight: 19 },
});
