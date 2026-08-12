import { useMemo, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  SectionTitle,
  Tag,
  toast,
} from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  cloneProvider,
  deleteProvider,
  deleteProviderModel,
  providerHealthCheck,
  setProviderModelEnabled,
  updateProvider,
} from '@/features/models/api';
import { AddModelSheet } from '@/features/models/components/add-model-sheet';
import { ModelRow } from '@/features/models/components/model-row';
import { ModelTasksSheet } from '@/features/models/components/model-tasks-sheet';
import { ProviderConnectionsSection } from '@/features/models/components/provider-connections-section';
import { ProviderEditSheet } from '@/features/models/components/provider-edit-sheet';
import { confirmDestructive } from '@/features/models/confirm';
import { errorMessage, isProviderInUse } from '@/features/models/errors';
import { useProvider, useProviderModels } from '@/features/models/hooks';
import {
  isManagedProvider,
  manifestPresetForProvider,
  platformHasNoModelsEndpoint,
} from '@/features/models/platforms';
import type { ModelTask, ProviderModelResponse } from '@/features/models/types';

/**
 * Provider detail is the mobile counterpart of the desktop model manager's
 * provider card. All model writes use complete canonical rows:
 *
 *   provider -> models[] -> capabilities[]
 *
 * No response ever contains a secret, so this screen only displays the
 * `has_credentials` marker and delegates write-only credential entry to the
 * provider editor/connection sheets.
 */
export default function ProviderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const providerId = id ?? '';
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const { provider, missing, error, isLoading, mutate } = useProvider(providerId);
  const {
    models,
    error: modelsError,
    isLoading: modelsLoading,
    mutate: mutateModels,
  } = useProviderModels(providerId);

  const [refreshing, setRefreshing] = useState(false);
  const [providerEditorOpen, setProviderEditorOpen] = useState(false);
  const [togglingProvider, setTogglingProvider] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [providerActionError, setProviderActionError] = useState('');
  const [busyModel, setBusyModel] = useState('');
  const [checkingModel, setCheckingModel] = useState('');
  const [checkingTask, setCheckingTask] = useState<ModelTask | null>(null);
  const [modelActionError, setModelActionError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [tasksRow, setTasksRow] = useState<ProviderModelResponse | null>(null);

  const managed = !!provider && isManagedProvider(provider.platform);
  const manifestPreset = provider
    ? manifestPresetForProvider({
        platform: provider.platform,
        base_url: provider.base_url,
      })
    : '';
  const displayName = provider
    ? managed
      ? t('list.managedName')
      : provider.name || provider.platform
    : t('title');

  /**
   * The dedicated model endpoint is authoritative when it has loaded. During
   * the first render, the nested provider projection gives the page useful
   * content without waiting for a second request.
   */
  const rows = useMemo(
    () => models ?? provider?.models ?? [],
    [models, provider?.models],
  );

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([mutate(), mutateModels()]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleProvider = async (next: boolean) => {
    if (!provider || managed || togglingProvider) return;
    setTogglingProvider(true);
    setProviderActionError('');
    await mutate(
      (current) =>
        current
          ? current.map((item) =>
              item.provider_id === provider.provider_id
                ? { ...item, enabled: next }
                : item,
            )
          : current,
      { revalidate: false },
    );
    try {
      await updateProvider(provider.provider_id, { enabled: next });
    } catch (reason) {
      setProviderActionError(errorMessage(reason, tc('feedback.requestFailed')));
      void mutate();
    } finally {
      setTogglingProvider(false);
      void mutate();
    }
  };

  const toggleModel = async (row: ProviderModelResponse, next: boolean) => {
    if (busyModel) return;
    setBusyModel(row.model);
    setModelActionError('');
    await mutateModels(
      (current) =>
        current?.map((item) =>
          item.model === row.model ? { ...item, enabled: next } : item,
        ),
      { revalidate: false },
    );
    try {
      await setProviderModelEnabled(row.provider_id, row, next);
    } catch (reason) {
      setModelActionError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setBusyModel('');
      void mutateModels();
      void mutate();
    }
  };

  const heartbeat = async (row: ProviderModelResponse, task: ModelTask) => {
    if (checkingModel) return;
    setCheckingModel(row.model);
    setCheckingTask(task);
    setModelActionError('');
    try {
      const result = await providerHealthCheck(row.provider_id, row.model, task);
      if (result.status === 'healthy') {
        toast.success(t('models.healthy', { latency: result.elapsed_ms }));
      } else {
        setModelActionError(result.message || t('models.unhealthy'));
      }
    } catch (reason) {
      setModelActionError(
        t('models.checkFailed', {
          message: errorMessage(reason, tc('feedback.requestFailed')),
        }),
      );
    } finally {
      setCheckingModel('');
      setCheckingTask(null);
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
          setModelActionError('');
          try {
            await deleteProviderModel(row.provider_id, row.model);
            toast.success(tc('feedback.deleted'));
          } catch (reason) {
            setModelActionError(errorMessage(reason, tc('feedback.requestFailed')));
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
    if (!provider || managed) return;
    confirmDestructive({
      title: t('provider.delete'),
      message: `${t('provider.deleteConfirm', { name: displayName })}\n${tc(
        'confirm.irreversible',
      )}`,
      confirmLabel: tc('actions.delete'),
      cancelLabel: tc('actions.cancel'),
      onConfirm: () => {
        void (async () => {
          setDeleting(true);
          setProviderActionError('');
          try {
            await deleteProvider(provider.provider_id);
            toast.success(tc('feedback.deleted'));
            router.canGoBack() ? router.back() : router.replace('/models');
          } catch (reason) {
            setProviderActionError(
              isProviderInUse(reason)
                ? t('provider.inUse')
                : errorMessage(reason, tc('feedback.requestFailed')),
            );
          } finally {
            setDeleting(false);
          }
        })();
      },
    });
  };

  const duplicateProvider = async () => {
    if (!provider || managed || cloning) return;
    setCloning(true);
    setProviderActionError('');
    try {
      await cloneProvider(provider.provider_id, `${displayName} ${t('provider.copySuffix')}`);
      toast.success(t('provider.cloned'));
      void mutate();
    } catch (reason) {
      setProviderActionError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setCloning(false);
    }
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
    const forbidden = error instanceof ApiError && error.status === 403;
    return (
      <Screen scroll={false}>
        {header}
        <ErrorState
          message={forbidden ? t('list.ownerOnly') : `${t('list.loadFailed')}\n${error.message}`}
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
          action={
            <Button variant="secondary" onPress={() => router.back()}>
              {tc('actions.back')}
            </Button>
          }
        />
      </Screen>
    );
  }

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refreshAll()}>
      {header}

      <Card>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>
            {t('provider.platform')}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
            {provider.platform}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>
            {t('provider.name')}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={2}>
            {provider.name || provider.platform}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>
            {t('provider.baseUrl')}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={2}>
            {provider.base_url || t('provider.notApplicable')}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>
            {t('provider.authScheme')}
          </Text>
          <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={2}>
            {provider.auth_scheme || t('provider.notConfigured')}
          </Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>
            {t('provider.credentials')}
          </Text>
          <Tag tone={provider.has_credentials ? 'success' : 'warning'}>
            {provider.has_credentials
              ? t('list.credentialsConfigured')
              : t('list.credentialsMissing')}
          </Tag>
        </View>

        {managed ? (
          <View style={styles.managedRow}>
            <Tag tone="primary">{t('list.managed')}</Tag>
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              {t('list.managedHint')}
            </Text>
          </View>
        ) : (
          <>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={[styles.metaValue, { color: colors.text }]}>
                  {t('provider.enabled')}
                </Text>
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {t('provider.enabledHint')}
                </Text>
              </View>
              <Switch
                accessibilityLabel={t('provider.enabled')}
                value={provider.enabled}
                disabled={togglingProvider}
                onValueChange={(next) => void toggleProvider(next)}
                trackColor={{ true: colors.primary, false: colors.border }}
              />
            </View>
          </>
        )}

        {providerActionError ? (
          <Text style={[styles.error, { color: colors.danger }]}>
            {providerActionError}
          </Text>
        ) : null}

        {!managed ? (
          <View style={styles.buttonRow}>
            <View style={styles.buttonFlex}>
              <Button
                variant="secondary"
                onPress={() => setProviderEditorOpen(true)}
                disabled={cloning || deleting}
              >
                {t('provider.edit')}
              </Button>
            </View>
            <View style={styles.buttonFlex}>
              <Button
                variant="secondary"
                onPress={() => void duplicateProvider()}
                loading={cloning}
                disabled={deleting}
              >
                {t('provider.clone')}
              </Button>
            </View>
          </View>
        ) : null}
      </Card>

      {!managed ? (
        <ProviderConnectionsSection
          providerId={provider.provider_id}
          platform={provider.platform}
        />
      ) : null}

      <SectionTitle>
        {`${t('models.title')} · ${t('models.count', { count: rows.length })}`}
      </SectionTitle>

      {modelsLoading && !models && rows.length === 0 ? (
        <Loading label={tc('state.loading')} />
      ) : null}
      {modelsError && rows.length === 0 ? (
        <ErrorState
          message={`${t('models.loadFailed')}\n${modelsError.message}`}
          onRetry={() => void mutateModels()}
          retryLabel={tc('actions.retry')}
        />
      ) : null}
      {modelActionError ? (
        <Text style={[styles.error, { color: colors.danger }]}>{modelActionError}</Text>
      ) : null}

      {rows.length === 0 && !modelsLoading ? (
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
          checkingTask={checkingModel === row.model ? checkingTask : null}
          onToggle={(next) => void toggleModel(row, next)}
          onHeartbeat={(task) => void heartbeat(row, task)}
          onEdit={() => setTasksRow(row)}
          onDelete={() => removeModel(row)}
        />
      ))}

      {!managed ? (
        <>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {platformHasNoModelsEndpoint(provider.platform)
              ? t('models.noCatalogEndpointHint')
              : t('models.mobileEditorHint')}
          </Text>
          {rows.length > 0 ? (
            <View style={styles.action}>
              <Button variant="secondary" onPress={() => setAddOpen(true)}>
                {t('models.add')}
              </Button>
            </View>
          ) : null}
          <View style={styles.danger}>
            <Button variant="danger" onPress={removeProvider} loading={deleting}>
              {t('provider.delete')}
            </Button>
          </View>
        </>
      ) : null}

      <AddModelSheet
        visible={addOpen}
        providerId={provider.provider_id}
        platform={provider.platform}
        manifestPreset={manifestPreset}
        providerBaseUrl={provider.base_url}
        providerAuthScheme={provider.auth_scheme}
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
        providerPlatform={manifestPreset}
        providerBaseUrl={provider.base_url}
        providerAuthScheme={provider.auth_scheme}
        existingModelIds={rows.map((row) => row.model)}
        onClose={() => setTasksRow(null)}
        onSaved={(updated) => {
          void mutateModels(
            (list) =>
              list?.map((item) => (item.model === updated.model ? updated : item)),
            { revalidate: false },
          );
          void mutateModels();
          void mutate();
        }}
      />

      <ProviderEditSheet
        visible={providerEditorOpen}
        provider={provider}
        onClose={() => setProviderEditorOpen(false)}
        onSaved={() => {
          setProviderEditorOpen(false);
          void mutate();
          void mutateModels();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    paddingVertical: 6,
  },
  metaLabel: { fontSize: FontSize.sm, width: 92 },
  metaValue: { flex: 1, fontSize: FontSize.sm, fontWeight: '600' },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: Spacing.sm },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, minHeight: 44 },
  switchText: { flex: 1, gap: 2 },
  managedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  hint: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.sm },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.md },
  buttonFlex: { flex: 1 },
  action: { marginTop: Spacing.md },
  danger: { marginTop: Spacing.xxl },
});
