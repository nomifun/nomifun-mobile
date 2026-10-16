/**
 * `src/features/sessions/workpath.ts` — the session-list grouping rules.
 *
 * These are a line-for-line port of the desktop sidebar, so the tests below
 * pin the *quirks* as much as the happy path: no canonicalization, a
 * case-sensitive key, the `//` degenerate collapse, and companion sessions
 * being excluded from project sections while still passing
 * `isProjectConversation`.
 */
import { describe, expect, it } from 'bun:test';

import type { Conversation, ConversationExtra } from '@/features/sessions/api';
import {
  DEFAULT_WORKPATH_KEY,
  buildConversationGroups,
  groupKeyForConversation,
  isCompanionConversation,
  isProjectConversation,
  workpathKey,
  workspaceDisplayName,
  workspaceDisplayNames,
} from '@/features/sessions/workpath';

function conversation(
  id: string,
  extra: ConversationExtra | null,
  modifiedAt = 0,
): Conversation {
  return {
    conversation_id: id,
    name: id,
    type: 'chat',
    created_at: modifiedAt,
    modified_at: modifiedAt,
    extra,
  };
}

describe('workpathKey', () => {
  it('normalizes Windows separators', () => {
    expect(workpathKey('C:\\Users\\me\\proj')).toBe('C:/Users/me/proj');
  });

  it('drops trailing slashes but keeps a bare root', () => {
    expect(workpathKey('/a/b/')).toBe('/a/b');
    expect(workpathKey('/a/b///')).toBe('/a/b');
    expect(workpathKey('/')).toBe('/');
    expect(workpathKey('C:\\')).toBe('C:');
  });

  it('answers the sentinel for every flavour of empty', () => {
    expect(workpathKey('')).toBe(DEFAULT_WORKPATH_KEY);
    expect(workpathKey('   ')).toBe(DEFAULT_WORKPATH_KEY);
    expect(workpathKey(null)).toBe(DEFAULT_WORKPATH_KEY);
    expect(workpathKey(undefined)).toBe(DEFAULT_WORKPATH_KEY);
  });

  it('trims surrounding whitespace before normalizing', () => {
    expect(workpathKey('  /a/b/  ')).toBe('/a/b');
  });

  it('does NOT canonicalize — that is the desktop behaviour', () => {
    expect(workpathKey('/a/./proj')).toBe('/a/./proj');
    expect(workpathKey('/a/../proj')).toBe('/a/../proj');
    // Case-sensitive on purpose: paths come from the server's own spelling.
    expect(workpathKey('/A/Proj')).toBe('/A/Proj');
  });

  it('collapses an all-slash path to the empty string (documented quirk)', () => {
    expect(workpathKey('//')).toBe('');
  });

  it('is idempotent, so keys may be fed back in', () => {
    expect(workpathKey(workpathKey('C:\\a\\b\\'))).toBe('C:/a/b');
  });
});

describe('isProjectConversation', () => {
  it('is true for a non-empty, non-temporary workspace', () => {
    expect(isProjectConversation(conversation('a', { workspace: '/home/me/proj' }))).toBe(true);
  });

  it('is true when the temporary flag is absent or false', () => {
    expect(
      isProjectConversation(
        conversation('a', { workspace: '/home/me/proj', is_temporary_workspace: false }),
      ),
    ).toBe(true);
  });

  it('is false for a temporary workspace', () => {
    expect(
      isProjectConversation(
        conversation('a', { workspace: '/data/tmp/x', is_temporary_workspace: true }),
      ),
    ).toBe(false);
  });

  it('is false without a workspace', () => {
    expect(isProjectConversation(conversation('a', {}))).toBe(false);
    expect(isProjectConversation(conversation('a', { workspace: '' }))).toBe(false);
    expect(isProjectConversation(conversation('a', null))).toBe(false);
  });
});

describe('isCompanionConversation', () => {
  it('accepts both the boolean and the SQLite integer shape', () => {
    expect(isCompanionConversation(conversation('a', { companion_session: true }))).toBe(true);
    expect(isCompanionConversation(conversation('a', { companion_session: 1 }))).toBe(true);
  });

  it('is false for every other value', () => {
    expect(isCompanionConversation(conversation('a', { companion_session: false }))).toBe(false);
    expect(isCompanionConversation(conversation('a', { companion_session: 0 }))).toBe(false);
    expect(isCompanionConversation(conversation('a', {}))).toBe(false);
    expect(isCompanionConversation(conversation('a', null))).toBe(false);
  });
});

describe('groupKeyForConversation', () => {
  it('shelves plain and temporary sessions under the default node', () => {
    expect(groupKeyForConversation(conversation('a', {}))).toBe(DEFAULT_WORKPATH_KEY);
    expect(
      groupKeyForConversation(
        conversation('a', { workspace: '/data/tmp', is_temporary_workspace: true }),
      ),
    ).toBe(DEFAULT_WORKPATH_KEY);
  });

  it('keeps a companion session out of the project sections', () => {
    const companion = conversation('a', {
      workspace: '/data/companion/companions/c1/workspace',
      companion_session: true,
    });
    // It passes the project predicate (the server forces the flag false)…
    expect(isProjectConversation(companion)).toBe(true);
    // …but it is not a project of the user's.
    expect(groupKeyForConversation(companion)).toBe(DEFAULT_WORKPATH_KEY);
  });

  it('uses the normalized workpath for a real project', () => {
    expect(groupKeyForConversation(conversation('a', { workspace: '/home/me/proj/' }))).toBe(
      '/home/me/proj',
    );
  });
});

describe('workspaceDisplayName', () => {
  it('is the basename', () => {
    expect(workspaceDisplayName('/home/me/proj')).toBe('proj');
    expect(workspaceDisplayName('C:\\code\\app\\')).toBe('app');
  });

  it('returns the sentinel for an empty workspace so callers can localize it', () => {
    expect(workspaceDisplayName('')).toBe(DEFAULT_WORKPATH_KEY);
    expect(workspaceDisplayName('   ')).toBe(DEFAULT_WORKPATH_KEY);
  });

  it('returns the root itself for `/` (it has no basename)', () => {
    expect(workspaceDisplayName('/')).toBe('/');
  });

  it('returns the empty string for the `//` degenerate path (documented quirk)', () => {
    expect(workspaceDisplayName('//')).toBe('');
  });
});

describe('workspaceDisplayNames', () => {
  it('uses bare basenames while they are unique', () => {
    const names = workspaceDisplayNames(['/a/web', '/b/api']);
    expect(names.get('/a/web')).toBe('web');
    expect(names.get('/b/api')).toBe('api');
  });

  it('widens colliding basenames by one parent segment, with an ellipsis', () => {
    const names = workspaceDisplayNames(['/repo/web/src', '/repo/api/src']);
    expect(names.get('/repo/web/src')).toBe('…/web/src');
    expect(names.get('/repo/api/src')).toBe('…/api/src');
  });

  it('falls back to the full path rather than an elision that adds nothing', () => {
    // Elision only kicks in while the widened slice is a strict tail
    // (`depth < segments.length`); `…/a/proj` and `/a/proj` would read the
    // same, so the second round hands out full paths instead.
    const names = workspaceDisplayNames(['/proj', '/a/proj']);
    expect(names.get('/proj')).toBe('/proj');
    expect(names.get('/a/proj')).toBe('/a/proj');
  });

  it('disambiguates three-way collisions', () => {
    const names = workspaceDisplayNames(['/x/a/src', '/x/b/src', '/y/a/src']);
    expect(names.get('/x/b/src')).toBe('…/b/src');
    // `/x/a/src` and `/y/a/src` share two tails, so both grow to the full path.
    expect(names.get('/x/a/src')).toBe('/x/a/src');
    expect(names.get('/y/a/src')).toBe('/y/a/src');
  });

  it('accepts raw workspaces and already-normalized keys alike', () => {
    const names = workspaceDisplayNames(['C:\\code\\app\\', '/code/app']);
    expect(names.get('C:/code/app')).toBe('…/code/app');
    expect(names.get('/code/app')).toBe('/code/app');
  });

  it('deduplicates inputs that normalize to the same key', () => {
    const names = workspaceDisplayNames(['/a/proj', '/a/proj/', '/a/proj']);
    expect(names.size).toBe(1);
    expect(names.get('/a/proj')).toBe('proj');
  });

  it('skips empty workspaces and handles an empty input', () => {
    expect(workspaceDisplayNames([]).size).toBe(0);
    const names = workspaceDisplayNames(['', '   ', '/a/proj']);
    expect(names.size).toBe(1);
    expect(names.get('/a/proj')).toBe('proj');
  });

  it('labels the filesystem root with itself', () => {
    expect(workspaceDisplayNames(['/']).get('/')).toBe('/');
  });

  it('never yields an empty label, even for the `//` quirk', () => {
    expect(workspaceDisplayNames(['//']).get('')).toBe('');
  });
});

describe('buildConversationGroups', () => {
  it('returns nothing for nothing', () => {
    expect(buildConversationGroups([])).toEqual([]);
  });

  it('puts the default node first, then projects by most recent activity', () => {
    const groups = buildConversationGroups([
      conversation('p-old', { workspace: '/a/old' }, 100),
      conversation('plain', {}, 50),
      conversation('p-new', { workspace: '/a/new' }, 900),
    ]);
    expect(groups.map((group) => group.key)).toEqual([DEFAULT_WORKPATH_KEY, '/a/new', '/a/old']);
    expect(groups[0].isDefault).toBe(true);
    expect(groups[0].displayName).toBe('');
    expect(groups[0].path).toBeNull();
  });

  it('preserves the caller ordering inside a group and reports max activity', () => {
    const groups = buildConversationGroups([
      conversation('first', { workspace: '/a/proj' }, 10),
      conversation('second', { workspace: '/a/proj/' }, 90),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].items.map((item) => item.conversation_id)).toEqual(['first', 'second']);
    expect(groups[0].activityAt).toBe(90);
  });

  it('keeps the raw workspace of the leading row as the group path', () => {
    const groups = buildConversationGroups([
      conversation('a', { workspace: '  /a/proj/  ' }, 10),
      conversation('b', { workspace: '/a/proj' }, 5),
    ]);
    expect(groups[0].key).toBe('/a/proj');
    // Trimmed, but otherwise verbatim — this is the string a rebind sends back.
    expect(groups[0].path).toBe('/a/proj/');
  });

  it('merges temporary and companion sessions into the default node', () => {
    const groups = buildConversationGroups([
      conversation('tmp', { workspace: '/data/tmp', is_temporary_workspace: true }, 30),
      conversation('companion', { workspace: '/data/c/ws', companion_session: 1 }, 20),
      conversation('plain', null, 10),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(DEFAULT_WORKPATH_KEY);
    expect(groups[0].items).toHaveLength(3);
    expect(groups[0].activityAt).toBe(30);
  });

  it('disambiguates same-basename project sections', () => {
    const groups = buildConversationGroups([
      conversation('a', { workspace: '/repo/web/src' }, 20),
      conversation('b', { workspace: '/repo/api/src' }, 10),
    ]);
    expect(groups.map((group) => group.displayName)).toEqual(['…/web/src', '…/api/src']);
  });

  it('breaks an activity tie by key so the order is stable', () => {
    const groups = buildConversationGroups([
      conversation('b', { workspace: '/b' }, 5),
      conversation('a', { workspace: '/a' }, 5),
    ]);
    expect(groups.map((group) => group.key)).toEqual(['/a', '/b']);
  });

  it('treats a missing modified_at as zero activity', () => {
    const row = conversation('a', { workspace: '/a/proj' });
    // Server rows always carry it; a hand-built optimistic row may not.
    const groups = buildConversationGroups([
      { ...row, modified_at: undefined as unknown as number },
    ]);
    expect(groups[0].activityAt).toBe(0);
  });
});
