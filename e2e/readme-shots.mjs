#!/usr/bin/env node
/**
 * README screenshot capture — drives the H5 build through the surfaces the
 * docs gallery shows and writes numbered PNGs. Run with the same environment
 * as the acceptance scripts (see docs/TESTING.md):
 *
 *     NOMI_E2E_PLAYWRIGHT=/path/to/pw NOMI_E2E_PASSWORD='…' \
 *       NOMI_E2E_SHOTS=docs/screenshots node e2e/readme-shots.mjs
 *
 * Read-only against the backend: it browses and types a composer draft, but
 * sends no message and creates nothing. The one exception is when the backend
 * has no conversation at all, in which case it creates a single empty session
 * so the chat screen has something to show — the id is printed for cleanup.
 */
import { env, launch, login, openTab, seen, ui } from './lib.mjs';
import { join } from 'node:path';

const shot = async (page, name) => {
  const file = join(env.shots, name);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`  shot  ${name}`);
};

/** Settle helper: a screen is done when its marker shows OR the spinner is gone. */
const settle = async (page, marker, what) => {
  await seen(page.getByText(marker), what);
  const loading = page.getByText('加载中…').first();
  if (await loading.isVisible().catch(() => false)) {
    await loading.waitFor({ state: 'hidden' }).catch(() => {});
  }
};

const { browser, page } = await launch();
console.log(`readme-shots against ${env.base} → ${env.shots}`);

// 01 — connect/sign-in screen (fresh context always lands here on web).
await page.goto(`${env.base}/`, { waitUntil: 'domcontentloaded' });
await seen(page.locator('input[type="password"]'), 'the connect screen');
await shot(page, '01-connect.png');

// 02 — session inbox after login. A populated list settles on the filter
// chips; an empty one on its empty/error copy.
await login(page);
await settle(page, /全部|还没有会话|会话列表加载失败/, 'the session list');
// The "已连接" toast covers the header right after sign-in — let it fade.
await page
  .getByText(/已连接/)
  .first()
  .waitFor({ state: 'hidden', timeout: env.timeout })
  .catch(() => {});
await page.waitForTimeout(600);
await shot(page, '02-sessions.png');

// 03 — a real chat. Prefer an existing session that already has messages.
const conversations = await page.evaluate(async () => {
  const res = await fetch('/api/agent-sessions?limit=25');
  if (!res.ok) return [];
  const body = await res.json();
  return body.data?.items ?? body.items ?? [];
});

let chatId;
if (conversations.length > 0) {
  for (const c of conversations.slice(0, 10)) {
    const id = c.conversation_id;
    const has = await page.evaluate(async (cid) => {
      const res = await fetch(
        `/api/agent-sessions/${encodeURIComponent(cid)}/message-history?page_size=5&cursor=`,
      );
      if (!res.ok) return false;
      const body = await res.json();
      return (body.data?.items ?? body.items ?? []).length > 0;
    }, id);
    if (has) {
      chatId = id;
      break;
    }
  }
  chatId ??= conversations[0].conversation_id;
} else {
  // No session at all — create one empty chat through the UI so the screen
  // is real, and print the id so it can be deleted afterwards.
  const create = page.getByRole('button', { name: 'add', exact: true });
  if (await create.isVisible().catch(() => false)) {
    await create.click();
  } else {
    await page.getByText(/新建会话|新会话/).first().click();
  }
  await page.waitForURL(/\/session\//, { timeout: env.timeout });
  chatId = page.url().split('/session/')[1];
  console.log(`  note  created one empty session for the chat shot: ${chatId}`);
}

await page.goto(`${env.base}/session/${chatId}`, { waitUntil: 'domcontentloaded' });
await seen(page.getByPlaceholder('说点什么…'), 'the composer');
await page.waitForTimeout(1200);
await shot(page, '03-chat.png');

// 04 — composer with a drafted (unsent) message.
const composer = page.getByPlaceholder('说点什么…');
await composer.fill('帮我把这个项目的需求整理成一份清单');
await page.waitForTimeout(300);
await shot(page, '04-composer.png');
await composer.fill('');

// 05-08 — the remaining primary tabs.
await openTab(page, ui.tabs.tasks);
await settle(page, /定时任务仅在电脑|暂无定时任务|没有匹配的定时任务|任务列表|新建定时任务|下次/, 'the tasks screen');
await shot(page, '05-tasks.png');

await openTab(page, ui.tabs.requirements);
await settle(page, /全部标签|待处理|还没有需求|没有符合条件的需求|新建需求|待执行/, 'the requirements screen');
await shot(page, '06-requirements.png');

await openTab(page, ui.tabs.companions);
await settle(page, /认识你|还没有桌面伙伴|读取伙伴列表失败|新建伙伴|位伙伴/, 'the companions screen');
await shot(page, '07-companions.png');

await openTab(page, ui.tabs.more);
await settle(page, /模型管理|当前站点|由桌面端 Nomifun 提供服务/, 'the account screen');
await shot(page, '08-more.png');

// 09-10 — secondary screens reachable from 我的.
await page.getByText(ui.more.models, { exact: true }).first().click();
await settle(page, /还没有模型供应商|供应商|添加供应商/, 'the models screen');
await shot(page, '09-models.png');
await page.goBack();

await page.getByText(ui.more.customerService, { exact: true }).first().click();
await settle(page, /还没有客服|共.*位客服|创建客服/, 'the customer-service screen');
await shot(page, '10-customer-service.png');

// 11 — message search across all sessions. If the backend search endpoint is
// down (500), retry once; a persistent failure-state shot does not belong in
// the README, so delete the capture and note the gap.
await page.goto(`${env.base}/search`, { waitUntil: 'domcontentloaded' });
const searchField = page.getByPlaceholder('搜索所有会话里的消息');
await seen(searchField, 'the search field');
await searchField.fill('故事');
await page.waitForTimeout(2000);
if (await page.getByText('搜索失败').first().isVisible().catch(() => false)) {
  await page.getByText('重试').first().click().catch(() => {});
  await page.waitForTimeout(2000);
}
if (await page.getByText('搜索失败').first().isVisible().catch(() => false)) {
  console.log('  skip  11-search (backend search endpoint returned an error)');
} else {
  await shot(page, '11-search.png');
}

// 12 — the project-session directory picker: the phone browsing the
// Desktop's real filesystem to bind a working directory. Read-only: the
// picker is closed without creating anything.
await page.goto(`${env.base}/session/new-project`, { waitUntil: 'domcontentloaded' });
const pickBtn = page.getByRole('button', { name: ui.project.pick });
const pickThere = await pickBtn
  .first()
  .waitFor({ state: 'visible', timeout: env.timeout })
  .then(() => true)
  .catch(() => false);
if (pickThere) {
  await pickBtn.first().click();
  await seen(page.getByText('选择目录').first(), 'the directory picker');
  // Drill into the home shortcut so the shot shows real remote directories.
  await page.getByText('主目录').first().click().catch(() => {});
  await page.waitForTimeout(1500);
  await shot(page, '12-directory-picker.png');
  await page
    .getByRole('button', { name: '关闭' })
    .first()
    .click()
    .catch(() => page.keyboard.press('Escape').catch(() => {}));
} else {
  console.log('  skip  12-directory-picker (new-project screen did not render)');
}

// 13 — voice screen for a real session (mic permission is not granted
// headless; whatever the screen renders is the honest state).
await page
  .goto(`${env.base}/voice?session=${chatId}`, { waitUntil: 'domcontentloaded' })
  .catch(() => {});
await page.waitForTimeout(1500);
await shot(page, '13-voice.png');

// 14 — companion detail: back to the tab and open the first companion card.
await openTab(page, ui.tabs.companions);
await settle(page, /认识你|还没有桌面伙伴|新建伙伴/, 'the companions screen');
await page.getByText(/认识你/).first().click();
await page.waitForTimeout(1200);
await shot(page, '14-companion-detail.png');

await browser.close().catch(() => {});
console.log('done');
