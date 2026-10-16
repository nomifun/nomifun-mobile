import { useEffect, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Tag } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useModelProtocolDiscovery } from '../use-model-protocol-discovery';
import type { ModelProtocolDiscoveryContext } from '../protocol-discovery';
import type { ModelCapabilityDraft } from '../advanced';
import { errorMessage } from '../errors';
import type { ProviderModelCapabilityInput } from '../types';

export function ModelProtocolDiscoveryControl({ model, capability, context, disabled, onApply, onPendingChange }: {
  model: string;
  capability: ModelCapabilityDraft;
  context: ModelProtocolDiscoveryContext;
  disabled: boolean;
  onApply: (snapshot: string, selected: ProviderModelCapabilityInput, selectionSource: 'automatic' | 'manual') => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const { t } = useTranslation('models');
  const { colors } = useTheme();
  const state = useModelProtocolDiscovery(model, capability, context);
  const pendingCallback = useRef(onPendingChange);
  pendingCallback.current = onPendingChange;
  useEffect(() => { pendingCallback.current(state.pending); }, [state.pending]);
  useEffect(() => () => pendingCallback.current(false), []);
  const ready = Boolean(model.trim()) && (Boolean(context.providerId) || context.credentials !== undefined);
  return (
    <View style={styles.root}>
      <Text style={[styles.hint, { color: colors.textTertiary }]}>
        {t(capability.task === 'chat' ? 'discovery.chatHint' : 'discovery.otherHint')}
      </Text>
      <Button small variant="secondary" disabled={disabled || !ready} loading={state.pending}
        onPress={() => void state.discover()}>{t('discovery.action')}</Button>
      {state.error ? <Text style={[styles.hint, { color: colors.danger }]}>{errorMessage(state.error, t('discovery.failed'))}</Text> : null}
      {state.result ? (
        <View style={styles.root}>
          {state.result.candidates.map((candidate) => (
            <View key={candidate.protocol} style={styles.candidate}>
              <Text style={[styles.name, { color: colors.text }]}>{candidate.protocol}</Text>
              <Tag tone={candidate.status === 'available' ? 'success' : candidate.status === 'blocked' ? 'danger' : 'warning'}>
                {t(`discovery.status.${candidate.status}`)}
              </Tag>
              <Text style={[styles.hint, { color: colors.textTertiary }]}>{t(`discovery.evidence.${candidate.evidence}`)}</Text>
              {candidate.message ? <Text style={[styles.hint, { color: colors.textSecondary }]}>{candidate.message}</Text> : null}
              {candidate.status === 'available' && candidate.capability ? (
                <Button small variant="secondary" disabled={disabled || state.pending}
                  onPress={() => onApply(state.testedSnapshot, candidate.capability!, 'manual')}>{t('discovery.use')}</Button>
              ) : null}
            </View>
          ))}
          {state.result.candidates.length === 0 ? <Text style={[styles.hint, { color: colors.warning }]}>{t('discovery.empty')}</Text> : null}
          {state.result.selected_capability && state.result.candidates.some((candidate) => candidate.status === 'available' && candidate.protocol === state.result?.selected_protocol) ? (
            <Button small disabled={disabled || state.pending}
              onPress={() => onApply(state.testedSnapshot, state.result!.selected_capability!, 'automatic')}>{t('discovery.useRecommended')}</Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: Spacing.sm, paddingHorizontal: Spacing.sm, paddingBottom: Spacing.sm },
  candidate: { gap: Spacing.xs },
  name: { fontSize: FontSize.sm, fontWeight: '600' },
  hint: { fontSize: FontSize.xs, lineHeight: 18 },
});
