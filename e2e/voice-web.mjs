#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import { playwright } from './lib.mjs';
import { requireMatchingWebSources } from './voice-web-provenance.mjs';
import { checkWebMedia } from './voice-web-media.mjs';
import { startVoiceWebServer } from '../scripts/voice-web-server.mjs';

// Strictly isolated, always headless; never attaches to an existing browser.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: {
  'export-dir': { type: 'string' }, 'backend-url': { type: 'string' },
  'data-dir': { type: 'string' }, 'report-dir': { type: 'string' },
  'media-only': { type: 'boolean' },
} });
if (globalThis.Bun || !['export-dir', 'backend-url', 'data-dir', 'report-dir'].every(key => values[key])) {
  throw new Error('Use node e2e/voice-web.mjs --export-dir <source-bound-export> --backend-url <isolated-origin> --data-dir <fresh-backend-data> --report-dir build.noindex/<fresh-name>');
}
const exportDir = resolve(root, values['export-dir']);
const reportDir = resolve(root, values['report-dir']);
const dataDir = resolve(values['data-dir']);
if (![exportDir, reportDir].every(path => path.startsWith(join(root, 'build.noindex') + sep))) {
  throw new Error('Web export and report must be isolated inside Mobile build.noindex.');
}
const announced = JSON.parse(await readFile(join(dataDir, 'port.json'), 'utf8'));
const backendEvidence = JSON.parse((await readFile(join(dirname(dataDir), 'backend-source-evidence.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(announced.host, '127.0.0.1');
assert.equal(values['backend-url'], 'http://127.0.0.1:' + announced.port);
assert.ok(announced.pid > 0 && backendEvidence.source_files_checked > 0);
assert.deepEqual(backendEvidence.source_mismatch, []);
const source = await requireMatchingWebSources(root, exportDir);
const status = await fetch(values['backend-url'] + '/api/auth/status', { signal: AbortSignal.timeout(5000) });
assert.equal(status.status, 200);
const authStatus = await status.json();
if (!values['media-only']) assert.equal(authStatus.needs_setup, true, 'Refusing an initialized installation; use a fresh isolated data directory.');
try { await access(reportDir); throw new Error('Report directory exists; preserve it and choose another.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await mkdir(reportDir, { recursive: true });
const wavePath = join(reportDir, 'synthetic-microphone.wav');
const rate = 48000, samples = rate * 3, wave = Buffer.alloc(44 + samples * 2);
wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(rate, 24); wave.writeUInt32LE(rate * 2, 28); wave.writeUInt16LE(2, 32);
wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  const envelope = 0.55 + 0.35 * Math.sin(2 * Math.PI * 4.3 * t);
  const tone = Math.sin(2 * Math.PI * 227 * t + 2.1 * Math.sin(2 * Math.PI * 1.3 * t)) +
    0.35 * Math.sin(2 * Math.PI * 719 * t) + 0.1 * Math.sin(2 * Math.PI * 1301 * t);
  wave.writeInt16LE(Math.round(7000 * envelope * tone), 44 + i * 2);
}
await writeFile(wavePath, wave);
const moduleDir = join(exportDir, '__voice_acceptance__');
await mkdir(moduleDir, { recursive: true });
const bundle = spawn(process.env.NOMI_E2E_BUN_EXECUTABLE || 'bun', ['build',
  join(root, 'src/features/voice/media/endpoint.web.ts'), '--target', 'browser', '--format', 'esm',
  '--outfile', join(moduleDir, 'endpoint.mjs')], { cwd: root, stdio: 'inherit', windowsHide: true });
const bundleExit = await new Promise((accept, reject) => {
  bundle.once('error', reject); bundle.once('exit', accept);
});
assert.equal(bundleExit, 0, 'Production Web media endpoint bundle failed');
await writeFile(join(moduleDir, 'media.html'), '<!doctype html><html><head><meta charset="utf-8"><title>Isolated voice media contract</title></head><body>Headless synthetic-media contract</body></html>');
const report = {
  schema: 'nomifun.rn-web-voice-acceptance.v1', generated_at: new Date().toISOString(),
  scope: 'Actual RN Web UI + isolated production Desktop API; actual browser AudioWorklet with synthetic microphone and simulated disposition.',
  source_manifest: source, backend: { pid: announced.pid, port: announced.port, ...backendEvidence },
  cloud_calls: false, microphone_source: 'Chromium synthetic test device', physical_audio_acceptance: 'pending',
  ios_android_native_acceptance: 'pending', p50_ms: null, p95_ms: null, headless: true,
  checks: [], requests: {}, pending: ['two real model vendors and work receipts', 'real microphone/speakers/AEC and listening',
    'LAN/TLS and physical device lifecycle', 'real concurrent text/voice load', 'native iOS build/device', 'human acceptance'],
};
report.media_only = values['media-only'] === true;
report.synthetic_microphone_sha256 = createHash('sha256').update(wave).digest('hex');
let browser, context, web, page;
const pageErrors = [];
async function step(name, action) {
  try {
    const evidence = await action();
    report.checks.push({ name, result: 'passed', evidence });
    console.log('PASS ' + name);
  } catch (error) {
    report.checks.push({ name, result: 'failed', reason: error.message });
    console.log('FAIL ' + name);
    throw error;
  }
}
async function noVoiceStore() {
  try { await access(join(dataDir, 'voice/voice.sqlite3')); return false; }
  catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
try {
  web = await startVoiceWebServer({ exportDir, backendUrl: values['backend-url'], port: 0 });
  const { chromium } = await playwright();
  browser = await chromium.launch({ headless: true,
    ...(process.env.NOMI_E2E_EXECUTABLE_PATH ? { executablePath: process.env.NOMI_E2E_EXECUTABLE_PATH } : { channel: 'chromium' }),
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
      '--use-file-for-fake-audio-capture=' + wavePath, '--mute-audio'],
  });
  report.browser_version = browser.version();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', colorScheme: 'light' });
  context.setDefaultTimeout(15000);
  await context.grantPermissions(['microphone'], { origin: web.origin });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  const sockets = [];
  page.on('websocket', socket => sockets.push(new URL(socket.url()).pathname));
  page.on('request', request => {
    const path = new URL(request.url()).pathname;
    const key = request.method() + ' ' + path;
    report.requests[key] = (report.requests[key] ?? 0) + 1;
  });
  await page.addInitScript(() => {
    window.__nomiVoiceGumCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__nomiVoiceGumCalls++;
      return original(...args);
    };
  });
  if (!values['media-only']) {
  await step('actual_product_setup_through_rn_web', async () => {
    await page.goto(web.origin, { waitUntil: 'domcontentloaded' });
    await page.locator('input[type="password"]').waitFor();
    await page.locator('input:not([type="password"])').first().fill('voice-web-admin');
    await page.locator('input[type="password"]').fill(randomBytes(24).toString('base64url'));
    await page.getByRole('button', { name: '连接', exact: true }).first().click();
    await page.getByText('我的', { exact: true }).last().waitFor();
    assert.equal(await noVoiceStore(), true);
    return { real_setup_api: true, existing_installation_used: false, voice_store_opened: false };
  });
  await step('real_canonical_session_and_headless_host_gate', async () => {
    const compilation = page.waitForResponse(response =>
      response.request().method() === 'POST' && new URL(response.url()).pathname.startsWith('/api/agent-presets/from-template/'));
    await page.getByLabel('新建会话', { exact: true }).click();
    const response = await compilation;
    let fixture = 'ordinary Mobile default Agent';
    if (response.status() === 422) {
      const rejection = await response.json();
      assert.ok(JSON.stringify(rejection).includes('CAPABILITY_NOT_MATERIALIZED'));
      assert.ok(JSON.stringify(rejection).includes('system.browser_use'));
      report.pending.push('ordinary assistant.general creation on a Desktop host with actual native browser/computer role owners');
      report.ordinary_agent_environment_gate = { http_status: 422, missing_role: 'system.browser_use',
        ordinary_default_changed: false, native_role_faked: false };
      // An explicit, published chat.minimal test Session permits UI/draft
      // verification on an API-only host. Never change Mobile's default Agent
      // or pretend this fixture validates assistant.general's tools.
      const sessionId = await page.evaluate(async () => {
        const binding = JSON.parse(localStorage.getItem('nomifun.connection.v1'));
        const call = async (path, body) => {
          const result = await fetch(path, { method: body ? 'POST' : 'GET',
            headers: { Authorization: 'Bearer ' + binding.token, ...(body ? { 'Content-Type': 'application/json' } : {}),
              ...(path === '/api/agent-sessions' ? { 'Idempotency-Key': crypto.randomUUID().replaceAll('-', '') } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {}) });
          const json = await result.json();
          if (!result.ok || json.success === false) throw new Error('Canonical fixture API rejected: ' + path + ' HTTP ' + result.status);
          return json.data ?? json;
        };
        const library = await call('/api/agent-preset-templates?source=official');
        const minimal = library.official_templates.find(value => value.template_key === 'chat.minimal');
        if (!minimal || !Array.isArray(minimal.seed?.required_resource_kinds) ||
            minimal.seed.required_resource_kinds.length !== 0) throw new Error('Published exact-empty chat.minimal is unavailable');
        const editor = await call('/api/agent-presets/from-template/chat.minimal', {
          display_name: 'RN Web explicit empty-capability test Agent', model_route_refs: {}, chat_route_records: {}, reuse_existing: false,
        });
        const created = await call('/api/agent-sessions', { preset_id: editor.preset.preset_id, title: 'Nomi · RN Web 语音验收' });
        return created.agent_session_id;
      });
      await page.goto(web.origin + '/session/' + sessionId);
      fixture = 'explicit published chat.minimal via real canonical API; not the default Agent';
    } else assert.equal(response.status(), 200);
    await page.getByRole('button', { name: '实时语音', exact: true }).waitFor();
    report.agent_session_id = new URL(page.url()).pathname.split('/').pop();
    assert.ok(report.agent_session_id && report.agent_session_id !== 'voice');
    return { agent_session_id: report.agent_session_id, fixture, model_invocation: false, ordinary_default_changed: false };
  });
  const sessionCopy = JSON.parse(await readFile(join(root, 'src/i18n/locales/zh-CN/sessions.json'), 'utf8'));
  const draft = 'RN Web 验收：这条文字仍是草稿，未提交。';
  await page.getByPlaceholder(sessionCopy.composer.placeholder).fill(draft);
  await step('voice_navigation_and_configuration_are_inert', async () => {
    await page.getByRole('button', { name: '实时语音', exact: true }).click();
    await page.getByText('尚无当前设备可用的已验证全双工模型。', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '开始语音', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '保存语音配置', exact: true }).isDisabled(), true);
    await page.getByRole('radio', { name: /启用即时模型纠正/ }).click();
    assert.equal(await page.getByRole('radio', { name: /启用即时模型纠正/ }).getAttribute('aria-checked'), 'true');
    assert.equal(await page.evaluate(() => window.__nomiVoiceGumCalls), 0);
    assert.equal(sockets.some(path => path.startsWith('/api/mobile-voice')), false);
    assert.equal(await noVoiceStore(), true);
    return { get_user_media_calls: 0, voice_media_sockets: 0, voice_store_opened: false, profile_saved: false };
  });
  await step('mobile_voice_layout_at_supported_mobile_web_viewports', async () => {
    for (const [name, width, height] of [['phone', 390, 844], ['wide', 1024, 768]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: join(reportDir, 'voice-' + name + '.png'), fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, name + ' has horizontal document overflow');
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => {
      const radio = document.querySelector('[role="radio"]');
      return radio && getComputedStyle(radio).backgroundColor === 'rgb(26, 26, 26)';
    });
    await page.screenshot({ path: join(reportDir, 'voice-phone-dark.png'), fullPage: true });
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => {
      const radio = document.querySelector('[role="radio"]');
      return radio && getComputedStyle(radio).backgroundColor === 'rgb(249, 250, 251)';
    });
    return { target: 'separate nomifun-mobile RN Web; no Desktop renderer emulation',
      screenshots: ['voice-phone.png', 'voice-wide.png', 'voice-phone-dark.png'] };
  });
  await step('return_to_text_preserves_the_unsubmitted_draft', async () => {
    await page.goBack({ waitUntil: 'domcontentloaded' });
    assert.equal(await page.getByPlaceholder(sessionCopy.composer.placeholder).inputValue(), draft);
    assert.equal(await noVoiceStore(), true);
    return { draft_preserved: true, submitted_turns: 0 };
  });
  await step('voice_api_unavailable_isolated_from_text', async () => {
    const faultPage = await context.newPage();
    await faultPage.goto(web.origin + '/session/' + report.agent_session_id);
    await faultPage.getByPlaceholder(sessionCopy.composer.placeholder).fill(draft);
    await faultPage.route('**/api/mobile-voice/v1/catalog', route => route.fulfill({ status: 404, contentType: 'application/json',
      body: JSON.stringify({ success: false, message: 'Voice API unavailable (explicit fault injection)' }) }));
    await faultPage.getByRole('button', { name: '实时语音', exact: true }).click();
    await faultPage.getByText('当前 Desktop 尚未提供可用的语音服务。文字会话仍可继续。', { exact: true }).waitFor();
    await faultPage.goBack({ waitUntil: 'domcontentloaded' });
    assert.equal(await faultPage.getByPlaceholder(sessionCopy.composer.placeholder).inputValue(), draft);
    await faultPage.close();
    return { fault: 'only voice catalog HTTP 404 injected; all other APIs real', draft_preserved: true };
  });
  await step('binding_reload_does_not_request_microphone', async () => {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: '实时语音', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__nomiVoiceGumCalls), 0);
    assert.equal(await page.locator('input[type="password"]').count(), 0);
    assert.deepEqual(pageErrors, []);
    return { binding_restored: true, get_user_media_calls: 0, page_errors: 0 };
  });
  }
  const mediaPage = await context.newPage();
  await mediaPage.goto(web.origin + '/__voice_acceptance__/media.html');
  await checkWebMedia(mediaPage, web.origin + '/__voice_acceptance__/endpoint.mjs', step);
  await requireMatchingWebSources(root, exportDir);
  assert.equal(await noVoiceStore(), true);
  report.local_web_result = 'passed';
} catch (error) {
  report.local_web_result = 'failed';
  report.failure = error.message;
  await page?.screenshot({ path: join(reportDir, 'failure.png'), fullPage: true }).catch(() => {});
  process.exitCode = 1;
} finally {
  const cleanup = await Promise.allSettled([
    context?.close(), browser?.close(), web?.close(),
  ]);
  report.owned_browser_and_proxy_closed = cleanup.every(item => item.status === 'fulfilled') && !browser?.isConnected();
  if (!report.owned_browser_and_proxy_closed) process.exitCode = 1;
  report.page_errors = pageErrors;
  report.harness_sha256 = {};
  for (const file of ['e2e/voice-web.mjs', 'e2e/voice-web-media.mjs', 'e2e/voice-web-provenance.mjs',
    'scripts/voice-web-server.mjs', 'scripts/voice-web-export.mjs']) {
    report.harness_sha256[file] = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
  }
  report.endpoint_bundle_sha256 = createHash('sha256').update(await readFile(join(moduleDir, 'endpoint.mjs'))).digest('hex');
  await writeFile(join(reportDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('RN Web evidence: ' + join(reportDir, 'report.json'));
}
