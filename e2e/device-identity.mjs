/** Real same-origin multi-page IndexedDB acceptance. No Desktop, app renderer or phone emulation. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { env, playwright } from './lib.mjs';

const scratch = await mkdtemp(join(tmpdir(), 'nomifun-device-identity-'));
const source = resolve(import.meta.dirname, '../src/api');
const entry = join(scratch, 'entry.ts');
const bundle = join(scratch, 'identity.js');
await writeFile(entry, `export { createIndexedDbDeviceIdentityStore } from ${JSON.stringify(join(source, 'device-identity-indexeddb.ts'))};
export { generateWebInstallationKey } from ${JSON.stringify(join(source, 'device-identity-core.ts'))};`);
await promisify(execFile)('bun', ['build', entry, '--target=browser', '--format=esm', '--outfile', bundle]);
const script = await readFile(bundle);
const html = `<!doctype html><meta charset="utf-8"><script type="module">
import { createIndexedDbDeviceIdentityStore, generateWebInstallationKey } from '/identity.js';
window.generations = 0;
window.createIdentity = generate => createIndexedDbDeviceIdentityStore(() => indexedDB, generate ?? (() => {
  window.generations++;
  return generateWebInstallationKey(crypto);
}));
window.identity = window.createIdentity();
window.withoutStorage = () => createIndexedDbDeviceIdentityStore(() => undefined, () => { throw Error('Must not generate'); });
window.ready = true;
</script>`;
const server = createServer((request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', request.url === '/identity.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/identity.js' ? script : html);
});
let browser;
try {
  await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const origin = `http://127.0.0.1:${address.port}`;
  const { chromium } = await playwright();
  browser = await chromium.launch({ headless: true, ...(env.executablePath ? { executablePath: env.executablePath } : {}) });
  const context = await browser.newContext();
  const first = await context.newPage();
  const second = await context.newPage();
  await Promise.all([first.goto(origin), second.goto(origin)]);
  await Promise.all([first.waitForFunction(() => window.ready), second.waitForFunction(() => window.ready)]);
  let shared;
  for (let index = 0; index < 16; index++) {
    const desktop = `concurrent-desktop-${index}`;
    const values = await Promise.all([first, second].map(page => page.evaluate(id => window.identity.getInstallationKey(id), desktop)));
    assert.equal(values[0], values[1]); assert.match(values[0], /^[0-9a-f]{64}$/);
    if (index === 0) shared = values[0];
  }
  const generated = await Promise.all([first, second].map(page => page.evaluate(() => window.generations)));
  assert.equal(generated[0] + generated[1], 16, 'Every Desktop has one generator across both pages');
  console.log('PASS same-origin concurrent pages atomically share one installation identity');
  await first.reload(); await first.waitForFunction(() => window.ready);
  assert.equal(await first.evaluate(() => window.identity.getInstallationKey('concurrent-desktop-0')), shared);
  const isolated = await Promise.all([first, second].map((page, index) => page.evaluate(id => window.identity.getInstallationKey(id), `independent-${index}`)));
  assert.notEqual(isolated[0], isolated[1]);
  console.log('PASS reload preserves identity and different Desktops stay isolated');

  const completed = await first.evaluate(async () => {
    const original = IDBDatabase.prototype.transaction;
    let commits = 0;
    IDBDatabase.prototype.transaction = function (...args) {
      const transaction = original.apply(this, args);
      transaction.addEventListener('complete', () => { commits++; });
      return transaction;
    };
    try { await window.identity.getInstallationKey('completion-receipt'); return commits; }
    finally { IDBDatabase.prototype.transaction = original; }
  });
  assert.equal(completed, 1, 'Registration may begin only after the identity transaction commits');
  console.log('PASS identity is returned only after transaction completion');

  const aborted = await first.evaluate(async () => {
    const original = IDBObjectStore.prototype.add;
    let registrations = 0;
    IDBObjectStore.prototype.add = function (...args) {
      const request = original.apply(this, args); this.transaction.abort(); return request;
    };
    try {
      const error = await window.identity.getInstallationKey('abort-before-registration')
        .then(() => { registrations++; return null; }, failure => failure.message);
      return { error, registrations };
    } finally { IDBObjectStore.prototype.add = original; }
  });
  assert.equal(aborted.registrations, 0); assert.match(aborted.error, /abort/i);
  const retried = await first.evaluate(() => window.identity.getInstallationKey('abort-before-registration'));
  assert.equal(await second.evaluate(() => window.identity.getInstallationKey('abort-before-registration')), retried);
  console.log('PASS transaction abort prevents registration and later retry commits one identity');

  const unavailable = await first.evaluate(async () => {
    let registrations = 0;
    const error = await window.withoutStorage().getInstallationKey('no-storage')
      .then(() => { registrations++; return null; }, failure => failure.message);
    return { error, registrations };
  });
  assert.equal(unavailable.registrations, 0); assert.match(unavailable.error, /IndexedDB is required/);
  const noRandomness = await first.evaluate(async () => window.createIdentity(() => { throw Error('Secure randomness unavailable'); })
    .getInstallationKey('no-randomness').then(() => null, failure => failure.message));
  assert.equal(noRandomness, 'Secure randomness unavailable');
  console.log('PASS unavailable storage or secure randomness never creates a temporary identity');
} finally {
  await browser?.close();
  await new Promise(accept => server.close(accept));
  await rm(scratch, { recursive: true, force: true });
}
