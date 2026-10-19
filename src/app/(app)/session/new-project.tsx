/**
 * Create a project session: pick a directory on the desktop machine, name the
 * session, POST it, land in the chat.
 *
 * The picker obtains a real server directory; creation canonicalizes and
 * validates it before freezing the session's workspace binding.
 */
import { useCallback, useState } from 'react';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Button, Screen, TextField, toast } from '@/components/ui';
import { DirectoryPicker } from '@/features/fs/components/directory-picker';
import { hasEdgeWhitespaceSegment, isRiskyWorkspacePath } from '@/features/fs/api';
import { DirectoryField } from '@/features/projects/components/directory-field';
import { RiskyPathNotice } from '@/features/projects/components/risky-path-notice';
import { workspaceErrorMessage } from '@/features/projects/errors';
import { useRecentProjectDirectories } from '@/features/projects/hooks';
import { useSessionList } from '@/features/sessions/list-context';
import { isStaleSessionError, sessionErrorText } from '@/features/sessions/errors';
import { DEFAULT_WORKPATH_KEY, workspaceDisplayName } from '@/features/sessions/workpath';

/** `?workspace=` prefill, sent by the "+" on a project group in the list. */
function initialWorkspace(param: string | string[] | undefined): string {
  const raw = Array.isArray(param) ? param[0] : param;
  return raw?.trim() ?? '';
}

/**
 * Default session name = the directory's basename. `workspaceDisplayName`
 * answers the group sentinel for an empty path and a bare `'/'` for the file
 * system root; neither is a name, so those degrade to "let the server name it".
 */
function defaultSessionName(path: string): string {
  if (path.length === 0) return '';
  const label = workspaceDisplayName(path);
  return label === DEFAULT_WORKPATH_KEY || label === '/' ? '' : label;
}

export default function NewProjectSessionScreen() {
  const { t } = useTranslation('project');
  const { t: tc } = useTranslation('common');
  const params = useLocalSearchParams<{ workspace?: string }>();
  const sessions = useSessionList();

  const [workspace, setWorkspace] = useState(() => initialWorkspace(params.workspace));
  const [name, setName] = useState(() => defaultSessionName(initialWorkspace(params.workspace)));
  /** Once the user edits the name, changing the directory must not overwrite it. */
  const [nameTouched, setNameTouched] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [directoryError, setDirectoryError] = useState<string | undefined>(undefined);
  /** Armed by the first tap on a risky path — a soft gate, not a block. */
  const [riskArmed, setRiskArmed] = useState(false);
  const submitting = sessions.creating;

  /**
   * Directories the user already runs project sessions in, offered on the
   * picker's start screen, derived from the shared loaded session window.
   */
  const recentDirectories = useRecentProjectDirectories(
    (name) => t('create.recentDirectory', { name }),
    pickerVisible,
  );

  const risky = workspace.length > 0 && isRiskyWorkspacePath(workspace);
  // The server rejects edge whitespace with a 400 only at submit time, and the
  // picker closes before its own warning can be read — so warn here too.
  const edgeWhitespace = workspace.length > 0 && hasEdgeWhitespaceSegment(workspace);

  const handlePick = useCallback(
    (picked: string) => {
      setPickerVisible(false);
      setWorkspace(picked);
      setDirectoryError(undefined);
      setRiskArmed(false);
      if (!nameTouched) setName(defaultSessionName(picked));
    },
    [nameTouched],
  );

  const submit = useCallback(async () => {
    if (submitting) return;
    if (workspace.length === 0) {
      setDirectoryError(t('create.needDirectory'));
      return;
    }
    if (risky && !riskArmed) {
      setRiskArmed(true);
      return;
    }
    try {
      // CreateAgentSessionRequestDto carries {preset_id, title?, model?,
      // workspace?} — the directory is frozen into the session's Workspace
      // binding here. An empty name falls back to the basename so the field
      // hint stays true (the server would otherwise mint its own default).
      const fallbackName = name.trim() || defaultSessionName(workspace);
      const created = await sessions.create(fallbackName || undefined, { workspace });
      if (!sessions.isCurrent() || created.epoch !== sessions.epoch) return;
      toast.success(t('create.created'));
      if (created?.conversation_id) {
        router.replace(`/session/${created.conversation_id}`);
      } else {
        router.back();
      }
    } catch (error) {
      if (!sessions.isCurrent() || isStaleSessionError(error)) return;
      toast.error(
        t('create.failed', {
          message: workspaceErrorMessage(error, {
            edgeWhitespace: t('errors.edgeWhitespace'),
            notOwner: t('errors.notOwner'),
            fallback: sessionErrorText(error, tc('feedback.requestFailed')),
          }),
        }),
      );
    }
  }, [name, risky, riskArmed, sessions, submitting, t, tc, workspace]);

  return (
    <Screen keyboardAvoiding>
      <Stack.Screen options={{ title: t('create.title') }} />

      <DirectoryField
        path={workspace || undefined}
        error={directoryError}
        onPress={() => setPickerVisible(true)}
      />

      <TextField
        label={t('create.nameLabel')}
        placeholder={t('create.namePlaceholder')}
        hint={t('create.nameHint')}
        value={name}
        autoCapitalize="sentences"
        onChangeText={(next) => {
          setNameTouched(true);
          setName(next);
        }}
      />

      {edgeWhitespace ? (
        <RiskyPathNotice
          title={t('create.whitespaceTitle')}
          body={t('create.whitespaceHint', { path: workspace })}
        />
      ) : null}

      {risky ? (
        <RiskyPathNotice
          title={t('create.riskyTitle')}
          body={t('create.riskyHint', { path: workspace })}
          confirmHint={riskArmed ? t('create.riskyConfirmHint') : undefined}
        />
      ) : null}

      <Button onPress={() => void submit()} loading={submitting}>
        {risky ? t('create.submitConfirm') : t('create.submit')}
      </Button>

      <DirectoryPicker
        visible={pickerVisible}
        initialPath={workspace || undefined}
        shortcuts={recentDirectories}
        onClose={() => setPickerVisible(false)}
        onPick={handlePick}
      />
    </Screen>
  );
}
