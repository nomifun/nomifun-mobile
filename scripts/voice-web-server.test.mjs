import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, symlink, rm, realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { startVoiceWebServer, parseVoiceWebArgs } from './voice-web-server.mjs';

// The actual socket acceptance cases run with `node --test`, not Bun's
// incompatible node:http upgrade layer. Bun verifies the fail-closed guard.
const test = process.versions.bun ? nodeTest.skip : nodeTest;
nodeTest('Bun cannot report readiness for an unsupported WebSocket proxy runtime', { skip: !process.versions.bun }, async () => {
  await assert.rejects(startVoiceWebServer({ exportDir: '.', backendUrl: 'http://127.0.0.1:1' }),
    error => error.code === 'NODE_RUNTIME_REQUIRED');
});

const script = fileURLToPath(new URL('./voice-web-server.mjs', import.meta.url));
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
async function fixture(t) {
  const owned = await mkdtemp(path.join(tmpdir(), 'nomifun-voice-web-test-'));
  const root = path.join(owned, 'export'), external = path.join(owned, 'outside');
  await mkdir(root); await mkdir(external);
  await Promise.all([
    writeFile(path.join(root, 'index.html'), '<html>static-index</html>'),
    writeFile(path.join(root, 'voice.html'), '<html>voice-route</html>'),
    writeFile(path.join(external, 'secret.txt'), 'outside-must-not-be-served'),
    copyFile(path.join(publicRoot, 'voice-worklet.js'), path.join(root, 'voice-worklet.js')),
    copyFile(path.join(publicRoot, 'voice-dsp.js'), path.join(root, 'voice-dsp.js')),
  ]);
  await mkdir(path.join(root, 'session'));
  await writeFile(path.join(root, 'session', '[id].html'), '<html>dynamic-session-route</html>');
  await writeFile(path.join(root, 'session', 'new-project.html'), '<html>literal-session-route</html>');
  t.after(async () => {
    const canonical = await realpath(owned), relative = path.relative(await realpath(tmpdir()), canonical);
    assert.ok(relative.startsWith('nomifun-voice-web-test-') && !relative.includes(path.sep));
    await rm(canonical, { recursive: true, force: true });
  });
  return { root, external };
}
async function backend(t, handler) {
  const sockets = new Set();
  const server = http.createServer(handler ?? ((_req, res) => res.end('backend-alive')));
  server.on('connection', socket => { sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket)); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve); for (const socket of sockets) socket.destroy();
  }));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function preview(t, root, backendUrl, events = []) {
  const running = await startVoiceWebServer({ exportDir: root, backendUrl, logger: event => events.push(event) });
  t.after(() => running.close()); return running;
}
function request(origin, pathname, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin);
    const req = http.request({ hostname: url.hostname, port: url.port, path: pathname, method, headers }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject); req.end(body);
  });
}
function websocket(origin, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(origin), socket = net.connect({ host: url.hostname, port: Number(url.port) });
    const chunks = [];
    const timeout = setTimeout(() => { socket.destroy(); reject(new Error('WebSocket handshake timeout')); }, 3000);
    socket.once('error', reject);
    socket.once('connect', () => socket.write([
      `GET ${pathname} HTTP/1.1`, `Host: ${url.host}`, 'Connection: Upgrade', 'Upgrade: websocket',
      'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
      ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`), '', '',
    ].join('\r\n')));
    const onData = chunk => {
      chunks.push(chunk); const combined = Buffer.concat(chunks), end = combined.indexOf('\r\n\r\n');
      if (end < 0) return;
      clearTimeout(timeout); socket.removeListener('data', onData);
      resolve({ socket, response: combined.subarray(0, end).toString(), tail: combined.subarray(end + 4) });
    };
    socket.on('data', onData);
  });
}
function maskedBinary(payload) {
  const mask = Buffer.from([1, 3, 5, 7]), frame = Buffer.alloc(payload.length + 6);
  frame[0] = 0x82; frame[1] = 0x80 | payload.length; mask.copy(frame, 2);
  payload.forEach((value, index) => { frame[index + 6] = value ^ mask[index % 4]; });
  return frame;
}

test('explicit configuration, immutable loopback binding and import-safe CLI args', async t => {
  const { root } = await fixture(t);
  assert.deepEqual(parseVoiceWebArgs(['--export-dir', root, '--backend-url', 'http://127.0.0.1:1234']),
    { exportDir: root, backendUrl: 'http://127.0.0.1:1234' });
  for (const args of [[], ['--export-dir'], ['--host', '0.0.0.0'],
    ['--export-dir', root, '--backend-url', 'http://localhost', '--port', '1234'],
    ['--export-dir', root, '--export-dir', root, '--backend-url', 'http://localhost']]) assert.throws(() => parseVoiceWebArgs(args));
  for (const backendUrl of [undefined, '', 'not-a-url', 'ws://localhost', 'http://user:synthetic-secret@localhost',
    'http://localhost/api', 'http://localhost/?ticket=synthetic-secret', 'http://localhost/#fragment']) {
    await assert.rejects(startVoiceWebServer({ exportDir: root, backendUrl }));
  }
  await assert.rejects(startVoiceWebServer({ backendUrl: 'http://localhost' }));
  await assert.rejects(startVoiceWebServer({ exportDir: root, backendUrl: 'http://localhost', port: 1234 }));
  const upstream = await backend(t), running = await preview(t, root, upstream.url);
  assert.equal(running.server.address().address, '127.0.0.1'); assert.ok(running.port > 0);
  assert.equal(running.backendValidated, false); assert.equal(running.cloudValidated, false); assert.equal(running.microphoneValidated, false);
});

test('Expo literal and dynamic routes, HEAD and real worklet/DSP MIME and bytes', async t => {
  const { root } = await fixture(t), upstream = await backend(t), running = await preview(t, root, upstream.url);
  for (const [pathname, content] of [['/', 'static-index'], ['/voice', 'voice-route'], ['/voice/', 'voice-route'],
    ['/session/native-session-id', 'dynamic-session-route'], ['/session/new-project', 'literal-session-route']]) {
    const res = await request(running.origin, pathname); assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /^text\/html/); assert.ok(res.body.toString().includes(content));
  }
  for (const name of ['voice-worklet.js', 'voice-dsp.js']) {
    const res = await request(running.origin, `/${name}`);
    assert.equal(res.status, 200); assert.match(res.headers['content-type'], /^text\/javascript/);
    assert.deepEqual(res.body, await readFile(path.join(publicRoot, name)));
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  }
  const head = await request(running.origin, '/voice', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0); assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal((await request(running.origin, '/missing.js')).status, 404);
  assert.equal((await request(running.origin, '/voice', { method: 'POST' })).status, 405);
});

test('raw/encoded traversal, Windows separators, malformed escapes and linked external paths stay closed', async t => {
  const { root, external } = await fixture(t), upstream = await backend(t), running = await preview(t, root, upstream.url);
  await symlink(external, path.join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(root, '.private'), 'hidden-file');
  for (const pathname of ['/../outside/secret.txt', '/%2e%2e/outside/secret.txt', '/%2e%2e%5coutside/secret.txt',
    '/a\\..\\secret.txt', '/a%00.txt', '/%ff', '//outside/secret.txt']) assert.equal((await request(running.origin, pathname)).status, 400);
  for (const pathname of ['/escape/secret.txt', '/.private']) {
    const res = await request(running.origin, pathname); assert.equal(res.status, 404);
    assert.ok(!res.body.toString().includes('outside-must-not-be-served'));
  }
});

test('HTTP proxy keeps Host/Origin/auth/cookies/body/status and does not log queries or secrets', async t => {
  const { root } = await fixture(t), seen = [], events = [];
  const upstream = await backend(t, (req, res) => {
    const chunks = []; req.on('data', chunk => chunks.push(chunk)); req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: Buffer.concat(chunks).toString() });
      res.writeHead(req.headers.authorization ? 202 : 403, { 'Set-Cookie': 'original=synthetic-cookie; HttpOnly; SameSite=Lax' });
      res.end('original-backend-response');
    });
  });
  const running = await preview(t, root, upstream.url, events), body = '{"work":"original-body"}';
  const headers = { Host: 'original-host.invalid:4321', Origin: 'https://original-origin.invalid',
    Authorization: 'Bearer synthetic-secret', Cookie: 'original=synthetic-cookie', 'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body) };
  const pathname = '/api/mobile-voice/v1/sessions?must-not-log=synthetic-query';
  const res = await request(running.origin, pathname, { method: 'POST', headers, body });
  assert.equal(res.status, 202); assert.equal(seen[0].url, pathname); assert.equal(seen[0].body, body);
  for (const key of ['host', 'origin', 'authorization', 'cookie']) assert.equal(seen[0].headers[key], headers[Object.keys(headers).find(name => name.toLowerCase() === key)]);
  assert.equal(seen[0].headers['x-forwarded-host'], undefined);
  assert.deepEqual(res.headers['set-cookie'], ['original=synthetic-cookie; HttpOnly; SameSite=Lax']);
  assert.equal((await request(running.origin, '/api/sessions')).status, 403);
  for (const pathname of ['/health', '/login', '/logout', '/qr-login']) assert.equal((await request(running.origin, pathname)).body.toString(), 'original-backend-response');
  assert.ok(!/synthetic-secret|synthetic-cookie|synthetic-query|must-not-log/.test(JSON.stringify(events)));
});

test('business and voice media WebSockets preserve ticket subprotocol and byte forwarding', async t => {
  const { root } = await fixture(t), upstream = await backend(t), seen = [], events = [];
  upstream.server.on('upgrade', (req, socket) => {
    seen.push({ url: req.url, headers: req.headers });
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\nSec-WebSocket-Protocol: nomifun.voice.v1\r\n\r\n`);
    socket.once('data', frame => {
      const length = frame[1] & 0x7f, payload = Buffer.alloc(length);
      for (let index = 0; index < length; index++) payload[index] = frame[index + 6] ^ frame[2 + index % 4];
      socket.write(Buffer.concat([Buffer.from([0x82, payload.length]), payload]));
    });
  });
  const running = await preview(t, root, upstream.url, events);
  for (const pathname of ['/ws?must-not-log=synthetic-query', '/api/mobile-voice/v1/sessions/public-id/media']) {
    const headers = { Origin: running.origin, Cookie: 'auth=synthetic-cookie', Authorization: 'Bearer synthetic-secret',
      'Sec-WebSocket-Protocol': 'nomifun.voice.v1, nomifun.voice.ticket.synthetic-ticket' };
    const peer = await websocket(running.origin, pathname, headers); t.after(() => peer.socket.destroy());
    assert.match(peer.response, /^HTTP\/1\.1 101/); assert.match(peer.response, /Sec-WebSocket-Protocol: nomifun.voice.v1/i);
    const expected = Buffer.from([0, 1, 255, 128, 13, 10]);
    const echoed = new Promise((resolve, reject) => { peer.socket.once('data', resolve); peer.socket.once('error', reject); });
    peer.socket.write(maskedBinary(expected)); assert.deepEqual(await echoed, Buffer.concat([Buffer.from([0x82, expected.length]), expected]));
    const original = seen.at(-1); assert.equal(original.url, pathname); assert.equal(original.headers.host, new URL(running.origin).host);
    assert.equal(original.headers.origin, headers.Origin); assert.equal(original.headers.authorization, headers.Authorization);
    assert.equal(original.headers['sec-websocket-protocol'], headers['Sec-WebSocket-Protocol']);
    peer.socket.destroy();
  }
  const refused = await websocket(running.origin, '/voice-worklet.js'); refused.socket.destroy();
  assert.match(refused.response, /^HTTP\/1\.1 404/);
  await running.close(); assert.equal(running.server.listening, false);
  assert.equal((await request(upstream.url, '/health')).body.toString(), 'backend-alive');
  assert.ok(!/synthetic-ticket|synthetic-secret|synthetic-query|synthetic-cookie/.test(JSON.stringify(events)));
});

test('unavailable upstream is a generic 502; shutdown is idempotent and leaves other server alive', async t => {
  const { root } = await fixture(t), unrelated = await backend(t), unused = http.createServer();
  await new Promise(resolve => unused.listen(0, '127.0.0.1', resolve));
  const port = unused.address().port; await new Promise(resolve => unused.close(resolve));
  const events = [], running = await preview(t, root, `http://127.0.0.1:${port}`, events);
  const result = await request(running.origin, '/api/mobile-voice/v1?ticket=synthetic-query',
    { headers: { Authorization: 'Bearer synthetic-secret' } });
  assert.equal(result.status, 502); assert.equal(result.body.toString(), 'Backend unavailable');
  assert.deepEqual(events.at(-1), { event: 'proxy_error', code: 'ECONNREFUSED' });
  const first = running.close(); assert.equal(running.close(), first); await first;
  await assert.rejects(request(running.origin, '/voice'));
  assert.equal((await request(unrelated.url, '/health')).status, 200);
  assert.ok(!/synthetic-query|synthetic-secret/.test(JSON.stringify(events)));
});

test('shutdown drains then closes only owned active HTTP and WebSocket connections', async t => {
  const { root } = await fixture(t);
  const upstream = await backend(t, (req, res) => {
    if (req.url === '/api/stream') { res.writeHead(200); res.write('open-stream'); }
    else res.end('backend-alive');
  });
  upstream.server.on('upgrade', (req, socket) => {
    const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
  });
  const running = await preview(t, root, upstream.url), peer = await websocket(running.origin, '/ws');
  t.after(() => peer.socket.destroy());
  const client = http.get(`${running.origin}/api/stream`); client.on('error', () => {});
  t.after(() => client.destroy());
  await new Promise(resolve => client.once('response', res => { res.on('error', () => {}); res.once('data', resolve); }));
  const started = Date.now(); await running.close();
  assert.ok(Date.now() - started < 1500); assert.equal(running.server.listening, false);
  await assert.rejects(request(running.origin, '/voice'));
  assert.equal((await request(upstream.url, '/health')).body.toString(), 'backend-alive');
});

test('CLI SIGINT and SIGTERM handlers close their own listener in isolated child processes', async t => {
  const { root } = await fixture(t), upstream = await backend(t);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    // Windows child.kill() terminates a process without delivering its console
    // handler. Emit the same Node event in the child to exercise the installed
    // handler and real TCP cleanup; OS/console signal delivery is separate.
    const source = `import { runVoiceWebCli } from ${JSON.stringify(pathToFileURL(script).href)}; await runVoiceWebCli(${JSON.stringify(['--export-dir', root, '--backend-url', upstream.url])}); setTimeout(() => process.emit(${JSON.stringify(signal)}), 25);`;
    const child = spawn('node', ['--input-type=module', '--eval', source], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    const timeout = setTimeout(() => child.kill(), 5000);
    const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
    clearTimeout(timeout); assert.equal(exit, 0, stderr);
    const events = stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(events[0].event, 'ready'); assert.equal(events.at(-1).event, 'closed');
    await assert.rejects(request(events[0].origin, '/voice'));
    assert.equal((await request(upstream.url, '/health')).status, 200);
  }
});
