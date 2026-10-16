import { describe, expect, it } from 'bun:test';

import { sessionTokenRefreshDelayMs } from '@/api/session-token';

function base64Url(value: string): string {
  const binary = Array.from(
    new TextEncoder().encode(value),
    (byte) => String.fromCharCode(byte),
  ).join('');
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function token(iat: number, exp: number): string {
  return `${base64Url('{"alg":"none"}')}.${base64Url(
    JSON.stringify({ iat, exp, username: '测试用户' }),
  )}.signature`;
}

describe('sessionTokenRefreshDelayMs', () => {
  it('refreshes a bearer JWT at half-life', () => {
    expect(sessionTokenRefreshDelayMs(token(1_000, 3_000), 1_500_000)).toBe(
      500_000,
    );
  });

  it('refreshes immediately once half-life has passed', () => {
    expect(sessionTokenRefreshDelayMs(token(1_000, 3_000), 2_500_000)).toBe(0);
  });

  it('returns no schedule for malformed or non-window tokens', () => {
    expect(sessionTokenRefreshDelayMs('not-a-jwt', 0)).toBeUndefined();
    expect(sessionTokenRefreshDelayMs(token(3_000, 1_000), 0)).toBeUndefined();
  });
});
