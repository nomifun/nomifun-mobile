import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createProvider,
  fetchModelsAnonymous,
} from '@/features/models/api';
import { Sheet } from '@/features/models/components/sheet';
import { errorMessage } from '@/features/models/errors';
import {
  PLATFORM_PRESETS,
  isHttpUrl,
  platformHasNoModelsEndpoint,
} from '@/features/models/platforms';
import {
  AUTH_SCHEME_PRESETS,
  buildBedrockConfig,
  buildConnectionCredentials,
  buildProviderCredentials,
  credentialsKindForScheme,
  isValidConnectionRole,
  type BedrockAuthMethod,
  type ConnectionCredentialsDraft,
} from '@/features/models/connection-form';
import {
  capabilityInputsFromDefinition,
  normalizeModelId,
  validateModelDefinition,
  type CatalogCapabilitySuggestion,
  type ModelDefinitionDraft,
} from '@/features/models/advanced';
import { useModelProtocolManifests } from '@/features/models/hooks';
import { ModelDefinitionEditor } from './model-definition-editor';
import type {
  ModelInfo,
  ModelTask,
  ProviderConnectionDescriptor,
  ProviderConnectionInput,
} from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

/**
 * Mobile translation of the desktop AddPlatformModal.
 *
 * The provider form and the model capability editor intentionally share the
 * same `ModelDefinitionEditor` used by add-model and edit-model. This keeps
 * protocol defaults, endpoint clearing, connection-role validation and
 * capability serialization identical across all entry points.
 */
export function AddProviderSheet({
  visible,
  onClose,
  onCreated,
}: {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = PLATFORM_PRESETS[presetIndex] ?? PLATFORM_PRESETS[0];
  const [name, setName] = useState(preset.label);
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [authScheme, setAuthScheme] = useState(preset.defaultAuthScheme ?? 'bearer');
  const [baseUrlDirty, setBaseUrlDirty] = useState(false);
  const [authSchemeDirty, setAuthSchemeDirty] = useState(false);
  const [apiKeysText, setApiKeysText] = useState('');
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [bedrockRegion, setBedrockRegion] = useState('us-east-1');
  const [bedrockProfile, setBedrockProfile] = useState('');
  const [bedrockAuthMethod, setBedrockAuthMethod] =
    useState<BedrockAuthMethod>('accessKey');
  const [bedrockAccessKeyId, setBedrockAccessKeyId] = useState('');
  const [bedrockSecretAccessKey, setBedrockSecretAccessKey] = useState('');
  const [bedrockSessionToken, setBedrockSessionToken] = useState('');

  const [definition, setDefinition] = useState<ModelDefinitionDraft>({
    model: '',
    capabilities: [],
  });
  const [catalog, setCatalog] = useState<ModelInfo[] | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [pendingConnections, setPendingConnections] = useState<
    ProviderConnectionInput[]
  >([]);
  const [connectionEditor, setConnectionEditor] = useState<{
    task: ModelTask;
    role: string;
    roleReadOnly: boolean;
    baseUrl: string;
    authScheme: string;
    label: string;
    requiresCredentials: boolean;
  } | null>(null);
  const [connectionCredentials, setConnectionCredentials] =
    useState<ConnectionCredentialsDraft>({
      apiKeysText: '',
      appKey: '',
      accessKey: '',
      resourceId: '',
      rawJson: '',
    });
  const [connectionError, setConnectionError] = useState('');
  const [connectionSaving, setConnectionSaving] = useState(false);
  const catalogRequestRef = useRef(0);

  // A hidden sheet may still have an in-flight anonymous catalog request.
  // Invalidate it immediately on dismissal so a late response cannot hydrate
  // the next provider draft when the sheet is reopened.
  useEffect(() => {
    if (!visible) {
      catalogRequestRef.current += 1;
      setCatalogLoading(false);
    }
  }, [visible]);

  const selectedTasks = useMemo(
    () => definition.capabilities.map((capability) => capability.task),
    [definition.capabilities],
  );
  // Always bootstrap chat as well. Besides giving chat forms a useful
  // recommendation, the manifest response is the backend authority for the
  // runtime platform/base URL of regional presets.
  const manifests = useModelProtocolManifests(
    preset.preset,
    ['chat', ...selectedTasks],
    baseUrl,
  );
  const bootstrapManifest = manifests.manifests.chat;
  const firstManifest = selectedTasks
    .map((task) => manifests.manifests[task])
    .find((manifest) => manifest !== undefined);
  const providerManifest = firstManifest ?? bootstrapManifest;
  const runtimePlatform = providerManifest?.platform ?? preset.platform;
  const isBedrock = runtimePlatform === 'bedrock' || preset.bedrock === true;

  useEffect(() => {
    if (!visible) return;
    if (!baseUrlDirty && !isBedrock && bootstrapManifest?.platform_default_base_url) {
      setBaseUrl(bootstrapManifest.platform_default_base_url);
    }
    if (!authSchemeDirty) {
      const recommended =
        bootstrapManifest?.recommendation?.default_auth_scheme ??
        bootstrapManifest?.default_auth_scheme;
      if (recommended) setAuthScheme(recommended);
    }
  }, [
    authSchemeDirty,
    baseUrlDirty,
    bootstrapManifest,
    isBedrock,
    visible,
  ]);

  const catalogSuggestions = useMemo<CatalogCapabilitySuggestion[]>(
    () =>
      (catalog ?? []).map((model) => ({
        model: model.id,
        label: model.name ?? model.id,
        tasks: model.tasks ?? [],
        traits: model.traits ?? [],
      })),
    [catalog],
  );

  const credentialsResult = useMemo(
    () =>
      buildProviderCredentials({
        isBedrock,
        mode: 'create',
        hasStoredCredentials: false,
        apiKeysText,
        bedrockAuthMethod,
        accessKeyId: bedrockAccessKeyId,
        secretAccessKey: bedrockSecretAccessKey,
        sessionToken: bedrockSessionToken,
      }),
    [
      apiKeysText,
      bedrockAccessKeyId,
      bedrockAuthMethod,
      bedrockSecretAccessKey,
      bedrockSessionToken,
      isBedrock,
    ],
  );
  const bedrockConfig = isBedrock
    ? buildBedrockConfig(bedrockAuthMethod, bedrockRegion, bedrockProfile)
    : undefined;

  const validation = validateModelDefinition(
    definition,
    manifests.manifests,
    baseUrl,
    [],
    manifests.loadingTasks,
    pendingConnections.map((connection) => connection.role),
    authScheme,
    Object.fromEntries(
      pendingConnections.map((connection) => [
        connection.role,
        connection.auth_scheme,
      ]),
    ),
    pendingConnections.map<ProviderConnectionDescriptor>((connection) => ({
      role: connection.role,
      label: connection.label ?? undefined,
      base_url: connection.base_url,
      auth_scheme: connection.auth_scheme,
      has_credentials: true,
    })),
  );

  const reset = () => {
    catalogRequestRef.current += 1;
    setCatalogLoading(false);
    const first = PLATFORM_PRESETS[0];
    setPresetIndex(0);
    setName(first.label);
    setBaseUrl(first.baseUrl);
    setAuthScheme(first.defaultAuthScheme ?? 'bearer');
    setBaseUrlDirty(false);
    setAuthSchemeDirty(false);
    setApiKeysText('');
    setRevealSecrets(false);
    setBedrockRegion('us-east-1');
    setBedrockProfile('');
    setBedrockAuthMethod('accessKey');
    setBedrockAccessKeyId('');
    setBedrockSecretAccessKey('');
    setBedrockSessionToken('');
    setDefinition({ model: '', capabilities: [] });
    setCatalog(null);
    setCatalogError('');
    setFormError('');
    setPendingConnections([]);
    setConnectionEditor(null);
    setConnectionCredentials({
      apiKeysText: '',
      appKey: '',
      accessKey: '',
      resourceId: '',
      rawJson: '',
    });
    setConnectionError('');
    setConnectionSaving(false);
  };

  const close = () => {
    if (saving || connectionSaving) return;
    reset();
    onClose();
  };

  const pickPreset = (index: number) => {
    const next = PLATFORM_PRESETS[index];
    if (!next) return;
    catalogRequestRef.current += 1;
    setCatalogLoading(false);
    setPresetIndex(index);
    setName(next.requiresName ? '' : next.label);
    setBaseUrl(next.baseUrl);
    setAuthScheme(next.defaultAuthScheme ?? 'bearer');
    setBaseUrlDirty(false);
    setAuthSchemeDirty(false);
    setApiKeysText('');
    setRevealSecrets(false);
    setBedrockRegion('us-east-1');
    setBedrockProfile('');
    setBedrockAuthMethod('accessKey');
    setBedrockAccessKeyId('');
    setBedrockSecretAccessKey('');
    setBedrockSessionToken('');
    setCatalog(null);
    setCatalogError('');
    setFormError('');
    setDefinition({ model: '', capabilities: [] });
    setPendingConnections([]);
    setConnectionEditor(null);
    setConnectionError('');
  };

  const openConnectionEditor = (task: ModelTask, role: string) => {
    const capability = definition.capabilities.find((item) => item.task === task);
    const manifest = manifests.manifests[task];
    const descriptor = manifest?.protocols.find(
      (item) => item.protocol_id === capability?.protocol,
    );
    const recommended = descriptor?.default_connections.find(
      (connection) => (connection.connection_role ?? 'default') === role,
    );
    const fallbackBaseUrl =
      recommended?.base_url ??
      (role === 'default' ? baseUrl : baseUrl);
    const fallbackAuth =
      recommended?.auth_scheme ??
      manifest?.recommendation?.default_auth_scheme ??
      (authScheme || 'bearer');
    setConnectionEditor({
      task,
      role,
      roleReadOnly: !!recommended,
      baseUrl: fallbackBaseUrl,
      authScheme: fallbackAuth,
      label: recommended?.connection_label ?? '',
      requiresCredentials: recommended?.requires_credentials ?? true,
    });
    setConnectionCredentials({
      apiKeysText: '',
      appKey: '',
      accessKey: '',
      resourceId: '',
      rawJson: '',
    });
    setConnectionError('');
  };

  const savePendingConnection = () => {
    if (!connectionEditor || connectionSaving) return;
    const role = connectionEditor.role.trim();
    const connectionBaseUrl = connectionEditor.baseUrl.trim();
    const scheme = connectionEditor.authScheme.trim();
    if (!isValidConnectionRole(role)) {
      setConnectionError(t('connections.roleInvalid'));
      return;
    }
    if (!connectionBaseUrl) {
      setConnectionError(t('connections.baseUrlRequired'));
      return;
    }
    if (!scheme) {
      setConnectionError(t('connections.authSchemeRequired'));
      return;
    }
    const built = buildConnectionCredentials(scheme, connectionCredentials);
    if (!built.ok) {
      setConnectionError(
        built.error === 'volc_incomplete'
          ? t('connections.volcIncomplete')
          : t('connections.invalidCredentialsJson'),
      );
      return;
    }
    if (connectionEditor.requiresCredentials && built.credentials === undefined) {
      setConnectionError(t('connections.credentialsRequired'));
      return;
    }

    const input: ProviderConnectionInput = {
      role,
      label: connectionEditor.label.trim() || undefined,
      base_url: connectionBaseUrl,
      auth_scheme: scheme,
      credentials: built.credentials ?? {},
    };
    setConnectionSaving(true);
    try {
      setPendingConnections((current) => [
        ...current.filter((item) => item.role !== role),
        input,
      ]);
      setDefinition((current) => ({
        ...current,
        capabilities: current.capabilities.map((capability) =>
          capability.task === connectionEditor.task
            ? {
                ...capability,
                connectionRole: role,
                baseUrlOverride: '',
                allowCrossOriginCredentials: false,
              }
            : capability,
        ),
      }));
      setConnectionEditor(null);
      setConnectionError('');
    } finally {
      setConnectionSaving(false);
    }
  };

  const loadCatalog = async () => {
    if (!isBedrock && (!isHttpUrl(baseUrl) || !authScheme.trim())) {
      setCatalogError(t('add.catalogNeedsCredentials'));
      return;
    }
    if (!credentialsResult.ok || credentialsResult.credentials === undefined) {
      setCatalogError(t('add.catalogNeedsCredentials'));
      return;
    }
    if (isBedrock && !bedrockRegion.trim()) {
      setCatalogError(t('add.bedrockRegionRequired'));
      return;
    }
    if (isBedrock && bedrockAuthMethod === 'profile' && !bedrockProfile.trim()) {
      setCatalogError(t('add.bedrockProfileRequired'));
      return;
    }

    const requestId = ++catalogRequestRef.current;
    setCatalogLoading(true);
    setCatalogError('');
    try {
      const result = await fetchModelsAnonymous({
        platform: runtimePlatform,
        base_url: isBedrock ? '' : baseUrl.trim(),
        auth_scheme: authScheme.trim(),
        credentials: credentialsResult.credentials,
        ...(bedrockConfig ? { bedrock_config: bedrockConfig } : {}),
        try_fix: true,
      });
      if (requestId !== catalogRequestRef.current || !visible) return;
      setCatalog(result.models);
      if (result.fixed_base_url && !baseUrlDirty) {
        setBaseUrl(result.fixed_base_url);
      }
      if (result.models.length === 0) {
        setCatalogError(t('models.fetchFailed'));
      }
    } catch (error) {
      if (requestId === catalogRequestRef.current && visible) {
        setCatalogError(errorMessage(error, t('models.fetchFailed')));
      }
    } finally {
      if (requestId === catalogRequestRef.current) setCatalogLoading(false);
    }
  };

  const save = async () => {
    if (saving) return;
    setFormError('');
    if (!name.trim()) {
      setFormError(t('provider.nameRequired'));
      return;
    }
    if (!isBedrock && !isHttpUrl(baseUrl)) {
      setFormError(t('provider.baseUrlInvalid'));
      return;
    }
    if (!authScheme.trim()) {
      setFormError(t('add.authSchemeRequired'));
      return;
    }
    if (isBedrock && !bedrockRegion.trim()) {
      setFormError(t('add.bedrockRegionRequired'));
      return;
    }
    if (isBedrock && bedrockAuthMethod === 'profile' && !bedrockProfile.trim()) {
      setFormError(t('add.bedrockProfileRequired'));
      return;
    }
    if (!credentialsResult.ok || credentialsResult.credentials === undefined) {
      setFormError(
        isBedrock
          ? t('add.bedrockCredentialsRequired')
          : t('add.keyRequired'),
      );
      return;
    }
    if (!validation.valid) {
      setFormError(t('add.capabilityInvalid'));
      return;
    }
    const capabilities = capabilityInputsFromDefinition(definition);
    if (!capabilities || capabilities.length === 0) {
      setFormError(t('add.capabilityInvalid'));
      return;
    }

    setSaving(true);
    try {
      await createProvider({
        platform: runtimePlatform,
        name: name.trim(),
        base_url: isBedrock ? '' : baseUrl.trim(),
        auth_scheme: authScheme.trim(),
        credentials: credentialsResult.credentials,
        ...(bedrockConfig ? { bedrock_config: bedrockConfig } : {}),
        initial_model: {
          model: normalizeModelId(definition.model),
          enabled: true,
          capabilities,
        },
        ...(pendingConnections.length > 0
          ? { connections: pendingConnections }
          : {}),
      });
      reset();
      onCreated();
      toast.success(t('add.created', { name: name.trim() }));
    } catch (error) {
      setFormError(
        t('add.createFailed', {
          message: errorMessage(error, tc('feedback.requestFailed')),
        }),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={t('add.title')}
      closeDisabled={saving || connectionSaving}
      onClose={close}
      footer={
        <Button
          onPress={() => void save()}
          loading={saving}
          disabled={!validation.valid}
        >
          {t('add.submit')}
        </Button>
      }
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('add.platform')}
      </Text>
      <View style={styles.chips}>
        {PLATFORM_PRESETS.map((item, index) => {
          const active = index === presetIndex;
          return (
            <Pressable
              key={`${item.preset}-${item.platform}`}
              accessibilityRole="button"
              disabled={saving}
              {...a11yState({ selected: active, disabled: saving })}
              onPress={() => pickPreset(index)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                  opacity: saving ? 0.5 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.chipText,
                  { color: active ? colors.primary : colors.textSecondary },
                ]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        {t('add.platformHint')}
      </Text>

      <TextField
        label={t('provider.name')}
        value={name}
        onChangeText={setName}
        hint={t('add.nameHint')}
        placeholder={preset.label}
        editable={!saving}
      />
      {!isBedrock ? (
        <TextField
          label={t('provider.baseUrl')}
          value={baseUrl}
          onChangeText={(value) => {
            setBaseUrlDirty(true);
            setBaseUrl(value);
          }}
          placeholder="https://api.example.com/v1"
          keyboardType="url"
          autoComplete="off"
          editable={!saving}
        />
      ) : null}
      <TextField
        label={t('provider.authScheme')}
        value={authScheme}
        onChangeText={(value) => {
          setAuthSchemeDirty(true);
          setAuthScheme(value);
        }}
        placeholder="bearer / header_key:x-api-key"
        autoComplete="off"
        editable={!saving}
      />

      {isBedrock ? (
        <>
          <TextField
            label={t('provider.bedrockRegion')}
            value={bedrockRegion}
            onChangeText={setBedrockRegion}
            editable={!saving}
          />
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('provider.bedrockAuthMethod')}
          </Text>
          <View style={styles.chips}>
            {(['accessKey', 'profile', 'defaultChain'] as const).map((method) => {
              const active = method === bedrockAuthMethod;
              return (
                <Pressable
                  key={method}
                  accessibilityRole="button"
                  disabled={saving}
                  {...a11yState({ selected: active, disabled: saving })}
                  onPress={() => setBedrockAuthMethod(method)}
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primarySoft : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {t(`provider.bedrockAuth.${method}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {bedrockAuthMethod === 'profile' ? (
            <TextField
              label={t('provider.bedrockProfile')}
              value={bedrockProfile}
              onChangeText={setBedrockProfile}
              placeholder="default"
              editable={!saving}
            />
          ) : null}
          {bedrockAuthMethod === 'accessKey' ? (
            <>
              <TextField
                label={t('provider.bedrockAccessKeyId')}
                value={bedrockAccessKeyId}
                onChangeText={setBedrockAccessKeyId}
                secureTextEntry={!revealSecrets}
                editable={!saving}
              />
              <TextField
                label={t('provider.bedrockSecretAccessKey')}
                value={bedrockSecretAccessKey}
                onChangeText={setBedrockSecretAccessKey}
                secureTextEntry={!revealSecrets}
                editable={!saving}
              />
              <TextField
                label={t('provider.bedrockSessionToken')}
                value={bedrockSessionToken}
                onChangeText={setBedrockSessionToken}
                secureTextEntry={!revealSecrets}
                editable={!saving}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <TextField
            label={t('provider.apiKey')}
            value={apiKeysText}
            onChangeText={setApiKeysText}
            placeholder={t('provider.apiKeyPlaceholder')}
            secureTextEntry={!revealSecrets}
            multiline={revealSecrets}
            autoComplete="off"
            hint={t('provider.apiKeyEditHint')}
            editable={!saving}
          />
        </>
      )}
      <Pressable
        accessibilityRole="button"
        disabled={saving}
        {...a11yState({ disabled: saving })}
        onPress={() => setRevealSecrets((value) => !value)}
        hitSlop={8}
      >
        <Text style={[styles.link, { color: colors.primary }]}>
          {revealSecrets ? t('provider.hide') : t('provider.reveal')}
        </Text>
      </Pressable>

      <ModelDefinitionEditor
        value={definition}
        onChange={setDefinition}
        providerBaseUrl={baseUrl}
        providerAuthScheme={authScheme}
        manifests={manifests.manifests}
        manifestLoadingTasks={manifests.loadingTasks}
        manifestErrorTasks={manifests.errorTasks}
        validationErrors={validation.errors}
        disabled={saving || connectionSaving}
        catalogSuggestions={catalogSuggestions}
        catalogLoading={catalogLoading}
        catalogError={catalogError}
        onRefreshCatalog={() => void loadCatalog()}
        connections={pendingConnections.map<ProviderConnectionDescriptor>((connection) => ({
          role: connection.role,
          label: connection.label ?? undefined,
          base_url: connection.base_url,
          auth_scheme: connection.auth_scheme,
          has_credentials: true,
        }))}
        onRequestConnection={openConnectionEditor}
      />

      {connectionEditor ? (
        <View
          style={[
            styles.connectionEditor,
            { borderColor: colors.warning, backgroundColor: colors.warningSoft },
          ]}
        >
          <Text style={[styles.label, { color: colors.warning }]}>
            {t('connections.inlineTitle', { role: connectionEditor.role })}
          </Text>
          <Text style={[styles.hint, { color: colors.warning }]}>
            {t('connections.inlineHint')}
          </Text>
          <TextField
            label={t('connections.role')}
            value={connectionEditor.role}
            editable={!connectionEditor.roleReadOnly && !connectionSaving}
            onChangeText={(role) =>
              setConnectionEditor((current) => (current ? { ...current, role } : current))
            }
            placeholder="voice"
          />
          <TextField
            label={t('connections.label')}
            value={connectionEditor.label}
            editable={!connectionSaving}
            onChangeText={(label) =>
              setConnectionEditor((current) => (current ? { ...current, label } : current))
            }
            placeholder={t('connections.labelPlaceholder')}
          />
          <TextField
            label={t('connections.baseUrl')}
            value={connectionEditor.baseUrl}
            editable={!connectionSaving}
            onChangeText={(baseUrl) =>
              setConnectionEditor((current) => (current ? { ...current, baseUrl } : current))
            }
            keyboardType="url"
          />
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('connections.authScheme')}
          </Text>
          <View style={styles.chips}>
            {AUTH_SCHEME_PRESETS.map((option) => {
              const active = connectionEditor.authScheme === option;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  disabled={connectionSaving}
                  {...a11yState({ selected: active, disabled: connectionSaving })}
                  onPress={() =>
                    setConnectionEditor((current) =>
                      current ? { ...current, authScheme: option } : current,
                    )
                  }
                  style={[
                    styles.chip,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.primarySoft : colors.surface,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? colors.primary : colors.textSecondary },
                    ]}
                  >
                    {option}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <TextField
            label={t('connections.authSchemeCustom')}
            value={connectionEditor.authScheme}
            editable={!connectionSaving}
            onChangeText={(authScheme) =>
              setConnectionEditor((current) => (current ? { ...current, authScheme } : current))
            }
            placeholder={t('connections.authSchemeCustomPlaceholder')}
          />
          {credentialsKindForScheme(connectionEditor.authScheme) === 'api_keys' ? (
            <TextField
              label={t('connections.credentials')}
              value={connectionCredentials.apiKeysText}
              editable={!connectionSaving}
              onChangeText={(apiKeysText) =>
                setConnectionCredentials((current) => ({ ...current, apiKeysText }))
              }
              placeholder={t('connections.apiKeys')}
              multiline
              numberOfLines={3}
              secureTextEntry
            />
          ) : null}
          {credentialsKindForScheme(connectionEditor.authScheme) === 'volc_voice' ? (
            <>
              <TextField
                label={t('connections.volcAppKey')}
                value={connectionCredentials.appKey}
                editable={!connectionSaving}
                onChangeText={(appKey) =>
                  setConnectionCredentials((current) => ({ ...current, appKey }))
                }
                secureTextEntry
              />
              <TextField
                label={t('connections.volcAccessKey')}
                value={connectionCredentials.accessKey}
                editable={!connectionSaving}
                onChangeText={(accessKey) =>
                  setConnectionCredentials((current) => ({ ...current, accessKey }))
                }
                secureTextEntry
              />
              <TextField
                label={t('connections.volcResourceId')}
                value={connectionCredentials.resourceId}
                editable={!connectionSaving}
                onChangeText={(resourceId) =>
                  setConnectionCredentials((current) => ({ ...current, resourceId }))
                }
              />
            </>
          ) : null}
          {credentialsKindForScheme(connectionEditor.authScheme) === 'custom' ? (
            <TextField
              label={t('connections.credentials')}
              value={connectionCredentials.rawJson}
              editable={!connectionSaving}
              onChangeText={(rawJson) =>
                setConnectionCredentials((current) => ({ ...current, rawJson }))
              }
              placeholder={t('connections.rawCredentials')}
              multiline
              numberOfLines={4}
            />
          ) : null}
          {connectionError ? (
            <Text style={[styles.error, { color: colors.danger }]}>{connectionError}</Text>
          ) : null}
          <View style={styles.inlineActions}>
            <Button
              small
              variant="ghost"
              disabled={connectionSaving}
              onPress={() => {
                setConnectionEditor(null);
                setConnectionError('');
              }}
            >
              {tc('actions.cancel')}
            </Button>
            <Button
              small
              variant="secondary"
              loading={connectionSaving}
              onPress={savePendingConnection}
            >
              {t('connections.inlineSave')}
            </Button>
          </View>
        </View>
      ) : null}

      {platformHasNoModelsEndpoint(runtimePlatform) ? (
        <Text style={[styles.hint, { color: colors.warning }]}>
          {t('test.skipHint')}
        </Text>
      ) : null}
      {formError ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
          {formError}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  link: { fontSize: FontSize.sm, fontWeight: '600', paddingVertical: Spacing.xs },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: FontSize.sm, fontWeight: '600' },
  connectionEditor: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  inlineActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
  },
});
