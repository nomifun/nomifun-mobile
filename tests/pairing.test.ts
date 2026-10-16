import { describe, expect, it } from 'bun:test';

import {
  InvalidPairingUrlError,
  PairingOriginMismatchError,
  parseConnectionPayload,
  parsePairingUrl,
  redeemConnectionPayload,
  resolveConnectionPayload,
  type ParsedConnectionPayload,
} from '@/api/pairing';

const TOKEN = 'b'.repeat(64);
const ORIGIN = 'https://relay.example.com:19090';
const DEVICE_QR = `${ORIGIN}/device-pair?token=${TOKEN}`;
const BROWSER_QR = `${ORIGIN}/qr-login?token=${TOKEN}`;
const envelope = (url: string, scheme = 'nomifun') =>
  `${scheme}://pair?v=1&url=${encodeURIComponent(url)}`;
const PAIRING_URL = envelope(DEVICE_QR);

describe('parsePairingUrl', () => {
  it('unwraps the canonical app scheme and device ticket', () => {
    expect(parsePairingUrl(PAIRING_URL)).toEqual({
      source: 'pairing-url',
      credentialKind: 'device-pair',
      baseUrl: ORIGIN,
      qrToken: TOKEN,
    });
  });

  it('keeps legacy app envelopes and browser QR recognition', () => {
    expect(parsePairingUrl(envelope(DEVICE_QR, 'nomi'))?.credentialKind).toBe('device-pair');
    expect(parsePairingUrl(envelope(BROWSER_QR, 'nomi'))?.credentialKind).toBe('qr-login');
    expect(parsePairingUrl(envelope(BROWSER_QR))?.credentialKind).toBe('qr-login');
  });

  it('trims whitespace and accepts the optional envelope slash', () => {
    expect(parsePairingUrl(`\n ${PAIRING_URL} \n`)?.source).toBe('pairing-url');
    expect(parsePairingUrl(PAIRING_URL.replace('://pair?', '://pair/?'))?.source).toBe('pairing-url');
  });

  it('rejects unversioned, ambiguous, or credential-bearing envelopes', () => {
    const invalid = [
      `nomifun://pair?url=${encodeURIComponent(DEVICE_QR)}`,
      `nomifun://pair?v=2&url=${encodeURIComponent(DEVICE_QR)}`,
      `nomifun://pair?v=1`,
      `${PAIRING_URL}&v=1`,
      `${PAIRING_URL}&url=${encodeURIComponent(DEVICE_QR)}`,
      `${PAIRING_URL}&admin_password=secret`,
      `${PAIRING_URL}&token=${TOKEN}`,
      `${PAIRING_URL}#fragment`,
      PAIRING_URL.replace('://pair?', '://pair:123?'),
      PAIRING_URL.replace('://pair?', '://user:pass@pair?'),
      PAIRING_URL.replace('://pair?', '://pair/extra?'),
      PAIRING_URL.replace('://pair?', '://different?'),
      PAIRING_URL.replace('nomifun:', 'https:'),
      envelope(envelope(DEVICE_QR)),
      envelope('ftp://h/device-pair?token=' + TOKEN),
      envelope('https://user:pass@h/device-pair?token=' + TOKEN),
      envelope('https://h/login?token=' + TOKEN),
    ];
    for (const raw of invalid) expect(parsePairingUrl(raw)).toBeNull();
  });
});

describe('parseConnectionPayload', () => {
  it('accepts direct device QR URLs and legacy Desktop browser QR URLs', () => {
    expect(parseConnectionPayload(DEVICE_QR)).toEqual({
      source: 'desktop-qr', credentialKind: 'device-pair', baseUrl: ORIGIN, qrToken: TOKEN,
    });
    expect(parseConnectionPayload(BROWSER_QR)).toEqual({
      source: 'desktop-qr', credentialKind: 'qr-login', baseUrl: ORIGIN, qrToken: TOKEN,
    });
  });

  it('does not change the established browser QR parser compatibility', () => {
    expect(parseConnectionPayload(`${ORIGIN}/prefix/qr-login/?token=${TOKEN}&extra=1#fragment`))
      .toEqual({
        source: 'desktop-qr', credentialKind: 'qr-login', baseUrl: ORIGIN, qrToken: TOKEN,
      });
  });

  it('keeps new device ticket URLs closed and rejects ambiguous tokens', () => {
    const invalid = [
      `${DEVICE_QR}&token=${TOKEN}`,
      `${BROWSER_QR}&token=${TOKEN}`,
      `${DEVICE_QR}&extra=1`,
      `${DEVICE_QR}#fragment`,
      `${ORIGIN}/prefix/device-pair?token=${TOKEN}`,
      `${ORIGIN}/device-pair/deeper?token=${TOKEN}`,
      `${ORIGIN}/device-pair?token=${'x'.repeat(64)}`,
      `${ORIGIN}/device-pair?token=${'a'.repeat(31)}`,
      `${ORIGIN}/device-pair?token=${'a'.repeat(129)}`,
    ];
    for (const raw of invalid) expect(parseConnectionPayload(raw)).toBeNull();
    expect(parseConnectionPayload(`${ORIGIN}/device-pair/?token=${TOKEN}`)?.qrToken).toBe(TOKEN);
  });
});

describe('resolveConnectionPayload', () => {
  it('retains the native endpoint and resolves H5 to relative requests', () => {
    expect(resolveConnectionPayload(PAIRING_URL).baseUrl).toBe(ORIGIN);
    expect(resolveConnectionPayload(PAIRING_URL, { currentOrigin: ORIGIN }).baseUrl).toBe('');
    expect(resolveConnectionPayload(BROWSER_QR, { currentOrigin: ORIGIN }).baseUrl).toBe('');
  });

  it('compares normalized origins including case, default ports, and IPv6', () => {
    const matches = [
      ['http://DESKTOP.example:80', 'http://desktop.example'],
      ['https://desktop.example:443', 'https://DESKTOP.example'],
      ['http://[2001:db8::1]:80', 'http://[2001:db8:0:0:0:0:0:1]'],
    ];
    for (const [target, currentOrigin] of matches) {
      const raw = envelope(`${target}/device-pair?token=${TOKEN}`);
      expect(resolveConnectionPayload(raw, { currentOrigin }).baseUrl).toBe('');
    }
  });

  it('rejects cross-origin and unavailable H5 origins without exposing credentials', () => {
    const mismatch = [
      '', 'not-an-origin', 'file:///app',
      'http://relay.example.com:19090',
      'https://relay.example.com:19091',
      'https://relay.example.com.attacker:19090',
      'https://other.example.com:19090',
      'https://user:pass@relay.example.com:19090',
    ];
    for (const currentOrigin of mismatch) {
      try {
        resolveConnectionPayload(PAIRING_URL, { currentOrigin });
        throw new Error('expected origin rejection');
      } catch (error) {
        expect(error).toBeInstanceOf(PairingOriginMismatchError);
        expect((error as Error).message).not.toContain(TOKEN);
        expect((error as Error).message).not.toContain(ORIGIN);
      }
    }
  });
});

describe('redeemConnectionPayload', () => {
  it('passes only the native endpoint and one-shot token to a token exchange', async () => {
    const calls: Array<[string, string]> = [];
    const receipt = await redeemConnectionPayload(PAIRING_URL, 1, async (baseUrl, qrToken, epoch) => {
      calls.push([baseUrl, qrToken]);
      return { user: { user_id: 'u1', username: 'admin' }, epoch };
    });
    expect(receipt.user.username).toBe('admin');
    expect(receipt.epoch).toBe(1);
    expect(calls).toEqual([[ORIGIN, TOKEN]]);
  });

  it('gives a structured adapter the credential kind without reparsing', async () => {
    const calls: ParsedConnectionPayload[] = [];
    await redeemConnectionPayload(BROWSER_QR, 1, {
      redeem: async (payload, epoch) => {
        calls.push(payload);
        return { user: { user_id: 'u1', username: 'admin' }, epoch };
      },
    });
    expect(calls[0]?.credentialKind).toBe('qr-login');
    expect(calls[0]?.baseUrl).toBe(ORIGIN);
  });

  it('checks H5 origin before selecting a relative exchange endpoint', async () => {
    const calls: Array<[string, string]> = [];
    await redeemConnectionPayload(PAIRING_URL, 1, async (baseUrl, qrToken, epoch) => {
      calls.push([baseUrl, qrToken]);
      return { user: { user_id: 'u1', username: 'admin' }, epoch };
    }, { currentOrigin: ORIGIN });
    expect(calls).toEqual([['', TOKEN]]);
  });

  it('fails before any exchange for invalid or cross-origin input', async () => {
    let called = false;
    const exchange = async () => {
      called = true;
      return { user: { user_id: 'u1', username: 'admin' }, epoch: 1 };
    };
    try {
      await redeemConnectionPayload('nomifun://pair?v=1&token=secret', 1, exchange);
      throw new Error('expected invalid URL rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPairingUrlError);
    }
    try {
      await redeemConnectionPayload(PAIRING_URL, 1, exchange, { currentOrigin: 'https://other.example' });
      throw new Error('expected origin rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PairingOriginMismatchError);
    }
    expect(called).toBe(false);
  });
});
