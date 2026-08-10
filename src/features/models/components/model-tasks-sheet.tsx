import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { a11yState } from '@/utils/a11y';
import { setProviderModelTasks } from '@/features/models/api';
import { Sheet } from '@/features/models/components/sheet';
import { errorMessage } from '@/features/models/errors';
import { canSaveTasks, sortTasks, toggleTask } from '@/features/models/tasks';
import {
  MODEL_TASK_ORDER,
  MODEL_TRAIT_ORDER,
  type ModelTask,
  type ProviderModelResponse,
} from '@/features/models/types';

interface ModelTasksSheetProps {
  visible: boolean;
  row: ProviderModelResponse | null;
  onClose: () => void;
  /** Called with the server's row so the caller can patch its cache. */
  onSaved: (row: ProviderModelResponse) => void;
}

/**
 * 任务标签 editor — the one piece of the desktop's 模态能力 popover that belongs
 * on a phone: it decides which selectors the model appears in, and an untagged
 * row is invisible everywhere.
 *
 * Writes `POST /api/provider-models/update {provider_id, model, tasks}`; every
 * other column stays absent so it keeps its stored value. Traits, context
 * limit, protocol, connection role and the failover queue are heavier
 * assets and stay on the desktop — they are shown here read-only.
 *
 * A toast fired inside an RN `Modal` hides underneath it on native, so errors
 * are also rendered inline.
 */
export function ModelTasksSheet({ visible, row, onClose, onSaved }: ModelTasksSheetProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('models');
  const { t: tc } = useTranslation('common');

  const [draft, setDraft] = useState<ModelTask[]>([]);
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const model = row?.model ?? '';
  const stored = row ? sortTasks(row.tasks) : [];

  // Seed the draft when the sheet opens on a row (React's "adjust state when a
  // prop changes" pattern). Deliberately keyed on the model, not on the row
  // object: a background revalidation of the catalog must not wipe the picks
  // the user is in the middle of making.
  if (visible && seededFor !== model) {
    setSeededFor(model);
    setDraft(stored);
    setError('');
  } else if (!visible && seededFor !== null) {
    setSeededFor(null);
  }

  const close = () => {
    if (saving) return;
    onClose();
  };

  const save = () => {
    if (!row || saving) return;
    setSaving(true);
    setError('');
    void (async () => {
      try {
        const updated = await setProviderModelTasks(row.provider_id, row.model, draft);
        onSaved(updated);
        // Close BEFORE the toast: on native a toast fired while a Modal is open
        // renders underneath it.
        onClose();
        toast.success(tc('feedback.saved'));
      } catch (err) {
        setError(errorMessage(err, tc('feedback.requestFailed')));
      } finally {
        setSaving(false);
      }
    })();
  };

  return (
    <Sheet
      visible={visible}
      title={t('tasksEdit.title')}
      onClose={close}
      footer={
        <Button onPress={save} loading={saving} disabled={!canSaveTasks(draft, stored)}>
          {tc('actions.save')}
        </Button>
      }
    >
      <Text style={[styles.model, { color: colors.text }]} numberOfLines={2}>
        {model}
      </Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>{t('tasksEdit.hint')}</Text>

      {MODEL_TASK_ORDER.map((task) => {
        const checked = draft.includes(task);
        return (
          <Pressable
            key={task}
            accessibilityRole="checkbox"
            {...a11yState({ checked })}
            disabled={saving}
            onPress={() => setDraft((current) => toggleTask(current, task))}
            style={({ pressed }) => [
              styles.option,
              {
                borderColor: checked ? colors.primary : colors.border,
                backgroundColor: pressed ? colors.surfaceMuted : colors.surface,
              },
            ]}
          >
            <Ionicons
              name={checked ? 'checkbox' : 'square-outline'}
              size={20}
              color={checked ? colors.primary : colors.textTertiary}
            />
            <Text style={[styles.optionLabel, { color: colors.text }]} numberOfLines={1}>
              {t(`task.${task}`)}
            </Text>
          </Pressable>
        );
      })}

      {draft.length === 0 ? (
        <Text style={[styles.warning, { color: colors.warning }]}>{t('tasksEdit.emptyBlocked')}</Text>
      ) : null}
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

      <View style={[styles.desktop, { borderTopColor: colors.border }]}>
        <Text style={[styles.desktopTitle, { color: colors.textSecondary }]}>
          {t('tasksEdit.desktopTitle')}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('tasksEdit.traitsRow', {
            value:
              row && row.traits.length > 0
                ? MODEL_TRAIT_ORDER.filter((trait) => row.traits.includes(trait))
                    .map((trait) => t(`trait.${trait}`))
                    .join(' · ')
                : t('tasksEdit.none'),
          })}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('tasksEdit.contextRow', {
            value: row?.context_limit ? String(row.context_limit) : t('tasksEdit.default'),
          })}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('tasksEdit.protocolRow', {
            value: row?.protocol || t('tasksEdit.auto'),
            role: row?.connection_role || t('tasksEdit.none'),
          })}
        </Text>
        <Text style={[styles.hint, { color: colors.textTertiary }]}>
          {t('tasksEdit.desktopHint')}
        </Text>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  model: { fontSize: FontSize.md, fontWeight: '700' },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    minHeight: 46,
  },
  optionLabel: { flex: 1, fontSize: FontSize.sm, fontWeight: '500' },
  warning: { fontSize: FontSize.xs, lineHeight: 17 },
  error: { fontSize: FontSize.sm, lineHeight: 19 },
  desktop: {
    gap: 4,
    marginTop: Spacing.sm,
    paddingTop: Spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  desktopTitle: { fontSize: FontSize.sm, fontWeight: '600' },
});
