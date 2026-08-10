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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useSWR, { mutate as globalMutate } from 'swr';

import type { Conversation, Paginated } from '@/features/sessions/api';
import { conversationsPath } from '@/features/sessions/api';

import {
  type FileMetadata,
  type WorkspaceEntry,
  conversationWorkspaceKey,
  fileMetadata,
  listConversationWorkspace,
  readTextFile,
} from './api';
import {
  type PreviewFailure,
  isWorkspaceDirectoryMissingError,
  isWorkspaceUnassignedError,
  previewFailureKind,
} from './errors';
import {
  MAX_WORKSPACE_DEPTH,
  WORKSPACE_ROOT_PATH,
  joinWorkspacePath,
  parentWorkspacePath,
  workspaceSegments,
} from './paths';
import {
  type PreviewVerdict,
  absoluteWorkspacePath,
  classifyPreview,
  isTextFileName,
  truncatePreview,
} from './preview';
import { type DirectoryShortcut, RECENT_PROJECT_LIMIT, recentProjectShortcuts } from './recent';

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

// ── Recent project directories ─────────────────────────────────────

/**
 * The last few project directories, for the picker's start screen.
 *
 * Reads page one of `GET /api/conversations` (25 rows) and derives the list —
 * see `./recent`. No local storage: the desktop is the single source of truth,
 * so the list is identical on every device and self-heals when a project
 * session is deleted. `enabled: false` (a closed picker) fetches nothing.
 */
export function useRecentProjectDirectories(
  label: (name: string) => string,
  enabled = true,
  limit = RECENT_PROJECT_LIMIT,
): DirectoryShortcut[] {
  const { data } = useSWR<Paginated<Conversation>>(enabled ? conversationsPath() : null, {
    revalidateOnFocus: false,
    // Purely decorative: a failure means no shortcuts, never an error state.
    shouldRetryOnError: false,
  });
  // Not memoized on purpose: `label` is an inline arrow, so any dependency list
  // would either be wrong (stale labels) or useless (new identity every
  // render). Deriving five shortcuts from ≤25 rows is cheaper than the ceremony,
  // and with the picker closed there is no data to walk at all.
  return recentProjectShortcuts(data?.items ?? [], label, limit);
}

// ── File preview ───────────────────────────────────────────────────

export type FilePreviewState =
  | { kind: 'idle' }
  | { kind: 'loading'; name: string }
  /** Fetched and clipped for rendering. */
  | { kind: 'ready'; name: string; size: number; text: string; truncated: boolean; lines: number }
  /** Deliberately not fetched (binary / too large / empty file). */
  | { kind: 'refused'; name: string; reason: 'binary' | 'tooLarge' | 'empty'; size: number }
  | { kind: 'failed'; name: string; reason: PreviewFailure };

export interface FilePreview {
  state: FilePreviewState;
  /** Open the file `name` inside the currently browsed directory. */
  open: (name: string) => void;
  close: () => void;
  retry: () => void;
}

/**
 * One-shot read of a single workspace file, gated by its metadata.
 *
 * Deliberately not SWR: a preview must reflect the file *now* (the agent is
 * writing into this directory while the user looks at it), and caching an
 * inlined file body per path is exactly the wrong thing to keep in memory on a
 * phone.
 *
 * Two round trips by design — `metadata` first so a binary or huge file is
 * refused without ever transferring it (`/api/fs/read` inlines the whole file
 * into JSON and 500s on non-UTF-8 input).
 *
 * `workspace` is the conversation's absolute `extra.workspace`; without it the
 * request has no sandbox root that covers the project and every read is a 403.
 */
export function useFilePreview(
  workspace: string | undefined,
  segments: readonly string[],
): FilePreview {
  const [state, setState] = useState<FilePreviewState>({ kind: 'idle' });
  /** Guards against a slow response for a file the user already navigated away from. */
  const request = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(
    async (name: string) => {
      if (!workspace) return;
      const token = ++request.current;
      const settle = (next: FilePreviewState) => {
        if (mounted.current && request.current === token) setState(next);
      };

      // Refuse a non-text file from its *name*, before any request. The two
      // round trips would tell us nothing new — `mime_guess` on the server does
      // not know `.tsx`/`.toml` and calls `.ts` a video stream — and letting one
      // through to `/api/fs/read` is a 500 (`fs::read_to_string`). Refusing here
      // rather than in the row's `onPress` is what makes the tap answer with a
      // reason instead of doing nothing at all.
      if (!isTextFileName(name)) {
        settle({ kind: 'refused', name, reason: 'binary', size: 0 });
        return;
      }

      setState({ kind: 'loading', name });
      const absolute = absoluteWorkspacePath(workspace, segments, name);
      try {
        let meta: FileMetadata | undefined;
        try {
          meta = await fileMetadata(absolute, workspace);
        } catch (error) {
          settle({ kind: 'failed', name, reason: previewFailureKind(error) });
          return;
        }        const verdict: PreviewVerdict = classifyPreview({
          name,
          size: meta.size,
          mime: meta.type,
          isDirectory: meta.is_directory,
        });
        if (verdict.kind !== 'text') {
          settle({
            kind: 'refused',
            name,
            reason: verdict.kind,
            size: verdict.kind === 'tooLarge' ? verdict.size : meta.size,
          });
          return;
        }
        const content = await readTextFile(absolute, workspace);
        if (content === null) {
          // Inside the sandbox but not on disk — it went away since the listing.
          settle({ kind: 'failed', name, reason: 'notFound' });
          return;
        }
        const clipped = truncatePreview(content);
        settle({
          kind: 'ready',
          name,
          size: meta.size,
          text: clipped.text,
          truncated: clipped.truncated,
          lines: clipped.lines,
        });
      } catch (error) {
        settle({ kind: 'failed', name, reason: previewFailureKind(error) });
      }
    },
    [segments, workspace],
  );

  const open = useCallback(
    (name: string) => {
      void load(name);
    },
    [load],
  );

  const close = useCallback(() => {
    request.current += 1;
    setState({ kind: 'idle' });
  }, []);

  const retry = useCallback(() => {
    if (state.kind === 'idle') return;
    void load(state.name);
  }, [load, state]);

  return { state, open, close, retry };
}
