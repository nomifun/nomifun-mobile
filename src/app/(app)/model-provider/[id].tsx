import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSWRConfig } from 'swr';

import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  SectionTitle,
  Tag,
  TextField,
  toast,
} from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  deleteProvider,
  deleteProviderModel,
  detectProtocol,
  providerHealthCheck,
  setProviderModelEnabled,
  updateProvider,
} from '@/features/models/api';
import { AddModelSheet } from '@/features/models/components/add-model-sheet';
import { ModelRow } from '@/features/models/components/model-row';
import { ModelTasksSheet } from '@/features/models/components/model-tasks-sheet';
import { confirmDestructive } from '@/features/models/confirm';
import { errorMessage, isProviderInUse } from '@/features/models/errors';
import { useProvider, useProviderModels } from '@/features/models/hooks';
import {
  apiKeyCount,
  isHttpUrl,
  isManagedProvider,
  platformHasNoModelsEndpoint,
} from '@/features/models/platforms';
import { MODEL_TASK_ORDER, type ProtocolDetectionResponse, type ProviderModelResponse } from '@/features/models/types';

/** Primary task for a heartbeat probe, in the desktop's display order. */
function primaryTask(row: ProviderModelResponse) {
  return MODEL_TASK_ORDER.find((task) => row.tasks.includes(task));
}

/** 供应商详情：凭证、连通性、模型目录。 */
export default function ProviderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const providerId = id ?? '';
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const { mutate: globalMutate } = useSWRConfig();

  const { provider, missing, error, isLoading, mutate } = useProvider(providerId);
  const {
    models,
    error: modelsError,
    isLoading: modelsLoading,
    mutate: mutateModels,
  } = useProviderModels(providerId);

  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [keyDraft, setKeyDraft] = useState('');
  const [revealKey, setRevealKey] = useState(false);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingProvider, setTogglingProvider] = useState(false);
  const [testing, setTesting] = useState(false);
  const [detection, setDetection] = useState<ProtocolDetectionResponse | null>(null);
  const [testError, setTestError] = useState('');
  const [busyModel, setBusyModel] = useState('');
  const [checkingModel, setCheckingModel] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [tasksRow, setTasksRow] = useState<ProviderModelResponse | null>(null);
  const [deleting, setDeleting] = useState(false);

  const managed = !!provider && isManagedProvider(provider.platform);
  const displayName = provider
    ? managed
      ? t('list.managedName')
      : provider.name || provider.platform
    : t('title');

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([mutate(), mutateModels()]);
    } finally {
      setRefreshing(false);
    }
  };

  const startEdit = () => {
    if (!provider) return;
    setName(provider.name);
    setBaseUrl(provider.base_url);
    setKeyDraft('');
    setRevealKey(false);
    setFormError('');
    setEditing(true);
  };

  const save = async () => {
    if (!provider) return;
    if (!name.trim()) {
      setFormError(t('provider.nameRequired'));
      return;
    }
    if (!isHttpUrl(baseUrl)) {
      setFormError(t('provider.baseUrlInvalid'));
      return;
    }
    const patch: { name?: string; base_url?: string; api_key?: string } = {};
    if (name.trim() !== provider.name) patch.name = name.trim();
    if (baseUrl.trim() !== provider.base_url) patch.base_url = baseUrl.trim();
    // Empty draft = keep the stored credential untouched.
    if (keyDraft.trim()) patch.api_key = keyDraft.trim();
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await updateProvider(provider.provider_id, patch);
      await mutate();
      toast.success(tc('feedback.saved'));
      setEditing(false);
      setKeyDraft('');
      setRevealKey(false);
    } catch (err) {
      setFormError(t('provider.saveFailed', { message: errorMessage(err, tc('feedback.requestFailed')) }));
    } finally {
      setSaving(false);
    }
  };

  const toggleProvider = async (next: boolean) => {
    if (!provider) return;
    setTogglingProvider(true);
    try {
      await updateProvider(provider.provider_id, { enabled: next });
      await mutate();
    } catch (err) {
      toast.error(errorMessage(err, tc('feedback.requestFailed')));
      void mutate();
    } finally {
      setTogglingProvider(false);
    }
  };

  const runTest = async () => {
    if (!provider) return;
    const keyToTest = keyDraft.trim() || provider.api_key;
    if (!keyToTest) {
      setTestError(t('add.keyRequired'));
      return;
    }
    setTesting(true);
    setTestError('');
    setDetection(null);
    try {
      const result = await detectProtocol({
        base_url: (editing ? baseUrl : provider.base_url).trim(),
        api_key: keyToTest,
        test_all_keys: apiKeyCount(keyToTest) > 1,
      });
      setDetection(result);
    } catch (err) {
      setTestError(errorMessage(err, t('test.failed')));
    } finally {
      setTesting(false);
    }
  };

  const toggleModel = async (row: ProviderModelResponse, next: boolean) => {
    setBusyModel(row.model);
    await mutateModels(
      (list) => list?.map((item) => (item.model === row.model ? { ...item, enabled: next } : item)),
      { revalidate: false },
    );
    try {
      await setProviderModelEnabled(row.provider_id, row.model, next);
    } catch (err) {
      toast.error(errorMessage(err, tc('feedback.requestFailed')));
    } finally {
      setBusyModel('');
      void mutateModels();
      void mutate();
    }
  };

  const heartbeat = async (row: ProviderModelResponse) => {
    setCheckingModel(row.model);
    try {
      const result = await providerHealthCheck(row.provider_id, row.model, primaryTask(row));
      if (result.status === 'healthy') {
        toast.success(t('models.healthy', { latency: result.elapsed_ms }));
      } else {
        toast.error(result.message || t('models.unhealthy'));
      }
    } catch (err) {
      toast.error(t('models.checkFailed', { message: errorMessage(err, tc('feedback.requestFailed')) }));
    } finally {
      setCheckingModel('');
      // The probe persists health on the row — refetch, never merge locally.
      void mutateModels();
      void mutate();
    }
  };

  const removeModel = (row: ProviderModelResponse) => {
    confirmDestructive({
      title: t('models.delete'),
      message: t('models.deleteConfirm', { model: row.model }),
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        void (async () => {
          setBusyModel(row.model);
          try {
            await deleteProviderModel(row.provider_id, row.model);
            toast.success(tc('feedback.deleted'));
          } catch (err) {
            toast.error(errorMessage(err, tc('feedback.requestFailed')));
          } finally {
            setBusyModel('');
            void mutateModels();
            void mutate();
          }
        })();
      },
    });
  };

  const removeProvider = () => {
    if (!provider) return;
    confirmDestructive({
      title: t('provider.delete'),
      message: `${t('provider.deleteConfirm', { name: displayName })}\n${tc('confirm.irreversible')}`,
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        void (async () => {
          setDeleting(true);
          try {
            await deleteProvider(provider.provider_id);
            await mutate();
            toast.success(tc('feedback.deleted'));
            router.back();
          } catch (err) {
            toast.error(isProviderInUse(err) ? t('provider.inUse') : errorMessage(err, tc('feedback.requestFailed')));
          } finally {
            setDeleting(false);
          }
        })();
      },
    });
  };

  const header = <Stack.Screen options={{ title: displayName }} />;

  if (isLoading && !provider) {
    return (
      <Screen scroll={false}>
        {header}
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (error && !provider) {
    return (
      <Screen scroll={false}>
        {header}
        <ErrorState
          message={`${t('list.loadFailed')}\n${error.message}`}
          onRetry={() => void mutate()}
          retryLabel={tc('actions.retry')}
        />
      </Screen>
    );
  }

  if (!provider) {
    return (
      <Screen scroll={false}>
        {header}
        <EmptyState
          icon="help-circle-outline"
          title={t('provider.notFound')}
          description={missing ? t('provider.notFoundHint') : undefined}
          action={<Button variant="secondary" onPress={() => router.back()}>{tc('actions.back')}</Button>}
        />
      </Screen>
    );
  }

  const keyCount = apiKeyCount(provider.api_key);
  const rows = models ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refreshAll()}>
      {header}

      <Card>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>{t('provider.platform')}</Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
            {provider.platform}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>{t('provider.baseUrl')}</Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={2}>
            {provider.base_url || '—'}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>{t('provider.apiKey')}</Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
            {keyCount > 0 ? t('provider.apiKeyMasked', { count: keyCount }) : t('provider.apiKeyEmpty')}
          </Text>
        </View>

        {managed ? (
          <View style={styles.managedRow}>
            <Tag tone="primary">{t('list.managed')}</Tag>
            <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('list.managedHint')}</Text>
          </View>
        ) : (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={[styles.metaValue, { color: colors.text }]}>{t('provider.enabled')}</Text>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {t('provider.enabledHint')}
                </Text>
              </View>
              <Switch
                value={provider.enabled}
                disabled={togglingProvider}
                onValueChange={(next) => void toggleProvider(next)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </>
        )}
      </Card>

      {managed ? null : (
        <>
          <SectionTitle>{t('provider.credentials')}</SectionTitle>
          <Card>
            {editing ? (
              <>
                <TextField label={t('provider.name')} value={name} onChangeText={setName} />
                <TextField
                  label={t('provider.baseUrl')}
                  value={baseUrl}
                  onChangeText={setBaseUrl}
                  keyboardType="url"
                  autoComplete="off"
                />
                <TextField
                  label={t('provider.apiKey')}
                  value={keyDraft}
                  onChangeText={setKeyDraft}
                  placeholder={
                    keyCount > 0 ? t('provider.apiKeyMasked', { count: keyCount }) : t('provider.apiKeyPlaceholder')
                  }
                  secureTextEntry={!revealKey}
                  multiline={revealKey}
                  autoComplete="off"
                  hint={t('provider.apiKeyEditHint')}
                />
                <Pressable
                  accessibilityRole="button"
                  hitSlop={8}
                  onPress={() => {
                    // Reveal is explicit and opt-in: keys are never rendered by default.
                    if (revealKey) {
                      setRevealKey(false);
                      return;
                    }
                    setKeyDraft(keyDraft || provider.api_key);
                    setRevealKey(true);
                  }}
                >
                  <Text style={[styles.link, { color: colors.primary }]}>
                    {revealKey ? t('provider.hide') : t('provider.reveal')}
                  </Text>
                </Pressable>
                {formError ? (
                  <Text style={[styles.error, { color: colors.danger }]}>{formError}</Text>
                ) : null}
                <View style={styles.buttonRow}>
                  <View style={styles.buttonFlex}>
                    <Button variant="secondary" onPress={() => setEditing(false)} disabled={saving}>
                      {tc('actions.cancel')}
                    </Button>
                  </View>
                  <View style={styles.buttonFlex}>
                    <Button onPress={() => void save()} loading={saving}>
                      {tc('actions.save')}
                    </Button>
                  </View>
                </View>
              </>
            ) : (
              <>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {t('provider.credentialsHint')}
                </Text>
                <View style={styles.buttonRow}>
                  <View style={styles.buttonFlex}>
                    <Button variant="secondary" onPress={startEdit}>
                      {tc('actions.edit')}
                    </Button>
                  </View>
                  <View style={styles.buttonFlex}>
                    <Button variant="secondary" onPress={() => void runTest()} loading={testing}>
                      {testing ? t('test.testing') : t('test.action')}
                    </Button>
                  </View>
                </View>
              </>
            )}

            {platformHasNoModelsEndpoint(provider.platform) ? (
              <Text style={[styles.hint, { color: colors.warning }]}>{t('test.skipHint')}</Text>
            ) : null}
            {detection ? (
              <View style={[styles.result, { borderColor: colors.border }]}>
                <Text
                  style={[
                    styles.resultTitle,
                    { color: detection.success ? colors.success : colors.danger },
                  ]}
                >
                  {detection.success
                    ? t('test.success', { protocol: detection.protocol })
                    : t('test.failed')}
                </Text>
                {detection.multi_key_result ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    {t('test.keys', {
                      valid: detection.multi_key_result.valid,
                      total: detection.multi_key_result.total,
                    })}
                  </Text>
                ) : null}
                {detection.suggestion && detection.suggestion.type !== 'none' ? (
                  <Text style={[styles.hint, { color: colors.warning }]}>
                    {detection.suggestion.message}
                  </Text>
                ) : null}
                {detection.fixed_base_url ? (
                  <Text style={[styles.hint, { color: colors.textSecondary }]}>
                    {t('test.fixedBaseUrl', { url: detection.fixed_base_url })}
                  </Text>
                ) : null}
              </View>
            ) : null}
            {testError ? <Text style={[styles.error, { color: colors.danger }]}>{testError}</Text> : null}
          </Card>
        </>
      )}

      <SectionTitle>{`${t('models.title')} · ${t('models.count', { count: rows.length })}`}</SectionTitle>

      {modelsLoading && !models ? <Loading label={tc('state.loading')} /> : null}

      {modelsError && !models ? (
        <ErrorState
          message={`${t('models.loadFailed')}\n${modelsError.message}`}
          onRetry={() => void mutateModels()}
          retryLabel={tc('actions.retry')}
        />
      ) : null}

      {models && rows.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title={t('models.empty')}
          description={managed ? t('list.managedHint') : t('models.emptyHint')}
          action={
            managed ? undefined : (
              <Button variant="secondary" onPress={() => setAddOpen(true)}>
                {t('models.add')}
              </Button>
            )
          }
        />
      ) : null}

      {rows.map((row) => (
        <ModelRow
          key={row.model}
          row={row}
          providerDisabled={!provider.enabled}
          readOnly={managed}
          busy={busyModel === row.model}
          checking={checkingModel === row.model}
          onToggle={(next) => void toggleModel(row, next)}
          onHeartbeat={() => void heartbeat(row)}
          onEditTasks={() => setTasksRow(row)}
          onDelete={() => removeModel(row)}
        />
      ))}

      {managed || rows.length === 0 ? null : (
        <>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('models.tagsDesktopHint')}</Text>
          <View style={styles.action}>
            <Button variant="secondary" onPress={() => setAddOpen(true)}>
              {t('models.add')}
            </Button>
          </View>
        </>
      )}

      {managed ? null : (
        <View style={styles.danger}>
          <Button variant="danger" onPress={removeProvider} loading={deleting}>
            {t('provider.delete')}
          </Button>
        </View>
      )}

      <AddModelSheet
        visible={addOpen}
        providerId={provider.provider_id}
        platform={provider.platform}
        existing={rows.map((row) => row.model)}
        onClose={() => setAddOpen(false)}
        onAdded={() => {
          void mutateModels();
          void mutate();
        }}
      />

      <ModelTasksSheet
        visible={tasksRow !== null}
        row={tasksRow}
        onClose={() => setTasksRow(null)}
        onSaved={(updated) => {
          // The response IS the new row: patch it in, then revalidate the
          // provider (its models_detail carries the same tags) and every
          // task resolver that may now include or exclude this model.
          void mutateModels(
            (list) => list?.map((item) => (item.model === updated.model ? updated : item)),
            { revalidate: false },
          );
          void mutateModels();
          void mutate();
          void globalMutate(
            (key) => Array.isArray(key) && key[0] === '/api/model-profiles/resolve',
          );
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md, paddingVertical: 6 },
  metaLabel: { fontSize: FontSize.sm, width: 84 },
  metaValue: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
  managedRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm },
  hint: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  link: { fontSize: FontSize.sm, fontWeight: '600', paddingVertical: Spacing.xs },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginBottom: Spacing.sm },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.sm },
  buttonFlex: { flex: 1 },
  result: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: 4,
  },
  resultTitle: { fontSize: FontSize.sm, fontWeight: '700' },
  action: { marginTop: Spacing.md },
  danger: { marginTop: Spacing.xxl },
});
