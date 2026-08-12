import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { EmptyState, ErrorState, Loading, Tag } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { Sheet } from '@/features/models/components/sheet';
import { useTaskModels } from '@/features/models/hooks';
import { isManagedProvider } from '@/features/models/platforms';
import { modelSupportsTask, orderSelectorProviders } from '@/features/models/selectors';
import type {
  ModelRef,
  ModelTask,
  ModelTrait,
  ProviderResponse,
} from '@/features/models/types';
import { a11yState } from '@/utils/a11y';

interface ModelPickerSheetProps {
  visible: boolean;
  task: ModelTask;
  /** Optional capability traits required by the caller (e.g. vision input). */
  requiredTraits?: readonly ModelTrait[];
  title: string;
  current?: ModelRef;
  providers: readonly ProviderResponse[];
  busy?: boolean;
  onClose: () => void;
  onSelect: (ref: ModelRef) => void;
  onClear: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  showClear?: boolean;
}

/**
 * The mobile equivalent of the desktop `TaskModelSelect`.
 *
 * Candidates are derived from the canonical nested provider catalog (the
 * authority for every selector: enabled providers, enabled rows, and the
 * exact task-scoped capability). Two behaviours copied verbatim:
 * - a stale saved reference is rendered explicitly as "（不可用）" with a
 *   warning, never silently blanked;
 * - "request errored, data undefined" means the catalog is UNRESOLVED, not
 *   empty, so we never suggest the user has no models after a hiccup.
 */
export function ModelPickerSheet({
  visible,
  task,
  requiredTraits = [],
  title,
  current,
  providers,
  busy,
  onClose,
  onSelect,
  onClear,
  children,
  footer,
  showClear = true,
}: ModelPickerSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');
  const { candidates, unresolved, isLoading, refresh } = useTaskModels(
    task,
    visible,
    requiredTraits,
  );
  const localCandidates = orderSelectorProviders(providers).flatMap((provider) => {
    if (provider.enabled === false) return [];
    return provider.models
      .filter(
        (model) =>
          model.enabled === true && modelSupportsTask(model, task, requiredTraits),
      )
      .map((model) => ({ provider_id: provider.provider_id, model: model.model }));
  });
  // The management page already owns a complete provider graph. Prefer that
  // snapshot so an optimistic enable/disable immediately updates this sheet,
  // while the SWR hook still supplies authoritative loading/error semantics.
  const displayedCandidates = providers.length > 0 ? localCandidates : candidates;

  const providerLabel = (providerId: string): string => {
    const provider = providers.find((p) => p.provider_id === providerId);
    if (!provider) return providerId;
    if (isManagedProvider(provider.platform)) return t('list.managedName');
    return provider.name || provider.platform;
  };

  const groups = new Map<string, string[]>();
  for (const ref of displayedCandidates ?? []) {
    const list = groups.get(ref.provider_id) ?? [];
    list.push(ref.model);
    groups.set(ref.provider_id, list);
  }

  const currentIsStale =
    !!current &&
    !!displayedCandidates &&
    !displayedCandidates.some(
      (c) => c.provider_id === current.provider_id && c.model === current.model,
    );

  return (
    <Sheet
      visible={visible}
      title={title}
      closeDisabled={!!busy}
      onClose={onClose}
      footer={footer}
    >
      {children}
      {isLoading && !displayedCandidates ? <Loading label={tc('state.loading')} /> : null}

      {unresolved ? (
        <ErrorState
          message={t('defaults.catalogUnresolved')}
          onRetry={refresh}
          retryLabel={tc('actions.retry')}
        />
      ) : null}

      {currentIsStale && current ? (
        <View style={[styles.warning, { backgroundColor: colors.warningSoft }]}>
          <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
          <Text style={[styles.warningText, { color: colors.warning }]}>
            {t('defaults.staleWarning')}
          </Text>
        </View>
      ) : null}

      {currentIsStale && current ? (
        <View style={[styles.row, { borderColor: colors.border, opacity: 0.6 }]}>
          <Ionicons name="close-circle-outline" size={20} color={colors.textTertiary} />
          <Text style={[styles.model, { color: colors.textSecondary }]} numberOfLines={1}>
            {current.model}
          </Text>
          <Tag tone="warning">{t('defaults.unavailableTag')}</Tag>
        </View>
      ) : null}

      {displayedCandidates && displayedCandidates.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title={t('defaults.noCandidates')}
          description={t('defaults.noCandidatesHint')}
        />
      ) : null}

      {[...groups.entries()].map(([providerId, models]) => (
        <View key={providerId} style={styles.group}>
          <Text style={[styles.groupTitle, { color: colors.textSecondary }]} numberOfLines={1}>
            {providerLabel(providerId)}
          </Text>
          {models.map((model) => {
            const active = current?.provider_id === providerId && current?.model === model;
            return (
              <Pressable
                key={`${providerId}:${model}`}
                accessibilityRole="button"
                disabled={busy}
                {...a11yState({ selected: active, disabled: !!busy })}
                onPress={() => onSelect({ provider_id: providerId, model })}
                style={({ pressed }) => [
                  styles.row,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
                    opacity: busy ? 0.5 : 1,
                  },
                ]}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={20}
                  color={active ? colors.primary : colors.textTertiary}
                />
                <Text style={[styles.model, { color: colors.text }]} numberOfLines={1}>
                  {model}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ))}

      {showClear && current ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          {...a11yState({ disabled: !!busy })}
          onPress={onClear}
          style={({ pressed }) => [
            styles.clear,
            { opacity: busy ? 0.5 : pressed ? 0.6 : 1 },
          ]}
        >
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
          <Text style={[styles.clearText, { color: colors.danger }]}>{t('defaults.clear')}</Text>
        </Pressable>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: { marginBottom: Spacing.md, gap: Spacing.xs },
  groupTitle: { fontSize: FontSize.xs, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 48,
    marginBottom: Spacing.xs,
  },
  model: { flex: 1, fontSize: FontSize.sm },
  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  warningText: { flex: 1, fontSize: FontSize.xs, lineHeight: 17 },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    minHeight: 44,
  },
  clearText: { fontSize: FontSize.sm, fontWeight: '600' },
});
