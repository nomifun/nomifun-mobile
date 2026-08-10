#!/usr/bin/env node
/**
 * Project-session acceptance: create a session bound to a real directory, then
 * exercise the file browser and the read-only preview end to end.
 *
 *     node e2e/project-session.mjs        # or: bun run e2e:project
 *
 * Requires a **running desktop backend** plus `bun run dev`, and assumes the
 * backend runs on **this machine** — the fixture directory below is created
 * locally and must be visible to the desktop process. Point
 * `NOMI_E2E_PROJECT_DIR` elsewhere if that is not the case.
 *
 * Not read-only: it creates one conversation and leaves it behind (the id is
 * printed at the end). Deleting it from the phone UI is its own flow; doing it
 * here would make a failure mid-run hide the evidence.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { assert, env, finish, launch, login, seen, shot, step, ui } from './lib.mjs';

const DIR = env.projectDir;
const MARKER = `nomifun-e2e-${Date.now()}`;
const FIXTURES = {
  text: 'README.md',
  binary: 'logo.png',
  large: 'big.log',
  subdir: 'src',
  nested: 'nested.txt',
};

const { browser, page } = await launch();
console.log(`project session against ${env.base}\nfixture dir ${DIR}`);

/** Every `/api/fs/*` request, so a step can assert one was *not* made. */
const fsCalls = [];
page.on('request', (request) => {
  const url = request.url();
  if (url.includes('/api/fs/')) fsCalls.push(`${request.method()} ${url.replace(env.base, '')}`);
});

await step(page, 'prepare the fixture directory on disk', async () => {
  await mkdir(join(DIR, FIXTURES.subdir), { recursive: true });
  await writeFile(join(DIR, FIXTURES.text), `# ${MARKER}\n\nline two\nline three\n`, 'utf8');
  // A PNG header is enough: the phone refuses by extension before reading.
  await writeFile(join(DIR, FIXTURES.binary), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  // Over the 512 KB preview ceiling, so the refusal path is real.
  await writeFile(join(DIR, FIXTURES.large), 'x'.repeat(600 * 1024), 'utf8');
  await writeFile(join(DIR, FIXTURES.subdir, FIXTURES.nested), `${MARKER} nested\n`, 'utf8');
});

await step(page, 'connect and sign in', () => login(page), { fatal: true });

await step(page, 'open the create-project screen', async () => {
  // Deep link: the entry point ("+" on a project group) is covered by the
  // session-list flow; this script is about what happens after.
  await page.goto(`${env.base}/session/new-project`, { waitUntil: 'domcontentloaded' });
  await seen(page.getByText(ui.project.createTitle).first(), 'the create-project screen');
});

await step(page, 'pick the directory by typing an absolute path', async () => {
  await page.getByRole('button', { name: ui.project.pick }).first().click();
  await seen(page.getByText('选择目录').first(), 'the directory picker');
  await page.getByRole('button', { name: ui.picker.manual }).first().click();
  // The prompt overlay hosts exactly one input.
  await page.locator('input').last().fill(DIR);
  await page.getByRole('button', { name: ui.picker.manualSubmit }).first().click();
  // The picker hands back the server's canonical path, so this also proves the
  // path resolved server-side.
  await seen(page.getByText(DIR, { exact: false }), `the resolved path ${DIR}`);
});

await step(page, 'the session name defaults to the directory basename', async () => {
  const value = await page.locator('input').first().inputValue();
  assert(value === basename(DIR), `expected the name field to prefill "${basename(DIR)}", got "${value}"`);
});

const conversationId = await step(page, 'create the project session', async () => {
  await page.getByRole('button', { name: ui.project.submit }).first().click();
  // `new-project` is itself a `/session/*` path, so it has to be excluded or the
  // wait resolves against the page we are still on.
  await page.waitForURL(/\/session\/(?!new-project)[^/]+$/, { timeout: env.timeout * 2 });
  const id = new URL(page.url()).pathname.split('/').pop();
  assert(id && id !== 'new-project', `expected to land on a session, url is ${page.url()}`);
  return id;
});

await step(page, 'the chat screen shows the workspace chip', async () => {
  // By accessible label, not by text: the chip label is the basename, which is
  // also the session name in the header.
  await seen(page.getByRole('button', { name: '查看工作目录' }), 'the workspace chip');
});

await step(page, 'open the working-directory panel and the file browser', async () => {
  await page.getByRole('button', { name: '查看工作目录' }).first().click();
  await seen(page.getByText(DIR, { exact: false }), 'the full path in the panel');
  await page.getByRole('button', { name: ui.project.browse }).first().click();
  await seen(page.getByText(FIXTURES.text, { exact: true }), `${FIXTURES.text} in the listing`);
});

await step(page, 'preview a text file', async () => {
  await page.getByText(FIXTURES.text, { exact: true }).first().click();
  await seen(page.getByText(MARKER, { exact: false }), 'the file content in the preview');
  await seen(page.getByText(/共 \d+ 行/), 'the line/size footnote');
});

await step(page, 'leave the preview and return to the listing', async () => {
  await page.getByRole('button', { name: ui.project.previewBack }).first().click();
  await seen(page.getByText(FIXTURES.binary, { exact: true }), 'the listing again');
});

await step(page, 'a large text file is refused instead of downloaded', async () => {
  await page.getByText(FIXTURES.large, { exact: true }).first().click();
  await seen(page.getByText('文件太大'), 'the too-large refusal');
  await page.getByRole('button', { name: ui.project.previewBack }).first().click();
});

await step(page, 'a binary file is refused without being fetched', async () => {
  const before = fsCalls.length;
  await page.getByText(FIXTURES.binary, { exact: true }).first().click();
  // The refusal is decided from the extension, so the tap must answer with a
  // reason *and* cost nothing: `/api/fs/read` 500s on non-UTF-8 input, and
  // `/api/fs/metadata` could not tell us anything the name has not settled.
  await seen(page.getByText('无法预览这种文件'), 'the binary refusal');
  assert(
    fsCalls.length === before,
    `refusing a binary file must not hit the filesystem API, saw: ${fsCalls.slice(before).join(', ')}`,
  );
  await page.getByRole('button', { name: ui.project.previewBack }).first().click();
  await seen(page.getByText(FIXTURES.text, { exact: true }), 'the listing again');
});

await step(page, 'drill into a subdirectory and preview a nested file', async () => {
  await page.getByText(FIXTURES.subdir, { exact: true }).first().click();
  await seen(page.getByText(`/${FIXTURES.subdir}`), 'the breadcrumb of the subdirectory');
  await page.getByText(FIXTURES.nested, { exact: true }).first().click();
  await seen(page.getByText(MARKER, { exact: false }), 'the nested file content');
  await page.getByRole('button', { name: ui.project.previewBack }).first().click();
});

await step(page, 'the directory shows up as a recent project shortcut', async () => {
  await page.goto(`${env.base}/session/new-project`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: ui.project.pick }).first().click();
  await seen(
    page.getByText(`最近：${basename(DIR)}`),
    'the recent-project shortcut on the picker start screen',
  );
  // Tapping it must browse straight into that directory.
  await page.getByText(`最近：${basename(DIR)}`).first().click();
  await seen(page.getByText(FIXTURES.subdir, { exact: true }), 'the directory listing behind it');
});

await shot(page, 'final');
console.log(`\ncreated conversation: ${conversationId ?? '(none)'} — delete it from the app when done`);
await finish(browser, 'project session');
