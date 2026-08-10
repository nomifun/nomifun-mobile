/**
 * Working-directory entry point for the chat screen: the pill under the header
 * plus the panel behind it (full path, rebind, read-only file browser).
 *
 * Protocol facts this component encodes:
 * - "project session" is derived client-side (`isProjectConversation`) — the
 *   server does not return `custom_workspace`.
 * - Rebinding is offered for project sessions only. A temporary workspace is
 *   restored from `temp_workspace_id` on every read, so a PATCH there is a
 *   silent no-op (and clearing the marker breaks the row permanently).
 * - A successful rebind recycles the agent runtime, so the copy says the change
 *   lands on the next message.
 * - The copy never claims the agent is confined to the directory: as the
 *   installation owner it runs with the OS user's full authority.
 */
import { useCallback, useState } from 'react';
// `Clipboard` is deprecated in RN core but still shipped (and implemented by
// react-native-web); expo-clipboard is not a dependency of this app.
import { Clipboard, InteractionManager, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Tag, toast } from '@/components/ui';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import { isRiskyWorkspacePath } from '@/features/fs/api';
import { DirectoryPicker } from '@/features/fs/components/directory-picker';
import type { Conversation } from '@/features/sessions/api';
import { isProjectConversation, workspaceDisplayName } from '@/features/sessions/workpath';
import { useTheme } from '@/hooks/use-theme';

import { patchConversationWorkspace } from '../api';
import { confirmAction } from '../confirm';
import { workspaceErrorMessage } from '../errors';
import { invalidateConversationLists } from '../hooks';
import { Sheet } from './sheet';
import { WorkspaceChip } from './workspace-chip';
import { WorkspaceFiles } from './workspace-files';

interface WorkspacePanelProps {
  conversation: Conversation | undefined;
  /** Refetch the row after a rebind — the chip label comes from it. */
  onChanged?: () => void;
}

type PanelView = 'closed' | 'overview' | 'files';

export function WorkspacePanel({ conversation, onChanged }: WorkspacePanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('project');
  const { t: tc } = useTranslation('common');

  const [view, setView] = useState<PanelView>('closed');
  const [pickerVisible, setPickerVisible] = useState(false);
  const [saving, setSaving] = useState(false);

  const conversationId = conversation?.conversation_id;
  const workspace = conversation?.extra?.workspace?.trim() ?? '';
  const isProject = conversation ? isProjectConversation(conversation) : false;
  const temporary = workspace.length > 0 && !isProject;

  const apply = useCallback(
    async (picked: string) => {
      if (!conversationId) return;
      setSaving(true);
      try {
        await patchConversationWorkspace(conversationId, picked);
        invalidateConversationLists();
        onChanged?.();
        toast.success(t('sheet.changed'));
        setView('closed');
      } catch (error) {
        toast.error(
          t('sheet.changeFailed', {
            message: workspaceErrorMessage(error, {
              edgeWhitespace: t('errors.edgeWhitespace'),
              notOwner: t('errors.notOwner'),
              fallback: tc('feedback.requestFailed'),
            }),
          }),
        );
      } finally {
        setSaving(false);
      }
    },
    [conversationId, onChanged, t, tc],
  );

  const handlePick = useCallback(
    (picked: string) => {
      setPickerVisible(false);
      if (picked === workspace) return;
      const risky = isRiskyWorkspacePath(picked);
      const body = t('sheet.changeBody', { path: picked });
      // The picker calls onPick + onClose in the same tick, so its modal is
      // still dismissing right now; presenting the confirm on top of a
      // dismissing modal is how iOS swallows alerts. Wait for the animation.
      void InteractionManager.runAfterInteractions(() => {
        confirmAction({
          title: t('sheet.changeTitle'),
          message: risky ? `${body}\n\n${t('sheet.changeRisky')}` : body,
          confirmLabel: t('sheet.changeConfirm'),
          cancelLabel: tc('actions.cancel'),
          onConfirm: () => void apply(picked),
        });
      });
    },
    [apply, t, tc, workspace],
  );

  const copyPath = useCallback(() => {
    Clipboard.setString(workspace);
    toast.success(tc('feedback.copied'));
  }, [tc, workspace]);

  if (!conversationId || workspace.length === 0) return null;

  const label = temporary ? t('chip.temporary') : workspaceDisplayName(workspace);

  return (
    <>
      <View style={styles.bar}>
        <WorkspaceChip
          label={label}
          temporary={temporary}
          accessibilityLabel={t('chip.open')}
          onPress={() => setView('overview')}
        />
      </View>

      <Sheet
        visible={view !== 'closed'}
        title={view === 'files' ? t('files.title') : t('sheet.title')}
        closeLabel={tc('actions.close')}
        scrollable={view !== 'files'}
        onClose={() => setView('closed')}
      >
        {view === 'files' ? (
          <WorkspaceFiles conversationId={conversationId} onExit={() => setView('overview')} />
        ) : (
          <View style={styles.overview}>
            <Card style={styles.pathCard}>
              <Text style={[styles.pathLabel, { color: colors.textTertiary }]}>
                {t('sheet.pathLabel')}
              </Text>
              <View style={styles.pathRow}>
                <Text style={[styles.path, { color: colors.text }]} selectable>
                  {workspace}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('sheet.copy')}
                  onPress={copyPath}
                  style={({ pressed }) => [styles.copy, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Ionicons name="copy-outline" size={18} color={colors.primary} />
                </Pressable>
              </View>
              {temporary ? <Tag tone="warning">{t('chip.temporary')}</Tag> : null}
            </Card>

            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {temporary ? t('sheet.temporaryHint') : t('sheet.projectHint')}
            </Text>

            {isProject ? (
              <Button
                variant="secondary"
                loading={saving}
                onPress={() => setPickerVisible(true)}
              >
                {t('sheet.change')}
              </Button>
            ) : null}

            <Button variant="secondary" onPress={() => setView('files')}>
              {t('sheet.browse')}
            </Button>
          </View>
        )}
      </Sheet>

      <DirectoryPicker
        visible={pickerVisible}
        initialPath={workspace}
        onClose={() => setPickerVisible(false)}
        onPick={handlePick}
      />
    </>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xs },
  overview: { gap: Spacing.md },
  pathCard: { gap: Spacing.xs },
  pathLabel: { fontSize: FontSize.xs, fontWeight: '600' },
  pathRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  path: { flex: 1, fontSize: FontSize.sm, lineHeight: 20, fontFamily: Fonts.mono },
  copy: { width: 44, height: 44, alignItems: 'flex-end', justifyContent: 'center' },
  hint: { fontSize: FontSize.sm, lineHeight: 20 },
});
