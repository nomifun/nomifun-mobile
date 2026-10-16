/**
 * Workpath grouping for the session list — a port of the desktop sidebar rules
 * (`ui/src/renderer/pages/conversation/SessionList/utils/workpathKey.ts` and
 * `workpathTree.ts`), so the phone shelves a conversation under exactly the
 * same project node the desktop does.
 *
 * Protocol facts (docs/research/project-sessions.md §1/§4, workspace-runtime.md §2):
 * - There is no project table, no `project_id`. A "project session" is nothing
 *   but a non-empty `extra.workspace` pointing at a directory on the host.
 * - The server strips `custom_workspace` on create, so the desktop derives it
 *   in its mapper (`apiModelMapper.ts:197-204`). `isProjectConversation` below
 *   is that same expression and is the ONLY admissible test.
 * - `extra.is_temporary_workspace` is derived server-side on every read (the
 *   workspace sits under the backend data dir). Never guess it from the path
 *   shape.
 * - `workpathKey` is case-sensitive and does NOT canonicalize: `/a/proj` and
 *   `/a/./proj` are two different groups. That is intentional — the desktop
 *   behaves the same, and paths that come out of `/api/fs/browse` are already
 *   the server's own spelling.
 */
import type { Conversation } from './api';

/** Sentinel node for "no bound directory" (desktop `DEFAULT_WORKPATH_KEY`). */
export const DEFAULT_WORKPATH_KEY = '__default__';

/**
 * Line-for-line port of the desktop `workpathKey`: `\` → `/`, drop trailing
 * slashes, keep a bare `/`, empty → the default sentinel.
 *
 * Quirk kept on purpose: a pathological all-slash path (`//`) collapses to the
 * empty string, exactly as it does on the desktop. Callers fall back to the raw
 * path for display.
 */
export function workpathKey(workspace?: string | null): string {
  const trimmed = (workspace ?? '').trim();
  if (!trimmed) return DEFAULT_WORKPATH_KEY;
  const slashed = trimmed.replace(/\\/g, '/');
  if (slashed === '/') return '/';
  return slashed.replace(/\/+$/, '');
}

/**
 * The one and only project test: a workspace the user chose. The server does
 * not return `custom_workspace`, so this derivation is authoritative.
 */
export function isProjectConversation(conversation: Conversation): boolean {
  const extra = conversation.extra;
  return !!extra?.workspace && extra?.is_temporary_workspace !== true;
}

/**
 * A companion's own session. Its workspace is a backend-managed per-companion
 * directory (`<data_dir>/companion/companions/<id>/workspace`) and the server
 * forces `is_temporary_workspace: false` for it (`convert.rs:58-72`), so it
 * passes `isProjectConversation` while being no project of the user's at all.
 * Grouping therefore keeps companion sessions out of the project sections —
 * the predicate above stays untouched because unit 3 relies on it for "may I
 * repoint this workspace".
 */
export function isCompanionConversation(conversation: Conversation): boolean {
  const flag = conversation.extra?.companion_session;
  return flag === true || flag === 1;
}

/** Which section a row belongs to. Non-projects fall into the default node. */
export function groupKeyForConversation(conversation: Conversation): string {
  if (!isProjectConversation(conversation)) return DEFAULT_WORKPATH_KEY;
  if (isCompanionConversation(conversation)) return DEFAULT_WORKPATH_KEY;
  return workpathKey(conversation.extra?.workspace);
}

function segmentsOf(key: string): string[] {
  return key.split('/').filter(Boolean);
}

/**
 * Label at a given disambiguation depth: 1 = bare basename (the common case),
 * 2..n-1 = an elided tail (`…/api/src`), n and beyond = the full path. The
 * ellipsis matters: without it a widened label (`a/proj`) and a full path
 * (`/a/proj`) differ by one leading slash and read as the same thing.
 */
function labelFor(key: string, depth: number): string {
  const segments = segmentsOf(key);
  if (segments.length === 0) return key; // '/' — or the `//` degenerate case
  if (depth <= 1) return segments[segments.length - 1] ?? key;
  if (depth < segments.length) return `…/${segments.slice(-depth).join('/')}`;
  return key; // full path, the last disambiguator
}

/**
 * Display name for a single workspace: the basename (desktop
 * `workpathTree.ts:66-68`). Returns the sentinel for an empty workspace so the
 * caller can substitute its own i18n label.
 */
export function workspaceDisplayName(workspace: string): string {
  const key = workpathKey(workspace);
  if (key === DEFAULT_WORKPATH_KEY) return key;
  return segmentsOf(key).pop() ?? key;
}

/**
 * Disambiguated display names for a whole screen's worth of workspaces, keyed
 * by `workpathKey`. Basenames are used while they are unique; colliding ones
 * grow one parent segment at a time (`web/src` vs `api/src`) and fall back to
 * the full path when even that is not enough. The desktop does not disambiguate
 * (two same-named drawers), which on a narrow phone list is unusable.
 *
 * Accepts raw workspaces or already-normalized keys (`workpathKey` is
 * idempotent). Default/empty workspaces are skipped.
 */
export function workspaceDisplayNames(workspaces: Iterable<string>): Map<string, string> {
  const keys: string[] = [];
  for (const workspace of workspaces) {
    const key = workpathKey(workspace);
    if (key === DEFAULT_WORKPATH_KEY) continue;
    if (!keys.includes(key)) keys.push(key);
  }

  const depths = new Map<string, number>(keys.map((key) => [key, 1]));
  const rounds = keys.reduce((max, key) => Math.max(max, segmentsOf(key).length), 1) + 1;

  for (let round = 0; round < rounds; round++) {
    const byLabel = new Map<string, string[]>();
    for (const key of keys) {
      const label = labelFor(key, depths.get(key) ?? 1);
      const bucket = byLabel.get(label);
      if (bucket) bucket.push(key);
      else byLabel.set(label, [key]);
    }
    let widened = false;
    for (const bucket of byLabel.values()) {
      if (bucket.length < 2) continue;
      for (const key of bucket) {
        const depth = depths.get(key) ?? 1;
        // Stop once a wider slice no longer changes anything (full path reached).
        if (labelFor(key, depth + 1) === labelFor(key, depth)) continue;
        depths.set(key, depth + 1);
        widened = true;
      }
    }
    if (!widened) break;
  }

  const out = new Map<string, string>();
  for (const key of keys) out.set(key, labelFor(key, depths.get(key) ?? 1) || key);
  return out;
}

export interface ConversationGroup {
  /** Grouping identity: a normalized workpath, or `DEFAULT_WORKPATH_KEY`. */
  key: string;
  /**
   * Raw `extra.workspace` of the leading row — the string the server actually
   * stores, which is what "new session in this project" must send back. `null`
   * for the default group.
   */
  path: string | null;
  /** Basename, disambiguated against the other groups; `''` for the default. */
  displayName: string;
  isDefault: boolean;
  /** Members in the caller's order (pinned first, then `modified_at` desc). */
  items: Conversation[];
  /** `max(modified_at)` over the members — the desktop node `activityAt`. */
  activityAt: number;
}

/**
 * Group an already-sorted conversation list (pinned first, then `modified_at`
 * desc — see `useConversationList`) into sections. Member order is preserved,
 * so the in-group ordering is inherited rather than recomputed.
 *
 * Section order mirrors the desktop (`workpathTree.ts:124-133`) minus the
 * "pinned workpath" concept, which has no server representation: default node
 * first, then projects by most recent activity.
 */
export function buildConversationGroups(conversations: Conversation[]): ConversationGroup[] {
  const byKey = new Map<string, ConversationGroup>();

  for (const conversation of conversations) {
    const key = groupKeyForConversation(conversation);
    const activityAt = conversation.modified_at ?? 0;
    const existing = byKey.get(key);
    if (existing) {
      existing.items.push(conversation);
      if (activityAt > existing.activityAt) existing.activityAt = activityAt;
      continue;
    }
    const isDefault = key === DEFAULT_WORKPATH_KEY;
    byKey.set(key, {
      key,
      path: isDefault ? null : (conversation.extra?.workspace ?? '').trim() || key,
      displayName: '',
      isDefault,
      items: [conversation],
      activityAt,
    });
  }

  const labels = workspaceDisplayNames(byKey.keys());
  const groups = [...byKey.values()];
  for (const group of groups) {
    if (group.isDefault) continue;
    group.displayName = labels.get(group.key) || group.path || group.key;
  }

  return groups.sort(
    (a, b) =>
      Number(b.isDefault) - Number(a.isDefault) ||
      b.activityAt - a.activityAt ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}
