import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { connectionStore } from '@/api/connection';
import { Button, TextField } from '@/components/ui';
import { Sheet } from '@/components/ui/sheet';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { modelGateway } from '../api';
import { gatewayAddress, gatewayExternalUrl } from '../gateway';
import type { ModelGatewayCatalogResponse, ModelGatewayMetaResponse } from '../types';

export function GatewayOperator({ meta }: { meta: ModelGatewayMetaResponse }) {
  const { t } = useTranslation('modelGateway');
  const { colors } = useTheme();
  const links = ['homepage_url', 'console_url', 'purchase_url', 'terms_url', 'privacy_url'] as const;
  return <View style={[styles.card, { borderColor: colors.border }]}>
    <Text style={{ color: colors.text, fontSize: FontSize.md, fontWeight: '600' }}>{meta.operator.name}</Text>
    <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>{t('independentOperator')}</Text>
    <View style={styles.actions}>{links.map(field => {
      const url = gatewayExternalUrl(meta.operator[field]);
      return url ? <Button key={field} small variant="ghost" onPress={() => { void Linking.openURL(url).catch(() => {}); }}>{t(`links.${field}`)}</Button> : null;
    })}</View>
  </View>;
}

export function ModelGatewaySetup({ visible, onClose, onCreated }: {
  visible: boolean; onClose: () => void; onCreated: () => void;
}) {
  const { t } = useTranslation('modelGateway');
  const { colors } = useTheme();
  const [baseUrl, setBaseUrl] = useState('');
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [meta, setMeta] = useState<ModelGatewayMetaResponse>();
  const [catalog, setCatalog] = useState<ModelGatewayCatalogResponse>();
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<'meta' | 'catalog' | 'create'>();
  const [error, setError] = useState('');
  const revision = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const address = gatewayAddress(baseUrl);
  const models = useMemo(() => catalog?.models.filter(model => `${model.id} ${model.display_name} ${model.vendor}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? [], [catalog, search]);
  const invalidate = () => { revision.current += 1; abort.current?.abort(); setBusy(undefined); setError(''); };
  useEffect(() => {
    if (visible) {
      setBaseUrl(''); setName(''); setApiKey(''); setMeta(undefined); setCatalog(undefined); setSelected([]); setSearch(''); setError(''); setBusy(undefined);
    }
    return () => { revision.current += 1; abort.current?.abort(); };
  }, [visible]);
  const start = () => {
    abort.current?.abort(); abort.current = new AbortController();
    return { current: ++revision.current, options: { signal: abort.current.signal, expectedEpoch: connectionStore.epoch() } };
  };
  const loadMeta = async () => {
    if (!address || busy) return;
    const { current, options } = start(); setBusy('meta'); setError('');
    try {
      const result = await modelGateway.meta({ base_url: address.root }, options);
      if (current !== revision.current) return;
      setMeta(result); if (!name.trim()) setName(result.operator.name);
    } catch { if (current === revision.current) setError(t('metaFailed')); }
    finally { if (current === revision.current) setBusy(undefined); }
  };
  const loadCatalog = async () => {
    if (!address || !meta || !apiKey.trim() || busy) return;
    const { current, options } = start(); setBusy('catalog'); setError('');
    try {
      const result = await modelGateway.catalog({ base_url: address.root, api_key: apiKey.trim() }, options);
      if (current !== revision.current) return;
      setCatalog(result); setSelected(result.models.map(model => model.id));
    } catch { if (current === revision.current) setError(t('catalogFailed')); }
    finally { if (current === revision.current) setBusy(undefined); }
  };
  const save = async () => {
    if (!address || !meta || !catalog || !apiKey.trim() || !name.trim() || !selected.length || busy) return;
    const { current, options } = start(); setBusy('create'); setError('');
    try {
      await modelGateway.create({ base_url: address.root, api_key: apiKey.trim(), name: name.trim(), models: selected }, options);
      if (current !== revision.current) return;
      setApiKey(''); onCreated(); onClose();
    } catch { if (current === revision.current) setError(t('saveFailed')); }
    finally { if (current === revision.current) setBusy(undefined); }
  };
  const close = () => { if (busy === 'create') return; invalidate(); setApiKey(''); onClose(); };
  return <Sheet visible={visible} title={t('title')} subtitle={t('setupDescription')} onClose={close} closeDisabled={busy === 'create'} tall footer={
    <Button loading={busy === 'create'} disabled={!catalog || !name.trim() || !selected.length || !!busy} onPress={() => void save()}>{t('addSelected')}</Button>
  }>
    <View style={styles.body}>
      <TextField label={t('address')} value={baseUrl} editable={busy !== 'create'} placeholder="https://models.example.com" onChangeText={value => { invalidate(); setBaseUrl(value); setMeta(undefined); setCatalog(undefined); setSelected([]); setApiKey(''); }} error={baseUrl.trim() && !address ? t('invalidAddress') : undefined} />
      {address?.insecure ? <Text style={{ color: colors.warning }}>{t('insecureAddress')}</Text> : null}
      <Button variant="secondary" loading={busy === 'meta'} disabled={!address || !!busy} onPress={() => void loadMeta()}>{t('checkOperator')}</Button>
      {meta ? <>
        <GatewayOperator meta={meta} />
        <TextField label={t('name')} value={name} onChangeText={setName} editable={busy !== 'create'} />
        <TextField label={t('apiKey')} value={apiKey} secureTextEntry autoComplete="off" editable={busy !== 'create'} hint={t('keyDestination', { domain: address?.domain ?? '' })} onChangeText={value => { invalidate(); setApiKey(value); setCatalog(undefined); setSelected([]); }} />
        <Button variant="secondary" loading={busy === 'catalog'} disabled={!apiKey.trim() || !!busy} onPress={() => void loadCatalog()}>{t('loadCatalog')}</Button>
      </> : null}
      {catalog ? <>
        <TextField label={t('searchModels')} variant="search" value={search} onChangeText={setSearch} />
        <Button variant="ghost" disabled={busy === 'create'} onPress={() => setSelected(selected.length === catalog.models.length ? [] : catalog.models.map(model => model.id))}>{t('selectAll', { selected: selected.length, total: catalog.models.length })}</Button>
        {!catalog.models.length ? <Text style={{ color: colors.textSecondary }}>{t('emptyCatalog')}</Text> : null}
        {models.map(model => <Pressable key={model.id} accessibilityRole="checkbox" {...a11yState({ checked: selected.includes(model.id), disabled: busy === 'create' })} disabled={busy === 'create'} onPress={() => setSelected(current => current.includes(model.id) ? current.filter(id => id !== model.id) : [...current, model.id])} style={[styles.card, { backgroundColor: selected.includes(model.id) ? colors.primarySoft : colors.surface, borderColor: colors.border }]}>
          <Text style={{ color: colors.text, fontWeight: '600' }}>{selected.includes(model.id) ? '☑ ' : '☐ '}{model.display_name}</Text>
          <Text selectable style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>{model.id} · {model.vendor}</Text>
          <Text style={{ color: colors.textSecondary, fontSize: FontSize.xs }}>{model.tasks.map(task => t(`models:task.${task}`)).join(' · ')} · {t(`status.${model.status}`, { defaultValue: model.status })}{model.included_in_plan ? ` · ${t('includedInPlan')}` : ''}</Text>
        </Pressable>)}
      </> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: colors.danger }}>{error}</Text> : null}
    </View>
  </Sheet>;
}

const styles = StyleSheet.create({
  body: { gap: Spacing.md },
  card: { padding: Spacing.md, borderWidth: 1, borderRadius: Radius.md, gap: Spacing.sm },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
});
