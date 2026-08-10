/**
 * `src/features/projects/{preview,paths,recent}.ts` — the pure parts of the
 * project-session feature.
 *
 * The preview gate is the interesting one: it exists to stop two specific
 * server behaviours from reaching the phone — `/api/fs/read` 500s on non-UTF-8
 * input, and its own size ceiling is 256 MB of inlined JSON. Anything the gate
 * lets through is a request that will be made.
 */
import { describe, expect, it } from 'bun:test';

import type { Conversation, ConversationExtra } from '@/features/sessions/api';
import {
  MAX_WORKSPACE_DEPTH,
  WORKSPACE_ROOT_PATH,
  joinWorkspacePath,
  parentWorkspacePath,
  workspaceSegments,
} from '@/features/projects/paths';
import {
  MAX_PREVIEW_BYTES,
  MAX_PREVIEW_CHARS,
  absoluteWorkspacePath,
  classifyPreview,
  fileExtension,
  formatBytes,
  isTextFileName,
  truncatePreview,
} from '@/features/projects/preview';
import { recentProjectShortcuts } from '@/features/projects/recent';

describe('workspace paths', () => {
  it('splits a relative path into non-empty segments', () => {
    expect(workspaceSegments('/')).toEqual([]);
    expect(workspaceSegments('/src')).toEqual(['src']);
    expect(workspaceSegments('/src//app/')).toEqual(['src', 'app']);
    expect(workspaceSegments('')).toEqual([]);
  });

  it('joins and un-joins symmetrically', () => {
    expect(joinWorkspacePath(WORKSPACE_ROOT_PATH, 'src')).toBe('/src');
    expect(joinWorkspacePath('/src', 'app')).toBe('/src/app');
    expect(parentWorkspacePath('/src/app')).toBe('/src');
    expect(parentWorkspacePath('/src')).toBe(WORKSPACE_ROOT_PATH);
    expect(parentWorkspacePath(WORKSPACE_ROOT_PATH)).toBe(WORKSPACE_ROOT_PATH);
  });

  it('agrees with the server depth ceiling', () => {
    let path = WORKSPACE_ROOT_PATH;
    for (let i = 0; i < MAX_WORKSPACE_DEPTH; i++) path = joinWorkspacePath(path, `d${i}`);
    expect(workspaceSegments(path)).toHaveLength(MAX_WORKSPACE_DEPTH);
  });
});

describe('fileExtension', () => {
  it('takes the last dot', () => {
    expect(fileExtension('a.tar.gz')).toBe('gz');
    expect(fileExtension('App.TSX')).toBe('tsx');
  });

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(fileExtension('.env')).toBe('');
    expect(fileExtension('.gitignore')).toBe('');
  });

  it('returns nothing for an extension-less name', () => {
    expect(fileExtension('Makefile')).toBe('');
    expect(fileExtension('')).toBe('');
    expect(fileExtension('trailing.')).toBe('');
  });
});

describe('isTextFileName', () => {
  it('accepts source, markup and config files', () => {
    for (const name of [
      'index.ts', 'App.tsx', 'main.rs', 'setup.py', 'Cargo.toml', 'package.json',
      'README.md', 'styles.css', 'notes.txt', 'server.log', 'fix.patch', 'q.graphql',
    ]) {
      expect(isTextFileName(name)).toBe(true);
    }
  });

  it('accepts the extension-less files that are text by convention', () => {
    expect(isTextFileName('Makefile')).toBe(true);
    expect(isTextFileName('LICENSE')).toBe(true);
    expect(isTextFileName('Dockerfile')).toBe(true);
    expect(isTextFileName('.env')).toBe(true);
    expect(isTextFileName('.gitignore')).toBe(true);
    expect(isTextFileName('bun.lock')).toBe(true);
  });

  it('rejects binaries, media and archives', () => {
    for (const name of [
      'logo.png', 'clip.mp4', 'archive.zip', 'lib.so', 'app.exe', 'font.woff2',
      'db.sqlite', 'photo.JPEG', 'model.onnx', 'doc.pdf', 'sheet.xlsx',
    ]) {
      expect(isTextFileName(name)).toBe(false);
    }
  });

  it('rejects an unknown extension and an empty name', () => {
    expect(isTextFileName('data.weird')).toBe(false);
    expect(isTextFileName('')).toBe(false);
    expect(isTextFileName('   ')).toBe(false);
  });
});

describe('classifyPreview', () => {
  it('accepts a small text file', () => {
    expect(classifyPreview({ name: 'a.ts', size: 1200 })).toEqual({ kind: 'text' });
  });

  it('refuses anything that does not look like text', () => {
    expect(classifyPreview({ name: 'logo.png', size: 100 })).toEqual({ kind: 'binary' });
    expect(classifyPreview({ name: 'a.bin', size: 100 })).toEqual({ kind: 'binary' });
    expect(classifyPreview({ name: 'src', size: 0, isDirectory: true })).toEqual({ kind: 'binary' });
  });

  it('trusts a text MIME when the name says nothing', () => {
    // The server guesses MIME from the extension, so this is the case where the
    // extension is unknown to us but known to `mime_guess`.
    expect(classifyPreview({ name: 'notes.weird', size: 10, mime: 'text/plain' })).toEqual({
      kind: 'text',
    });
    expect(classifyPreview({ name: 'x.unknown', size: 10, mime: 'application/json' })).toEqual({
      kind: 'text',
    });
    expect(classifyPreview({ name: 'x.unknown', size: 10, mime: 'application/octet-stream' })).toEqual(
      { kind: 'binary' },
    );
  });

  it('never trusts a MIME over a binary-looking extension it knows nothing about', () => {
    // `mime_guess` calls `.ts` a MPEG transport stream; the name gate wins.
    expect(classifyPreview({ name: 'a.ts', size: 10, mime: 'video/mp2t' })).toEqual({ kind: 'text' });
  });

  it('checks size before text-ness so a huge log is never fetched', () => {
    expect(classifyPreview({ name: 'huge.log', size: MAX_PREVIEW_BYTES + 1 })).toEqual({
      kind: 'tooLarge',
      size: MAX_PREVIEW_BYTES + 1,
    });
    expect(classifyPreview({ name: 'edge.log', size: MAX_PREVIEW_BYTES })).toEqual({ kind: 'text' });
  });

  it('reports an empty file as its own state', () => {
    expect(classifyPreview({ name: 'empty.txt', size: 0 })).toEqual({ kind: 'empty' });
  });

  it('treats a nonsense size as zero rather than throwing', () => {
    expect(classifyPreview({ name: 'a.txt', size: Number.NaN })).toEqual({ kind: 'empty' });
    expect(classifyPreview({ name: 'a.txt', size: -5 })).toEqual({ kind: 'empty' });
  });
});

describe('truncatePreview', () => {
  it('normalizes CRLF and drops the trailing newline', () => {
    expect(truncatePreview('a\r\nb\r\n')).toEqual({ text: 'a\nb', truncated: false, lines: 2 });
    expect(truncatePreview('a\rb')).toEqual({ text: 'a\nb', truncated: false, lines: 2 });
  });

  it('clips at the limit and says so', () => {
    const clipped = truncatePreview('x'.repeat(MAX_PREVIEW_CHARS + 10));
    expect(clipped.truncated).toBe(true);
    expect(clipped.text).toHaveLength(MAX_PREVIEW_CHARS);
  });

  it('honours a custom limit', () => {
    expect(truncatePreview('abcdef', 3)).toEqual({ text: 'abc', truncated: true, lines: 1 });
    expect(truncatePreview('abc', 3)).toEqual({ text: 'abc', truncated: false, lines: 1 });
  });

  it('reports an empty body as zero lines', () => {
    expect(truncatePreview('')).toEqual({ text: '', truncated: false, lines: 0 });
    expect(truncatePreview('\n\n')).toEqual({ text: '', truncated: false, lines: 0 });
  });
});

describe('formatBytes', () => {
  it('picks a unit', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('absoluteWorkspacePath', () => {
  it('joins a POSIX workspace with the browser path stack', () => {
    expect(absoluteWorkspacePath('/home/me/proj', [], 'a.ts')).toBe('/home/me/proj/a.ts');
    expect(absoluteWorkspacePath('/home/me/proj', ['src', 'app'], 'a.ts')).toBe(
      '/home/me/proj/src/app/a.ts',
    );
  });

  it('keeps Windows separators consistent', () => {
    expect(absoluteWorkspacePath('C:\\code\\app', ['src'], 'a.ts')).toBe('C:\\code\\app\\src\\a.ts');
    // A workspace already spelled with forward slashes stays that way.
    expect(absoluteWorkspacePath('C:/code/app', ['src'], 'a.ts')).toBe('C:/code/app/src/a.ts');
  });

  it('strips trailing separators instead of doubling them', () => {
    expect(absoluteWorkspacePath('/home/me/proj/', [], 'a.ts')).toBe('/home/me/proj/a.ts');
    expect(absoluteWorkspacePath('/', [], 'a.ts')).toBe('/a.ts');
    expect(absoluteWorkspacePath('  /home/me/proj  ', [], 'a.ts')).toBe('/home/me/proj/a.ts');
  });

  it('ignores empty stack entries', () => {
    expect(absoluteWorkspacePath('/p', ['', 'src', ''], 'a.ts')).toBe('/p/src/a.ts');
  });
});

describe('recentProjectShortcuts', () => {
  const label = (name: string) => `recent:${name}`;

  function row(id: string, extra: ConversationExtra | null, modifiedAt: number): Conversation {
    return {
      conversation_id: id,
      name: id,
      type: 'chat',
      created_at: modifiedAt,
      modified_at: modifiedAt,
      extra,
    };
  }

  it('lists project directories, newest first', () => {
    const shortcuts = recentProjectShortcuts(
      [
        row('a', { workspace: '/a/old' }, 100),
        row('b', { workspace: '/b/new' }, 900),
      ],
      label,
    );
    expect(shortcuts).toEqual([
      { label: 'recent:new', path: '/b/new' },
      { label: 'recent:old', path: '/a/old' },
    ]);
  });

  it('deduplicates by workpath, keeping the most recent spelling', () => {
    const shortcuts = recentProjectShortcuts(
      [
        row('newest', { workspace: '/a/proj/' }, 900),
        row('older', { workspace: '/a/proj' }, 100),
      ],
      label,
    );
    expect(shortcuts).toHaveLength(1);
    // The server's own spelling, trimmed only — that is what a create sends back.
    expect(shortcuts[0].path).toBe('/a/proj/');
  });

  it('skips temporary workspaces, companion sessions and workspace-less rows', () => {
    const shortcuts = recentProjectShortcuts(
      [
        row('tmp', { workspace: '/data/tmp/x', is_temporary_workspace: true }, 900),
        row('companion', { workspace: '/data/companion/c1/workspace', companion_session: 1 }, 800),
        row('plain', {}, 700),
        row('null-extra', null, 600),
        row('blank', { workspace: '   ' }, 500),
        row('real', { workspace: '/a/proj' }, 400),
      ],
      label,
    );
    expect(shortcuts).toEqual([{ label: 'recent:proj', path: '/a/proj' }]);
  });

  it('disambiguates two projects with the same basename', () => {
    const shortcuts = recentProjectShortcuts(
      [
        row('a', { workspace: '/repo/web/src' }, 900),
        row('b', { workspace: '/repo/api/src' }, 800),
      ],
      label,
    );
    expect(shortcuts.map((entry) => entry.label)).toEqual(['recent:…/web/src', 'recent:…/api/src']);
  });

  it('honours the limit and handles empty input', () => {
    const rows = Array.from({ length: 9 }, (_, index) =>
      row(`c${index}`, { workspace: `/p/proj-${index}` }, 100 - index),
    );
    expect(recentProjectShortcuts(rows, label)).toHaveLength(5);
    expect(recentProjectShortcuts(rows, label, 2).map((entry) => entry.path)).toEqual([
      '/p/proj-0',
      '/p/proj-1',
    ]);
    expect(recentProjectShortcuts(rows, label, 0)).toEqual([]);
    expect(recentProjectShortcuts([], label)).toEqual([]);
  });

  it('does not depend on the server having sorted the rows', () => {
    const shortcuts = recentProjectShortcuts(
      [row('a', { workspace: '/a' }, 1), row('b', { workspace: '/b' }, 2)],
      label,
      1,
    );
    expect(shortcuts[0].path).toBe('/b');
  });
});
