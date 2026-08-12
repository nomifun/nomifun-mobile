import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, TextField } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { fetchProviderModels } from '@/features/models/api';
import { Sheet } from '@/features/models/components/sheet';
import { errorMessage } from '@/features/models/errors';
import { platformHasNoModelsEndpoint } from '@/features/models/platforms';
import type { ModelInfo } from '@/features/models/types';
import { a11yState } from '@/utils/a11y';
import { AddProviderModelEditor } from './add-provider-model-editor';

const MAX_VISIBLE_MODELS = 40;

interface AddModelSheetProps {
  visible: boolean;
  providerId: string;
  platform: string;
  /** Manifest lookup preset; runtime `platform` is kept separate. */
  manifestPreset?: string;
  providerBaseUrl?: string;
  providerAuthScheme?: string;
  /** Model ids already in the catalog — shown as 已添加, not addable twice. */
  existing: string[];
  onClose: () => void;
  onAdded: () => void;
}

/**
 * Adds one catalog row at a time via the provider-models API, never by
 * PUTting the whole `models` array back onto the provider (that is the
 * read-modify-write race the desktop deliberately moved away from).
 */
export function AddModelSheet({
  visible,
  providerId,
  platform,
  manifestPreset = platform,
  providerBaseUrl = '',
  providerAuthScheme = '',
  existing,
  onClose,
  onAdded,
}: AddModelSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const [catalog, setCatalog] = useState<ModelInfo[] | null>(null);
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState('');
  const [added, setAdded] = useState<string[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<ModelInfo | undefined>();
  const catalogRequestRef = useRef(0);

  // Ignore a provider catalog response that finishes after the sheet closes.
  // Without this guard it can hydrate the next draft when the sheet reopens.
  useEffect(() => {
    if (!visible) {
      catalogRequestRef.current += 1;
      setFetching(false);
    }
  }, [visible]);

  const close = () => {
    catalogRequestRef.current += 1;
    setFetching(false);
    setCatalog(null);
    setQuery('');
    setManual('');
    setError('');
    setAdded([]);
    setSelectedSuggestion(undefined);
    onClose();
  };

  const loadCatalog = async () => {
    if (!visible) return;
    const requestId = ++catalogRequestRef.current;
    setFetching(true);
    setError('');
    try {
      const result = await fetchProviderModels(providerId);
      if (requestId !== catalogRequestRef.current || !visible) return;
      setCatalog(result.models);
      if (result.models.length === 0) setError(t('models.fetchFailed'));
    } catch (err) {
      if (requestId === catalogRequestRef.current && visible) {
        setError(errorMessage(err, t('models.fetchFailed')));
      }
    } finally {
      if (requestId === catalogRequestRef.current) setFetching(false);
    }
  };

  const add = (model: string | ModelInfo) => {
    const id = (typeof model === 'string' ? model : model.id).trim();
    if (!id) return;
    setManual(id);
    setSelectedSuggestion(typeof model === 'string' ? undefined : model);
    setEditorOpen(true);
  };

  const known = new Set([...existing, ...added]);
  const filtered = (catalog ?? []).filter((m) =>
    query.trim() ? m.id.toLowerCase().includes(query.trim().toLowerCase()) : true,
  );
  const visibleModels = filtered.slice(0, MAX_VISIBLE_MODELS);

  return (
    <>
      <Sheet
        // The editor owns a second Sheet. Keep the two Modal instances mutually
        // exclusive so native platforms never render nested Modal containers.
        visible={visible && !editorOpen}
        title={t('models.add')}
        onClose={close}
        footer={
          <Button variant="secondary" onPress={close}>
            {tc('actions.done')}
          </Button>
        }
      >
        <Text style={[styles.label, { color: colors.textSecondary }]}>
          {t('models.addManual')}
        </Text>
        <View style={styles.manualRow}>
          <View style={styles.manualField}>
            <TextField
              value={manual}
              onChangeText={(value) => {
                setManual(value);
                setSelectedSuggestion(undefined);
              }}
              placeholder={t('models.modelId')}
              autoComplete="off"
              onSubmitEditing={() => void add(manual)}
            />
          </View>
          <Button small onPress={() => void add(manual)} disabled={!manual.trim()}>
            {tc('actions.create')}
          </Button>
        </View>

        <View style={styles.spacer} />
        <Button variant="secondary" onPress={() => void loadCatalog()} loading={fetching}>
          {fetching ? t('models.fetching') : t('models.fetchFromUpstream')}
        </Button>
        {platformHasNoModelsEndpoint(platform) ? (
          <Text style={[styles.hint, { color: colors.warning }]}>{t('test.skipHint')}</Text>
        ) : null}
        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        {catalog ? (
          <>
            <View style={styles.spacer} />
            <TextField
              value={query}
              onChangeText={setQuery}
              placeholder={tc('actions.search')}
              autoComplete="off"
            />
            {visibleModels.map((item) => {
              const isKnown = known.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  disabled={isKnown}
                  {...a11yState({ disabled: isKnown })}
                  onPress={() => add(item)}
                  style={({ pressed }) => [
                    styles.modelRow,
                    {
                      borderColor: colors.border,
                      backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                      opacity: isKnown ? 0.55 : 1,
                    },
                  ]}
                >
                  <Ionicons
                    name={isKnown ? 'checkmark-circle' : 'add-circle-outline'}
                    size={20}
                    color={isKnown ? colors.success : colors.primary}
                  />
                  <Text style={[styles.modelName, { color: colors.text }]} numberOfLines={1}>
                    {item.id}
                  </Text>
                  {isKnown ? (
                    <Text style={[styles.hint, { color: colors.textTertiary }]}>
                      {t('models.alreadyAdded')}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
            {filtered.length > visibleModels.length ? (
              <Text style={[styles.hint, { color: colors.textTertiary }]}>
                {t('add.moreModels', { count: filtered.length - visibleModels.length })}
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.hint, { color: colors.textTertiary }]}>
            {t('models.emptyHint')}
          </Text>
        )}
      </Sheet>

      <AddProviderModelEditor
        visible={visible && editorOpen}
        providerId={providerId}
        providerPreset={manifestPreset}
        providerBaseUrl={providerBaseUrl}
        providerAuthScheme={providerAuthScheme}
        modelId={manual.trim()}
        catalogSuggestion={
          selectedSuggestion
            ? {
                model: selectedSuggestion.id,
                label: selectedSuggestion.name ?? selectedSuggestion.id,
                tasks: selectedSuggestion.tasks ?? [],
                traits: selectedSuggestion.traits ?? [],
              }
            : undefined
        }
        existingModelIds={[...existing, ...added]}
        onClose={() => setEditorOpen(false)}
        onSaved={(id) => {
          setAdded((prev) => (prev.includes(id) ? prev : [...prev, id]));
          setEditorOpen(false);
          setManual('');
          onAdded();
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: FontSize.sm, fontWeight: '600', marginBottom: Spacing.xs },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.xs },
  spacer: { height: Spacing.md },
  manualRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  manualField: { flex: 1 },
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
});
