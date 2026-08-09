import { useMemo, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { passwordLogin, probeServer, qrLogin, setupAdmin } from '@/api/auth';
import { ApiError } from '@/api/types';
import { parseQrPayload } from '@/api/utils';
import { Button, Card, Screen, TextField, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useConnection } from '@/hooks/use-connection';
import { useTheme } from '@/hooks/use-theme';

const DEFAULT_PORT = '25808';

/** Map a login failure onto a user-actionable message. */
function loginErrorText(
  err: unknown,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return t('rateLimited');
    if (err.status === 401) return t('loginFailed', { message: err.message });
    return t('loginFailed', { message: err.message });
  }
  return t('probeFailed');
}

export default function ConnectScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('connect');
  const connection = useConnection();
  const isWeb = Platform.OS === 'web';

  const lastBaseUrl = connection.phase === 'disconnected' ? connection.lastBaseUrl : undefined;
  const initial = useMemo(() => {
    if (!lastBaseUrl) return { host: '', port: DEFAULT_PORT };
    try {
      const u = new URL(lastBaseUrl);
      return { host: u.hostname, port: u.port || DEFAULT_PORT };
    } catch {
      return { host: '', port: DEFAULT_PORT };
    }
  }, [lastBaseUrl]);

  const [host, setHost] = useState(initial.host);
  const [port, setPort] = useState(initial.port);
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsSetup, setNeedsSetup] = useState(false);
  const [pasted, setPasted] = useState('');

  const baseUrl = isWeb ? '' : `http://${host.trim()}:${port.trim() || DEFAULT_PORT}`;

  const submit = async () => {
    setError('');
    if (!isWeb && !host.trim()) {
      setError(t('hostPlaceholder'));
      return;
    }
    setBusy(true);
    try {
      const probe = await probeServer(baseUrl);
      if (!probe.reachable) {
        setError(t('probeFailed'));
        return;
      }
      if (probe.isNomifun === false) {
        setError(t('notNomifun'));
        return;
      }
      if (probe.needsSetup) {
        setNeedsSetup(true);
        if (!password) return; // show setup hint, wait for credentials
        await setupAdmin(baseUrl, username.trim(), password);
      } else {
        await passwordLogin(baseUrl, username.trim(), password);
      }
      toast.success(t('connectedAs', { username: username.trim() }));
    } catch (err) {
      setError(loginErrorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  const submitPastedLink = async () => {
    setError('');
    const parsed = parseQrPayload(pasted);
    if (!parsed) {
      setError(t('qrInvalid'));
      return;
    }
    setBusy(true);
    try {
      await qrLogin(parsed.baseUrl, parsed.qrToken);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 400)) {
        setError(t('qrExpired'));
      } else {
        setError(loginErrorText(err, t));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen keyboardAvoiding>
      <View style={styles.hero}>
        <View style={[styles.logo, { backgroundColor: colors.primary }]}>
          <Ionicons name="hardware-chip-outline" size={34} color="#FFF" />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>{t('title')}</Text>
        <Text style={[styles.subtitle, { color: colors.textTertiary }]}>{t('subtitle')}</Text>
      </View>

      {!isWeb && (
        <>
          <Button onPress={() => router.push('/scan')} style={{ marginBottom: Spacing.sm }}>
            {t('scanQr')}
          </Button>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('scanHint')}</Text>
        </>
      )}

      <Card style={{ marginTop: Spacing.xl }}>
        <Text style={[styles.cardTitle, { color: colors.text }]}>
          {needsSetup ? t('setupTitle') : t('manual')}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary, marginBottom: Spacing.lg }]}>
          {needsSetup ? t('setupHint') : isWeb ? t('webSameOrigin') : t('manualHint')}
        </Text>

        {!isWeb && (
          <View style={styles.hostRow}>
            <View style={{ flex: 2 }}>
              <TextField
                label={t('host')}
                placeholder={t('hostPlaceholder')}
                value={host}
                onChangeText={setHost}
                keyboardType="url"
                autoComplete="off"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label={t('port')}
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
              />
            </View>
          </View>
        )}

        <TextField label={t('username')} value={username} onChangeText={setUsername} />
        <TextField
          label={t('password')}
          hint={needsSetup ? undefined : t('passwordHint')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={submit}
        />

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        <Button onPress={submit} loading={busy} disabled={!password}>
          {busy ? t('connecting') : t('connect')}
        </Button>
      </Card>

      {!isWeb && (
        <Card style={{ marginTop: Spacing.lg }}>
          <Text style={[styles.cardTitle, { color: colors.text }]}>{t('pasteLink')}</Text>
          <TextField
            placeholder="http://192.168.x.x:25808/qr-login?token=…"
            hint={t('pasteLinkHint')}
            value={pasted}
            onChangeText={setPasted}
            autoComplete="off"
          />
          <Button variant="secondary" onPress={submitPastedLink} disabled={!pasted || busy}>
            {t('connect')}
          </Button>
        </Card>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: Spacing.xxl, gap: Spacing.sm },
  logo: {
    width: 72,
    height: 72,
    borderRadius: Radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.title, fontWeight: '700' },
  subtitle: { fontSize: FontSize.sm, textAlign: 'center', lineHeight: 20, maxWidth: 320 },
  cardTitle: { fontSize: FontSize.lg, fontWeight: '600', marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 18, textAlign: 'center' },
  hostRow: { flexDirection: 'row', gap: Spacing.md },
  error: { fontSize: FontSize.sm, marginBottom: Spacing.md, lineHeight: 20 },
});
