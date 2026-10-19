/**
 * 总览 — read-and-monitor first: who this companion is, how far it has come, what
 * it remembers and knows, plus the one primary action (打开聊天) and a manual
 * learn pass. Model settings use the same profile API as the desktop.
 */
import { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Notice, SectionTitle, Tag, toast } from '@/components/ui';
import { RefreshControl } from '@/components/ui/refresh-control';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { connectionStore } from '@/api/connection';

import { ensureCompanionThread, runLearnPass } from '../api';
import { useCompanionExtras } from '../hooks';
import { pushConversation } from '../navigation';
import type { CompanionProfilePatch, CompanionWithStatus } from '../types';
import {
  MOOD_VISUALS,
  ROBOT_PHASE_TONES,
  characterOf,
  formatIsoTime,
  moodOf,
  robotPhaseOf,
} from '../utils';
import { CompanionFigure } from './companion-figure';
import { LevelBar } from './level-bar';
import { DesktopHint, InfoRow, StatCell } from './rows';
import { SkillsCard } from './skills-card';
import { ModelsCard } from './models-card';

interface OverviewTabProps {
  companion: CompanionWithStatus;
  learning: boolean;
  setLearning: (value: boolean) => void;
  refreshProfile: () => Promise<unknown>;
  saveProfile: (patch: CompanionProfilePatch) => Promise<void>;
  profileSaving: boolean;
}

export function OverviewTab({
  companion,
  learning,
  setLearning,
  refreshProfile,
  saveProfile,
  profileSaving,
}: OverviewTabProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('companions');

  const companionId = companion.companion_id;
  const status = companion.status;
  const extras = useCompanionExtras(companionId);
  const [refreshing, setRefreshing] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState('');

  const refresh = useCallback(() => {
    setRefreshing(true);
    void (async () => {
      try {
        await Promise.all([refreshProfile(), extras.revalidate()]);
      } finally {
        setRefreshing(false);
      }
    })();
  }, [refreshProfile, extras]);

  const mood = moodOf(status?.mood);
  const character = characterOf(companion.character);
  const modelReady = !!companion.model;

  const openChat = () => {
    if (chatBusy) return;
    setChatError('');
    setChatBusy(true);
    const epoch = connectionStore.epoch();
    void (async () => {
      try {
        // Reuse the desktop receive Session, or create it from current defaults.
        const thread = await ensureCompanionThread(companionId);
        if (connectionStore.epoch() !== epoch) return;
        pushConversation(thread.conversation_id);
      } catch (error) {
        if (connectionStore.epoch() !== epoch) return;
        const message = error instanceof Error ? error.message : t('overview.chatFailed');
        setChatError(message);
        toast.error(message);
      } finally {
        setChatBusy(false);
      }
    })();
  };

  const runLearn = () => {
    if (learning) return;
    setLearning(true);
    const epoch = connectionStore.epoch();
    void (async () => {
      try {
        const result = await runLearnPass(companionId);
        if (connectionStore.epoch() !== epoch) return;
        if (result.status === 'ok') {
          toast.success(t('overview.learnDone', { count: result.memories_added }));
        } else if (result.status === 'model_unconfigured') {
          toast.info(t('overview.learnModelMissing'));
        } else if (result.status === 'no_events') {
          toast.info(t('overview.learnNoEvents'));
        } else {
          toast.error(result.error || t('overview.learnFailed'));
        }
        await Promise.all([refreshProfile(), extras.revalidate()]);
      } catch (err) {
        if (connectionStore.epoch() !== epoch) return;
        toast.error(err instanceof Error ? err.message : t('overview.learnFailed'));
      } finally {
        setLearning(false);
      }
    })();
  };

  const skills = extras.skills?.items ?? [];
  const digest = extras.digest;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          tintColor={colors.textTertiary}
        />
      }
    >
      <Card style={styles.hero}>
        <View style={styles.heroTop}>
          <CompanionFigure
            companion={companion}
            size={72}
            mood={status?.mood}
            busy={learning}
          />
          <View style={styles.heroBody}>
            <Text style={[styles.heroName, { color: colors.text }]} numberOfLines={1}>
              {companion.name}
            </Text>
            <Text style={[styles.heroStyle, { color: colors.textTertiary }]} numberOfLines={2}>
              {t(`characters.${character}.style`)}
            </Text>
            <View style={styles.heroTags}>
              <Tag tone={MOOD_VISUALS[mood].tone}>{t(`moods.${mood}`)}</Tag>
              {learning ? <Tag tone="primary">{t('overview.learning')}</Tag> : null}
              {companion.appearance?.companion_enabled ? (
                <Tag tone="success">{t('overview.deskShown')}</Tag>
              ) : (
                <Tag>{t('overview.deskHidden')}</Tag>
              )}
            </View>
          </View>
        </View>

        <LevelBar xp={status?.xp ?? 0} />

        <Button onPress={openChat} loading={chatBusy}>
          {t('overview.openChat')}
        </Button>
        {chatError ? <Notice tone="danger">{chatError}</Notice> : null}
        {!modelReady ? (
          <View style={[styles.warning, { backgroundColor: colors.warningSoft }]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.warning} />
            <View style={styles.warningBody}>
              <Text style={[styles.warningTitle, { color: colors.warning }]}>
                {t('overview.chatModelMissingTitle')}
              </Text>
              <Text style={[styles.warningText, { color: colors.textSecondary }]}>
                {t('overview.chatModelMissingBody')}
              </Text>
            </View>
          </View>
        ) : null}
      </Card>

      <SectionTitle>{t('overview.statsTitle')}</SectionTitle>
      <View style={styles.stats}>
        <StatCell label={t('overview.statMemories')} value={status?.memories_active ?? 0} />
        <StatCell label={t('overview.statArchived')} value={status?.memories_archived ?? 0} />
        <StatCell label={t('overview.statSkills')} value={extras.skills?.total ?? skills.length} />
        <StatCell label={t('overview.statXp')} value={Math.round(status?.xp ?? 0)} />
      </View>

      <SectionTitle>{t('overview.learnTitle')}</SectionTitle>
      <Card style={styles.card}>
        <InfoRow
          label={t('overview.learnSchedule')}
          value={
            companion.learn?.enabled
              ? t('overview.learnOn', { minutes: companion.learn.interval_minutes })
              : t('overview.learnOff')
          }
          muted={!companion.learn?.enabled}
        />
        {digest ? (
          <InfoRow
            label={t('overview.weeklyTitle')}
            value={`${t('overview.weeklySkills', { count: digest.skills_learned })} · ${t(
              'overview.weeklyMemories',
              { count: digest.memories_added },
            )}`}
          />
        ) : null}
        <Button variant="secondary" onPress={runLearn} loading={learning}>
          {t('overview.learnRun')}
        </Button>
        <DesktopHint text={t('overview.learnHint')} />
      </Card>

      <ModelsCard key={companionId} companion={companion} saveProfile={saveProfile} saving={profileSaving} />

      <SkillsCard skills={extras.skills} error={extras.skillsError} decide={extras.decideSkill} />

      <SectionTitle>{t('overview.robotsTitle')}</SectionTitle>
      <Card style={styles.card}>
        {extras.boundRobots.length === 0 ? (
          <Text style={[styles.empty, { color: colors.textTertiary }]}>
            {extras.robotsError ? t('overview.robotsFailed') : t('overview.robotsEmpty')}
          </Text>
        ) : (
          extras.boundRobots.map((robot) => {
            const phase = robotPhaseOf(extras.phases.get(robot.robot_id)?.phase);
            return (
              <View key={robot.robot_id} style={styles.listItem}>
                <View style={styles.listItemBody}>
                  <Text style={[styles.listItemTitle, { color: colors.text }]} numberOfLines={1}>
                    {robot.name}
                  </Text>
                  <Text style={[styles.listItemMeta, { color: colors.textTertiary }]} numberOfLines={1}>
                    {t('overview.robotBoard', { board: robot.board })}
                    {robot.last_seen
                      ? ` · ${t('overview.robotLastSeen', { time: formatIsoTime(robot.last_seen) })}`
                      : ` · ${t('overview.robotNeverSeen')}`}
                  </Text>
                </View>
                <Tag tone={ROBOT_PHASE_TONES[phase]}>{t(`robotStatus.${phase}`)}</Tag>
              </View>
            );
          })
        )}
        <DesktopHint text={t('overview.robotsHint')} />
      </Card>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: Spacing.lg, paddingBottom: Spacing.xxl, gap: Spacing.sm },
  hero: { gap: Spacing.lg },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg },
  heroBody: { flex: 1, gap: 4 },
  heroName: { fontSize: FontSize.title, fontWeight: '700' },
  heroStyle: { fontSize: FontSize.sm, lineHeight: 18 },
  heroTags: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.xs, marginTop: 2 },
  warning: { flexDirection: 'row', gap: Spacing.sm, borderRadius: 10, padding: Spacing.md },
  warningBody: { flex: 1, gap: 2 },
  warningTitle: { fontSize: FontSize.sm, fontWeight: '600' },
  warningText: { fontSize: FontSize.xs, lineHeight: 17 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  card: { gap: Spacing.md },
  empty: { fontSize: FontSize.sm, lineHeight: 20 },
  listItem: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  listItemBody: { flex: 1, gap: 2 },
  listItemTitle: { fontSize: FontSize.sm, fontWeight: '600' },
  listItemMeta: { fontSize: FontSize.xs, lineHeight: 16 },
});
