import { useEffect, useMemo, useState } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, toast } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Sheet } from '@/features/models/components/sheet';
import { useModelProtocolManifests, useProviderConnections } from '@/features/models/hooks';
import {
  applyCatalogSuggestionForTask,
  capabilityInputsFromDefinition,
  normalizeModelId,
  validateModelDefinition,
  type CatalogCapabilitySuggestion,
  type ModelDefinitionDraft,
} from '@/features/models/advanced';
import { saveProviderModel } from '@/features/models/api';
import { ModelDefinitionEditor } from './model-definition-editor';
import { errorMessage } from '@/features/models/errors';
import type { ProviderModelResponse } from '@/features/models/types';
import { ProviderConnectionSheet } from './provider-connection-sheet';

interface AddProviderModelEditorProps {
  visible: boolean;
  providerId: string;
  /** Stable manifest preset or stored runtime platform. */
  providerPreset: string;
  providerBaseUrl?: string;
  providerAuthScheme?: string;
  modelId: string;
  catalogSuggestion?: CatalogCapabilitySuggestion;
  existingModelIds: readonly string[];
  onClose: () => void;
  onSaved: (id: string, row?: ProviderModelResponse) => void;
}

export function AddProviderModelEditor({
  visible,
  providerId,
  providerPreset,
  providerBaseUrl = '',
  providerAuthScheme = '',
  modelId,
  catalogSuggestion,
  existingModelIds,
  onClose,
  onSaved,
}: AddProviderModelEditorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [definition, setDefinition] = useState<ModelDefinitionDraft>(() =>
    catalogSuggestion?.tasks[0]
      ? applyCatalogSuggestionForTask(
          { model: modelId, capabilities: [] },
          catalogSuggestion,
          catalogSuggestion.tasks[0],
        )
      : { model: modelId, capabilities: [] },
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [connectionRequest, setConnectionRequest] = useState<{
    role: string;
    baseUrl?: string;
    authScheme?: string;
  } | null>(null);

  const selectedTasks = useMemo(
    () => definition.capabilities.map((capability) => capability.task),
    [definition.capabilities],
  );
  const manifests = useModelProtocolManifests(
    providerPreset,
    selectedTasks,
    providerBaseUrl,
  );
  const connectionState = useProviderConnections(providerId, visible);
  const connectionDescriptors = connectionState.connections.map((connection) => ({
    role: connection.role,
    label: connection.label,
    base_url: connection.base_url,
    auth_scheme: connection.auth_scheme,
    has_credentials: connection.has_credentials,
  }));
  const validation = validateModelDefinition(
    definition,
    manifests.manifests,
    providerBaseUrl,
    existingModelIds,
    manifests.loadingTasks,
    connectionDescriptors.map((connection) => connection.role),
    providerAuthScheme,
    Object.fromEntries(
      connectionDescriptors.map((connection) => [connection.role, connection.auth_scheme]),
    ),
    connectionDescriptors,
  );

  useEffect(() => {
    if (!visible) return;
    setDefinition(
      catalogSuggestion?.tasks[0]
        ? applyCatalogSuggestionForTask(
            { model: modelId, capabilities: [] },
            catalogSuggestion,
            catalogSuggestion.tasks[0],
          )
        : { model: modelId, capabilities: [] },
    );
    setError('');
    setConnectionRequest(null);
  }, [catalogSuggestion, modelId, visible]);

  const close = () => {
    if (!saving) onClose();
  };

  const save = async () => {
    setError('');
    if (!validation.valid) {
      setError(t('add.capabilityInvalid'));
      return;
    }
    const capabilities = capabilityInputsFromDefinition(definition);
    if (!capabilities || capabilities.length === 0) {
      setError(t('add.capabilityInvalid'));
      return;
    }
    setSaving(true);
    try {
      const row = await saveProviderModel({
        provider_id: providerId,
        model: {
          model: normalizeModelId(definition.model),
          enabled: true,
          ...(definition.description === undefined
            ? {}
            : { description: definition.description.trim() || undefined }),
          capabilities,
        },
      });
      onSaved(row.model, row);
      onClose();
      toast.success(t('models.added', { model: row.model }));
    } catch (reason) {
      setError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        visible={visible && connectionRequest === null}
        title={t('models.add')}
        closeDisabled={saving}
        onClose={close}
        footer={
          <Button
            onPress={() => void save()}
            loading={saving}
            disabled={connectionState.isLoading}
          >
            {tc('actions.save')}
          </Button>
        }
      >
        <ModelDefinitionEditor
          value={definition}
          onChange={setDefinition}
          providerBaseUrl={providerBaseUrl}
          providerAuthScheme={providerAuthScheme}
          manifests={manifests.manifests}
          manifestLoadingTasks={manifests.loadingTasks}
          manifestErrorTasks={manifests.errorTasks}
          validationErrors={validation.errors}
          validationPending={connectionState.isLoading}
          disabled={saving}
          existingModelIds={existingModelIds}
          modelReadOnly={false}
          connections={connectionDescriptors}
          onRequestConnection={(task, requestedRole) => {
            const capability = definition.capabilities.find(
              (candidate) => candidate.task === task,
            );
            const descriptor = manifests.manifests[task]?.protocols.find(
              (protocol) => protocol.protocol_id === capability?.protocol,
            );
            const role = requestedRole.trim() || 'default';
            const recommended = descriptor?.default_connections.find(
              (connection) => (connection.connection_role ?? 'default') === role,
            );
            setConnectionRequest({
              role,
              baseUrl: recommended?.base_url ?? providerBaseUrl,
              authScheme: recommended?.auth_scheme ?? providerAuthScheme,
            });
          }}
        />
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      </Sheet>
      <ProviderConnectionSheet
        visible={visible && connectionRequest !== null}
        providerId={providerId}
        prefillRole={connectionRequest?.role}
        prefillBaseUrl={connectionRequest?.baseUrl}
        prefillScheme={connectionRequest?.authScheme}
        onClose={() => setConnectionRequest(null)}
        onSaved={() => {
          setConnectionRequest(null);
          void connectionState.mutate();
        }}
      />
    </>
  );
}
