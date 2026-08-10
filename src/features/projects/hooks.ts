/**
 * SWR wiring for the read-only workspace file browser.
 *
 * Two error codes are *states*, not failures, and are modelled as such:
 * - 404 → the workspace directory is not on disk (yet). The server answers 404
 *   on purpose so that a polling rail does not produce a 500 storm.
 * - 400 "no workspace assigned" → the row has no workspace at all.
 *
 * There are no workspace WebSocket events server-side, so refreshing is
 * user-driven (pull-to-refresh / the refresh button in the browser header).
 */
import { useCallback, useMemo, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

import {
  conversationWorkspaceKey,
  listConversationWorkspace,
  type WorkspaceEntry,
} from './api';
import { isWorkspaceDirectoryMissingError, isWorkspaceUnassignedError } from './errors';
import {
  MAX_WORKSPACE_DEPTH,
  WORKSPACE_ROOT_PATH,
  joinWorkspacePath,
  parentWorkspacePath,
  workspaceSegments,
} from './paths';

/**
 * Drop every cached conversation-list page after a create/rebind so the session
 * list regroups. The list is `useSWRInfinite`, whose internal keys wrap the
 * request path, hence the substring match instead of a prefix one.
 *
 * `conversation.listChanged` normally covers this over WebSocket; this is the
 * belt for the case where the socket is reconnecting.
 */
export function invalidateConversationLists(): void {
  void globalMutate((key) => typeof key === 'string' && key.includes('/api/conversations?'));
}

type Listing =
  | { kind: 'ok'; entries: WorkspaceEntry[] }
  | { kind: 'missing' }
  | { kind: 'unassigned' };

export interface WorkspaceListingState {
  /** Server order is already directories-first, case-insensitive alphabetical. */
  entries: WorkspaceEntry[];
  isLoading: boolean;
  isRefreshing: boolean;
  /** 404 — show an empty state, never an error dialog. */
  missing: boolean;
  /** 400 — the conversation carries no workspace. */
  unassigned: boolean;
  error: unknown;
  refresh: () => Promise<unknown>;
  retry: () => void;
}

export function useWorkspaceListing(
  conversationId: string | undefined,
  path: string,
): WorkspaceListingState {
  const key = conversationId ? conversationWorkspaceKey(conversationId, path) : null;
  const [refreshing, setRefreshing] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<Listing>(key, async (): Promise<Listing> => {
    if (!conversationId) return { kind: 'ok', entries: [] };
    try {
      const entries = await listConversationWorkspace(conversationId, path);
      return { kind: 'ok', entries };
    } catch (err) {
      if (isWorkspaceDirectoryMissingError(err)) return { kind: 'missing' };
      if (isWorkspaceUnassignedError(err)) return { kind: 'unassigned' };
      throw err;
    }
  });

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      return await mutate();
    } finally {
      setRefreshing(false);
    }
  }, [mutate]);

  return {
    entries: data?.kind === 'ok' ? data.entries : [],
    isLoading: isLoading && !data,
    isRefreshing: refreshing,
    missing: data?.kind === 'missing',
    unassigned: data?.kind === 'unassigned',
    error,
    refresh,
    retry: () => void mutate(),
  };
}

export interface WorkspaceBrowserState extends WorkspaceListingState {
  /** Workspace-relative path, always starting with `/`. */
  path: string;
  segments: string[];
  /** False at the workspace root. */
  canGoUp: boolean;
  /** The server refuses relative depths beyond `MAX_WORKSPACE_DEPTH`. */
  atDepthLimit: boolean;
  openDirectory: (name: string) => void;
  goUp: () => void;
}

/** Path stack + listing for one conversation's workspace. */
export function useWorkspaceBrowser(conversationId: string | undefined): WorkspaceBrowserState {
  const [path, setPath] = useState<string>(WORKSPACE_ROOT_PATH);
  const listing = useWorkspaceListing(conversationId, path);
  const segments = useMemo(() => workspaceSegments(path), [path]);

  const openDirectory = useCallback(
    (name: string) => {
      setPath((current) =>
        workspaceSegments(current).length >= MAX_WORKSPACE_DEPTH
          ? current
          : joinWorkspacePath(current, name),
      );
    },
    [],
  );

  return {
    ...listing,
    path,
    segments,
    canGoUp: segments.length > 0,
    atDepthLimit: segments.length >= MAX_WORKSPACE_DEPTH,
    openDirectory,
    goUp: () => setPath((current) => parentWorkspacePath(current)),
  };
}
