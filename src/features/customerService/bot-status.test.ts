/**
 * Unit tests for `botStatusKey` (`bun test`).
 *
 * The branch that matters is `error`: the runtime parks a bot there when the
 * handshake failed for good (revoked/mistyped token → Telegram `getMe` 401) and
 * `connected` never flips true afterwards. Folding that into `connecting` shows
 * a spinner-ish "连接中" forever, so it must stay a distinct, danger-toned key.
 */
import { describe, expect, it } from 'bun:test';

import { botStatusKey, normalizeChannelPluginStatus } from './normalize';
import type { ChannelPluginStatus } from './types';

const bot = (patch: Partial<ChannelPluginStatus> = {}): ChannelPluginStatus => ({
  plugin_id: 'p1',
  type: 'telegram',
  name: 'Telegram Bot',
  enabled: true,
  connected: false,
  hasToken: true,
  owner_domain: 'customer_service',
  ...patch,
});

describe('botStatusKey', () => {
  it('reports a failed handshake as error, not connecting', () => {
    expect(botStatusKey(bot({ status: 'error' }))).toBe('error');
  });

  it('still says connecting while the runtime is mid-lifecycle', () => {
    expect(botStatusKey(bot({ status: 'starting' }))).toBe('connecting');
    expect(botStatusKey(bot({ status: undefined }))).toBe('connecting');
  });

  it('prefers connected over a stale error phase', () => {
    expect(botStatusKey(bot({ connected: true, status: 'error' }))).toBe('connected');
  });

  it('keeps the more actionable keys ahead of error', () => {
    // No credentials at all — telling the user to fix a "connection" is wrong.
    expect(botStatusKey(bot({ hasToken: false, status: 'error' }))).toBe('noToken');
    // Turned off on purpose; the recorded error is stale.
    expect(botStatusKey(bot({ enabled: false, status: 'error' }))).toBe('disabled');
  });
});

describe('normalizeChannelPluginStatus', () => {
  it('carries the runtime phase through from the wire', () => {
    const row = normalizeChannelPluginStatus({
      plugin_id: '019feb62-19b0-7821-9c56-ab34d22d2434',
      type: 'telegram',
      name: 'Telegram Bot',
      enabled: true,
      status: 'error',
      connected: false,
      has_token: true,
      owner_domain: 'customer_service',
    });
    expect(row.status).toBe('error');
    expect(botStatusKey(row)).toBe('error');
  });

  it('leaves the phase undefined when the server omits it', () => {
    const row = normalizeChannelPluginStatus({
      plugin_id: '019feb62-19b0-7821-9c56-ab34d22d2434',
      type: 'telegram',
      name: 'Telegram Bot',
      enabled: true,
      connected: true,
      has_token: true,
    });
    expect(row.status).toBeUndefined();
    expect(botStatusKey(row)).toBe('connected');
  });
});
