/**
 * Shared harness for the browser acceptance scripts (`e2e/*.mjs`).
 *
 * These drive the **web (H5) build** through Playwright, because that is the
 * only target that can be automated on this Linux box — and, per AGENTS.md, the
 * one we verify on. They are acceptance scripts, not a test framework: each one
 * walks a real user flow against a **running desktop backend**, prints a
 * per-step verdict, and drops a screenshot per step so a failure is inspectable
 * afterwards.
 *
 * Playwright is NOT a dependency of this repo (it pulls a browser download that
 * CI never needs — CI runs typecheck + unit tests only). Install it on demand:
 *
 *     bun add -d playwright && bun x playwright install chromium
 *
 * …or, to keep it out of this repo entirely, point the scripts at an install
 * that already exists on the machine:
 *
 *     NOMI_E2E_PLAYWRIGHT=/tmp/pw bun run e2e     # /tmp/pw/node_modules/playwright
 *
 * Environment (all optional):
 *   NOMI_E2E_BASE       origin serving app + API on one host   [http://127.0.0.1:8788]
 *   NOMI_E2E_USER       login user                             [admin]
 *   NOMI_E2E_PASSWORD   login password                         [nomifun]
 *   NOMI_E2E_SHOTS      screenshot directory                   [docs/screenshots/e2e]
 *   NOMI_E2E_HEADED     "1" to watch the run                   [headless]
 *   NOMI_E2E_SLOWMO     ms of slow motion per action           [0]
 *   NOMI_E2E_TIMEOUT    default action timeout in ms           [15000]
 *   NOMI_E2E_PROJECT_DIR directory used by the project flow    [/tmp/nomi-e2e-project]
 *   NOMI_E2E_PLAYWRIGHT dir holding node_modules/playwright    [this repo]
 */
import { mkdir, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(import.meta.dirname, '..');

export const env = {
  base: (process.env.NOMI_E2E_BASE ?? 'http://127.0.0.1:8788').replace(/\/+$/, ''),
  user: process.env.NOMI_E2E_USER ?? 'admin',
  password: process.env.NOMI_E2E_PASSWORD ?? 'nomifun',
  shots: resolve(REPO_ROOT, process.env.NOMI_E2E_SHOTS ?? 'docs/screenshots/e2e'),
  headed: process.env.NOMI_E2E_HEADED === '1',
  slowMo: Number(process.env.NOMI_E2E_SLOWMO ?? 0),
  timeout: Number(process.env.NOMI_E2E_TIMEOUT ?? 15_000),
  projectDir: process.env.NOMI_E2E_PROJECT_DIR ?? '/tmp/nomi-e2e-project',
};

/**
 * UI copy the scripts click on. zh-CN is the primary locale and the app boots
 * into it unconditionally (`lng: 'zh-CN'` in src/i18n/index.ts), so matching on
 * Chinese text is stable. Keep this table in sync with
 * `src/i18n/locales/zh-CN/*.json` — a rename here is a one-line fix instead of
 * a hunt through five scripts.
 */
export const ui = {
  connect: { submit: '连接', title: '连接桌面端' },
  tabs: {
    sessions: '会话',
    tasks: '任务',
    requirements: '需求',
    companions: '伙伴',
    more: '我的',
  },
  more: { models: '模型管理', customerService: '客服' },
  project: {
    createTitle: '新建项目会话',
    submit: '创建项目会话',
    pick: '选择工作目录',
    change: '更换目录',
    browse: '浏览项目文件',
    previewBack: '返回文件列表',
  },
  picker: { manual: '手动输入路径', manualSubmit: '校验并选择', select: '选择当前目录' },
};

/**
 * Import Playwright — from this repo, or from an install somewhere else.
 *
 * `NOMI_E2E_PLAYWRIGHT` is the directory whose `node_modules` holds an existing
 * playwright (e.g. a scratch dir used for browser automation on this machine).
 * It exists so a one-off acceptance run does not have to add a ~150 MB browser
 * dependency to a repo whose CI never needs one. `NODE_PATH` cannot do this
 * job: Node's **ESM** resolver ignores it (only `require` honours it), and ESM
 * refuses to import a bare directory — so the package entry has to be resolved
 * with `require.resolve` and imported as a file URL.
 */
export async function playwright() {
  const external = process.env.NOMI_E2E_PLAYWRIGHT?.trim();
  if (external) {
    const anchor = createRequire(join(resolve(external), 'package.json'));
    try {
      // `anchor.resolve('playwright')` would answer the **CJS** entry
      // (`index.js`, the `require` condition), and `import()`ing that yields a
      // namespace without `chromium`. Resolve the manifest instead and take the
      // package's own `import` condition, which is the real ESM entry.
      const manifest = anchor.resolve('playwright/package.json');
      const pkg = JSON.parse(await readFile(manifest, 'utf8'));
      const entry = pkg.exports?.['.']?.import ?? pkg.module ?? pkg.main ?? 'index.js';
      return await import(pathToFileURL(join(dirname(manifest), entry)).href);
    } catch (error) {
      console.error(
        `NOMI_E2E_PLAYWRIGHT=${external} does not resolve a playwright package\n` +
          `(expected ${join(resolve(external), 'node_modules', 'playwright')}): ${error?.message}\n`,
      );
      process.exit(2);
    }
  }
  try {
    return await import('playwright');
  } catch {
    console.error(
      'playwright is not installed in this repo (on purpose — it is not a runtime\n' +
        'dependency and CI does not run these scripts). Either install it here:\n\n' +
        '    bun add -d playwright && bun x playwright install chromium\n\n' +
        'or point the scripts at an install you already have:\n\n' +
        '    NOMI_E2E_PLAYWRIGHT=/path/to/dir/with/node_modules bun run e2e\n',
    );
    process.exit(2);
  }
}

/** A phone-sized Chromium with console/page errors surfaced in the log. */
export async function launch() {
  const { chromium, devices } = await playwright();
  await mkdir(env.shots, { recursive: true });
  const browser = await chromium.launch({ headless: !env.headed, slowMo: env.slowMo });
  const context = await browser.newContext({
    ...devices['iPhone 13'],
    // The app is same-origin with the API through the dev proxy; a fixed locale
    // keeps the copy table above valid.
    locale: 'zh-CN',
    isMobile: true,
    hasTouch: true,
  });
  context.setDefaultTimeout(env.timeout);
  const page = await context.newPage();
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`  [console] ${message.text()}`);
  });
  page.on('pageerror', (error) => console.log(`  [pageerror] ${error.message}`));
  return { browser, context, page };
}

let stepIndex = 0;
const failures = [];

/** `01-connect.png`, `02-…` — numbered so the directory reads as a filmstrip. */
export async function shot(page, name) {
  const file = join(env.shots, `${String(stepIndex).padStart(2, '0')}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  return file;
}

/**
 * Run one named step. A throw is recorded and the run continues, so one broken
 * step does not hide the state of everything after it — except for a `fatal`
 * step (connect/login), where continuing would just print a wall of identical
 * timeouts.
 */
export async function step(page, name, body, { fatal = false } = {}) {
  stepIndex += 1;
  const label = `${String(stepIndex).padStart(2, '0')} ${name}`;
  try {
    const result = await body();
    console.log(`  PASS  ${label}`);
    await shot(page, slug(name));
    return result;
  } catch (error) {
    failures.push({ name, message: error?.message ?? String(error) });
    console.log(`  FAIL  ${label}\n        ${error?.message ?? error}`);
    await shot(page, `FAIL-${slug(name)}`);
    if (fatal) {
      console.log('\n  aborting: nothing after this step can pass.');
      await page.context().browser()?.close().catch(() => {});
      process.exit(1);
    }
    return undefined;
  }
}

function slug(name) {
  return name
    .replace(/[^\w一-龥]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

/** Assert a locator becomes visible; the message names what was expected. */
export async function seen(locator, what, timeout = env.timeout) {
  await locator.first().waitFor({ state: 'visible', timeout }).catch(() => {
    throw new Error(`expected to see: ${what}`);
  });
}

export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

/**
 * Open the app and log in.
 *
 * On web there is no host/port field — the build talks to its own origin (see
 * `src/app/connect.tsx`) — so the only inputs are user + password. A session
 * already restored from localStorage lands straight on the tab bar, in which
 * case this is a no-op.
 */
export async function login(page) {
  await page.goto(`${env.base}/`, { waitUntil: 'domcontentloaded' });
  const tabBar = page.getByText(ui.tabs.sessions, { exact: true });
  const password = page.locator('input[type="password"]');

  const arrived = await Promise.race([
    tabBar.first().waitFor({ state: 'visible', timeout: env.timeout }).then(() => 'app'),
    password.first().waitFor({ state: 'visible', timeout: env.timeout }).then(() => 'connect'),
  ]).catch(() => 'nothing');

  if (arrived === 'nothing') {
    throw new Error(
      `neither the tab bar nor the login form appeared at ${env.base} — is the desktop backend ` +
        'and `bun run dev` (Expo web + proxy) running?',
    );
  }
  if (arrived === 'app') return 'already-signed-in';

  // The username field is the only non-password input on this screen.
  const user = page.locator('input:not([type="password"])').first();
  await user.fill(env.user);
  await password.first().fill(env.password);
  await page.getByRole('button', { name: ui.connect.submit }).first().click();
  await seen(tabBar, `the ${ui.tabs.sessions} tab after logging in`, env.timeout * 2);
  return 'signed-in';
}

/** Tap a bottom tab by its label. */
export async function openTab(page, label) {
  await page.getByText(label, { exact: true }).last().click();
}

/** Print the verdict and exit non-zero when anything failed. */
export async function finish(browser, title) {
  await browser?.close().catch(() => {});
  console.log(`\n${title}: ${stepIndex - failures.length}/${stepIndex} steps passed`);
  console.log(`screenshots: ${env.shots}`);
  if (failures.length > 0) {
    for (const failure of failures) console.log(`  FAIL ${failure.name}: ${failure.message}`);
    process.exit(1);
  }
}
