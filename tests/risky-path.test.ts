/**
 * `src/features/fs/risky-path.ts` — the two client-only path heuristics.
 *
 * They only drive warning copy, so the expensive failure mode is a *false
 * positive*: a warning on an ordinary project directory teaches the user to
 * ignore the warning. Half of the cases below are therefore near-misses
 * (`/etcetera`, `/usrlocal`, `my.ssh-notes`) that must NOT warn.
 */
import { describe, expect, it } from 'bun:test';

import { hasEdgeWhitespaceSegment, isRiskyWorkspacePath } from '@/features/fs/risky-path';

describe('isRiskyWorkspacePath — hits', () => {
  it('flags the filesystem root and bare drives', () => {
    expect(isRiskyWorkspacePath('/')).toBe(true);
    expect(isRiskyWorkspacePath('C:')).toBe(true);
    expect(isRiskyWorkspacePath('C:/')).toBe(true);
    expect(isRiskyWorkspacePath('C:\\')).toBe(true);
    expect(isRiskyWorkspacePath('d:\\')).toBe(true);
  });

  it('flags the unexpanded home marker', () => {
    expect(isRiskyWorkspacePath('~')).toBe(true);
  });

  it('flags Unix system trees and their children', () => {
    for (const path of ['/etc', '/etc/nginx', '/usr', '/usr/local/bin', '/bin', '/system']) {
      expect(isRiskyWorkspacePath(path)).toBe(true);
    }
  });

  it('flags the Windows system tree, case-insensitively', () => {
    expect(isRiskyWorkspacePath('C:\\Windows')).toBe(true);
    expect(isRiskyWorkspacePath('c:/windows/system32')).toBe(true);
  });

  it('flags a home directory itself but not its children', () => {
    expect(isRiskyWorkspacePath('/home/rika')).toBe(true);
    expect(isRiskyWorkspacePath('/home/rika/')).toBe(true);
    expect(isRiskyWorkspacePath('/Users/rika')).toBe(true);
    expect(isRiskyWorkspacePath('C:/Users/rika')).toBe(true);
    expect(isRiskyWorkspacePath('/root')).toBe(true);
    expect(isRiskyWorkspacePath('/home/rika/code')).toBe(false);
  });

  it('flags credential stores at any depth, case-insensitively', () => {
    expect(isRiskyWorkspacePath('/home/rika/.ssh')).toBe(true);
    expect(isRiskyWorkspacePath('/home/rika/.ssh/keys')).toBe(true);
    expect(isRiskyWorkspacePath('/srv/.aws/config')).toBe(true);
    expect(isRiskyWorkspacePath('/srv/.GnuPG')).toBe(true);
    expect(isRiskyWorkspacePath('C:\\Users\\rika\\.ssh\\x')).toBe(true);
  });

  it('normalizes trailing slashes before matching', () => {
    expect(isRiskyWorkspacePath('/etc/')).toBe(true);
    expect(isRiskyWorkspacePath('/etc///')).toBe(true);
    expect(isRiskyWorkspacePath('  /etc  ')).toBe(true);
  });
});

describe('isRiskyWorkspacePath — must not warn', () => {
  it('does not match a prefix that merely starts like a system tree', () => {
    expect(isRiskyWorkspacePath('/etcetera')).toBe(false);
    expect(isRiskyWorkspacePath('/usrlocal')).toBe(false);
    expect(isRiskyWorkspacePath('/binary')).toBe(false);
    expect(isRiskyWorkspacePath('/systemd')).toBe(false);
    expect(isRiskyWorkspacePath('C:/WindowsApps')).toBe(false);
  });

  it('does not match a filename that merely contains a credential name', () => {
    expect(isRiskyWorkspacePath('/home/rika/my.ssh-notes')).toBe(false);
    expect(isRiskyWorkspacePath('/home/rika/.sshfs')).toBe(false);
    expect(isRiskyWorkspacePath('/home/rika/aws')).toBe(false);
  });

  it('accepts ordinary project directories', () => {
    expect(isRiskyWorkspacePath('/home/rika/src/nomifun-mobile')).toBe(false);
    expect(isRiskyWorkspacePath('/Users/rika/Documents/proj')).toBe(false);
    expect(isRiskyWorkspacePath('C:\\code\\app')).toBe(false);
    expect(isRiskyWorkspacePath('/opt/data')).toBe(false);
    expect(isRiskyWorkspacePath('/home/rika/.config/nomi')).toBe(false);
  });

  it('says nothing about empty or non-string input', () => {
    expect(isRiskyWorkspacePath('')).toBe(false);
    expect(isRiskyWorkspacePath('   ')).toBe(false);
    expect(isRiskyWorkspacePath(null as unknown as string)).toBe(false);
    expect(isRiskyWorkspacePath(undefined as unknown as string)).toBe(false);
    expect(isRiskyWorkspacePath(42 as unknown as string)).toBe(false);
  });

  it('does not flag a home-like path with more segments', () => {
    expect(isRiskyWorkspacePath('/home')).toBe(false);
    expect(isRiskyWorkspacePath('/home/rika/a/b')).toBe(false);
    expect(isRiskyWorkspacePath('C:/Users')).toBe(false);
  });
});

describe('hasEdgeWhitespaceSegment', () => {
  it('catches a leading or trailing space on any segment', () => {
    expect(hasEdgeWhitespaceSegment('/a/ b/c')).toBe(true);
    expect(hasEdgeWhitespaceSegment('/a/b /c')).toBe(true);
    expect(hasEdgeWhitespaceSegment('/a/b ')).toBe(true);
    expect(hasEdgeWhitespaceSegment(' /a/b')).toBe(true);
    expect(hasEdgeWhitespaceSegment('/a/\tb')).toBe(true);
  });

  it('catches it through Windows separators too', () => {
    expect(hasEdgeWhitespaceSegment('C:\\a \\b')).toBe(true);
    expect(hasEdgeWhitespaceSegment('C:\\a\\b')).toBe(false);
  });

  it('allows interior spaces — the backend does too', () => {
    expect(hasEdgeWhitespaceSegment('/Library/Application Support/nomi')).toBe(false);
    expect(hasEdgeWhitespaceSegment('C:\\Program Files\\nomi')).toBe(false);
  });

  it('ignores empty segments from doubled separators', () => {
    expect(hasEdgeWhitespaceSegment('/a//b')).toBe(false);
    expect(hasEdgeWhitespaceSegment('/')).toBe(false);
  });

  it('says nothing about empty or non-string input', () => {
    expect(hasEdgeWhitespaceSegment('')).toBe(false);
    expect(hasEdgeWhitespaceSegment(null as unknown as string)).toBe(false);
    expect(hasEdgeWhitespaceSegment(7 as unknown as string)).toBe(false);
  });
});
