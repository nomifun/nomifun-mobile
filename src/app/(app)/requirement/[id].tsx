import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ApiError } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
  Tag,
  TextField,
  toast,
} from '@/components/ui';
import { FontSize, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  completeRequirement,
  deleteRequirement,
  requirementKey,
  setRequirementStatus,
  updateRequirement,
  type UpdateRequirementInput,
} from '@/features/requirements/api';
import { RequirementForm } from '@/features/requirements/components/requirement-form';
import { StatusTag } from '@/features/requirements/components/status-tag';
import {
  useInvalidateRequirements,
  useRequirement,
  useRequirementTags,
  useRequirementsLive,
} from '@/features/requirements/hooks';
import { ALLOWED_TRANSITIONS, isTerminalStatus, type RequirementStatus } from '@/features/requirements/types';
import { confirmAction, formatTimestamp, useRelativeTime } from '@/features/requirements/utils';

export default function RequirementDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { t } = useTranslation('requirements');
  const { t: tc } = useTranslation('common');
  const relative = useRelativeTime();

  const detail = useRequirement(id);
  const tags = useRequirementTags();
  const invalidate = useInvalidateRequirements();
  useRequirementsLive();

  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  /** Which note-taking transition is open ('done' via /complete, 'failed' via /status). */
  const [noteTarget, setNoteTarget] = useState<'done' | 'failed' | null>(null);
  const [note, setNote] = useState('');

  const item = detail.data;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([detail.mutate(), tags.mutate()]);
    } finally {
      setRefreshing(false);
    }
  }, [detail, tags]);

  const run = async (
    action: () => Promise<unknown>,
    successText: string,
    /** Keys to evict rather than revalidate (the row is gone after a delete). */
    dropKeys?: readonly string[],
  ) => {
    if (!id) return;
    setBusy(true);
    try {
      await action();
      invalidate(dropKeys);
      toast.success(successText);
      setNoteTarget(null);
      setNote('');
      return true;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tc('feedback.requestFailed'));
      // Drop any optimistic assumption and re-read the authoritative row.
      void detail.mutate();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const notFound = detail.error instanceof ApiError && detail.error.status === 404;

  // Only the edges `RequirementService::set_status` accepts from a client.
  const transitions: readonly RequirementStatus[] = item ? ALLOWED_TRANSITIONS[item.status] : [];
  const canComplete = transitions.includes('done');
  const canRequeue = transitions.includes('pending');
  const canFail = transitions.includes('failed');
  const canCancel = transitions.includes('cancelled');

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()} keyboardAvoiding>
      <Stack.Screen options={{ title: item ? `#${item.display_no}` : t('detail.title') }} />

      {!item && detail.isLoading ? <Loading label={tc('state.loading')} /> : null}

      {!item && notFound ? (
        <EmptyState
          icon="trash-outline"
          title={t('detail.notFound')}
          action={
            <Button variant="secondary" onPress={() => router.back()}>
              {tc('actions.back')}
            </Button>
          }
        />
      ) : null}

      {!item && detail.error && !notFound ? (
        <ErrorState
          message={detail.error instanceof Error ? detail.error.message : tc('feedback.requestFailed')}
          retryLabel={tc('actions.retry')}
          onRetry={() => void detail.mutate()}
        />
      ) : null}

      {item && editing ? (
        <RequirementForm
          initial={{ title: item.title, tag: item.tag, content: item.content }}
          tagSuggestions={(tags.data ?? []).map((summary) => summary.tag)}
          submitting={busy}
          submitLabel={tc('actions.save')}
          onCancel={() => setEditing(false)}
          onSubmit={(values) => {
            const patch: UpdateRequirementInput = {};
            if (values.title !== item.title) patch.title = values.title;
            if (values.tag !== item.tag) patch.tag = values.tag;
            if (values.content !== item.content) patch.content = values.content;
            if (Object.keys(patch).length === 0) {
              setEditing(false);
              return;
            }
            void run(() => updateRequirement(item.requirement_id, patch), tc('feedback.saved')).then(
              (ok) => {
                if (ok) setEditing(false);
              },
            );
          }}
        />
      ) : null}

      {item && !editing ? (
        <>
          <Card>
            <View style={styles.chips}>
              <StatusTag status={item.status} />
              <Tag tone="primary">{item.tag}</Tag>
              {item.attempt_count > 1 ? (
                <Tag tone="warning">{t('list.attempt', { count: item.attempt_count })}</Tag>
              ) : null}
            </View>
            <Text style={[styles.title, { color: colors.text }]} selectable>
              {item.title}
            </Text>
            <Text style={[styles.headMeta, { color: colors.textTertiary }]}>
              {`#${item.display_no} · ${
                item.created_by === 'agent' ? t('detail.createdByAgent') : t('detail.createdByUser')
              } · ${relative(item.updated_at)}`}
            </Text>
          </Card>

          <SectionTitle>{t('detail.content')}</SectionTitle>
          <Card>
            <Text
              style={[
                styles.body,
                { color: item.content.trim() ? colors.textSecondary : colors.textTertiary },
              ]}
              selectable
            >
              {item.content.trim() ? item.content : t('detail.contentEmpty')}
            </Text>
          </Card>

          {item.completion_note ? (
            <>
              <SectionTitle>{t('detail.note')}</SectionTitle>
              <Card>
                <Text style={[styles.body, { color: colors.textSecondary }]} selectable>
                  {item.completion_note}
                </Text>
              </Card>
            </>
          ) : null}

          {item.owner_conversation_id || item.owner_terminal_id ? (
            <>
              <SectionTitle>{t('detail.owner')}</SectionTitle>
              {item.owner_conversation_id ? (
                <ListRow
                  title={t('detail.openSession')}
                  left={<Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />}
                  chevron
                  onPress={() =>
                    router.push({
                      pathname: '/session/[id]',
                      params: { id: item.owner_conversation_id ?? '' },
                    })
                  }
                />
              ) : (
                <ListRow
                  title={t('detail.terminalOwner')}
                  subtitle={t('detail.terminalHint')}
                  left={<Ionicons name="terminal-outline" size={20} color={colors.textTertiary} />}
                />
              )}
            </>
          ) : null}

          <SectionTitle>{t('detail.meta')}</SectionTitle>
          <Card>
            <MetaRow label={t('detail.attempts')} value={t('detail.attemptsValue', { count: item.attempt_count })} />
            {item.order_key ? <MetaRow label={t('detail.orderKey')} value={item.order_key} /> : null}
            <MetaRow label={t('detail.startedAt')} value={formatTimestamp(item.started_at)} />
            <MetaRow label={t('detail.completedAt')} value={formatTimestamp(item.completed_at)} />
            <MetaRow label={t('detail.createdAt')} value={formatTimestamp(item.created_at)} />
            <MetaRow label={t('detail.updatedAt')} value={formatTimestamp(item.updated_at)} last />
          </Card>

          {item.attachments && item.attachments.length > 0 ? (
            <>
              <SectionTitle>{t('detail.attachments')}</SectionTitle>
              <Card>
                {item.attachments.map((file) => (
                  <View key={file.attachment_id} style={styles.attachment}>
                    <Ionicons name="image-outline" size={16} color={colors.textTertiary} />
                    <Text style={[styles.attachmentName, { color: colors.textSecondary }]} numberOfLines={1}>
                      {file.file_name}
                    </Text>
                  </View>
                ))}
                <Text style={[styles.hint, { color: colors.textTertiary }]}>
                  {t('detail.attachmentsHint')}
                </Text>
              </Card>
            </>
          ) : null}

          <SectionTitle>{t('detail.actions')}</SectionTitle>

          {item.status === 'in_progress' ? (
            <Card style={styles.noticeCard}>
              <Ionicons name="sync-outline" size={18} color={colors.primary} />
              <Text style={[styles.notice, { color: colors.textSecondary }]}>
                {t('detail.inProgressHint')}
              </Text>
            </Card>
          ) : null}

          {/*
            `failed` is terminal for judging but still requeueable, so it must not
            claim "frozen, create a new one" while a 重新排队 button sits below it.
          */}
          {isTerminalStatus(item.status) ? (
            <Card style={styles.noticeCard}>
              <Ionicons
                name={canRequeue ? 'refresh-outline' : 'lock-closed-outline'}
                size={18}
                color={canRequeue ? colors.warning : colors.textTertiary}
              />
              <Text style={[styles.notice, { color: colors.textSecondary }]}>
                {canRequeue ? t('detail.failedHint') : t('detail.frozenHint')}
              </Text>
            </Card>
          ) : null}

          {noteTarget ? (
            <Card style={styles.noteCard}>
              <TextField
                label={noteTarget === 'done' ? t('note.completeLabel') : t('note.failLabel')}
                placeholder={
                  noteTarget === 'done' ? t('note.completePlaceholder') : t('note.failPlaceholder')
                }
                value={note}
                onChangeText={setNote}
                multiline
                autoCapitalize="sentences"
                style={styles.noteInput}
              />
              <Button
                variant={noteTarget === 'done' ? 'primary' : 'danger'}
                loading={busy}
                onPress={() => {
                  if (noteTarget === 'done') {
                    void run(
                      () => completeRequirement(item.requirement_id, note),
                      t('feedback.completed'),
                    );
                  } else {
                    void run(
                      () => setRequirementStatus(item.requirement_id, 'failed', note),
                      t('feedback.statusChanged'),
                    );
                  }
                }}
              >
                {noteTarget === 'done' ? t('actions.confirmComplete') : t('actions.confirmFail')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onPress={() => {
                  setNoteTarget(null);
                  setNote('');
                }}
                style={styles.stacked}
              >
                {tc('actions.cancel')}
              </Button>
            </Card>
          ) : (
            <View style={styles.actions}>
              {canComplete ? (
                <Button disabled={busy} onPress={() => setNoteTarget('done')}>
                  {t('actions.complete')}
                </Button>
              ) : null}
              {canRequeue ? (
                <Button
                  variant={canComplete ? 'secondary' : 'primary'}
                  loading={busy}
                  onPress={() =>
                    void run(
                      () => setRequirementStatus(item.requirement_id, 'pending'),
                      t('feedback.requeued'),
                    )
                  }
                >
                  {t('actions.requeue')}
                </Button>
              ) : null}

              {canFail || canCancel ? (
                <View style={styles.buttonRow}>
                  {canFail ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      style={styles.grow}
                      onPress={() => setNoteTarget('failed')}
                    >
                      {t('actions.fail')}
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      style={styles.grow}
                      onPress={() =>
                        confirmAction({
                          title: t('confirm.cancelTitle'),
                          message: t('confirm.cancelMessage'),
                          confirmLabel: t('confirm.cancelConfirm'),
                          cancelLabel: tc('actions.cancel'),
                          destructive: true,
                          onConfirm: () => {
                            void run(
                              () => setRequirementStatus(item.requirement_id, 'cancelled'),
                              t('feedback.statusChanged'),
                            );
                          },
                        })
                      }
                    >
                      {t('actions.cancel')}
                    </Button>
                  ) : null}
                </View>
              ) : null}

              <View style={styles.buttonRow}>
                <Button
                  variant="secondary"
                  disabled={busy}
                  style={styles.grow}
                  onPress={() => setEditing(true)}
                >
                  {t('actions.editInfo')}
                </Button>
                <Button
                  variant="danger"
                  disabled={busy}
                  style={styles.grow}
                  onPress={() =>
                    confirmAction({
                      title: tc('confirm.deleteTitle'),
                      message: t('confirm.deleteMessage', { title: item.title }),
                      confirmLabel: tc('actions.delete'),
                      cancelLabel: tc('actions.cancel'),
                      destructive: true,
                      onConfirm: () => {
                        void run(
                          () => deleteRequirement(item.requirement_id),
                          tc('feedback.deleted'),
                          [requirementKey(item.requirement_id)],
                        ).then((ok) => {
                          if (!ok) return;
                          // A deep-linked or refreshed page has no history entry
                          // to pop, and staying on a deleted requirement is a
                          // dead end.
                          if (router.canGoBack()) router.back();
                          else router.replace('/requirements');
                        });
                      },
                    })
                  }
                >
                  {t('actions.delete')}
                </Button>
              </View>
            </View>
          )}
        </>
      ) : null}
    </Screen>
  );
}

/** Label/value pair used by the metadata card. */
function MetaRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.metaRow, last ? undefined : { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <Text style={[styles.metaLabel, { color: colors.textTertiary }]}>{label}</Text>
      <Text style={[styles.metaValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginBottom: Spacing.sm },
  title: { fontSize: FontSize.xl, fontWeight: '700', lineHeight: 28 },
  headMeta: { fontSize: FontSize.xs, marginTop: Spacing.xs },
  body: { fontSize: FontSize.sm, lineHeight: 21 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: 9,
  },
  metaLabel: { fontSize: FontSize.sm },
  metaValue: { fontSize: FontSize.sm, fontWeight: '500', flexShrink: 1 },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: 4 },
  attachmentName: { fontSize: FontSize.sm, flexShrink: 1 },
  hint: { fontSize: FontSize.xs, marginTop: Spacing.sm },
  noticeCard: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, marginBottom: Spacing.md },
  notice: { fontSize: FontSize.sm, lineHeight: 20, flex: 1 },
  noteCard: { marginBottom: Spacing.md },
  noteInput: { minHeight: 110, paddingTop: Spacing.md, textAlignVertical: 'top' },
  actions: { gap: Spacing.sm },
  buttonRow: { flexDirection: 'row', gap: Spacing.sm },
  grow: { flex: 1 },
  stacked: { marginTop: Spacing.sm },
});
