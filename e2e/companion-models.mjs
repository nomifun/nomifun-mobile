#!/usr/bin/env node
/**
 * Real RN Web interaction against an in-process, deterministic HTTP fixture.
 * This proves Mobile UI/transport behavior, not real Desktop acceptance.
 * No Desktop process, user data, upstream model or Turn is accessed.
 *
 * CI=1 EXPO_OFFLINE=1 bunx expo export -p web --output-dir .tmp-e2e/companion-models/web
 * NOMI_E2E_PLAYWRIGHT=/path/containing/node_modules node e2e/companion-models.mjs
 * Optional NOMI_E2E_EXECUTABLE_PATH selects an existing headless Chromium.
 */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, realpath, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { playwright } from './lib.mjs';

const { values } = parseArgs({ options: {
  'export-dir': { type: 'string', default: '.tmp-e2e/companion-models/web' },
  'report-dir': { type: 'string', default: '.tmp-e2e/companion-models' },
  help: { type: 'boolean' },
} });
if (values.help) {
  console.log('node e2e/companion-models.mjs [--export-dir <Expo web export>] [--report-dir <output directory>]');
  process.exit(0);
}
const exportDir = await realpath(resolve(values['export-dir']));
const reportDir = resolve(values['report-dir']);
await stat(join(exportDir, 'index.html'));
await mkdir(reportDir, { recursive: true });
const repoRoot = resolve(import.meta.dirname, '..');
const locale = JSON.parse(await readFile(join(repoRoot, 'src/i18n/locales/zh-CN/models.json'), 'utf8'));
const companionLocale = JSON.parse(await readFile(join(repoRoot, 'src/i18n/locales/zh-CN/companions.json'), 'utf8'));
const id = 'mobile-model-fixture';
const providerId = 'fixture-provider';
const ref = model => ({ provider_id: providerId, model });
const now = 1_800_000_000_000;
const desktop = { desktop_id: id, desktop_name: 'Companion UI fixture', protocol_version: 1,
  min_client_protocol: 1, capabilities: ['agent_session'] };
const system = { storage_generation: id, agent_data_generation: 1, platform: 'fixture', arch: 'fixture' };
const capability = (task, traits = []) => ({ task, traits,
  protocol: task === 'chat' && traits.includes('vision_input') ? 'openai.responses' : `fixture.${task}`,
  connection_role: 'default', allow_cross_origin_credentials: false, provider_params: {},
  created_at: now, updated_at: now });
const model = (name, task, traits = [], enabled = true) => ({ provider_id: providerId,
  model: name, enabled, sort_order: 0, capabilities: [capability(task, traits)], created_at: now, updated_at: now });
const provider = { provider_id: providerId, platform: 'openai', name: 'Local fixture',
  base_url: 'http://127.0.0.1:1', auth_scheme: 'bearer', has_credentials: true, enabled: true,
  sort_order: 0, created_at: now, updated_at: now,
  models: [model('chat-alpha', 'chat'), model('chat-vision', 'chat', ['vision_input']),
    model('image-only', 'image_generation'), model('asr-one', 'speech_recognition'),
    model('tts-one', 'speech_synthesis'), model('tts-two', 'speech_synthesis'),
    { ...model('unsupported-vision', 'chat', ['vision_input']),
      capabilities: [{ ...capability('chat', ['vision_input']), protocol: 'fixture.unsupported' }] },
    model('chat-disabled', 'chat', [], false)] };
let providers = [provider, { ...provider, provider_id: 'disabled-provider', name: 'Disabled provider', enabled: false,
  models: [{ ...model('forbidden-disabled-provider', 'chat'), provider_id: 'disabled-provider' }] }];
let providersError = false;
let profileError = false;
let nextPatchError;
let patchDelay = 0;
let profile = {
  companion_id: id, seq: 1, name: '模型验证伙伴', character: 'mochi',
  persona: { preset: 'lively', custom: 'keep-persona' }, model: null, fallback_model: null, vision_model: null,
  voice: { asr: null, tts: { ...ref('tts-one'), voice: 'preserved-voice' },
    vad: { engine: 'silero', sensitivity: 0.61, min_silence_ms: 731 } },
  learn: { enabled: false, interval_minutes: 73, model: null },
  evolve: { enabled: true, interval_minutes: 97, model: null, auto_activate: true },
  skills: { enabled: [], disabled_auto: [] },
  appearance: { companion_enabled: false, quiet_start: '23:00', quiet_end: '08:00' },
  order_index: 1, created_at: now,
};
const initial = structuredClone(profile);
const existingSession = { conversation_id: 'existing-session', name: 'Existing frozen Session', type: 'agent',
  model: ref('frozen-session-model'), created_at: now, modified_at: now,
  extra: { companion_id: id, companion_session: true } };
const sessionBefore = structuredClone(existingSession);
const requests = [];
const patches = [];
const unexpected = [];
const pageErrors = [];
const checks = [];
let mood = 'happy';
const fullProfile = () => ({ ...structuredClone(profile), status: { companion_id: id,
  xp: 11, level: 1, mood, memories_active: 3, memories_archived: 2,
  model_configured: profile.model !== null, collect_any_enabled: false } });
function merge(target, patch) {
  for (const [key, value] of Object.entries(patch)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {};
      merge(target[key], value);
    } else target[key] = value;
  }
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
const apiResponse = (response, data, status = 200) => {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(status < 400 ? { success: true, data } : { success: false, message: data }));
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/api/')) {
      const entry = { method: request.method, path, status: 200 };
      requests.push(entry);
      assert.equal(request.headers.authorization,
        path === '/api/connections/info' ? undefined : 'Bearer companion-ui-fixture-token');
      if (path === `/api/companion/companions/${id}` && request.method === 'PATCH') {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const patch = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        const error = nextPatchError;
        nextPatchError = undefined;
        patches.push({ body: patch, accepted: !error });
        if (patchDelay) await new Promise(accept => setTimeout(accept, patchDelay));
        if (error) { entry.status = 400; apiResponse(response, error, 400); return; }
        merge(profile, patch);
        // Desktop PATCH returns a profile without status: the UI must re-read.
        apiResponse(response, structuredClone(profile));
        return;
      }
      assert.equal(request.method, 'GET', `Unexpected write ${request.method} ${path}`);
      let data;
      if (path === '/api/connections/info') data = desktop;
      else if (path === '/api/system/info') data = system;
      else if (path === '/api/model-protocols') {
        const task = url.searchParams.get('task') ?? 'chat';
        const descriptor = { protocol_id: `fixture.${task}`, supported_tasks: [task], executor: 'agent',
          transport: 'http', requires_output_ceiling: false, allowed_auth_schemes: ['bearer'],
          scopes: ['native'], platforms: ['openai'], default_connections: [], endpoints: [] };
        data = { tasks: [task], preset: url.searchParams.get('preset') ?? 'OpenAI', platform: 'openai',
          requested_task: task, platform_default_base_url: null, requires_user_input: false,
          default_auth_scheme: 'bearer', auth_schemes: [],
          recommendation: { protocol_id: descriptor.protocol_id, connection_role: 'default', default_base_url: null,
            default_auth_scheme: 'bearer', base_url_override_required: false }, protocols: [descriptor] };
      }
      else if (path === '/api/providers') {
        if (providersError) { entry.status = 503; apiResponse(response, 'fixture catalog unavailable', 503); return; }
        data = providers;
      } else if (path === `/api/companion/companions/${id}`) {
        if (profileError) { entry.status = 503; apiResponse(response, 'fixture profile refresh unavailable', 503); return; }
        data = fullProfile();
      }
      else if (path === '/api/companion/companions') data = [fullProfile()];
      else if (path === '/api/companion/config') data = { default_companion_id: id, smart_collaboration: false };
      else if (path.endsWith('/weekly-digest')) data = { since_ms: now, skills_learned: 0, memories_added: 0, new_skill_names: [] };
      else if (path.endsWith('/skills')) data = { items: [], total: 0 };
      else if (path === '/api/robots') data = { robots: [] };
      else if (path === '/api/robots/statuses') data = { statuses: [] };
      else if (path === '/api/settings/client') data = {};
      else if (path === '/api/agent-sessions') data = { items: [existingSession], total: 1, has_more: false };
      else if (/^\/api\/projects(?:\/.*)?$/.test(path)) data = [];
      else if (path === '/api/notifications') data = [];
      else throw new Error(`Unexpected API route ${request.method} ${path}`);
      apiResponse(response, data);
      return;
    }
    assert.equal(request.method, 'GET');
    assert.ok(!path.split('/').includes('..') && !path.includes('\\'));
    const candidate = resolve(exportDir, `.${path}`);
    const within = relative(exportDir, candidate);
    assert.ok(!isAbsolute(within) && !within.startsWith('..'));
    const candidates = [candidate, `${candidate}.html`, join(candidate, 'index.html')];
    if (!extname(path)) candidates.push(join(exportDir, 'companion', '[id].html'), join(exportDir, 'index.html'));
    for (const file of candidates) {
      try {
        if (!(await stat(file)).isFile()) continue;
        response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
        response.end(await readFile(file));
        return;
      } catch (error) { if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error; }
    }
    response.writeHead(404); response.end('Not found');
  } catch (error) {
    unexpected.push(error.message);
    if (!response.headersSent) apiResponse(response, error.message, 500);
    else response.destroy();
  }
});
await new Promise((accept, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', accept); });
const origin = `http://127.0.0.1:${server.address().port}`;
const { chromium } = await playwright();
const browser = await chromium.launch({ headless: true,
  ...(process.env.NOMI_E2E_EXECUTABLE_PATH ? { executablePath: process.env.NOMI_E2E_EXECUTABLE_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 },
  locale: 'zh-CN', isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
await context.addInitScript(({ desktop, system }) => {
  localStorage.setItem('nomifun.connection.v1', JSON.stringify({ baseUrl: '',
    token: 'companion-ui-fixture-token', user: null, desktop, system }));
}, { desktop, system });
await context.route('**/*', route => {
  const target = new URL(route.request().url());
  if (target.origin === origin) return route.continue();
  unexpected.push(`External network attempted: ${target.origin}${target.pathname}`);
  return route.abort();
});
// A fixture-owned socket establishes the app's normal WS-ready lifecycle.
// It never connects to a Desktop, starts a Turn or fabricates config events.
const fixtureSockets = new Set();
await context.routeWebSocket(/\/ws(?:\?|$)/, socket => {
  fixtureSockets.add(socket);
  socket.onMessage(() => {});
  socket.onClose(() => fixtureSockets.delete(socket));
});
const notify = (name, data) => {
  assert.ok(fixtureSockets.size > 0, 'A fixture WebSocket must be connected before publishing a change');
  for (const socket of fixtureSockets) socket.send(JSON.stringify({ name, data }));
};
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.on('pageerror', error => pageErrors.push(error.message));
const waitUntil = async (condition, label) => {
  const deadline = Date.now() + 15_000;
  while (!await condition()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise(accept => setTimeout(accept, 20));
  }
};
// RNW Modal adds an unnamed outer dialog during exit animation. Scope to the
// Sheet's named inner dialog so closing animations cannot create ambiguity.
const sheet = () => page.locator('[role="dialog"][aria-label]');
// RNW's icon font participates in the button's accessible name, so match the
// visible model identifier without depending on the decorative glyph prefix.
const modelOption = name => sheet().getByRole('button', { name: new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
const enterProfile = async () => {
  // The app's protected routes initially return to the list while the persisted
  // connection is verified. Follow the same navigation as a signed-in user.
  await page.getByRole('button', { name: '打开导航', exact: true }).click();
  await page.getByRole('button', { name: '伙伴', exact: true }).click();
  await page.getByRole('button', { name: profile.name, exact: true }).click();
  await page.getByTestId('companion-model-model').waitFor({ state: 'visible' });
};
const reloadProfile = async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterProfile();
};
const open = async slot => {
  await page.getByTestId(`companion-model-${slot}`).click();
  await sheet().waitFor({ state: 'visible' });
};
const close = async () => {
  await sheet().getByRole('button', { name: '关闭', exact: true }).click();
  await sheet().waitFor({ state: 'hidden' });
};
const voiceInput = () => sheet().getByRole('textbox', { name: locale.defaults.voice, exact: true });
const voiceSettles = expected => waitUntil(async () => await voiceInput().inputValue() === expected, `voice draft: ${expected}`);
const choose = async (slot, selectedModel, expected) => {
  const before = patches.length;
  const reads = requests.filter(item => item.method === 'GET' && item.path === `/api/companion/companions/${id}`).length;
  await open(slot);
  await modelOption(selectedModel).click();
  await sheet().waitFor({ state: 'hidden' });
  assert.equal(patches.length, before + 1);
  assert.deepEqual(patches.at(-1), { body: expected, accepted: true });
  await waitUntil(() => requests.filter(item => item.method === 'GET' && item.path === `/api/companion/companions/${id}`).length > reads,
    'authoritative profile refresh after PATCH');
  assert.match(await page.getByTestId(`companion-model-${slot}`).innerText(), new RegExp(selectedModel));
};
let activeCheck;
let failure;
const check = async (name, run) => {
  activeCheck = name;
  await run();
  checks.push(name);
  await page.screenshot({ path: join(reportDir, `${String(checks.length).padStart(2, '0')}.png`) });
  console.log(`PASS ${name}`);
};
try {
  await page.goto(origin, { waitUntil: 'domcontentloaded' });
  await enterProfile();
  await check('all seven editable slots mount with server status and preserved TTS voice', async () => {
    for (const slot of ['model', 'fallback_model', 'vision_model', 'asr', 'tts', 'learn', 'evolve']) {
      await page.getByTestId(`companion-model-${slot}`).waitFor({ state: 'visible' });
    }
    await open('tts');
    await voiceSettles('preserved-voice');
    await page.screenshot({ path: join(reportDir, 'picker-tts.png') });
    await close();
    assert.equal(patches.length, 0);
  });
  await check('chat picker filters disabled and incompatible models, saves one field and re-reads canonical state', async () => {
    await open('model');
    for (const name of ['asr-one', 'tts-one', 'image-only', 'chat-disabled', 'forbidden-disabled-provider']) {
      assert.equal(await modelOption(name).count(), 0);
    }
    await page.screenshot({ path: join(reportDir, 'picker-chat.png') });
    await close();
    await choose('model', 'chat-alpha', { model: ref('chat-alpha') });
    await reloadProfile();
    await page.getByTestId('companion-model-model').getByText(/chat-alpha/).waitFor();
  });
  await check('fallback, vision, ASR, learning and evolution use exact slot payloads', async () => {
    await choose('fallback_model', 'chat-alpha', { fallback_model: ref('chat-alpha') });
    await open('vision_model');
    assert.equal(await modelOption('chat-alpha').count(), 0);
    assert.equal(await modelOption('unsupported-vision').count(), 0);
    await close();
    await choose('vision_model', 'chat-vision', { vision_model: ref('chat-vision') });
    await choose('asr', 'asr-one', { voice: { asr: ref('asr-one') } });
    await choose('learn', 'chat-alpha', { learn: { model: ref('chat-alpha') } });
    await choose('evolve', 'chat-vision', { evolve: { model: ref('chat-vision') } });
  });
  await check('Settings and Overview share the same saved model profile', async () => {
    await page.getByRole('tab', { name: '设置', exact: true }).click();
    await page.getByTestId('companion-model-learn').getByText(/chat-alpha/).waitFor();
    await open('fallback_model');
    assert.equal(await modelOption('chat-alpha').getAttribute('aria-selected'), 'true');
    await close();
    await page.getByRole('tab', { name: '总览', exact: true }).click();
    await page.getByTestId('companion-model-evolve').getByText(/chat-vision/).waitFor();
  });
  await check('an unsaved TTS voice survives a WebSocket-driven profile refresh', async () => {
    const before = patches.length;
    await open('tts');
    await voiceSettles('preserved-voice');
    await voiceInput().fill('unsaved-draft-voice');
    mood = 'excited';
    notify('companion.config-updated', { companion_id: id });
    await page.getByText('兴奋', { exact: true }).last().waitFor();
    assert.equal(await voiceInput().inputValue(), 'unsaved-draft-voice');
    assert.equal(patches.length, before);
    await page.screenshot({ path: join(reportDir, 'tts-draft-after-refresh.png') });
    await close();
    await open('tts');
    await voiceSettles('preserved-voice');
    await close();
  });
  await check('TTS drafts preserve voice, save edited voice and clear explicitly without changing ASR/VAD', async () => {
    await open('tts');
    await voiceSettles('preserved-voice');
    const before = patches.length;
    await modelOption('tts-two').click();
    await voiceSettles('preserved-voice');
    assert.equal(patches.length, before, 'TTS model selection must remain a draft until Save');
    await sheet().getByRole('button', { name: '保存', exact: true }).click();
    await sheet().waitFor({ state: 'hidden' });
    assert.deepEqual(patches.at(-1).body, { voice: { tts: { ...ref('tts-two'), voice: 'preserved-voice' } } });
    await open('tts');
    await voiceSettles('preserved-voice');
    await sheet().getByRole('textbox', { name: locale.defaults.voice, exact: true }).fill('updated-voice');
    await sheet().getByRole('button', { name: '保存', exact: true }).click();
    await sheet().waitFor({ state: 'hidden' });
    assert.deepEqual(patches.at(-1).body, { voice: { tts: { ...ref('tts-two'), voice: 'updated-voice' } } });
    await open('tts');
    await voiceSettles('updated-voice');
    await sheet().getByText(companionLocale.modelSettings.followGlobal, { exact: true }).click();
    await sheet().getByRole('button', { name: '保存', exact: true }).click();
    await sheet().waitFor({ state: 'hidden' });
    assert.deepEqual(patches.at(-1).body, { voice: { tts: null } });
    assert.deepEqual(profile.voice.asr, ref('asr-one'));
    assert.deepEqual(profile.voice.vad, initial.voice.vad);
  });
  await check('a rejected save stays inline in the open sheet and retry commits exactly once', async () => {
    nextPatchError = 'fixture selection rejected';
    const before = patches.length;
    await open('model');
    await modelOption('chat-vision').click();
    await sheet().getByText('fixture selection rejected', { exact: true }).waitFor();
    assert.equal(patches.length, before + 1);
    assert.equal(profile.model.model, 'chat-alpha');
    assert.match(await page.getByTestId('companion-model-model').innerText(), /chat-alpha/);
    await page.screenshot({ path: join(reportDir, 'picker-save-error.png') });
    patchDelay = 400;
    await modelOption('chat-vision').click();
    await waitUntil(() => patches.length === before + 2, 'retry request');
    assert.equal(await modelOption('chat-vision').getAttribute('aria-disabled'), 'true');
    await sheet().waitFor({ state: 'hidden' });
    patchDelay = 0;
    assert.equal(patches.length, before + 2);
    assert.equal(profile.model.model, 'chat-vision');
  });
  await check('a committed PATCH survives temporary GET failure with inline retry feedback', async () => {
    profileError = true;
    await choose('fallback_model', 'chat-vision', { fallback_model: ref('chat-vision') });
    await page.getByText(companionLocale.detail.refreshFailed, { exact: true }).waitFor();
    assert.match(await page.getByTestId('companion-model-fallback_model').innerText(), /chat-vision/);
    assert.equal(patches.at(-1).accepted, true);
    await page.screenshot({ path: join(reportDir, 'committed-with-refresh-error.png') });
    profileError = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText(companionLocale.detail.refreshFailed, { exact: true }).waitFor({ state: 'hidden' });
    assert.match(await page.getByTestId('companion-model-fallback_model').innerText(), /chat-vision/);
  });
  await check('provider updates mark a saved model unavailable without erasing its reference', async () => {
    provider.models.find(item => item.model === 'chat-alpha').enabled = false;
    notify('providers.changed', {});
    await page.getByTestId('companion-model-learn').getByText(companionLocale.modelSettings.unavailable, { exact: true }).waitFor();
    assert.match(await page.getByTestId('companion-model-learn').innerText(), /chat-alpha/);
    assert.deepEqual(profile.learn.model, ref('chat-alpha'));
    provider.models.find(item => item.model === 'chat-alpha').enabled = true;
    notify('providers.changed', {});
    await page.getByTestId('companion-model-learn').getByText(companionLocale.modelSettings.unavailable, { exact: true }).waitFor({ state: 'hidden' });
  });
  await check('explicit clear persists null and reload never changes an existing Session', async () => {
    await open('model');
    await sheet().getByText(companionLocale.modelSettings.clear, { exact: true }).click();
    await sheet().waitFor({ state: 'hidden' });
    assert.deepEqual(patches.at(-1).body, { model: null });
    await reloadProfile();
    await page.getByTestId('companion-model-model').waitFor();
    assert.equal(profile.model, null);
    assert.deepEqual(existingSession, sessionBefore);
    assert.equal(requests.filter(item => item.path.startsWith('/api/agent-sessions') && item.method !== 'GET').length, 0);
  });
  await check('an empty catalog offers model management and a failed catalog is distinguishable/retryable', async () => {
    providers = [];
    await reloadProfile();
    await open('model');
    await sheet().getByText(locale.defaults.noCandidates, { exact: true }).waitFor();
    await page.getByTestId('companion-manage-models').waitFor({ state: 'visible' });
    await page.screenshot({ path: join(reportDir, 'picker-empty.png') });
    await close();
    providersError = true;
    await reloadProfile();
    await open('model');
    await sheet().getByText(locale.defaults.catalogUnresolved, { exact: true }).waitFor();
    assert.equal(await sheet().getByText(locale.defaults.noCandidates, { exact: true }).count(), 0);
    providersError = false;
    await sheet().getByRole('button', { name: '重试', exact: true }).click();
    await sheet().getByText(locale.defaults.noCandidates, { exact: true }).waitFor();
    await page.getByTestId('companion-manage-models').getByRole('button').click();
    await page.waitForURL(/\/models$/);
    await page.getByText(locale.list.empty, { exact: true }).waitFor();
  });
  await check('unrelated configuration, existing Session and network isolation remain intact', async () => {
    assert.deepEqual(profile.persona, initial.persona);
    assert.deepEqual(profile.appearance, initial.appearance);
    assert.equal(profile.learn.enabled, initial.learn.enabled);
    assert.equal(profile.learn.interval_minutes, initial.learn.interval_minutes);
    assert.equal(profile.evolve.enabled, initial.evolve.enabled);
    assert.equal(profile.evolve.interval_minutes, initial.evolve.interval_minutes);
    assert.equal(profile.evolve.auto_activate, initial.evolve.auto_activate);
    assert.deepEqual(existingSession, sessionBefore);
    assert.deepEqual(unexpected, []);
    assert.deepEqual(pageErrors, []);
  });
} catch (error) {
  failure = { check: activeCheck, message: error.message, stack: error.stack };
  await page.screenshot({ path: join(reportDir, 'failure.png') }).catch(() => {});
  await writeFile(join(reportDir, 'failure-body.txt'), await page.locator('body').innerText().catch(() => ''));
  console.error(`FAIL ${activeCheck}: ${error.message}`);
} finally {
  await browser.close();
  await new Promise(accept => server.close(accept));
  await writeFile(join(reportDir, 'report.json'), JSON.stringify({
    schema: 'nomifun.mobile-companion-model-ui.v1', generated_at: new Date().toISOString(),
    scope: 'Real exported RN Web UI with isolated fixture HTTP/WS; not real Desktop, upstream model or physical Native acceptance.',
    export_dir: exportDir, passed: !failure, checks, requests, patches, unexpected,
    page_errors: pageErrors, failure,
  }, null, 2));
}
if (failure) process.exitCode = 1;
else console.log(`PASS ${checks.length} RN Web checks; report: ${join(reportDir, 'report.json')}`);
