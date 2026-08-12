import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { updateProvider } from '@/features/models/api';
import {
  buildBedrockConfig,
  buildProviderCredentials,
  type BedrockAuthMethod,
} from '@/features/models/connection-form';
import { errorMessage } from '@/features/models/errors';
import { isHttpUrl } from '@/features/models/platforms';
import { Sheet } from './sheet';
import type { ProviderResponse } from '@/features/models/types';

const BEDROCK_AUTH_METHODS: readonly BedrockAuthMethod[] = [
  'accessKey',
  'profile',
  'defaultChain',
];

export interface ProviderEditSheetProps {
  visible: boolean;
  provider: ProviderResponse | null;
  onClose: () => void;
  onSaved: (provider: ProviderResponse) => void;
}

/**
 * Provider metadata editor. It deliberately never tries to display a stored
 * secret: the backend only exposes `has_credentials`, and an empty update
 * keeps that encrypted value intact.
 */
export function ProviderEditSheet({
  visible,
  provider,
  onClose,
  onSaved,
}: ProviderEditSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [authScheme, setAuthScheme] = useState('');
  const [apiKeysText, setApiKeysText] = useState('');
  const [bedrockAuthMethod, setBedrockAuthMethod] =
    useState<BedrockAuthMethod>('accessKey');
  const [bedrockRegion, setBedrockRegion] = useState('us-east-1');
  const [bedrockProfile, setBedrockProfile] = useState('');
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [sessionToken, setSessionToken] = useState('');
  const [revealSecrets, setRevealSecrets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const isBedrock = provider?.platform === 'bedrock';

  useEffect(() => {
    if (!visible || !provider) return;
    setName(provider.name);
    setBaseUrl(provider.base_url);
    setAuthScheme(provider.auth_scheme);
    setApiKeysText('');
    setBedrockAuthMethod(provider.bedrock_config?.auth_method ?? 'accessKey');
    setBedrockRegion(provider.bedrock_config?.region ?? 'us-east-1');
    setBedrockProfile(provider.bedrock_config?.profile ?? '');
    setAccessKeyId('');
    setSecretAccessKey('');
    setSessionToken('');
    setRevealSecrets(false);
    setSaving(false);
    setError('');
  }, [provider, visible]);

  const save = async () => {
    if (!provider || saving) return;
    const trimmedName = name.trim();
    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedName) {
      setError(t('provider.nameRequired'));
      return;
    }
    if (!isBedrock && !isHttpUrl(trimmedBaseUrl)) {
      setError(t('provider.baseUrlInvalid'));
      return;
    }
    if (!authScheme.trim()) {
      setError(t('provider.authSchemeRequired'));
      return;
    }
    if (isBedrock && !bedrockRegion.trim()) {
      setError(t('add.bedrockRegionRequired'));
      return;
    }
    if (isBedrock && bedrockAuthMethod === 'profile' && !bedrockProfile.trim()) {
      setError(t('add.bedrockProfileRequired'));
      return;
    }

    const credentialBuild = buildProviderCredentials({
      isBedrock: !!isBedrock,
      mode: 'update',
      hasStoredCredentials: provider.has_credentials,
      apiKeysText,
      bedrockAuthMethod,
      accessKeyId,
      secretAccessKey,
      sessionToken,
    });
    if (!credentialBuild.ok) {
      const message =
        credentialBuild.error === 'api_keys_required'
          ? t('provider.credentialsRequired')
          : credentialBuild.error === 'bedrock_access_keys_incomplete'
            ? t('provider.bedrockAccessKeysIncomplete')
            : credentialBuild.error === 'bedrock_access_keys_required'
              ? t('provider.bedrockCredentialsRequired')
              : t('provider.bedrockAuthMethodRequired');
      setError(message);
      return;
    }

    setSaving(true);
    setError('');
    try {
      const updated = await updateProvider(provider.provider_id, {
        name: trimmedName,
        base_url: isBedrock ? '' : trimmedBaseUrl,
        auth_scheme: authScheme.trim(),
        ...(credentialBuild.credentials === undefined
          ? {}
          : { credentials: credentialBuild.credentials }),
        ...(isBedrock
          ? {
              bedrock_config: buildBedrockConfig(
                bedrockAuthMethod,
                bedrockRegion,
                bedrockProfile,
              ),
            }
          : {}),
      });
      onSaved(updated);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason, tc('feedback.requestFailed')));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet
      visible={visible && !!provider}
      title={t('provider.edit')}
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
        label={t('provider.name')}
        value={name}
        editable={!saving}
        onChangeText={setName}
      />
      {!isBedrock ? (
        <TextField
          label={t('provider.baseUrl')}
          value={baseUrl}
          editable={!saving}
          onChangeText={setBaseUrl}
          keyboardType="url"
          error={error === t('provider.baseUrlInvalid') ? error : undefined}
        />
      ) : null}
      <TextField
        label={t('provider.authScheme')}
        value={authScheme}
        editable={!saving}
        onChangeText={setAuthScheme}
        placeholder="bearer / header_key:x-api-key"
      />

      {isBedrock ? (
        <>
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('provider.bedrockAuthMethod')}
          </Text>
          <View style={styles.chips}>
            {BEDROCK_AUTH_METHODS.map((method) => {
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
          <TextField
            label={t('provider.bedrockRegion')}
            value={bedrockRegion}
            editable={!saving}
            onChangeText={setBedrockRegion}
            placeholder="us-east-1"
          />
          {bedrockAuthMethod === 'profile' ? (
            <TextField
              label={t('provider.bedrockProfile')}
              value={bedrockProfile}
              editable={!saving}
              onChangeText={setBedrockProfile}
              placeholder="default"
            />
          ) : null}
          {bedrockAuthMethod === 'accessKey' ? (
            <>
              <TextField
                label={t('provider.bedrockAccessKeyId')}
                value={accessKeyId}
                editable={!saving}
                onChangeText={setAccessKeyId}
                secureTextEntry={!revealSecrets}
                hint={provider.has_credentials ? t('provider.keepCredentialsHint') : undefined}
              />
              <TextField
                label={t('provider.bedrockSecretAccessKey')}
                value={secretAccessKey}
                editable={!saving}
                onChangeText={setSecretAccessKey}
                secureTextEntry={!revealSecrets}
              />
              <TextField
                label={t('provider.bedrockSessionToken')}
                value={sessionToken}
                editable={!saving}
                onChangeText={setSessionToken}
                secureTextEntry={!revealSecrets}
              />
            </>
          ) : null}
        </>
      ) : (
        <>
          <TextField
            label={t('provider.apiKey')}
            value={apiKeysText}
            editable={!saving}
            onChangeText={setApiKeysText}
            placeholder={
              provider?.has_credentials
                ? t('provider.apiKeyMasked', { count: 1 })
                : t('provider.apiKeyPlaceholder')
            }
            secureTextEntry={!revealSecrets}
            multiline={revealSecrets}
            hint={t('provider.apiKeyEditHint')}
          />
        </>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={saving}
        {...a11yState({ disabled: saving })}
        onPress={() => setRevealSecrets((current) => !current)}
        hitSlop={8}
      >
        <Text style={[styles.link, { color: colors.primary }]}>
          {revealSecrets ? t('provider.hide') : t('provider.reveal')}
        </Text>
      </Pressable>
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
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
  link: { fontSize: FontSize.sm, fontWeight: '600', paddingVertical: Spacing.xs },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginBottom: Spacing.sm },
});
