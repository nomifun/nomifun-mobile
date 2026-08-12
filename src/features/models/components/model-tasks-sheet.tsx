import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, toast } from '@/components/ui';
import { useTheme } from '@/hooks/use-theme';
import { Sheet } from '@/features/models/components/sheet';
import { useModelProtocolManifests, useProviderConnections } from '@/features/models/hooks';
import {
  capabilityDraftFromResponse,
  capabilityInputsFromDefinition,
  validateModelDefinition,
  type ModelDefinitionDraft,
} from '@/features/models/advanced';
import { saveProviderModel } from '@/features/models/api';
import { errorMessage } from '@/features/models/errors';
import type { ProviderModelResponse, ProviderConnectionDescriptor } from '@/features/models/types';
import { ModelDefinitionEditor } from './model-definition-editor';
import { ProviderConnectionSheet } from './provider-connection-sheet';

interface ModelTasksSheetProps {
  visible: boolean;
  row: ProviderModelResponse | null;
  providerPlatform?: string;
  providerBaseUrl?: string;
  providerAuthScheme?: string;
  existingModelIds?: readonly string[];
  onClose: () => void;
  onSaved: (row: ProviderModelResponse) => void;
}

/**
 * The desktop calls this control an advanced model editor. On mobile it is
 * still a sheet, but it edits the complete capability graph atomically rather
 * than writing a legacy task-only patch.
 */
export function ModelTasksSheet({
  visible,
  row,
  providerPlatform = '',
  providerBaseUrl = '',
  providerAuthScheme = '',
  existingModelIds = [],
  onClose,
  onSaved,
}: ModelTasksSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [definition, setDefinition] = useState<ModelDefinitionDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [connectionRequest, setConnectionRequest] = useState<{
    role: string;
    baseUrl?: string;
    authScheme?: string;
  } | null>(null);
  const initializedKeyRef = useRef<string | null>(null);

  const selectedTasks = useMemo(
    () => definition?.capabilities.map((capability) => capability.task) ?? [],
    [definition],
  );
  const manifests = useModelProtocolManifests(
    providerPlatform,
    selectedTasks,
    providerBaseUrl,
  );
  const connectionState = useProviderConnections(row?.provider_id ?? '', visible && !!row);
  const connections: ProviderConnectionDescriptor[] = connectionState.connections.map(
    (connection) => ({
      role: connection.role,
      label: connection.label,
      base_url: connection.base_url,
      auth_scheme: connection.auth_scheme,
      has_credentials: connection.has_credentials,
    }),
  );
  const validation = definition
    ? validateModelDefinition(
        definition,
        manifests.manifests,
        providerBaseUrl,
        existingModelIds.filter((model) => model !== row?.model),
        manifests.loadingTasks,
        connections.map((connection) => connection.role),
        providerAuthScheme,
        Object.fromEntries(
          connections.map((connection) => [connection.role, connection.auth_scheme]),
        ),
        connections,
      )
    : { valid: false, errors: [] };

  useEffect(() => {
    if (!visible || !row) {
      initializedKeyRef.current = null;
      return;
    }
    const key = `${row.provider_id}\u0000${row.model}`;
    if (initializedKeyRef.current === key) return;
    initializedKeyRef.current = key;
    setDefinition({
      model: row.model,
      enabled: row.enabled,
      description: row.description,
      sortOrder: row.sort_order,
      capabilities: row.capabilities.map(capabilityDraftFromResponse),
    });
    setError('');
    setConnectionRequest(null);
  }, [row, visible]);

  const close = () => {
    if (!saving) onClose();
  };

  const requestConnection = (
    task: Parameters<
      NonNullable<ComponentProps<typeof ModelDefinitionEditor>['onRequestConnection']>
    >[0],
    requestedRole: string,
  ) => {
    const capability = definition?.capabilities.find((candidate) => candidate.task === task);
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
  };

  const save = async () => {
    if (!row || !definition || saving) return;
    setError('');
    if (!validation.valid) {
      setError(t('editor.capabilityInvalid'));
      return;
    }
    const capabilities = capabilityInputsFromDefinition(definition);
    if (!capabilities || capabilities.length === 0) {
      setError(t('editor.capabilityInvalid'));
      return;
    }
    setSaving(true);
    try {
      const updated = await saveProviderModel({
        provider_id: row.provider_id,
        model: {
          model: row.model,
          enabled: definition.enabled,
          ...(definition.description === undefined
            ? {}
            : { description: definition.description.trim() || undefined }),
          sort_order: definition.sortOrder,
          capabilities,
        },
      });
      onSaved(updated);
      onClose();
      toast.success(tc('feedback.saved'));
    } catch (reason) {
      setError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Sheet
        visible={visible && !!row && !!definition && connectionRequest === null}
        title={t('editor.title')}
        closeDisabled={saving}
        onClose={close}
        footer={
          <Button
            onPress={() => void save()}
            loading={saving}
            disabled={!definition || !validation.valid || connectionState.isLoading}
          >
            {tc('actions.save')}
          </Button>
        }
      >
        {definition ? (
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
            modelReadOnly
            connections={connections}
            onRequestConnection={requestConnection}
          />
        ) : null}
        {error ? <Text style={{ color: colors.danger }}>{error}</Text> : null}
      </Sheet>
      <ProviderConnectionSheet
        visible={visible && !!row && connectionRequest !== null}
        providerId={row?.provider_id ?? ''}
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
