import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createProvider, detectProtocol, fetchModelsAnonymous } from '@/features/models/api';
import { Sheet } from '@/features/models/components/sheet';
import { errorMessage } from '@/features/models/errors';
import {
  PLATFORM_PRESETS,
  apiKeyCount,
  isHttpUrl,
  platformHasNoModelsEndpoint,
} from '@/features/models/platforms';
import type { ModelInfo, ProtocolDetectionResponse } from '@/features/models/types';

const MAX_VISIBLE_MODELS = 40;

interface AddProviderSheetProps {
  visible: boolean;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Simple add-provider form. The desktop wizard (996 lines) also does protocol
 * auto-detection on a 1 s type debounce, per-key testing and first-model
 * tagging; here the probe is an explicit button (mobile keyboards + debounce =
 * a probe per keystroke) and tagging is left to the server heuristic.
 */
export function AddProviderSheet({ visible, onClose, onCreated }: AddProviderSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const [presetIndex, setPresetIndex] = useState(0);
  const preset = PLATFORM_PRESETS[presetIndex];
  const [name, setName] = useState(PLATFORM_PRESETS[0].label);
  const [baseUrl, setBaseUrl] = useState(PLATFORM_PRESETS[0].baseUrl);
  const [apiKey, setApiKey] = useState('');
  const [revealKey, setRevealKey] = useState(false);

  const [testing, setTesting] = useState(false);
  const [detection, setDetection] = useState<ProtocolDetectionResponse | null>(null);
  const [catalog, setCatalog] = useState<ModelInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [manualModel, setManualModel] = useState('');
  const [testError, setTestError] = useState('');
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const noCatalogEndpoint = platformHasNoModelsEndpoint(preset.platform);
  const keyCount = apiKeyCount(apiKey);

  const reset = () => {
    setPresetIndex(0);
    setName(PLATFORM_PRESETS[0].label);
    setBaseUrl(PLATFORM_PRESETS[0].baseUrl);
    setApiKey('');
    setRevealKey(false);
    setDetection(null);
    setCatalog(null);
    setQuery('');
    setSelected([]);
    setManualModel('');
    setTestError('');
    setFormError('');
  };

  const close = () => {
    reset();
    onClose();
  };

  const pickPreset = (index: number) => {
    const next = PLATFORM_PRESETS[index];
    setPresetIndex(index);
    setName(next.requiresName ? '' : next.label);
    setBaseUrl(next.baseUrl);
    setDetection(null);
    setCatalog(null);
    setSelected([]);
    setTestError('');
    setFormError('');
  };

  const validate = (): boolean => {
    if (!name.trim()) {
      setFormError(t('provider.nameRequired'));
      return false;
    }
    if (!isHttpUrl(baseUrl)) {
      setFormError(t('provider.baseUrlInvalid'));
      return false;
    }
    if (!apiKey.trim()) {
      setFormError(t('add.keyRequired'));
      return false;
    }
    setFormError('');
    return true;
  };

  const runTest = async () => {
    if (!validate()) return;
    setTesting(true);
    setTestError('');
    setDetection(null);
    try {
      if (!noCatalogEndpoint) {
        const result = await detectProtocol({
          base_url: baseUrl.trim(),
          api_key: apiKey.trim(),
          test_all_keys: keyCount > 1,
        });
        setDetection(result);
      }
      const models = await fetchModelsAnonymous({
        platform: preset.platform,
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
      });
      setCatalog(models.models);
      if (models.models.length === 0) setTestError(t('models.fetchFailed'));
    } catch (err) {
      setTestError(errorMessage(err, t('test.failed')));
    } finally {
      setTesting(false);
    }
  };

  const toggleModel = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]));
  };

  const addManual = () => {
    const id = manualModel.trim();
    if (!id) return;
    if (!selected.includes(id)) setSelected((prev) => [...prev, id]);
    setManualModel('');
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      await createProvider({
        platform: preset.platform,
        name: name.trim(),
        base_url: baseUrl.trim(),
        api_key: apiKey.trim(),
        models: selected,
      });
      toast.success(t('add.created', { name: name.trim() }));
      reset();
      onCreated();
    } catch (err) {
      setFormError(t('add.createFailed', { message: errorMessage(err, tc('feedback.requestFailed')) }));
    } finally {
      setSaving(false);
    }
  };

  const filtered = (catalog ?? []).filter((m) =>
    query.trim() ? m.id.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );
  const visibleModels = filtered.slice(0, MAX_VISIBLE_MODELS);

  return (
    <Sheet
      visible={visible}
      title={t('add.title')}
      onClose={close}
      footer={
        <Button onPress={save} loading={saving}>
          {t('add.submit')}
        </Button>
      }
    >
      <Text style={[styles.label, { color: colors.textSecondary }]}>{t('add.platform')}</Text>
      <View style={styles.chips}>
        {PLATFORM_PRESETS.map((item, index) => {
          const active = index === presetIndex;
          return (
            <Pressable
              key={`${item.platform}-${item.label}`}
              accessibilityRole="button"
              onPress={() => pickPreset(index)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? colors.primarySoft : colors.surface,
                  borderColor: active ? colors.primary : colors.border,
                },
              ]}
            >
              <Text
                style={[styles.chipText, { color: active ? colors.primary : colors.textSecondary }]}
              >
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('add.platformHint')}</Text>

      <View style={styles.spacer} />
      <TextField
        label={t('provider.name')}
        value={name}
        onChangeText={setName}
        hint={t('add.nameHint')}
        placeholder={preset.label}
      />
      <TextField
        label={t('provider.baseUrl')}
        value={baseUrl}
        onChangeText={setBaseUrl}
        placeholder="https://api.example.com/v1"
        keyboardType="url"
        autoComplete="off"
      />
      <TextField
        label={t('provider.apiKey')}
        value={apiKey}
        onChangeText={setApiKey}
        placeholder={t('provider.apiKeyPlaceholder')}
        secureTextEntry={!revealKey}
        multiline={revealKey}
        autoComplete="off"
        hint={keyCount > 1 ? t('provider.apiKeyMasked', { count: keyCount }) : t('provider.apiKeyEditHint')}
      />
      <Pressable accessibilityRole="button" onPress={() => setRevealKey((v) => !v)} hitSlop={8}>
        <Text style={[styles.link, { color: colors.primary }]}>
          {revealKey ? t('provider.hide') : t('provider.reveal')}
        </Text>
      </Pressable>

      <View style={styles.spacer} />
      <Button variant="secondary" onPress={runTest} loading={testing}>
        {testing ? t('test.testing') : t('add.fetchAndTest')}
      </Button>
      {noCatalogEndpoint ? (
        <Text style={[styles.hint, { color: colors.warning }]}>{t('test.skipHint')}</Text>
      ) : null}
      {detection ? (
        <View style={[styles.result, { borderColor: colors.border, backgroundColor: colors.surface }]}>
          <Text
            style={[
              styles.resultTitle,
              { color: detection.success ? colors.success : colors.danger },
            ]}
          >
            {detection.success ? t('test.success', { protocol: detection.protocol }) : t('test.failed')}
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
            <Pressable
              accessibilityRole="button"
              onPress={() => setBaseUrl(detection.fixed_base_url ?? baseUrl)}
            >
              <Text style={[styles.link, { color: colors.primary }]}>
                {t('test.fixedBaseUrl', { url: detection.fixed_base_url })}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {testError ? <Text style={[styles.error, { color: colors.danger }]}>{testError}</Text> : null}

      {catalog ? (
        <>
          <View style={styles.spacer} />
          <Text style={[styles.label, { color: colors.textSecondary }]}>
            {t('add.pickModels')} · {t('add.selected', { count: selected.length })}
          </Text>
          <TextField
            value={query}
            onChangeText={setQuery}
            placeholder={tc('actions.search')}
            autoComplete="off"
          />
          {visibleModels.map((item) => {
            const active = selected.includes(item.id);
            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                onPress={() => toggleModel(item.id)}
                style={({ pressed }) => [
                  styles.modelRow,
                  {
                    borderColor: colors.border,
                    backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={active ? colors.primary : colors.textTertiary}
                />
                <Text style={[styles.modelName, { color: colors.text }]} numberOfLines={1}>
                  {item.id}
                </Text>
              </Pressable>
            );
          })}
          {filtered.length > visibleModels.length ? (
            <Text style={[styles.hint, { color: colors.textTertiary }]}>
              {t('add.moreModels', { count: filtered.length - visibleModels.length })}
            </Text>
          ) : null}
        </>
      ) : null}

      <View style={styles.spacer} />
      <Text style={[styles.label, { color: colors.textSecondary }]}>{t('models.addManual')}</Text>
      <View style={styles.manualRow}>
        <View style={styles.manualField}>
          <TextField
            value={manualModel}
            onChangeText={setManualModel}
            placeholder={t('models.modelId')}
            autoComplete="off"
            onSubmitEditing={addManual}
          />
        </View>
        <Button small variant="secondary" onPress={addManual} disabled={!manualModel.trim()}>
          {tc('actions.create')}
        </Button>
      </View>
      {selected.length > 0 ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          {t('add.selectedList', { models: selected.join('、') })}
        </Text>
      ) : (
        <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('add.pickModelsHint')}</Text>
      )}

      {formError ? <Text style={[styles.error, { color: colors.danger }]}>{formError}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  link: { fontSize: FontSize.sm, fontWeight: '600', paddingVertical: Spacing.xs },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.xs },
  spacer: { height: Spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginBottom: Spacing.xs },
  chip: {
    borderWidth: 1,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: 8,
    minHeight: 36,
    justifyContent: 'center',
  },
  chipText: { fontSize: FontSize.sm, fontWeight: '600' },
  result: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: 4,
  },
  resultTitle: { fontSize: FontSize.sm, fontWeight: '700' },
  modelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 46,
    marginBottom: Spacing.xs,
  },
  modelName: { flex: 1, fontSize: FontSize.sm },
  manualRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  manualField: { flex: 1 },
});
