/**
 * 拒绝技能草稿 confirmation sheet.
 *
 * Rejection has side effects beyond the row (the draft is archived, a feedback
 * row is written and the mined pattern behind it is marked `rejected` so it
 * stops being proposed), so it gets an explicit confirm surface rather than a
 * one-tap button — and that surface is also where the optional `reason` is
 * typed, which is what feeds the 纠偏回流.
 *
 * A toast fired from inside an RN `Modal` renders underneath it on native, so
 * failures are ALSO shown inline here.
 */
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, TextField } from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import type { CompanionSkill } from '../types';
import { Sheet } from './sheet';

export function SkillRejectSheet({
  skill,
  visible,
  busy,
  onClose,
  onConfirm,
}: {
  skill: CompanionSkill | null;
  visible: boolean;
  busy: boolean;
  onClose: () => void;
  /** Resolves after the write; rejects with the message to show inline. */
  onConfirm: (reason: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');
  const { t: tc } = useTranslation('common');

  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const skillId = skill?.companion_skill_id ?? null;
  useEffect(() => {
    if (!visible) return;
    setReason('');
    setError('');
  }, [visible, skillId]);

  const confirm = () => {
    if (busy) return;
    setError('');
    void onConfirm(reason).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : t('overview.skillDecideFailed'));
    });
  };

  return (
    <Sheet
      visible={visible}
      title={t('overview.skillRejectTitle')}
      onClose={() => {
        if (!busy) onClose();
      }}
      closeLabel={tc('actions.close')}
      footer={
        <>
          <Button variant="danger" onPress={confirm} loading={busy}>
            {t('overview.skillRejectConfirm')}
          </Button>
          <Button variant="secondary" onPress={onClose} disabled={busy}>
            {tc('actions.cancel')}
          </Button>
        </>
      }
    >
      <Text style={[styles.name, { color: colors.text }]} numberOfLines={2}>
        {skill?.skill_name ?? ''}
      </Text>
      <Text style={[styles.body, { color: colors.textSecondary }]}>
        {t('overview.skillRejectBody')}
      </Text>
      <TextField
        label={t('overview.skillRejectReasonLabel')}
        hint={t('overview.skillRejectReasonHint')}
        value={reason}
        onChangeText={setReason}
        multiline
      />
      {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  name: { fontSize: FontSize.md, fontWeight: '700' },
  body: { fontSize: FontSize.sm, lineHeight: 20 },
  error: { fontSize: FontSize.sm, lineHeight: 19 },
});
