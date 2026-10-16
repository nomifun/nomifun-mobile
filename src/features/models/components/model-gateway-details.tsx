import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { connectionStore } from '@/api/connection';
import { Button, TextField } from '@/components/ui';
import { Sheet } from '@/components/ui/sheet';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { modelGateway } from '../api';
import { gatewayAddress, gatewayDate, gatewayInteger, gatewayMoney } from '../gateway';
import type { ModelGatewayAccountResponse, ModelGatewayMetaResponse, ProviderResponse } from '../types';
import { GatewayOperator } from './model-gateway-setup';

export function ModelGatewayDetails({ provider, onChanged }: {
  provider: ProviderResponse; onChanged: () => void | Promise<unknown>;
}) {
  const { t, i18n } = useTranslation('modelGateway');
  const { colors } = useTheme();
  const [meta, setMeta] = useState<ModelGatewayMetaResponse>();
  const [account, setAccount] = useState<ModelGatewayAccountResponse>();
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<'sync' | 'save' | 'meta'>();
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState(provider.base_url);
  const [name, setName] = useState(provider.name);
  const [apiKey, setApiKey] = useState('');
  const [editMeta, setEditMeta] = useState<ModelGatewayMetaResponse>();
  const revision = useRef(0);
  const actionRevision = useRef(0);
  const actionAbort = useRef<AbortController | null>(null);
  const address = gatewayAddress(baseUrl);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    const options = { expectedEpoch: connectionStore.epoch() };
    setLoading(true); setError(''); setMeta(undefined); setAccount(undefined);
    const results = await Promise.allSettled([modelGateway.providerMeta(provider.provider_id, options), modelGateway.account(provider.provider_id, options)]);
    if (current !== revision.current) return;
    if (results[0].status === 'fulfilled') setMeta(results[0].value);
    if (results[1].status === 'fulfilled') setAccount(results[1].value);
    if (results.some(result => result.status === 'rejected')) setError(t('accountFailed'));
    setLoading(false);
  }, [provider.provider_id, provider.base_url, provider.updated_at, t]);
  useEffect(() => {
    setNotice(''); setError(''); setBusy(undefined); setEditing(false); setApiKey(''); void refresh();
    return () => { revision.current += 1; actionRevision.current += 1; actionAbort.current?.abort(); };
  }, [refresh]);
  const start = () => {
    actionAbort.current?.abort(); actionAbort.current = new AbortController();
    return { current: ++actionRevision.current, options: { expectedEpoch: connectionStore.epoch(), signal: actionAbort.current.signal } };
  };
  const sync = async () => {
    if (loading || busy) return;
    const { current, options } = start(); setBusy('sync'); setError(''); setNotice('');
    try {
      const result = await modelGateway.sync(provider.provider_id, options);
      if (current !== actionRevision.current) return;
      await onChanged();
      if (current !== actionRevision.current) return;
      setNotice(t('syncComplete', { added: result.added, updated: result.updated })); await refresh();
    } catch { if (current === actionRevision.current) setError(t('syncFailed')); }
    finally { if (current === actionRevision.current) setBusy(undefined); }
  };
  const inspectAddress = async () => {
    if (!address || busy) return;
    const { current, options } = start(); setBusy('meta'); setError('');
    try {
      const result = await modelGateway.meta({ base_url: address.root }, options);
      if (current === actionRevision.current) setEditMeta(result);
    } catch { if (current === actionRevision.current) setError(t('metaFailed')); }
    finally { if (current === actionRevision.current) setBusy(undefined); }
  };
  const save = async () => {
    if (!address || !editMeta || !name.trim() || busy || (address.root !== gatewayAddress(provider.base_url)?.root && !apiKey.trim())) return;
    const { current, options } = start(); setBusy('save'); setError(''); setNotice('');
    try {
      await modelGateway.updateConnection(provider.provider_id, { base_url: address.root, name: name.trim(), ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}) }, options);
      if (current !== actionRevision.current) return;
      setApiKey(''); setEditing(false); await onChanged();
      if (current === actionRevision.current) { setNotice(t('connectionSaved')); await refresh(); }
    } catch { if (current === actionRevision.current) setError(t('connectionFailed')); }
    finally { if (current === actionRevision.current) setBusy(undefined); }
  };
  const unknown = t('unknown');
  const integer = (value: string | null | undefined) => gatewayInteger(value, i18n.language, unknown);
  const rows = account ? [
    [t('plan'), account.plan?.name ?? t('noPlan')],
    [t('balance'), gatewayMoney(account.balance.amount, account.balance.currency, i18n.language, unknown)],
    [t('planEnd'), gatewayDate(account.plan?.period_end, i18n.language, unknown)],
    [t('usage'), account.plan ? `${integer(account.plan.quota.used)} / ${integer(account.plan.quota.total)} ${account.plan.quota.unit}` : unknown],
    [t('keyName'), account.key.name],
    [t('keyEnd'), gatewayDate(account.key.expires_at, i18n.language, t('noExpiry'))],
    [t('keyRemaining'), `${integer(account.key.remaining_quota)} ${account.key.quota_unit}`],
    [t('requestsPerMinute'), integer(account.rate_limits.requests_per_minute)],
    [t('tokensPerMinute'), integer(account.rate_limits.tokens_per_minute)],
    [t('concurrentRequests'), integer(account.rate_limits.concurrent_requests)],
  ] : [];
  const closeEdit = () => { if (busy === 'save') return; actionRevision.current += 1; actionAbort.current?.abort(); setBusy(undefined); setApiKey(''); setEditing(false); setError(''); };
  return <View style={styles.body}>
    {meta ? <GatewayOperator meta={meta} /> : null}
    <View style={styles.actions}>
      <Button small variant="secondary" loading={loading} disabled={!!busy} onPress={() => void refresh()}>{t('refreshAccount')}</Button>
      <Button small variant="secondary" loading={busy === 'sync'} disabled={loading || !!busy} onPress={() => void sync()}>{t('syncCatalog')}</Button>
      <Button small variant="ghost" disabled={loading || !!busy} onPress={() => { setBaseUrl(provider.base_url); setName(provider.name); setApiKey(''); setEditMeta(meta); setError(''); setEditing(true); }}>{t('editConnection')}</Button>
    </View>
    {rows.map(([label, value]) => <View key={label} style={styles.row}><Text style={[styles.label, { color: colors.textSecondary }]}>{label}</Text><Text selectable style={[styles.value, { color: colors.text }]}>{value}</Text></View>)}
    <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>{t('syncHint')}</Text>
    {!editing && error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
    {notice ? <Text accessibilityLiveRegion="polite" style={{ color: colors.success }}>{notice}</Text> : null}
    <Sheet visible={editing} title={t('editConnection')} onClose={closeEdit} closeDisabled={busy === 'save'} footer={<Button loading={busy === 'save'} disabled={!address || !editMeta || !name.trim() || !!busy || (address.root !== gatewayAddress(provider.base_url)?.root && !apiKey.trim())} onPress={() => void save()}>{t('saveConnection')}</Button>}>
      <View style={styles.body}>
        <TextField label={t('address')} value={baseUrl} editable={busy !== 'save'} onChangeText={value => { actionRevision.current += 1; actionAbort.current?.abort(); setBusy(undefined); setBaseUrl(value); setApiKey(''); setEditMeta(undefined); setError(''); }} error={!address ? t('invalidAddress') : undefined} />
        {address?.insecure ? <Text style={{ color: colors.warning }}>{t('insecureAddress')}</Text> : null}
        <Button variant="secondary" disabled={!address || !!busy} loading={busy === 'meta'} onPress={() => void inspectAddress()}>{t('checkOperator')}</Button>
        {editMeta ? <>
          <GatewayOperator meta={editMeta} />
          <TextField label={t('name')} value={name} editable={busy !== 'save'} onChangeText={setName} />
          <TextField label={t('apiKey')} value={apiKey} editable={busy !== 'save'} secureTextEntry autoComplete="off" onChangeText={setApiKey} hint={`${t('keepKey')} ${t('keyDestination', { domain: address?.domain ?? '' })}`} />
        </> : null}
        {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
      </View>
    </Sheet>
  </View>;
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
  label: { width: 108, fontSize: FontSize.sm },
  value: { flex: 1, fontSize: FontSize.sm },
});
