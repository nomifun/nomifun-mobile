/**
 * 技能 section of 总览: the draft-approval inbox plus a read-only view of the
 * skills the companion already owns.
 *
 * Drafts are the one thing here that is genuinely "waiting on you"
 * (`companion.skill-drafted` even makes a good push target), so they are lifted
 * to the top with 采纳 / 拒绝 actions. Editing SKILL.md bodies stays on the
 * desktop — markdown editing on a phone is not the job.
 */
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button, Card, SectionTitle, Tag, toast } from '@/components/ui';
import { FontSize, Radius, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

import { partitionSkills } from '../skills';
import type { CompanionSkill, CompanionSkillPage } from '../types';
import { DesktopHint } from './rows';
import { SkillRejectSheet } from './skill-reject-sheet';

const SETTLED_LIMIT = 5;

export function SkillsCard({
  skills,
  error,
  decide,
}: {
  skills?: CompanionSkillPage;
  error?: unknown;
  /** Optimistic decide from `useCompanionExtras`; rejects with the API error. */
  decide: (companionSkillId: string, accept: boolean, reason?: string) => Promise<void>;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');

  const [busyId, setBusyId] = useState('');
  const [rejecting, setRejecting] = useState<CompanionSkill | null>(null);

  const { drafts, settled } = partitionSkills(skills?.items ?? []);

  const accept = (skill: CompanionSkill) => {
    if (busyId) return;
    setBusyId(skill.companion_skill_id);
    void decide(skill.companion_skill_id, true)
      .then(() => toast.success(t('overview.skillAccepted', { name: skill.skill_name })))
      .catch((err: unknown) => {
        toast.error(err instanceof Error ? err.message : t('overview.skillDecideFailed'));
      })
      .finally(() => setBusyId(''));
  };

  const reject = async (reason: string) => {
    const skill = rejecting;
    if (!skill) return;
    setBusyId(skill.companion_skill_id);
    try {
      await decide(skill.companion_skill_id, false, reason);
      setRejecting(null);
      toast.success(t('overview.skillRejected', { name: skill.skill_name }));
    } finally {
      setBusyId('');
    }
  };

  return (
    <>
      {drafts.length > 0 ? (
        <>
          <SectionTitle>{t('overview.skillDraftsTitle', { count: drafts.length })}</SectionTitle>
          <Card style={styles.card}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {t('overview.skillDraftsHint')}
            </Text>
            {drafts.map((skill) => (
              <View
                key={skill.companion_skill_id}
                style={[styles.draft, { backgroundColor: colors.surfaceMuted }]}
              >
                <View style={styles.draftHead}>
                  <Text style={[styles.draftName, { color: colors.text }]} numberOfLines={1}>
                    {skill.skill_name}
                  </Text>
                  <Tag tone="warning">{t('overview.skillStatus.draft')}</Tag>
                </View>
                <Text style={[styles.draftMeta, { color: colors.textTertiary }]} numberOfLines={3}>
                  {skill.description ||
                    t('overview.skillConfidence', {
                      percent: Math.round(skill.confidence * 100),
                    })}
                </Text>
                <View style={styles.draftActions}>
                  <View style={styles.draftAction}>
                    <Button
                      small
                      onPress={() => accept(skill)}
                      loading={busyId === skill.companion_skill_id}
                      disabled={busyId !== '' && busyId !== skill.companion_skill_id}
                    >
                      {t('overview.skillAccept')}
                    </Button>
                  </View>
                  <View style={styles.draftAction}>
                    <Button
                      small
                      variant="secondary"
                      onPress={() => setRejecting(skill)}
                      disabled={busyId !== ''}
                    >
                      {t('overview.skillReject')}
                    </Button>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </>
      ) : null}

      <SectionTitle>{t('overview.skillsTitle')}</SectionTitle>
      <Card style={styles.card}>
        {settled.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textTertiary }]}>
            {error ? t('overview.skillsFailed') : t('overview.skillsEmpty')}
          </Text>
        ) : (
          settled.slice(0, SETTLED_LIMIT).map((skill) => (
            <View key={skill.companion_skill_id} style={styles.listItem}>
              <View style={styles.listItemBody}>
                <Text style={[styles.listItemTitle, { color: colors.text }]} numberOfLines={1}>
                  {skill.skill_name}
                </Text>
                <Text style={[styles.listItemMeta, { color: colors.textTertiary }]} numberOfLines={2}>
                  {skill.description || t('overview.skillsUsage', { count: skill.usage_count })}
                </Text>
              </View>
              <Tag tone={skill.status === 'active' ? 'success' : 'neutral'}>
                {t(`overview.skillStatus.${skill.status}`)}
              </Tag>
            </View>
          ))
        )}
        {settled.length > SETTLED_LIMIT ? (
          <DesktopHint text={t('overview.skillsCount', { count: skills?.total ?? settled.length })} />
        ) : null}
      </Card>

      <SkillRejectSheet
        skill={rejecting}
        visible={rejecting !== null}
        busy={busyId !== '' && busyId === rejecting?.companion_skill_id}
        onClose={() => setRejecting(null)}
        onConfirm={reject}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: Spacing.md },
  hint: { fontSize: FontSize.xs, lineHeight: 17 },
  empty: { fontSize: FontSize.sm, lineHeight: 20 },
  draft: { borderRadius: Radius.md, padding: Spacing.md, gap: Spacing.xs },
  draftHead: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  draftName: { flex: 1, fontSize: FontSize.sm, fontWeight: '700' },
  draftMeta: { fontSize: FontSize.xs, lineHeight: 17 },
  draftActions: { flexDirection: 'row', gap: Spacing.sm, marginTop: Spacing.xs },
  draftAction: { flex: 1 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  listItemBody: { flex: 1, gap: 2 },
  listItemTitle: { fontSize: FontSize.sm, fontWeight: '600' },
  listItemMeta: { fontSize: FontSize.xs, lineHeight: 16 },
});
