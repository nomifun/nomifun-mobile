#!/usr/bin/env node
/**
 * H5 dev proxy — serves the Expo web dev server and the nomifun desktop API
 * on ONE origin, so cookies/CSRF/WS all behave exactly like production
 * (where the SPA is same-origin with the server).
 *
 *   phone/browser ──► http://<this-host>:8788
 *        /api /login /logout /qr-login /health /ws  ──► NOMIFUN_SERVER
 *        everything else (incl. Metro HMR websockets) ──► EXPO_WEB_TARGET
 *
 * Env:
 *   NOMIFUN_SERVER   backend origin   (default http://127.0.0.1:8787 — `nomifun-web`;
 *                    point at http://127.0.0.1:25808 to use the desktop app's LAN listener)
 *   EXPO_WEB_TARGET  Metro web origin (default http://127.0.0.1:8081)
 *   PORT             listen port      (default 8788, binds 0.0.0.0 for LAN phones)
 */
import http from 'node:http';
import httpProxy from 'http-proxy';

const API_TARGET = process.env.NOMIFUN_SERVER ?? 'http://127.0.0.1:8787';
const UI_TARGET = process.env.EXPO_WEB_TARGET ?? 'http://127.0.0.1:8081';
const PORT = Number(process.env.PORT ?? 8788);

const API_PREFIXES = ['/api', '/login', '/logout', '/qr-login', '/health', '/ws'];

const isApiPath = (url) => {
  const path = url.split('?')[0];
  return API_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
};

// changeOrigin stays false: the backend's host guard wants to see the address
// the phone actually typed (IP literal / localhost), and the session cookie is
// host-only.
const apiProxy = httpProxy.createProxyServer({ target: API_TARGET, changeOrigin: false, ws: true });
const uiProxy = httpProxy.createProxyServer({ target: UI_TARGET, changeOrigin: false, ws: true });

for (const [name, proxy] of [
  ['api', apiProxy],
  ['ui', uiProxy],
]) {
  proxy.on('error', (err, _req, res) => {
    const hint =
      name === 'api'
        ? `无法连接 nomifun 服务端 ${API_TARGET} — 先启动它（nomifun-web 或桌面端 WebUI 远程访问）`
        : `无法连接 Expo web ${UI_TARGET} — 先运行 bun run web`;
    console.error(`[proxy:${name}] ${err.code ?? err.message}`);
    if (res && !res.headersSent && res.writeHead) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(hint);
    } else if (res && res.destroy) {
      res.destroy();
    }
  });
}

const server = http.createServer((req, res) => {
  (isApiPath(req.url) ? apiProxy : uiProxy).web(req, res);
});

server.on('upgrade', (req, socket, head) => {
  (isApiPath(req.url) ? apiProxy : uiProxy).ws(req, socket, head);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  nomifun-mobile H5 dev proxy`);
  console.log(`  listen : http://0.0.0.0:${PORT}  (手机访问 http://<本机局域网IP>:${PORT})`);
  console.log(`  api    → ${API_TARGET}`);
  console.log(`  ui     → ${UI_TARGET}\n`);
});
