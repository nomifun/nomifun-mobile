/**
 * 身份与话术 — held in a local draft with an explicit 保存. Text fields must
 * never PATCH per keystroke (the desktop is explicit about this: every
 * keystroke would be a write, and a half-typed 服务策略 would go live).
 *
 * The draft only resets when the screen moves to a different agent; a
 * background refetch never discards what the user is typing.
 */
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, TextField, toast } from '@/components/ui';
import { Spacing } from '@/constants/theme';

import type { CsAgent, CsAgentPatch } from '../types';

interface Draft {
  name: string;
  greeting: string;
  persona: string;
  service_policy: string;
}

const draftOf = (agent: CsAgent): Draft => ({
  name: agent.name,
  greeting: agent.greeting,
  persona: agent.persona,
  service_policy: agent.service_policy,
});

export function IdentityCard({
  agent,
  patch,
}: {
  agent: CsAgent;
  patch: (next: CsAgentPatch) => Promise<CsAgent>;
}) {
  const { t } = useTranslation('customerService');
  const { t: tc } = useTranslation('common');
  const [draft, setDraft] = useState<Draft>(() => draftOf(agent));
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState('');

  useEffect(() => {
    setDraft(draftOf(agent));
    setNameError('');
    // Intentionally keyed on identity only — see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent.cs_agent_id]);

  const stored = useMemo(() => draftOf(agent), [agent]);
  const dirty =
    draft.name !== stored.name ||
    draft.greeting !== stored.greeting ||
    draft.persona !== stored.persona ||
    draft.service_policy !== stored.service_policy;

  const set = (key: keyof Draft) => (value: string) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
    if (key === 'name' && nameError) setNameError('');
  };

  const save = async () => {
    const name = draft.name.trim();
    if (!name) {
      setNameError(t('fields.nameRequired'));
      return;
    }
    setBusy(true);
    try {
      await patch({
        name,
        greeting: draft.greeting,
        persona: draft.persona,
        service_policy: draft.service_policy,
      });
      toast.success(t('detail.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tc('feedback.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <TextField
        label={t('fields.name')}
        placeholder={t('fields.namePlaceholder')}
        value={draft.name}
        onChangeText={set('name')}
        error={nameError || undefined}
      />
      <TextField
        label={t('fields.greeting')}
        placeholder={t('fields.greetingPlaceholder')}
        value={draft.greeting}
        onChangeText={set('greeting')}
        multiline
        style={styles.short}
      />
      <TextField
        label={t('fields.persona')}
        placeholder={t('fields.personaPlaceholder')}
        value={draft.persona}
        onChangeText={set('persona')}
        multiline
        style={styles.tall}
      />
      <TextField
        label={t('fields.servicePolicy')}
        hint={t('fields.servicePolicyHint')}
        placeholder={t('fields.servicePolicyPlaceholder')}
        value={draft.service_policy}
        onChangeText={set('service_policy')}
        multiline
        style={styles.tall}
      />

      <View style={styles.actions}>
        {dirty ? (
          <View style={styles.revert}>
            <Button variant="secondary" onPress={() => setDraft(stored)} disabled={busy}>
              {t('detail.revert')}
            </Button>
          </View>
        ) : null}
        <View style={styles.save}>
          <Button onPress={save} loading={busy} disabled={!dirty}>
            {tc('actions.save')}
          </Button>
        </View>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  short: { minHeight: 68, paddingTop: 12, textAlignVertical: 'top' },
  tall: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },
  actions: { flexDirection: 'row', gap: Spacing.md },
  revert: { flex: 1 },
  save: { flex: 2 },
});
