#!/usr/bin/env node
/**
 * Smoke acceptance: connect, log in, and visit every top-level surface.
 *
 *     node e2e/smoke.mjs          # or: bun run e2e
 *
 * Requires a **running desktop backend** plus the web dev server and proxy
 * (`bun run dev`) — see docs/TESTING.md. Read-only: it creates nothing and
 * deletes nothing, so it is safe to point at a real installation.
 *
 * What passing proves: the H5 build boots, the stored binding survives a
 * reload, every tab and both secondary screens mount, and each one settles into
 * a real state (content, empty state, or a retryable error) instead of a stuck
 * spinner.
 */
import { assert, env, finish, launch, login, openTab, seen, step, ui } from './lib.mjs';

/**
 * One marker per surface: a string that can ONLY come from that screen, so the
 * assertion cannot be satisfied by the tab bar label alone. Each alternative is
 * a legitimate settled state — loaded, empty, or failed-with-retry.
 */
const SURFACES = [
  // `新建项目会话` is the list header, rendered for *any* non-empty list, so with
  // the empty and failed states this trio is exhaustive. The obvious-looking
  // `未绑定目录` is not: that group header only appears once a **project**
  // session exists, so a marker relying on it passes or fails depending on what
  // the backend happens to hold.
  { tab: ui.tabs.sessions, marker: /还没有会话|会话列表加载失败|新建项目会话/ },
  { tab: ui.tabs.tasks, marker: /暂无定时任务|没有匹配的定时任务|任务列表|新建定时任务|下次运行/ },
  { tab: ui.tabs.requirements, marker: /还没有需求|没有符合条件的需求|新建需求|待执行/ },
  { tab: ui.tabs.companions, marker: /还没有桌面伙伴|读取伙伴列表失败|新建伙伴|位伙伴/ },
  { tab: ui.tabs.more, marker: /模型管理|当前站点|由桌面端 Nomifun 提供服务/ },
];

const { browser, page } = await launch();
console.log(`smoke against ${env.base}`);

await step(
  page,
  'connect and sign in',
  async () => {
    const how = await login(page);
    console.log(`        (${how})`);
  },
  { fatal: true },
);

for (const surface of SURFACES) {
  await step(page, `${surface.tab} tab settles`, async () => {
    await openTab(page, surface.tab);
    await seen(page.getByText(surface.marker), `a settled ${surface.tab} screen`);
    // A spinner still on screen after the marker means the screen is half-built.
    const loading = page.getByText('加载中…').first();
    if (await loading.isVisible().catch(() => false)) {
      await loading.waitFor({ state: 'hidden' });
    }
  });
}

await step(page, 'more tab reaches model management', async () => {
  await openTab(page, ui.tabs.more);
  await page.getByText(ui.more.models, { exact: true }).first().click();
  await seen(page.getByText(/还没有模型供应商|供应商|添加供应商/), 'the models screen');
  await page.goBack();
});

await step(page, 'more tab reaches customer service', async () => {
  await openTab(page, ui.tabs.more);
  await page.getByText(ui.more.customerService, { exact: true }).first().click();
  await seen(page.getByText(/还没有客服|共.*位客服|创建客服/), 'the customer-service screen');
  await page.goBack();
});

await step(page, 'binding survives a reload', async () => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  // A reload lands on whatever tab the previous step left behind, so the proof
  // that the stored binding was restored is "the app shell came back, not the
  // connect screen" — asserting a session-list marker here instead would make
  // this step depend on the order of the ones above it.
  await seen(page.getByText(ui.tabs.more, { exact: true }), 'the tab bar after reload');
  const connectScreen = await page.locator('input[type="password"]').count();
  assert(connectScreen === 0, 'the connect screen came back: the stored binding was not restored');
  await openTab(page, ui.tabs.sessions);
  await seen(page.getByText(SURFACES[0].marker), 'the session list after reload');
});

await finish(browser, 'smoke');
