/**
 * `src/api/utils.ts` — QR payload parsing and the two tiny helpers around it.
 *
 * `parseQrPayload` is the app's only trust boundary that is pure: whatever the
 * camera decodes lands here, so the tests below are mostly hostile input.
 */
import { describe, expect, it } from 'bun:test';

import { normalizeBaseUrl, parseQrPayload, randomHex } from '@/api/utils';

const TOKEN = 'a'.repeat(64);

describe('parseQrPayload — accepts', () => {
  it('parses the desktop WebUI QR url', () => {
    expect(parseQrPayload(`http://192.168.1.5:5173/qr-login?token=${TOKEN}`)).toEqual({
      baseUrl: 'http://192.168.1.5:5173',
      qrToken: TOKEN,
    });
  });

  it('accepts https and a hostname', () => {
    expect(parseQrPayload(`https://nomi.local/qr-login?token=${TOKEN}`)).toEqual({
      baseUrl: 'https://nomi.local',
      qrToken: TOKEN,
    });
  });

  it('trims surrounding whitespace and newlines', () => {
    expect(parseQrPayload(`\n  http://h:1/qr-login?token=${TOKEN}  \n`)?.baseUrl).toBe('http://h:1');
  });

  it('tolerates a trailing slash on the path', () => {
    expect(parseQrPayload(`http://h:1/qr-login/?token=${TOKEN}`)?.qrToken).toBe(TOKEN);
  });

  it('accepts a mounted sub-path', () => {
    expect(parseQrPayload(`http://h:1/webui/qr-login?token=${TOKEN}`)?.baseUrl).toBe('http://h:1');
  });

  it('keeps the origin only — path, extra query and hash are dropped', () => {
    expect(parseQrPayload(`http://h:1/qr-login?token=${TOKEN}&extra=1#frag`)).toEqual({
      baseUrl: 'http://h:1',
      qrToken: TOKEN,
    });
  });

  it('normalizes a default port away, exactly as `URL.origin` does', () => {
    expect(parseQrPayload(`http://h:80/qr-login?token=${TOKEN}`)?.baseUrl).toBe('http://h');
    expect(parseQrPayload(`https://h:443/qr-login?token=${TOKEN}`)?.baseUrl).toBe('https://h');
  });

  it('accepts the documented token length range and mixed case hex', () => {
    expect(parseQrPayload(`http://h/qr-login?token=${'A'.repeat(32)}`)?.qrToken).toBe('A'.repeat(32));
    expect(parseQrPayload(`http://h/qr-login?token=${'aF0'.repeat(20)}`)?.qrToken).toHaveLength(60);
    expect(parseQrPayload(`http://h/qr-login?token=${'b'.repeat(128)}`)).toBeTruthy();
  });
});

describe('parseQrPayload — rejects', () => {
  it('rejects anything that is not a URL', () => {
    expect(parseQrPayload('nope')).toBeNull();
    expect(parseQrPayload('')).toBeNull();
    expect(parseQrPayload('   ')).toBeNull();
    expect(parseQrPayload(`/qr-login?token=${TOKEN}`)).toBeNull();
  });

  it('rejects a non-http scheme', () => {
    expect(parseQrPayload(`ftp://h/qr-login?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`nomifun://h/qr-login?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`ws://h/qr-login?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`javascript:alert(1)//qr-login?token=${TOKEN}`)).toBeNull();
  });

  it('rejects a different path', () => {
    expect(parseQrPayload(`http://h/login?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`http://h/?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`http://h/qr-login-extra?token=${TOKEN}`)).toBeNull();
    expect(parseQrPayload(`http://h/qr-login/deeper?token=${TOKEN}`)).toBeNull();
  });

  it('rejects a missing or empty token', () => {
    expect(parseQrPayload('http://h/qr-login')).toBeNull();
    expect(parseQrPayload('http://h/qr-login?token=')).toBeNull();
    expect(parseQrPayload('http://h/qr-login?tokens=' + TOKEN)).toBeNull();
  });

  it('rejects a token that is not hex or is out of range', () => {
    expect(parseQrPayload(`http://h/qr-login?token=${'z'.repeat(64)}`)).toBeNull();
    expect(parseQrPayload(`http://h/qr-login?token=${'a'.repeat(31)}`)).toBeNull();
    expect(parseQrPayload(`http://h/qr-login?token=${'a'.repeat(129)}`)).toBeNull();
    expect(parseQrPayload(`http://h/qr-login?token=${'a'.repeat(63)}-`)).toBeNull();
  });
});

describe('normalizeBaseUrl', () => {
  it('strips every trailing slash so `${base}/api` never doubles up', () => {
    expect(normalizeBaseUrl('http://h:1/')).toBe('http://h:1');
    expect(normalizeBaseUrl('http://h:1///')).toBe('http://h:1');
    expect(normalizeBaseUrl('http://h:1')).toBe('http://h:1');
    expect(normalizeBaseUrl('')).toBe('');
  });

  it('leaves an interior path alone', () => {
    expect(normalizeBaseUrl('http://h:1/webui/')).toBe('http://h:1/webui');
  });
});

describe('randomHex', () => {
  it('returns two lowercase hex characters per byte', () => {
    expect(randomHex(4)).toMatch(/^[0-9a-f]{8}$/);
    expect(randomHex()).toHaveLength(64);
    expect(randomHex(0)).toBe('');
  });

  it('does not repeat itself', () => {
    expect(randomHex(16)).not.toBe(randomHex(16));
  });
});
