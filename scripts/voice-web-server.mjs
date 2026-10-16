#!/usr/bin/env node
/** Isolated Expo export preview. No GUI, model request, credential discovery,
 * user data or default backend/port. Importing this module never listens. */
import http from 'node:http';
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { realpath, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipeline } from 'node:stream/promises';
import httpProxy from 'http-proxy';

const API_PREFIXES = ['/api', '/login', '/logout', '/qr-login', '/health', '/ws'];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};
const ERROR_CODES = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND',
  'EHOSTUNREACH', 'EPIPE', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT']);
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
const backendPath = value => API_PREFIXES.some(prefix => value === prefix || value.startsWith(`${prefix}/`));
const emit = (logger, event) => { try { logger?.(event); } catch { /* Reporting cannot own server lifetime. */ } };
function requestPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) throw new Error('Invalid request path');
  const pathname = decodeURIComponent(value.split('?')[0]);
  if (/[\\\x00-\x1f\x7f#]/.test(pathname) || pathname.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid request path');
  return pathname;
}
function validateBackend(value) {
  let url;
  try { if (typeof value !== 'string' || !value.trim()) throw new Error(); url = new URL(value); }
  catch { throw new Error('An explicit HTTP(S) backend origin is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw new Error('Backend must be an HTTP(S) origin without credentials, path, query or fragment');
  return url.origin;
}
async function fileWithin(root, candidate) {
  if (!inside(root, candidate)) return null;
  let actual, info;
  try { actual = await realpath(candidate); info = await stat(actual); }
  catch (error) { if (['ENOENT', 'ENOTDIR'].includes(error.code)) return null; throw error; }
  if (!inside(root, actual) || !info.isFile()) return null;
  return { file: actual, info };
}
async function exportedRoutes(root) {
  const routes = [];
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '_expo' || entry.name === 'assets') continue;
      const candidate = path.join(directory, entry.name);
      // Export aliases can be inspected as exact files, but never recurse into
      // a linked directory or index an external HTML route.
      if (entry.isDirectory()) { await walk(candidate); continue; }
      if (!entry.name.endsWith('.html') || entry.name.startsWith('+')) continue;
      const found = await fileWithin(root, candidate); if (!found) continue;
      const relative = path.relative(root, candidate).replaceAll('\\', '/');
      const parts = relative.slice(0, -5).split('/').filter(part => !/^\(.+\)$/.test(part));
      if (parts.at(-1) === 'index') parts.pop();
      const escape = part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      let pattern = '', dynamic = 0;
      for (const part of parts) {
        if (/^\[\[\.\.\..+\]\]$/.test(part)) { pattern += '(?:/.*)?'; dynamic += 10; }
        else if (/^\[\.\.\..+\]$/.test(part)) { pattern += '/.+'; dynamic += 5; }
        else if (/^\[.+\]$/.test(part)) { pattern += '/[^/]+'; dynamic++; }
        else pattern += `/${escape(part)}`;
      }
      routes.push({ match: new RegExp(`^${pattern || '/'}${pattern ? '/?' : ''}$`),
        file: candidate, dynamic, grouped: relative.includes('('), relative });
    }
  }
  await walk(root);
  return routes.sort((a, b) => a.dynamic - b.dynamic || Number(a.grouped) - Number(b.grouped) || a.relative.localeCompare(b.relative));
}
function send(res, status, body) {
  if (res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Only an explicitly configured export is served on 127.0.0.1:0.
 * Ready proves static files and listener readiness; backend/cloud/audio are
 * deliberately unverified until a caller performs those acceptance checks. */
export async function startVoiceWebServer({ exportDir, backendUrl, port: requestedPort = 0, logger } = {}) {
  // Bun 1.3.14's node:http upgrade compatibility times out with http-proxy.
  // Never report readiness for a runtime that cannot carry the media socket.
  if (process.versions.bun) throw Object.assign(new Error('This preview requires Node for HTTP/WebSocket proxy compatibility'), { code: 'NODE_RUNTIME_REQUIRED' });
  if (requestedPort !== 0) throw new Error('Preview must use an isolated ephemeral port');
  const backendOrigin = validateBackend(backendUrl);
  if (typeof exportDir !== 'string' || !exportDir.trim()) throw new Error('An explicit export directory is required');
  let root;
  try { root = await realpath(path.resolve(exportDir)); if (!(await stat(root)).isDirectory()) throw new Error(); }
  catch { throw new Error('Export directory is unavailable'); }
  for (const required of ['index.html', 'voice-worklet.js', 'voice-dsp.js']) {
    if (!await fileWithin(root, path.join(root, required))) throw new Error('Export must contain index.html, voice-worklet.js and voice-dsp.js');
  }
  const routes = await exportedRoutes(root);
  const sockets = new Set(), upgrades = new Set(), proxySockets = new Set();
  const track = (socket, set = sockets) => { set.add(socket); socket.once('close', () => set.delete(socket)); };
  const agent = backendOrigin.startsWith('https:') ? new https.Agent({ keepAlive: false }) : new http.Agent({ keepAlive: false });
  const proxy = httpProxy.createProxyServer({ target: backendOrigin, changeOrigin: false,
    xfwd: false, ws: true, secure: true, prependPath: false, agent });
  let closing = false, closingPromise;
  // Keep the browser's original Host, Origin, credentials, subprotocol ticket
  // and response cookies. Authentication and host/CSRF checks stay in Desktop.
  proxy.on('proxyReq', request => { if (request.socket) track(request.socket, proxySockets); });
  proxy.on('proxyReqWs', request => request.once('socket', socket => track(socket, proxySockets)));
  proxy.on('open', socket => track(socket, proxySockets));
  const proxyError = (error, _req, output) => {
    if (!closing) emit(logger, { event: 'proxy_error', code: ERROR_CODES.has(error.code) ? error.code : 'UPSTREAM_ERROR' });
    if (typeof output?.writeHead === 'function') send(output, 502, 'Backend unavailable');
    else output?.destroy();
  };
  proxy.on('error', proxyError);
  const server = http.createServer(async (req, res) => {
    try {
      if (closing) { send(res, 503, 'Server closing'); return; }
      const pathname = requestPath(req.url);
      if (backendPath(pathname)) { proxy.web(req, res); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { res.setHeader('Allow', 'GET, HEAD'); send(res, 405, 'Method not allowed'); return; }
      const parts = pathname.slice(1).split('/');
      if (parts.some(part => part.startsWith('.'))) { send(res, 404, 'Not found'); return; }
      const candidate = path.resolve(root, ...parts);
      let found = await fileWithin(root, candidate);
      if (!found && !path.extname(pathname)) {
        for (const possible of [`${candidate}.html`, path.join(candidate, 'index.html')]) {
          found = await fileWithin(root, possible); if (found) break;
        }
        if (!found) for (const route of routes) if (route.match.test(pathname)) { found = await fileWithin(root, route.file); break; }
      }
      if (!found) { send(res, 404, 'Not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(found.file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': found.info.size, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      if (req.method === 'HEAD') res.end();
      else await pipeline(createReadStream(found.file), res);
    } catch (error) { if (!res.destroyed) send(res, error.message === 'Invalid request path' || error instanceof URIError ? 400 : 500, 'Request could not be served'); }
  });
  server.on('connection', socket => track(socket));
  server.on('upgrade', (req, socket, head) => {
    try {
      if (closing || !backendPath(requestPath(req.url))) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
      track(socket, upgrades); proxy.ws(req, socket, head);
    } catch { socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); }
  });
  server.on('clientError', (_error, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  const port = server.address().port, origin = `http://127.0.0.1:${port}`;
  const ready = { event: 'ready', host: '127.0.0.1', port, origin, exportDir: root,
    backendValidated: false, cloudValidated: false, microphoneValidated: false };
  const close = () => {
    if (closingPromise) return closingPromise;
    closing = true;
    closingPromise = new Promise(resolve => {
      const deadline = setTimeout(() => {
        for (const socket of sockets) socket.destroy();
        for (const socket of proxySockets) socket.destroy();
        agent.destroy();
      }, 300);
      server.close(() => {
        clearTimeout(deadline);
        for (const socket of sockets) socket.destroy();
        for (const socket of proxySockets) socket.destroy();
        agent.destroy();
        emit(logger, { event: 'closed', port }); resolve();
      });
      server.closeIdleConnections?.();
      // Only owned upgrade sockets are ended. Their peer receives disconnect;
      // the Desktop work task is not cancelled by this preview's shutdown.
      for (const socket of upgrades) socket.end();
    });
    return closingPromise;
  };
  emit(logger, ready);
  return { ...ready, backendOrigin, server, close };
}

export function parseVoiceWebArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    const field = key === '--export-dir' ? 'exportDir' : key === '--backend-url' ? 'backendUrl' : null;
    if (!field || options[field] !== undefined || typeof value !== 'string' || value.startsWith('--')) throw new Error('Use --export-dir <directory> --backend-url <HTTP(S) origin>');
    options[field] = value;
  }
  if (!options.exportDir || !options.backendUrl) throw new Error('Use --export-dir <directory> --backend-url <HTTP(S) origin>');
  return options;
}

export async function runVoiceWebCli(args = process.argv.slice(2)) {
  let running, stopRequested = false;
  const stop = () => { stopRequested = true; if (running) void running.close(); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  try {
    running = await startVoiceWebServer({ ...parseVoiceWebArgs(args), logger: event => process.stdout.write(`${JSON.stringify(event)}\n`) });
    running.server.once('close', () => { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); });
    if (stopRequested) await running.close();
    return running;
  } catch (error) {
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    throw error;
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  runVoiceWebCli().catch(error => { process.stderr.write(`${JSON.stringify({ event: 'startup_error', code: error.code === 'NODE_RUNTIME_REQUIRED' ? 'NODE_RUNTIME_REQUIRED' : 'INVALID_CONFIGURATION' })}\n`); process.exitCode = 1; });
}
