import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/types';
import {
  ASR_KEY,
  DEFAULT_CHAT_MODEL_KEY,
  DEFAULT_IMAGE_MODEL_KEY,
  TTS_KEY,
  setClientSetting,
  updateProvider,
} from '@/features/models/api';
import {
  Button,
  EmptyState,
  ErrorState,
  Loading,
  Screen,
  SectionTitle,
  toast,
} from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { AddProviderSheet } from '@/features/models/components/add-provider-sheet';
import { DefaultsCard } from '@/features/models/components/defaults-card';
import {
  ImageDefaultModelSheet,
  SpeechToTextDefaultModelSheet,
  TextToSpeechDefaultModelSheet,
} from '@/features/models/components/default-model-sheets';
import { ModelPickerSheet } from '@/features/models/components/model-picker-sheet';
import { ProviderCard } from '@/features/models/components/provider-card';
import { errorMessage, isReferenceConflict } from '@/features/models/errors';
import { useClientDefaults, useProviders } from '@/features/models/hooks';
import { SerializedLatestWriteQueue } from '@/features/models/serialized-latest-write-queue';
import type {
  ModelRef,
  ProviderResponse,
  SpeechToTextConfig,
  TextToSpeechConfig,
} from '@/features/models/types';

type DefaultSheet = 'chat' | 'image' | 'asr' | 'tts' | null;
type DefaultValue = ModelRef | SpeechToTextConfig | TextToSpeechConfig | null;

/** Provider list plus the task-specific install-wide defaults. */
export default function ModelsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const { providers, error, isLoading, mutate } = useProviders();
  const { defaults, mutate: mutateDefaults } = useClientDefaults();

  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [defaultSheet, setDefaultSheet] = useState<DefaultSheet>(null);
  const [savingDefault, setSavingDefault] = useState(false);
  const [defaultError, setDefaultError] = useState('');
  const defaultWriteQueue = useRef(new SerializedLatestWriteQueue());

  const refreshAll = async () => {
    setRefreshing(true);
    try {
      await Promise.all([mutate(), mutateDefaults()]);
    } finally {
      setRefreshing(false);
    }
  };

  const toggleProvider = async (provider: ProviderResponse, next: boolean) => {
    setBusyId(provider.provider_id);
    await mutate(
      (list) =>
        list?.map((item) =>
          item.provider_id === provider.provider_id ? { ...item, enabled: next } : item,
        ),
      { revalidate: false },
    );
    try {
      await updateProvider(provider.provider_id, { enabled: next });
    } catch (err) {
      toast.error(errorMessage(err, tc('feedback.requestFailed')));
    } finally {
      setBusyId('');
      void mutate();
    }
  };

  const openDefault = (kind: Exclude<DefaultSheet, null>) => {
    setDefaultError('');
    setDefaultSheet(kind);
  };

  const applyDefault = async (key: string, value: DefaultValue) => {
    setSavingDefault(true);
    setDefaultError('');
    const queue = defaultWriteQueue.current;
    const { done } = queue.enqueue(
      () =>
        // `null` deletes the key. Never persist a half-empty model reference.
        setClientSetting(key, value),
      {
        onLatestSuccess: () => {
          setDefaultSheet(null);
          toast.success(value ? tc('feedback.saved') : t('defaults.cleared'));
          void mutateDefaults();
        },
        onLatestError: (err) => {
          const message = isReferenceConflict(err)
            ? t('defaults.conflict')
            : errorMessage(err, tc('feedback.requestFailed'));
          setDefaultError(message);
          void mutateDefaults();
        },
        onLatestSettled: () => {
          setSavingDefault(false);
        },
      },
    );

    // Apply the latest choice immediately in the local SWR snapshot. The
    // serialized queue makes the eventual server order deterministic, while
    // the optimistic snapshot keeps rapid taps responsive on mobile.
    void mutateDefaults(
      (current) => {
        const next = { ...(current ?? {}) };
        if (value === null) delete next[key];
        else next[key] = value;
        return next;
      },
      { revalidate: false },
    );
    await done;
  };

  const closeDefault = () => {
    if (!savingDefault) {
      setDefaultError('');
      setDefaultSheet(null);
    }
  };

  const header = <Stack.Screen options={{ title: t('title') }} />;

  if (isLoading && !providers) {
    return (
      <Screen scroll={false}>
        {header}
        <Loading label={tc('state.loading')} />
      </Screen>
    );
  }

  if (error && !providers) {
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

  const list = providers ?? [];

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refreshAll()}>
      {header}

      <SectionTitle>{t('defaults.title')}</SectionTitle>
      <DefaultsCard
        defaults={defaults}
        providers={list}
        onEditChat={() => openDefault('chat')}
        onEditImage={() => openDefault('image')}
        onEditAsr={() => openDefault('asr')}
        onEditTts={() => openDefault('tts')}
      />

      {defaultError && defaultSheet === null ? (
        <Text style={[styles.error, { color: colors.danger }]}>{defaultError}</Text>
      ) : null}

      <SectionTitle>{t('list.providers')}</SectionTitle>
      {list.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title={t('list.empty')}
          description={t('list.emptyHint')}
          action={<Button onPress={() => setAddOpen(true)}>{t('list.addProvider')}</Button>}
        />
      ) : (
        <>
          {list.map((provider) => (
            <ProviderCard
              key={provider.provider_id}
              provider={provider}
              busy={busyId === provider.provider_id}
              onPress={() =>
                router.push({
                  pathname: '/model-provider/[id]',
                  params: { id: provider.provider_id },
                })
              }
              onToggle={(next) => void toggleProvider(provider, next)}
            />
          ))}
          <Text style={[styles.hint, { color: colors.textTertiary }]}>{t('list.orderHint')}</Text>
          <View style={styles.action}>
            <Button onPress={() => setAddOpen(true)}>{t('list.addProvider')}</Button>
          </View>
        </>
      )}

      <AddProviderSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          void mutate();
        }}
      />

      <ModelPickerSheet
        visible={defaultSheet === 'chat'}
        task="chat"
        title={t('defaults.chat')}
        current={defaults?.chat}
        providers={list}
        busy={savingDefault}
        onClose={closeDefault}
        onSelect={(ref) => void applyDefault(DEFAULT_CHAT_MODEL_KEY, ref)}
        onClear={() => void applyDefault(DEFAULT_CHAT_MODEL_KEY, null)}
      >
        {defaultError ? (
          <Text style={[styles.inlineError, { color: colors.danger }]}>{defaultError}</Text>
        ) : null}
      </ModelPickerSheet>

      <ImageDefaultModelSheet
        visible={defaultSheet === 'image'}
        current={defaults?.imageGeneration}
        providers={list}
        busy={savingDefault}
        error={defaultError}
        onClose={closeDefault}
        onSave={(value) => applyDefault(DEFAULT_IMAGE_MODEL_KEY, value)}
      />

      <SpeechToTextDefaultModelSheet
        visible={defaultSheet === 'asr'}
        config={defaults?.asr}
        providers={list}
        busy={savingDefault}
        error={defaultError}
        onClose={closeDefault}
        onSave={(value) => applyDefault(ASR_KEY, value)}
      />

      <TextToSpeechDefaultModelSheet
        visible={defaultSheet === 'tts'}
        config={defaults?.tts}
        providers={list}
        busy={savingDefault}
        error={defaultError}
        onClose={closeDefault}
        onSave={(value) => applyDefault(TTS_KEY, value)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.xs },
  action: { marginTop: Spacing.xl },
  error: { fontSize: FontSize.sm, lineHeight: 19, marginTop: Spacing.sm },
  inlineError: { fontSize: FontSize.sm, lineHeight: 19 },
});
