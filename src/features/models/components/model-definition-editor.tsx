import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Toggle } from '@/components/ui/toggle';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, Card, Tag, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import {
  CAPABILITY_ENDPOINT_FIELDS,
  addCapabilityTask,
  applyCatalogSuggestionForTask,
  changeCapabilityProtocol,
  changePrimaryModelTask,
  effectiveBaseUrl,
  endpointDescriptorValue,
  isProtocolAuthSchemeAllowed,
  parseProviderParams,
  patchCapabilityDraft,
  protocolDescriptorForDraft,
  reconcileCapabilityRecommendations,
  resolvedCapabilityUrl,
  rootMatchesShape,
  removeCapabilityTask,
  requiresCrossOriginConsent,
  sortTraits,
  type CapabilityEndpointField,
  type CapabilityValidationResult,
  type CatalogCapabilitySuggestion,
  type ModelCapabilityDraft,
  type ModelDefinitionDraft,
  type ModelProtocolManifest,
} from '@/features/models/advanced';
import {
  MODEL_TASK_ORDER,
  MODEL_TRAIT_ORDER,
  type ModelTask,
  type ProtocolEndpointDescriptor,
  type ProviderConnectionDescriptor,
} from '@/features/models/types';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';

export interface ModelDefinitionEditorProps {
  value: ModelDefinitionDraft;
  onChange: Dispatch<SetStateAction<ModelDefinitionDraft>>;
  providerBaseUrl: string;
  providerAuthScheme: string;
  manifests: Partial<Record<ModelTask, ModelProtocolManifest>>;
  manifestLoadingTasks?: readonly ModelTask[];
  manifestErrorTasks?: readonly ModelTask[];
  validationErrors?: CapabilityValidationResult['errors'];
  validationPending?: boolean;
  /** Lock all form controls while the owning sheet is saving. */
  disabled?: boolean;
  existingModelIds?: readonly string[];
  modelReadOnly?: boolean;
  catalogSuggestions?: readonly CatalogCapabilitySuggestion[];
  catalogLoading?: boolean;
  catalogError?: string;
  onRefreshCatalog?: () => void;
  connections?: readonly ProviderConnectionDescriptor[];
  onRequestConnection?: (task: ModelTask, role: string) => void;
  /**
   * Mobile add flows default to a small, recommendation-driven surface.
   * Advanced protocol/endpoint controls remain available on demand.
   */
  simpleMode?: boolean;
}

const endpointKey = (
  field: CapabilityEndpointField,
): keyof Pick<
  ModelCapabilityDraft,
  'endpoint' | 'pollEndpoint' | 'contentEndpoint' | 'realtimeEndpoint'
> => {
  switch (field) {
    case 'poll_endpoint':
      return 'pollEndpoint';
    case 'content_endpoint':
      return 'contentEndpoint';
    case 'realtime_endpoint':
      return 'realtimeEndpoint';
    default:
      return 'endpoint';
  }
};

function endpointLabel(
  field: CapabilityEndpointField,
  task: ModelTask,
  t: (key: string) => string,
): string {
  if (field === 'poll_endpoint') return t('editor.pollEndpoint');
  if (field === 'content_endpoint') return t('editor.contentEndpoint');
  if (field === 'realtime_endpoint' || task === 'realtime_conversation') {
    return t('editor.realtimeEndpoint');
  }
  return t('editor.endpoint');
}

function fallbackEndpointDescriptor(
  field: CapabilityEndpointField,
  task: ModelTask,
): ProtocolEndpointDescriptor {
  return {
    task,
    field,
    purpose: field === 'realtime_endpoint' ? 'session' : 'submit',
    method: null,
    default_value: '',
    root_shape: 'versioned_root',
    allowed_placeholders: [],
    required_placeholders: [],
    editable: true,
  };
}

export function ModelDefinitionEditor({
  value,
  onChange,
  providerBaseUrl,
  providerAuthScheme,
  manifests,
  manifestLoadingTasks = [],
  manifestErrorTasks = [],
  validationErrors = [],
  validationPending = false,
  disabled = false,
  existingModelIds = [],
  modelReadOnly = false,
  catalogSuggestions = [],
  catalogLoading = false,
  catalogError,
  onRefreshCatalog,
  connections = [],
  onRequestConnection,
  simpleMode = false,
}: ModelDefinitionEditorProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [expandedTask, setExpandedTask] = useState<ModelTask | null>(null);
  const [advancedTask, setAdvancedTask] = useState<ModelTask | null>(null);
  const controlsDisabled = disabled || validationPending;

  const selectedTasks = useMemo(
    () => value.capabilities.map((capability) => capability.task),
    [value.capabilities],
  );
  const primaryTask = modelReadOnly ? undefined : selectedTasks[0];
  const availableTasks = MODEL_TASK_ORDER.filter((task) => !selectedTasks.includes(task));
  const filteredCatalog = primaryTask
    ? catalogSuggestions.filter((suggestion) => suggestion.tasks.includes(primaryTask))
    : [];
  const duplicateModel =
    !modelReadOnly &&
    value.model.trim().length > 0 &&
    existingModelIds.some((model) => model.trim() === value.model.trim());
  const readyRecommendationManifests = useMemo(() => {
    const result: Partial<Record<ModelTask, ModelProtocolManifest>> = {};
    for (const task of MODEL_TASK_ORDER) {
      if (!manifestLoadingTasks.includes(task) && manifests[task]) {
        result[task] = manifests[task];
      }
    }
    return result;
  }, [manifestLoadingTasks, manifests]);
  useEffect(() => {
    onChange((current) => {
      const reconciledCapabilities = reconcileCapabilityRecommendations(
        current.capabilities,
        readyRecommendationManifests,
      );
      const changed = reconciledCapabilities.some(
        (capability, index) => capability !== current.capabilities[index],
      );
      return changed ? { ...current, capabilities: reconciledCapabilities } : current;
    });
  }, [onChange, readyRecommendationManifests]);

  const updateCapability = (task: ModelTask, patch: Partial<ModelCapabilityDraft>) => {
    onChange((current) => ({
      ...current,
      capabilities: current.capabilities.map((capability) =>
        capability.task === task
          ? patchCapabilityDraft(
              capability,
              (() => {
                const { task: _task, transportSource: _source, ...rest } = patch;
                return rest;
              })(),
            )
          : capability,
      ),
    }));
  };

  const selectPrimaryTask = (task: ModelTask) => {
    if (task === primaryTask) return;
    onChange((current) => changePrimaryModelTask(current, task));
    setExpandedTask(task);
  };

  const selectCatalogSuggestion = (suggestion: CatalogCapabilitySuggestion) => {
    if (!primaryTask) return;
    onChange((current) => applyCatalogSuggestionForTask(current, suggestion, primaryTask));
    setExpandedTask(primaryTask);
  };

  return (
    <View style={styles.root}>
      {!modelReadOnly ? (
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('editor.primaryTask')}
          </Text>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t('editor.primaryTaskHint')}
          </Text>
          <View style={styles.chips}>
            {MODEL_TASK_ORDER.map((task) => {
              const active = task === primaryTask;
              return (
                <Pressable
                  key={task}
                  accessibilityRole="button"
                  disabled={controlsDisabled}
                  {...a11yState({ selected: active, disabled: controlsDisabled })}
                  onPress={() => selectPrimaryTask(task)}
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
                    {t(`task.${task}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      <TextField
        label={t('editor.modelId')}
        value={value.model}
        editable={!modelReadOnly && !disabled}
        onChangeText={(model) => onChange((current) => ({ ...current, model }))}
        placeholder={modelReadOnly ? undefined : t('editor.modelPlaceholder')}
        error={duplicateModel ? t('editor.duplicateModel') : undefined}
        hint={!modelReadOnly ? t('editor.catalogHint') : t('editor.modelReadOnly')}
      />

      <TextField
        label={t('editor.description')}
        value={value.description ?? ''}
        editable={!disabled}
        onChangeText={(description) =>
          onChange((current) => ({
            ...current,
            description: description.length > 0 ? description : undefined,
          }))
        }
        placeholder={t('editor.descriptionPlaceholder')}
        hint={t('editor.descriptionHint')}
        multiline
        numberOfLines={3}
      />

      {!modelReadOnly && primaryTask ? (
        <Card style={styles.catalogCard}>
          <View style={styles.catalogHeader}>
            <View style={styles.flex}>
              <Text style={[styles.label, { color: colors.textSecondary }]}>
                {t('editor.catalog')}
              </Text>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t('editor.catalogTaskHint', { task: t(`task.${primaryTask}`) })}
              </Text>
            </View>
            {onRefreshCatalog ? (
              <Button
                small
                variant="ghost"
                loading={catalogLoading}
                disabled={disabled}
                onPress={onRefreshCatalog}
              >
                {tc('actions.refresh')}
              </Button>
            ) : null}
          </View>
          {catalogError ? (
            <Text style={[styles.hint, { color: colors.warning }]}>{catalogError}</Text>
          ) : null}
          {filteredCatalog.length === 0 && !catalogLoading ? (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              {t('editor.catalogEmpty')}
            </Text>
          ) : null}
          {filteredCatalog.slice(0, 40).map((suggestion) => (
            <Pressable
              key={suggestion.model}
              accessibilityRole="button"
              disabled={catalogLoading || disabled}
              {...a11yState({ disabled: catalogLoading || disabled })}
              onPress={() => selectCatalogSuggestion(suggestion)}
              style={({ pressed }) => [
                styles.catalogRow,
                {
                  borderColor: colors.border,
                  backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                },
              ]}
            >
              <Ionicons name="search-circle-outline" size={19} color={colors.primary} />
              <View style={styles.flex}>
                <Text style={[styles.modelText, { color: colors.text }]} numberOfLines={1}>
                  {suggestion.label ?? suggestion.model}
                </Text>
                {suggestion.label && suggestion.label !== suggestion.model ? (
                  <Text
                    style={[styles.catalogId, { color: colors.textTertiary }]}
                    numberOfLines={1}
                  >
                    {suggestion.model}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          ))}
        </Card>
      ) : null}

      {value.capabilities.map((capability, index) => (
        <CapabilityCard
          key={capability.task}
          capability={capability}
          expanded={
            expandedTask === capability.task ||
            (!simpleMode && index === 0 && expandedTask === null)
          }
          simpleMode={simpleMode}
          advancedOpen={!simpleMode || advancedTask === capability.task}
          manifest={manifests[capability.task]}
          loading={manifestLoadingTasks.includes(capability.task)}
          loadFailed={manifestErrorTasks.includes(capability.task)}
          providerBaseUrl={providerBaseUrl}
          providerAuthScheme={providerAuthScheme}
          connections={connections}
          validationErrors={validationErrors.filter((error) => error.task === capability.task)}
          validationPending={validationPending}
          disabled={disabled}
          canRemove={modelReadOnly || index > 0}
          onToggle={() =>
            setExpandedTask((current) => (current === capability.task ? null : capability.task))
          }
          onChange={(patch) => updateCapability(capability.task, patch)}
          onRemove={() =>
            onChange((current) => ({
              ...current,
              capabilities: removeCapabilityTask(current.capabilities, capability.task),
            }))
          }
          onOpenAdvanced={() => {
            setAdvancedTask(capability.task);
            setExpandedTask(capability.task);
          }}
          onRequestConnection={onRequestConnection}
          t={t}
        />
      ))}

      {value.capabilities.length > 0 && availableTasks.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('editor.additionalTasks')}
          </Text>
          <View style={styles.chips}>
            {availableTasks.map((task) => (
              <Pressable
                key={task}
                accessibilityRole="button"
                disabled={controlsDisabled}
                {...a11yState({ disabled: controlsDisabled })}
                onPress={() => {
                  onChange((current) => ({
                    ...current,
                    capabilities: addCapabilityTask(current.capabilities, task),
                  }));
                  setExpandedTask(task);
                }}
                style={[
                  styles.chip,
                  { borderColor: colors.border, backgroundColor: colors.surface },
                ]}
              >
                <Text style={[styles.chipText, { color: colors.textSecondary }]}>
                  + {t(`task.${task}`)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function CapabilityCard({
  capability,
  expanded,
  simpleMode,
  advancedOpen,
  manifest,
  loading,
  loadFailed,
  providerBaseUrl,
  providerAuthScheme,
  connections,
  validationErrors,
  validationPending,
  disabled,
  canRemove,
  onToggle,
  onChange,
  onRemove,
  onOpenAdvanced,
  onRequestConnection,
  t,
}: {
  capability: ModelCapabilityDraft;
  expanded: boolean;
  simpleMode: boolean;
  advancedOpen: boolean;
  manifest?: ModelProtocolManifest;
  loading: boolean;
  loadFailed: boolean;
  providerBaseUrl: string;
  providerAuthScheme: string;
  connections: readonly ProviderConnectionDescriptor[];
  validationErrors: CapabilityValidationResult['errors'];
  validationPending: boolean;
  disabled: boolean;
  canRemove: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<ModelCapabilityDraft>) => void;
  onRemove: () => void;
  onOpenAdvanced: () => void;
  onRequestConnection?: (task: ModelTask, role: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const { colors } = useTheme();
  const { t: tc } = useTranslation('common');
  const descriptor = protocolDescriptorForDraft(capability, manifest);
  const effectiveUrl = effectiveBaseUrl(capability, manifest, providerBaseUrl, connections);
  const role = capability.connectionRole.trim() || 'default';
  const roleExists =
    role === 'default' || connections.some((connection) => connection.role === role);
  const authScheme =
    role === 'default'
      ? providerAuthScheme
      : (connections.find((connection) => connection.role === role)?.auth_scheme ?? '');
  const authCompatible =
    !descriptor ||
    !authScheme ||
    isProtocolAuthSchemeAllowed(authScheme, descriptor.allowed_auth_schemes);
  const endpointDescriptors =
    descriptor?.endpoints.filter(
      (endpoint) =>
        endpoint.task === capability.task &&
        (CAPABILITY_ENDPOINT_FIELDS as readonly string[]).includes(endpoint.field),
    ) ?? [];
  const rootShape = descriptor?.root_shape ?? endpointDescriptors[0]?.root_shape;
  const rootShapeMismatch =
    descriptor?.transport !== 'sdk' &&
    !!rootShape &&
    !!effectiveUrl.trim() &&
    !rootMatchesShape(effectiveUrl, rootShape);
  const endpointFields = new Set<CapabilityEndpointField>(
    endpointDescriptors.map((endpoint) => endpoint.field as CapabilityEndpointField),
  );
  // Preserve server-returned overrides even if a newer manifest no longer
  // advertises that field. An edit/save round-trip must not drop transport
  // configuration merely because the registry response changed.
  for (const field of CAPABILITY_ENDPOINT_FIELDS) {
    if (capability[endpointKey(field)].trim()) endpointFields.add(field);
  }
  if (endpointFields.size === 0 && descriptor?.transport !== 'sdk') {
    endpointFields.add(
      capability.task === 'realtime_conversation' ? 'realtime_endpoint' : 'endpoint',
    );
  }
  const hasError =
    validationErrors.length > 0 ||
    (!loading && (loadFailed || !manifest)) ||
    !authCompatible ||
    !roleExists;

  return (
    <View
      style={[
        styles.capability,
        {
          borderColor: hasError ? colors.danger : colors.border,
          backgroundColor: colors.surface,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        disabled={validationPending || disabled}
        {...a11yState({
          expanded: advancedOpen && expanded,
          disabled: validationPending || disabled,
        })}
        onPress={
          validationPending || disabled
            ? undefined
            : simpleMode && !advancedOpen
              ? onOpenAdvanced
              : onToggle
        }
        style={styles.capabilityHeader}
      >
        <View style={styles.flex}>
          <View style={styles.taskTitleLine}>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              {t(`task.${capability.task}`)}
            </Text>
            <Tag tone={hasError ? 'danger' : validationPending || loading ? 'warning' : 'success'}>
              {hasError
                ? t('editor.needsAttention')
                : validationPending || loading
                  ? t('editor.preparing')
                  : t('editor.ready')}
            </Tag>
          </View>
          <Text style={[styles.hint, { color: colors.textTertiary }]} numberOfLines={2}>
            {capability.protocol || t('editor.protocolPending')} · {role} ·{' '}
            {effectiveUrl || t('editor.baseUrlPending')}
          </Text>
        </View>
        <Ionicons
          name={
            simpleMode && !advancedOpen
              ? 'chevron-forward'
              : expanded
                ? 'chevron-up'
                : 'chevron-down'
          }
          size={18}
          color={colors.textTertiary}
        />
      </Pressable>

      {simpleMode && !advancedOpen ? (
        <View style={[styles.compactBody, { borderTopColor: colors.border }]}>
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {hasError ? t('editor.compactNeedsAttention') : t('editor.compactAutoConfigured')}
          </Text>
          <Button small variant="secondary" disabled={disabled} onPress={onOpenAdvanced}>
            {t('editor.openAdvanced')}
          </Button>
        </View>
      ) : expanded ? (
        <View style={[styles.capabilityBody, { borderTopColor: colors.border }]}>
          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
            {t('editor.protocol')}
          </Text>
          {manifest?.protocols.length ? (
            <View style={styles.chips}>
              {manifest.protocols.map((protocol) => {
                const active = capability.protocol === protocol.protocol_id;
                return (
                  <Pressable
                    key={protocol.protocol_id}
                    accessibilityRole="button"
                    disabled={loading || validationPending || disabled}
                    {...a11yState({
                      selected: active,
                      disabled: loading || validationPending || disabled,
                    })}
                    onPress={() =>
                      onChange(changeCapabilityProtocol(capability, protocol.protocol_id, manifest))
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
                      {protocol.protocol_id}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Text style={[styles.hint, { color: colors.danger }]}>
              {loading ? tc('state.loading') : t('editor.noProtocol')}
            </Text>
          )}
          <TextField
            label={t('editor.protocolManual')}
            value={capability.protocol}
            editable={!disabled}
            onChangeText={(protocol) =>
              onChange(changeCapabilityProtocol(capability, protocol, manifest))
            }
            placeholder={t('editor.protocolPlaceholder')}
            error={
              validationErrors.some((error) =>
                ['protocol_required', 'protocol_not_registered', 'protocol_wrong_task'].includes(
                  error.code,
                ),
              )
                ? t('editor.protocolInvalid')
                : undefined
            }
          />

          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
            {t('editor.connectionRole')}
          </Text>
          <View style={styles.chips}>
            {['default', ...connections.map((connection) => connection.role)]
              .filter((candidate, index, candidates) => candidates.indexOf(candidate) === index)
              .map((candidate) => {
                const active = role === candidate;
                return (
                  <Pressable
                    key={candidate}
                    accessibilityRole="button"
                    disabled={validationPending || disabled}
                    {...a11yState({ selected: active, disabled: validationPending || disabled })}
                    onPress={() => onChange({ connectionRole: candidate })}
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
                      {candidate}
                    </Text>
                  </Pressable>
                );
              })}
          </View>
          <TextField
            label={t('editor.connectionRoleManual')}
            value={capability.connectionRole}
            editable={!disabled}
            onChangeText={(connectionRole) => onChange({ connectionRole })}
            error={!roleExists ? t('editor.connectionMissing') : undefined}
          />
          {!roleExists && onRequestConnection ? (
            <Button
              small
              variant="secondary"
              disabled={disabled}
              onPress={() => onRequestConnection(capability.task, role)}
            >
              {t('editor.createConnection')}
            </Button>
          ) : null}

          {descriptor?.transport !== 'sdk' ? (
            <>
              <TextField
                label={t('editor.baseUrlOverride')}
                value={capability.baseUrlOverride}
                editable={!disabled}
                onChangeText={(baseUrlOverride) => onChange({ baseUrlOverride })}
                placeholder={effectiveUrl || providerBaseUrl}
                keyboardType="url"
                hint={t('editor.baseUrlHint')}
              />
              {rootShape ? (
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {rootShape === 'versioned_root'
                    ? t('editor.rootShapeVersioned')
                    : t('editor.rootShapeOrigin')}
                </Text>
              ) : null}
              {rootShapeMismatch ? (
                <Text style={[styles.hint, { color: colors.warning }]}>
                  {rootShape === 'versioned_root'
                    ? t('editor.rootShapeMismatchVersioned')
                    : t('editor.rootShapeMismatchOrigin')}
                </Text>
              ) : null}
            </>
          ) : (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              {t('editor.sdkTransport')}
            </Text>
          )}

          {[...endpointFields].map((field) => {
            const key = endpointKey(field);
            const endpointDescriptor =
              endpointDescriptors.find((endpoint) => endpoint.field === field) ??
              fallbackEndpointDescriptor(field, capability.task);
            const overrideValue = capability[key];
            const resolvedUrl = resolvedCapabilityUrl(
              capability,
              endpointDescriptor,
              manifest,
              providerBaseUrl,
              connections,
            );
            return (
              <View key={field} style={styles.endpointField}>
                <TextField
                  label={endpointLabel(field, capability.task, t)}
                  value={overrideValue}
                  onChangeText={(next) => onChange({ [key]: next })}
                  placeholder={endpointDescriptorValue(capability, endpointDescriptor)}
                  editable={endpointDescriptor.editable && !disabled}
                  keyboardType="url"
                  hint={endpointDescriptor.method ?? undefined}
                />
                {resolvedUrl ? (
                  <Text style={[styles.hint, { color: colors.textTertiary }]} numberOfLines={3}>
                    {t('editor.resolvedUrl')}: {resolvedUrl}
                  </Text>
                ) : null}
              </View>
            );
          })}

          <Text style={[styles.subLabel, { color: colors.textSecondary }]}>
            {t('editor.traits')}
          </Text>
          <View style={styles.chips}>
            {MODEL_TRAIT_ORDER.map((trait) => {
              const active = capability.traits.includes(trait);
              return (
                <Pressable
                  key={trait}
                  accessibilityRole="checkbox"
                  disabled={validationPending || disabled}
                  {...a11yState({ checked: active, disabled: validationPending || disabled })}
                  onPress={() =>
                    onChange({
                      traits: sortTraits(
                        active
                          ? capability.traits.filter((item) => item !== trait)
                          : [...capability.traits, trait],
                      ),
                    })
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
                    {t(`trait.${trait}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <TextField
            label={t('editor.contextLimit')}
            value={capability.contextLimit ? String(capability.contextLimit) : ''}
            editable={!disabled}
            onChangeText={(raw) => {
              const parsed = Number(raw);
              onChange({
                contextLimit:
                  raw.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
              });
            }}
            keyboardType="numeric"
          />
          {descriptor?.requires_output_ceiling === true || capability.outputLimit !== undefined ? (
            <TextField
              label={t('editor.outputLimit')}
              value={capability.outputLimit ? String(capability.outputLimit) : ''}
              editable={!disabled}
              onChangeText={(raw) => {
                const parsed = Number(raw);
                onChange({
                  outputLimit:
                    raw.trim() && Number.isFinite(parsed) && parsed > 0 ? parsed : undefined,
                });
              }}
              keyboardType="numeric"
              hint={
                descriptor?.requires_output_ceiling ? t('editor.outputLimitRequired') : undefined
              }
              error={
                validationErrors.some((error) => error.code === 'output_ceiling_required')
                  ? t('editor.outputLimitRequired')
                  : undefined
              }
            />
          ) : null}
          <TextField
            label={t('editor.providerParams')}
            value={capability.providerParamsJson}
            editable={!disabled}
            onChangeText={(providerParamsJson) => onChange({ providerParamsJson })}
            placeholder={'{\n  "voice": "alloy"\n}'}
            multiline
            numberOfLines={4}
            error={
              !parseProviderParams(capability.providerParamsJson).ok
                ? t('editor.providerParamsInvalid')
                : undefined
            }
            hint={t('editor.providerParamsHint')}
          />

          {requiresCrossOriginConsent(capability, manifest, providerBaseUrl, connections) ? (
            <View style={[styles.consent, { backgroundColor: colors.warningSoft }]}>
              <View style={styles.switchLine}>
                <View style={styles.flex}>
                  <Text style={[styles.modelText, { color: colors.text }]}>
                    {t('editor.crossOriginConsent')}
                  </Text>
                  <Text style={[styles.hint, { color: colors.warning }]}>
                    {t('editor.crossOriginConsentHint')}
                  </Text>
                </View>
                <Toggle
                  value={capability.allowCrossOriginCredentials}
                  disabled={disabled}
                  accessibilityLabel={t('editor.crossOriginConsent')}
                  onValueChange={(allowCrossOriginCredentials) =>
                    onChange({ allowCrossOriginCredentials })
                  }
                />
              </View>
            </View>
          ) : null}

          {!authCompatible ? (
            <Text style={[styles.hint, { color: colors.danger }]}>
              {t('editor.authIncompatible', { auth: authScheme })}
            </Text>
          ) : null}
          {validationErrors.length > 0 ? (
            <Text style={[styles.hint, { color: colors.danger }]}>
              {t('editor.validationSummary')}
            </Text>
          ) : null}
          {canRemove ? (
            <Button small variant="danger" disabled={disabled} onPress={onRemove}>
              {t('editor.removeTask')}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.lg },
  section: { gap: Spacing.sm },
  flex: { flex: 1, gap: 2 },
  label: { fontSize: FontSize.sm, fontWeight: '600' },
  subLabel: { fontSize: FontSize.sm, fontWeight: '600', marginTop: Spacing.xs },
  sectionTitle: { fontSize: FontSize.md, fontWeight: '700' },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
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
  catalogCard: { gap: Spacing.sm },
  catalogHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  catalogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
  },
  modelText: { fontSize: FontSize.sm, fontWeight: '600' },
  catalogId: { fontSize: FontSize.xs },
  capability: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  capabilityHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    minHeight: 64,
  },
  taskTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: Spacing.xs },
  capabilityBody: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  endpointField: { gap: 2 },
  compactBody: {
    gap: Spacing.sm,
    padding: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  switchLine: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  consent: { borderRadius: Radius.md, padding: Spacing.md },
});
