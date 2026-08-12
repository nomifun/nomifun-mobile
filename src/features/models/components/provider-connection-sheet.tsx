import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  AUTH_SCHEME_PRESETS,
  buildConnectionCredentials,
  credentialsKindForScheme,
  isValidConnectionRole,
  type ConnectionCredentialsDraft,
} from '@/features/models/connection-form';
import { saveProviderConnection } from '@/features/models/api';
import { errorMessage } from '@/features/models/errors';
import { Sheet } from './sheet';
import type { ProviderConnectionResponse } from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

const CUSTOM_SCHEME = '__custom__';

const EMPTY_CREDENTIALS: ConnectionCredentialsDraft = {
  apiKeysText: '',
  appKey: '',
  accessKey: '',
  resourceId: '',
  rawJson: '',
};

export interface ProviderConnectionSheetProps {
  visible: boolean;
  providerId: string;
  editing?: ProviderConnectionResponse;
  prefillRole?: string;
  prefillBaseUrl?: string;
  prefillScheme?: string;
  onClose: () => void;
  onSaved: (connection: ProviderConnectionResponse) => void;
}

/**
 * Mobile counterpart of the desktop connection drawer. Secrets are
 * write-only: editing an existing row starts with an empty credential form,
 * and an empty submission omits `credentials` so the server keeps its value.
 */
export function ProviderConnectionSheet({
  visible,
  providerId,
  editing,
  prefillRole,
  prefillBaseUrl,
  prefillScheme,
  onClose,
  onSaved,
}: ProviderConnectionSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const isEdit = !!editing;

  const initialScheme = editing?.auth_scheme ?? prefillScheme ?? 'bearer';
  const initialIsPreset = (AUTH_SCHEME_PRESETS as readonly string[]).includes(initialScheme);

  const [role, setRole] = useState('');
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [schemeChoice, setSchemeChoice] = useState<string>('bearer');
  const [customScheme, setCustomScheme] = useState('');
  const [credentials, setCredentials] =
    useState<ConnectionCredentialsDraft>(EMPTY_CREDENTIALS);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const scheme = schemeChoice === CUSTOM_SCHEME ? customScheme.trim() : schemeChoice;
  const credentialsKind = credentialsKindForScheme(scheme || 'bearer');

  useEffect(() => {
    if (!visible) return;
    const nextScheme = editing?.auth_scheme ?? prefillScheme ?? 'bearer';
    const preset = (AUTH_SCHEME_PRESETS as readonly string[]).includes(nextScheme);
    setRole(editing?.role ?? prefillRole ?? '');
    setLabel(editing?.label ?? '');
    setBaseUrl(editing?.base_url ?? prefillBaseUrl ?? '');
    setSchemeChoice(preset ? nextScheme : CUSTOM_SCHEME);
    setCustomScheme(preset ? '' : nextScheme);
    setCredentials(EMPTY_CREDENTIALS);
    setSaving(false);
    setError('');
  }, [editing, prefillBaseUrl, prefillRole, prefillScheme, visible]);

  const schemeOptions = useMemo(
    () => [
      ...AUTH_SCHEME_PRESETS,
      ...(schemeChoice === CUSTOM_SCHEME &&
      customScheme.trim() &&
      !(AUTH_SCHEME_PRESETS as readonly string[]).includes(customScheme.trim())
        ? [customScheme.trim()]
        : []),
    ],
    [customScheme, schemeChoice],
  );

  const save = async () => {
    const nextRole = role.trim();
    if (!isEdit && !isValidConnectionRole(nextRole)) {
      setError(t('connections.roleInvalid'));
      return;
    }
    if (!isEdit && nextRole === 'default') {
      setError(t('connections.roleInvalid'));
      return;
    }
    if (!baseUrl.trim()) {
      setError(t('connections.baseUrlRequired'));
      return;
    }
    if (!scheme) {
      setError(t('connections.authSchemeRequired'));
      return;
    }

    const built = buildConnectionCredentials(scheme, credentials);
    if (!built.ok) {
      setError(
        built.error === 'volc_incomplete'
          ? t('connections.volcIncomplete')
          : t('connections.invalidCredentialsJson'),
      );
      return;
    }
    if (built.credentials === undefined && (!isEdit || editing?.has_credentials !== true)) {
      setError(t('connections.credentialsRequired'));
      return;
    }

    setSaving(true);
    setError('');
    try {
      const saved = await saveProviderConnection(providerId, {
        role: nextRole,
        label: label.trim() || undefined,
        base_url: baseUrl.trim(),
        auth_scheme: scheme,
        ...(built.credentials === undefined ? {} : { credentials: built.credentials }),
        ...(isEdit && editing?.extra !== undefined ? { extra: editing.extra } : {}),
      });
      onSaved(saved);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      title={isEdit ? t('connections.edit') : t('connections.add')}
      closeDisabled={saving}
      onClose={() => {
        if (!saving) onClose();
      }}
      footer={
        <Button onPress={() => void save()} loading={saving}>
          {tc('actions.save')}
        </Button>
      }
    >
      <TextField
        label={t('connections.role')}
        value={role}
        onChangeText={setRole}
        editable={!isEdit && !saving}
        placeholder="voice"
        hint={!isEdit ? t('connections.roleHint') : undefined}
        error={error && !isValidConnectionRole(role.trim()) ? error : undefined}
      />
      <TextField
        label={t('connections.label')}
        value={label}
        editable={!saving}
        onChangeText={setLabel}
        placeholder={t('connections.labelPlaceholder')}
      />
      <TextField
        label={t('connections.baseUrl')}
        value={baseUrl}
        editable={!saving}
        onChangeText={setBaseUrl}
        placeholder="https://example.com"
        keyboardType="url"
        error={error === t('connections.baseUrlRequired') ? error : undefined}
      />

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('connections.authScheme')}
      </Text>
      <View style={styles.chips}>
        {schemeOptions.map((option) => {
          const active = schemeChoice === option;
          return (
            <Pressable
              key={option}
              accessibilityRole="button"
              disabled={saving}
              {...a11yState({ selected: active, disabled: saving })}
              onPress={() => {
                setSchemeChoice(option);
                if (option !== CUSTOM_SCHEME) setCustomScheme('');
                setError('');
              }}
              style={[
                styles.chip,
                {
                  borderColor: active ? colors.primary : colors.border,
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                },
              ]}
            >
              <Text style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          accessibilityRole="button"
          disabled={saving}
          {...a11yState({ selected: schemeChoice === CUSTOM_SCHEME, disabled: saving })}
          onPress={() => {
            setSchemeChoice(CUSTOM_SCHEME);
            setError('');
          }}
          style={[
            styles.chip,
            {
              borderColor: schemeChoice === CUSTOM_SCHEME ? colors.primary : colors.border,
              backgroundColor:
                schemeChoice === CUSTOM_SCHEME ? colors.primarySoft : colors.surface,
            },
          ]}
        >
          <Text
            style={[
              styles.chipText,
              { color: schemeChoice === CUSTOM_SCHEME ? colors.primary : colors.textSecondary },
            ]}
          >
            {t('connections.authSchemeCustom')}
          </Text>
        </Pressable>
      </View>
      {schemeChoice === CUSTOM_SCHEME ? (
        <TextField
          label={t('connections.authSchemeCustom')}
          value={customScheme}
          editable={!saving}
          onChangeText={(value) => {
            setCustomScheme(value);
            setError('');
          }}
          placeholder={t('connections.authSchemeCustomPlaceholder')}
        />
      ) : null}

      <Text style={[styles.label, { color: colors.textSecondary }]}>
        {t('connections.credentials')}
      </Text>
      {credentialsKind === 'api_keys' ? (
        <TextField
          value={credentials.apiKeysText}
          editable={!saving}
          onChangeText={(apiKeysText) =>
            setCredentials((current) => ({ ...current, apiKeysText }))
          }
          placeholder={t('connections.apiKeys')}
          multiline
          numberOfLines={3}
          secureTextEntry
          hint={isEdit ? t('connections.keepCredentialsHint') : undefined}
        />
      ) : null}
      {credentialsKind === 'volc_voice' ? (
        <View style={styles.credentialGroup}>
          <TextField
            value={credentials.appKey}
            editable={!saving}
            onChangeText={(appKey) => setCredentials((current) => ({ ...current, appKey }))}
            placeholder={t('connections.volcAppKey')}
            secureTextEntry
          />
          <TextField
            value={credentials.accessKey}
            editable={!saving}
            onChangeText={(accessKey) =>
              setCredentials((current) => ({ ...current, accessKey }))
            }
            placeholder={t('connections.volcAccessKey')}
            secureTextEntry
          />
          <TextField
            value={credentials.resourceId}
            editable={!saving}
            onChangeText={(resourceId) =>
              setCredentials((current) => ({ ...current, resourceId }))
            }
            placeholder={t('connections.volcResourceId')}
          />
        </View>
      ) : null}
      {credentialsKind === 'custom' ? (
        <TextField
          value={credentials.rawJson}
          editable={!saving}
          onChangeText={(rawJson) => setCredentials((current) => ({ ...current, rawJson }))}
          placeholder={t('connections.rawCredentials')}
          multiline
          numberOfLines={5}
          hint={isEdit ? t('connections.keepCredentialsHint') : undefined}
        />
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>
          {error}
        </Text>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.md },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: FontSize.sm, fontWeight: '600' },
  credentialGroup: { gap: Spacing.xs },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginBottom: Spacing.sm },
});
