import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api/types';
import { Button, EmptyState, ErrorState, Loading, Screen, SectionTitle, toast } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { DEFAULT_CHAT_MODEL_KEY, setClientSetting, updateProvider } from '@/features/models/api';
import { AddProviderSheet } from '@/features/models/components/add-provider-sheet';
import { DefaultsCard } from '@/features/models/components/defaults-card';
import { ModelPickerSheet } from '@/features/models/components/model-picker-sheet';
import { ProviderCard } from '@/features/models/components/provider-card';
import { errorMessage, isReferenceConflict } from '@/features/models/errors';
import { useClientDefaults, useProviders } from '@/features/models/hooks';
import type { ModelRef, ProviderResponse } from '@/features/models/types';

/** 模型管理 — provider list + the install-wide defaults. */
export default function ModelsScreen() {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const { providers, error, isLoading, mutate } = useProviders();
  const { defaults, mutate: mutateDefaults } = useClientDefaults();

  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [savingDefault, setSavingDefault] = useState(false);

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
    // Optimistic: flip locally, then let the server be the authority.
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

  const applyChatDefault = async (ref: ModelRef | null) => {
    setSavingDefault(true);
    try {
      // `null` deletes the key — "no default" must never be a half-empty object.
      await setClientSetting(DEFAULT_CHAT_MODEL_KEY, ref);
      await mutateDefaults();
      toast.success(ref ? tc('feedback.saved') : t('defaults.cleared'));
      setPickerOpen(false);
    } catch (err) {
      toast.error(
        isReferenceConflict(err)
          ? t('defaults.conflict')
          : errorMessage(err, tc('feedback.requestFailed')),
      );
      void mutateDefaults();
    } finally {
      setSavingDefault(false);
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
        onEditChat={() => setPickerOpen(true)}
      />

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
        visible={pickerOpen}
        task="chat"
        title={t('defaults.chat')}
        current={defaults?.chat}
        providers={list}
        busy={savingDefault}
        onClose={() => setPickerOpen(false)}
        onSelect={(ref) => void applyChatDefault(ref)}
        onClear={() => void applyChatDefault(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.xs, lineHeight: 17, marginTop: Spacing.xs },
  action: { marginTop: Spacing.xl },
});
