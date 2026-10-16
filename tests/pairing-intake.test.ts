import { describe, expect, it } from 'bun:test';

import { isPairingAppLink, PairingAttemptLock } from '@/api/pairing-intake';

describe('isPairingAppLink', () => {
  it('recognizes canonical and legacy app links, including malformed payloads for error UI', () => {
    expect(isPairingAppLink('nomifun://pair?v=1&url=...')).toBe(true);
    expect(isPairingAppLink('nomi://pair?v=2')).toBe(true);
    expect(isPairingAppLink(' \n nomifun://pair \n ')).toBe(true);
  });

  it('leaves unrelated routes and web links to their existing handlers', () => {
    for (const raw of [null, undefined, '', 'not a URL', 'nomifun://session/1', 'https://h/qr-login']) {
      expect(isPairingAppLink(raw)).toBe(false);
    }
  });
});

describe('PairingAttemptLock', () => {
  it('acquires synchronously only once and cannot unlock an ongoing exchange', () => {
    const lock = new PairingAttemptLock();
    expect(lock.tryStart()).toBe(true);
    expect(lock.tryStart()).toBe(false);
    expect(lock.resetForRescan()).toBe(false);
    expect(lock.status).toBe('pending');
  });

  it('keeps failed or invalid scans paused until an explicit rescan', () => {
    const lock = new PairingAttemptLock();
    lock.tryStart();
    lock.fail();
    expect(lock.status).toBe('failed');
    for (let callback = 0; callback < 10; callback++) expect(lock.tryStart()).toBe(false);
    expect(lock.resetForRescan()).toBe(true);
    expect(lock.status).toBe('ready');
    expect(lock.tryStart()).toBe(true);
    expect(lock.tryStart()).toBe(false);
  });

  it('never unlocks a successful intake or lets a later failure undo success', () => {
    const lock = new PairingAttemptLock();
    lock.tryStart();
    lock.succeed();
    lock.fail();
    expect(lock.status).toBe('succeeded');
    expect(lock.tryStart()).toBe(false);
    expect(lock.resetForRescan()).toBe(false);
  });

  it('ignores completion callbacks without an acquired attempt', () => {
    const lock = new PairingAttemptLock();
    lock.fail();
    lock.succeed();
    expect(lock.status).toBe('ready');
  });
});
