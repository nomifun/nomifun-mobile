import { expect, test } from 'bun:test';
import { scopeConnectionPort } from '@/api/connection-port';

test('retained voice control ports cannot deliver old cleanup or receipts to a new Desktop', async () => {
  let epoch = 1; const delivered: string[] = [];
  const port = { control: async (id: string) => { delivered.push(id); return id; }, supported: true };
  const first = scopeConnectionPort(port, () => epoch, epoch);
  expect(await first.control('voice-a')).toBe('voice-a'); expect(first.supported).toBe(true);
  epoch = 2;
  expect(() => first.control('voice-a-close')).toThrow();
  const second = scopeConnectionPort(port, () => epoch, epoch);
  expect(await second.control('voice-b')).toBe('voice-b');
  expect(delivered).toEqual(['voice-a', 'voice-b']);
});
