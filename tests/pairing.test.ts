import { describe, expect, it } from 'bun:test';

import {
  InvalidPairingUrlError,
  parseConnectionPayload,
  parsePairingUrl,
  redeemConnectionPayload,
} from '@/api/pairing';

const TOKEN = 'b'.repeat(64);
const DESKTOP_QR = `https://relay.example.com:19090/qr-login?token=${TOKEN}`;
const PAIRING_URL = `nomi://pair?v=1&url=${encodeURIComponent(DESKTOP_QR)}`;

describe('parsePairingUrl', () => {
  it('unwraps a versioned pairing envelope around the existing Desktop QR', () => {
    expect(parsePairingUrl(PAIRING_URL)).toEqual({
      source: 'pairing-url',
      baseUrl: 'https://relay.example.com:19090',
      qrToken: TOKEN,
    });
  });

  it('trims whitespace and rejects unknown envelope fields', () => {
    expect(parsePairingUrl(`\n ${PAIRING_URL} \n`)?.source).toBe('pairing-url');
    expect(parsePairingUrl(`${PAIRING_URL}&admin_password=secret`)).toBeNull();
    expect(parsePairingUrl(`nomi://pair?v=2&url=${encodeURIComponent(DESKTOP_QR)}`)).toBeNull();
    expect(parsePairingUrl(`nomi://pair?v=1&url=${encodeURIComponent('https://h/login?token=x')}`)).toBeNull();
  });

  it('does not accept credentials, direct tokens, or non-pair schemes', () => {
    expect(parsePairingUrl(`nomi://pair?v=1&token=${TOKEN}`)).toBeNull();
    expect(parsePairingUrl(`nomi://pair?v=1&url=${encodeURIComponent(DESKTOP_QR)}&token=${TOKEN}`)).toBeNull();
    expect(parsePairingUrl(`https://relay.example.com/pair?v=1&url=${encodeURIComponent(DESKTOP_QR)}`)).toBeNull();
    expect(parsePairingUrl(`nomi://pair?v=1&url=${encodeURIComponent('https://user:pass@h/qr-login?token=' + TOKEN)}`)).toBeNull();
  });
});

describe('parseConnectionPayload', () => {
  it('keeps the existing Desktop QR format working', () => {
    expect(parseConnectionPayload(DESKTOP_QR)).toEqual({
      source: 'desktop-qr',
      baseUrl: 'https://relay.example.com:19090',
      qrToken: TOKEN,
    });
  });

  it('accepts both legacy and wrapped QR inputs', () => {
    expect(parseConnectionPayload(PAIRING_URL)?.source).toBe('pairing-url');
    expect(parseConnectionPayload(DESKTOP_QR)?.source).toBe('desktop-qr');
  });
});

describe('redeemConnectionPayload', () => {
  it('passes only the Desktop endpoint and one-shot QR token to the exchange', async () => {
    const calls: Array<[string, string]> = [];
    const user = await redeemConnectionPayload(PAIRING_URL, async (baseUrl, qrToken) => {
      calls.push([baseUrl, qrToken]);
      return { user_id: 'u1', username: 'admin' };
    });

    expect(user.username).toBe('admin');
    expect(calls).toEqual([['https://relay.example.com:19090', TOKEN]]);
  });

  it('uses the same exchange for the legacy Desktop QR', async () => {
    const calls: Array<[string, string]> = [];
    await redeemConnectionPayload(DESKTOP_QR, async (baseUrl, qrToken) => {
      calls.push([baseUrl, qrToken]);
      return { user_id: 'u1', username: 'admin' };
    });
    expect(calls).toEqual([['https://relay.example.com:19090', TOKEN]]);
  });

  it('fails before any network exchange for invalid input', async () => {
    let called = false;
    try {
      await redeemConnectionPayload('nomi://pair?v=1&token=secret', async () => {
        called = true;
        return { user_id: 'u1', username: 'admin' };
      });
      throw new Error('expected invalid pairing URL');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPairingUrlError);
    }
    expect(called).toBe(false);
  });
});
