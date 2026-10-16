/**
 * Working-directory entry point for the chat screen: the pill under the header
 * plus the panel behind it (full path, read-only file browser).
 *
 * Protocol facts this component encodes:
 * - "project session" is derived client-side (`isProjectConversation`) — the
 *   server does not return `custom_workspace`.
 * - The workspace is a frozen resource binding: it is chosen at create time
 *   and there is no rebind surface, so the panel is strictly read-only.
 * - The copy never claims the agent is confined to the directory: as the
 *   installation owner it runs with the OS user's full authority.
 */
import { useCallback, useState } from 'react';
// `Clipboard` is deprecated in RN core but still shipped (and implemented by
// react-native-web); expo-clipboard is not a dependency of this app.
import { Clipboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button, Card, Tag, toast } from '@/components/ui';
import { Fonts, FontSize, Spacing } from '@/constants/theme';
import type { Conversation } from '@/features/sessions/api';
import { isProjectConversation, workspaceDisplayName } from '@/features/sessions/workpath';
import { useTheme } from '@/hooks/use-theme';

import { Sheet } from '@/components/ui/sheet';
import { WorkspaceChip } from './workspace-chip';
import { WorkspaceFiles } from './workspace-files';

interface WorkspacePanelProps {
  conversation: Conversation | undefined;
  onChanged?: () => void;
}

type PanelView = 'closed' | 'overview' | 'files';

export function WorkspacePanel({ conversation }: WorkspacePanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation('project');
  const { t: tc } = useTranslation('common');

  const [view, setView] = useState<PanelView>('closed');

  const conversationId = conversation?.conversation_id;
  const workspace = conversation?.extra?.workspace?.trim() ?? '';
  const isProject = conversation ? isProjectConversation(conversation) : false;
  const temporary = workspace.length > 0 && !isProject;

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
        scroll={view !== 'files'}
        wide={view === 'files'}
        onClose={() => setView('closed')}
      >
        {view === 'files' ? (
          <WorkspaceFiles
            conversationId={conversationId}
            // The listing is session-scoped, but reading a file needs the
            // absolute path — and the workspace root as the request's sandbox.
            workspace={workspace}
            onExit={() => setView('overview')}
          />
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

            <Button variant="secondary" onPress={() => setView('files')}>
              {t('sheet.browse')}
            </Button>
          </View>
        )}
      </Sheet>
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
