# Testing & verification

Three gates, in the order of how often you should run them:

| Command | Needs a backend? | What it proves |
| --- | --- | --- |
| `bun run typecheck` | no | `tsc --noEmit` over `src/`, `tests/`, `e2e` types |
| `bun test` | no | pure functions behave, including on dirty input |
| `bun run check:i18n` | no | zh-CN / en-US stay in lockstep, no missing keys |
| `bun run e2e` | **yes** | the H5 build boots and every surface mounts |
| `bun run e2e:project` | **yes** | the whole project-session flow works |
| `node --test scripts/voice-web-server.test.mjs` | isolated fixtures | Node static/API/WS boundaries and owned shutdown; no cloud/device proof |
| `node e2e/voice-web.mjs` (`e2e:voice-web`) | **fresh isolated API-only host** | source-bound RN Web UI plus browser synthetic-media contracts; see the dedicated procedure below |

## Session data and Android module identity

```sh
bun test tests/session-commands.test.ts tests/session-wire.test.ts tests/session-data.test.ts tests/session-sync.test.ts src/features/sessions/__tests__/catalog.test.ts src/features/sessions/__tests__/presentation.test.ts tests/cache-module-identity.test.mjs tests/transport-client.test.ts
bun run typecheck
bun run typecheck:e2e-sessions
bun run check:i18n
bun run check:cache-modules
```

The cache-module test uses the real Metro resolver and real React provider hooks
in a separate Node process. It reproduces the original ESM/CJS context split,
then checks that public SWR entries share fetcher, cache and mutate under the
project configuration. A source-only Node import test cannot detect this native
resolution problem.

After native bundling changes, clear Metro and inspect the emitted graph:

```sh
CI=1 EXPO_OFFLINE=1 bunx expo export --platform android --clear --no-bytecode --source-maps --output-dir /tmp/nomifun-session-android
node scripts/check-cache-module-graph.mjs --source-map /tmp/nomifun-session-android/_expo/static/js/android/entry-HASH.js.map
```

The map must contain one SWR config context. Bytecode/JS export checks do not
replace installing a rebuilt APK and accepting the flow on a physical device.

Real HTTP acceptance requires a separate fresh API-only host with data, work,
cache and log directories isolated under a new temporary directory:

```sh
bun run e2e:sessions -- --backend-url http://127.0.0.1:PORT --data-dir /tmp/NEW-DIRECTORY/data
```

The script checks loopback, the process announcement, the exact reported data
directory, new-installation state and the absence of configured providers before
writing. It exercises the real Mobile transport, creation command, wire validators
and shared owner: empty list, committed create, manual refresh, pagination,
metadata synchronization and deletion. No Turn or model request is sent. The
report defaults to `.tmp-e2e/session-data/report.json`; only its own Session IDs
are cleanup candidates. A host without native cleanup support may reject deletion
with `AGENT_SESSION_BROWSER_CLEANUP_UNAVAILABLE`; that remains an explicit failed
real-host check, never a simulated success or reason to bypass cleanup.

Browser acceptance must check that a known created Session returns to the list,
remains after manual refresh and reload, appears once, and has no permanent
"loading more" indicator. A load-error message is not a settled success state.

Connection changes have a focused offline gate:

```sh
bun test tests/connection-contract.test.ts tests/connection-core.test.ts tests/credential-storage.test.ts tests/transport-client.test.ts tests/pairing.test.ts tests/pairing-intake.test.ts
bun run typecheck
bun run check:i18n
bun run export:web
```

The pure HTTP transport in `src/api/transport-client.ts` and the injectable
store in `src/api/connection-core.ts` can run against the real Desktop / Relay /
agent stack without importing React Native. Cover one-shot device pairing,
independent revocation (including WebSocket invalidation), an uncertain POST
with exactly one delivery, and a held response from an old Desktop after the
active namespace changes. Mocked secure storage failure tests prove pointer
commit ordering; they do not prove physical Keychain / Keystore behavior.

H5 acceptance needs Mobile HTML, `/api/*` and `/ws` on the same origin. Its
sign-in now registers a separately revocable device through `device-login` /
`device-setup`, with browser cookies omitted. Run acceptance against isolated
data, rather than treating sign-in as a read-only operation. Expo development
must regenerate typed routes after adding routes; the production export checks
bundling. Android/iOS camera permissions, secure storage and native cold/warm
intents require a rebuilt Native app and physical-device acceptance.

`bun run check` runs the three offline gates in one go — that is the pre-commit
loop. Definition of done for any change stays "typecheck clean **with your files
included**".

## Unit tests (`bun test`)

Bun's own runner, no Jest, no extra dependency. It picks up `tests/*.test.ts`
and any `src/**/*.test.ts`, and resolves the `@/*` alias straight from
`tsconfig.json` — nothing to configure.

```bash
bun test                        # everything
bun test tests/cron.test.ts     # one file
bun test --watch                # while writing
bun test -t "placeholder"        # by test name
```

**What belongs here:** pure functions — reducers, normalizers, path math,
parsers, formatters. `src/features/**` is deliberately organised so those live
apart from React (`workpath.ts`, `stream.ts`, `cron.ts`, `risky-path.ts`,
`normalize.ts`, `preview.ts`, `recent.ts`…).

**What does not:** anything that imports React Native, `@/i18n`, or
`@/api/client`. Bun runs without a React Native renderer — `react-native` will not resolve and there
is no renderer. Import the pure module directly (`@/features/fs/risky-path`),
never the barrel that re-exports it alongside the API layer
(`@/features/fs/api`).

`tests/bun-test.d.ts` declares the slice of `bun:test` these tests use.
`@types/bun` is intentionally NOT installed: it ships its own `global`/`fetch`/
timer declarations that collide with react-native's and would pollute
`bun run typecheck` for the whole app. If you need a matcher that is not
declared yet, add it there.

## i18n consistency (`bun run check:i18n`)

`scripts/check-i18n.mjs`, zero dependencies. It **fails** on:

1. a namespace or key present in one locale but not the other;
2. a `{{placeholder}}` set that differs between locales for the same key
   (`_one` / `_zero` plural forms may inline `count` — "1 session" is correct);
3. an empty string on either side;
4. a `t('…')` call site whose key does not exist.

It **warns** (never fails) about keys no call site references: keys built at
runtime (`t(\`weekday.${day}\`)`) cannot be proven used, so the list is a
cleanup hint, not a verdict.

Namespace resolution mirrors how the app calls i18next: `useTranslation('ns')`
destructuring (`t`, or an alias such as `tc`), a local wrapper
(`const tr = (k) => i18n.t(k, { ns: 'fs' })`), and an inline `{ ns: 'common' }`
override. A non-literal key is counted as dynamic and skipped — the summary line
prints how many.

When you add UI text: fill **both** `src/i18n/locales/zh-CN/<ns>.json` and
`src/i18n/locales/en-US/<ns>.json` in the same change. zh-CN is the source of
truth; en-US must have the identical key set.

## Browser acceptance (`e2e/`)

The realtime voice task uses the dedicated isolated RN Web procedure below,
not the general scripts' default ports, credentials, desktop launch or data.
Its authorization covers headless Chromium only. Visible GUI, Tauri, native
apps, emulators, ADB, APK installation and commit/push remain prohibited.

Playwright scripts that drive the **web build** — the only target that can be
automated on Linux, and the one AGENTS.md says to verify on. They are acceptance
scripts, not a test framework: numbered steps, a verdict per step, a screenshot
per step, non-zero exit if anything failed.

### Prerequisites

Playwright is **not** a dependency of this repo (its ~150 MB browser download is
only needed for explicit browser acceptance). There are two ways to get one:

```bash
# a) add it here, if you are going to iterate on these scripts
bun add -d playwright && bun x playwright install chromium

# b) borrow an install that already exists on the machine — nothing touches
#    package.json / bun.lock, which is the right call for a one-off run
NOMI_E2E_PLAYWRIGHT=/tmp/pw bun run e2e      # → /tmp/pw/node_modules/playwright
```

`NOMI_E2E_PLAYWRIGHT` is the *directory containing* `node_modules`, not the
package itself. `NODE_PATH=…` does **not** work here and is not worth trying:
Node's ESM resolver ignores it (only `require` honours it), so a bare
`import 'playwright'` inside `e2e/lib.mjs` cannot see an out-of-tree install.
`lib.mjs` therefore resolves the package manifest itself and imports the
`exports['.'].import` entry — resolving the package the ordinary way hands back
the CJS `index.js`, whose named exports an `import()` cannot see, and the symptom
is `Cannot read properties of undefined (reading 'launch')`.

Either way the browser binary comes from `~/.cache/ms-playwright`; a borrowed
install already has it.

Then, in three terminals (or one `bun run dev` plus the desktop app):

1. **The desktop app** — `~/src/nomifun-tauri`, with *开放能力 → WebUI 远程访问*
   switched on. It serves the API on `http://127.0.0.1:25808`.
   Alternatively run `nomifun-web` on `:8787`.
2. **`bun run dev`** — Expo web on `:8081` **and** `scripts/dev-proxy.mjs` on
   `:8788`. The proxy is not optional: it puts the app and the API on **one
   origin** so cookies/CSRF/WS behave like production.
   Point it at the desktop listener with
   `NOMIFUN_SERVER=http://127.0.0.1:25808 bun run dev`.
3. **The script** — `bun run e2e`.

### Credentials

`NOMI_E2E_USER` / `NOMI_E2E_PASSWORD` (defaults `admin` / `nomifun`). The real
password is shown in the desktop app's *WebUI 远程访问* panel — read it from
there, do not commit it. On a brand-new backend the connect screen switches to
"initialize admin" and the same two values create the account.

### Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `NOMI_E2E_BASE` | `http://127.0.0.1:8788` | origin serving app **and** API |
| `NOMI_E2E_USER` | `admin` | login user |
| `NOMI_E2E_PASSWORD` | `nomifun` | login password |
| `NOMI_E2E_SHOTS` | `docs/screenshots/e2e` | screenshot output directory |
| `NOMI_E2E_HEADED` | *(unset)* | `1` to watch the browser |
| `NOMI_E2E_SLOWMO` | `0` | ms of slow motion per action |
| `NOMI_E2E_TIMEOUT` | `15000` | default action timeout (ms) |
| `NOMI_E2E_PROJECT_DIR` | `/tmp/nomi-e2e-project` | fixture dir for the project flow |
| `NOMI_E2E_PLAYWRIGHT` | *(unset)* | dir holding `node_modules/playwright`, when it is not installed here |

A full run against a live desktop backend looks like this:

```bash
NOMI_E2E_PLAYWRIGHT=/tmp/pw NOMI_E2E_PASSWORD='…' bun run e2e          # 9 steps
NOMI_E2E_PLAYWRIGHT=/tmp/pw NOMI_E2E_PASSWORD='…' \
  NOMI_E2E_PROJECT_DIR=/tmp/my-fixture bun run e2e:project             # 14 steps
```

### The scripts

- **`e2e/smoke.mjs`** — connect, log in, visit all five tabs plus model
  management and customer service, reload to prove the stored binding survives.
  Read-only: safe against a real installation. The reload step asserts *the app
  shell, not a particular tab* — a reload lands on whichever tab the run left
  behind, so asserting the session list there would only pass by accident.
- **`e2e/project-session.mjs`** — creates a fixture directory, picks it by typing
  an absolute path, creates the project session, browses the workspace, previews
  a text file, checks that a >512 KB file and a binary file are refused (the
  binary one with an assertion that **no** `/api/fs/*` request was made — the
  refusal is decided from the extension), drills into a subdirectory, and finally
  checks the directory shows up as a *recent project* shortcut. **Creates one
  conversation and leaves it behind** (the id is printed); delete it from the app
  afterwards. It also assumes the desktop backend runs on this machine, since the
  fixture directory is created locally — point `NOMI_E2E_PROJECT_DIR` at a path
  the backend can see otherwise.
- **`e2e/readme-shots.mjs`** — the README gallery generator. Logs in, walks
  every documented surface, and writes the numbered PNGs under
  `NOMI_E2E_SHOTS` (point it at `docs/screenshots` to refresh the README).
  Read-only except for one fallback: on a backend with zero conversations it
  creates a single empty session so the chat screen has content — the id is
  printed, delete it afterwards.
- **`e2e/lib.mjs`** — launch/login/step/screenshot helpers and, importantly, the
  `ui` table of on-screen strings. The scripts match Chinese copy (the app boots
  into zh-CN unconditionally), so a wording change is a one-line fix there
  instead of a hunt through every script.

Selectors follow the app's accessibility surface wherever there is one
(`getByRole('button', { name: '查看工作目录' })`) and fall back to visible text.
Do not add `testID`s just for these scripts — if a control is hard to address,
it is usually missing an `accessibilityLabel`, which is worth fixing anyway.

## RN Web 语音隔离验收

当前共享UI的Android Release及iOS JS/Hermes打包另已完成，报告在
build.noindex/voice-sdk-ui-20261007092140/current-ui-packaging.json及
build.noindex/voice-ios-js-current-20261007-7f21c9/report.json。新Android包
59976185B/SHA c2e51872ff5e4cb6e7feb3cac45c71db436aebdf001d34cf525afbd080b4afa6，
当前iOS Hermes5794000B/SHA57a3c77d24f4d0d246014fd7c717a9f74888a3c17bba906a89594e5d0b8ce864。
source/copy前后、实际构建及进程终态均保留；旧包不补当前UI。它们没有运行app，
不代替本节Web、Swift、真机、声学、两云与完整工具宿主验收。

此流程对应独立的 `nomifun-mobile` RN/Expo Web 产品。Desktop 使用
API-only 宿主；Mobile 的手机 viewport 不用于 Desktop renderer 验收。
全程只运行隔离无头 Chromium，保留原可见 GUI/Tauri/原生应用/模拟器/ADB/
安装 APK 与 commit/push 禁令。

### 运行时与源码导出

使用已有外部 Playwright runtime，不修改 package/lock 或借用当前浏览器。
`NOMI_E2E_PLAYWRIGHT` 指向**包含 `node_modules/playwright` 的运行时根目录**；
`NOMI_E2E_EXECUTABLE_PATH` 指向该运行时的 Chromium 可执行文件。
没有显式 executable 时，runner 使用 Playwright 的 Chromium channel。
`NOMI_E2E_BUN_EXECUTABLE` 可指定打包媒体入口用的 Bun 完整路径；它不会
让服务器或 runner 改用 Bun。`e2e:voice-web` 的 package script 实际执行
`node e2e/voice-web.mjs`，与下面直接 Node 命令等价。

每次完整验收使用新的 export/report 目录。`voice:web:export --out-dir`
拒绝已有目录，并在 Expo 导出前后核对 `src/public/plugins`、app/package
配置与 lock 的 SHA，写 `.voice-web-source.json`；runner 再比对当前源码，
源码变化后必须重新导出。Bun 只负责导出/打包；Node 负责 HTTP/WS 与浏览器
调度。实际 Bun 1.3.14 WS 升级兼容检查失败，服务器在 Bun 下会在监听前
返回 `NODE_RUNTIME_REQUIRED`。Bun-only guard 通过不能代替 Node 网络检查。

```powershell
# nomifun-mobile 根目录；本例只准备导出，不启动服务或 GUI。
$VoiceWebSuffix = [guid]::NewGuid().ToString("N")
$VoiceWebExport = Join-Path (Get-Location).Path ("build.noindex/voice-web-export-" + $VoiceWebSuffix)
$VoiceWebReport = Join-Path (Get-Location).Path ("build.noindex/voice-web-report-" + $VoiceWebSuffix)
bun run voice:web:export --out-dir $VoiceWebExport
```

### 独立的真实 Desktop API

先用当前 Desktop 源码对应、已核对源/二进制身份的 `nomifun-web`，单独
创建 fresh backend 根。每个 data 根有各自**预先创建、已存在的 workdir**，
在这个后端子进程中设置 `NOMIFUN_WORK_DIR`；不能让第二个 data 根重用
同一个 workdir，也不能把“workdir 不存在”导致的 data fallback 当作正确
隔离。完整 UI 验收会创建一次性 admin 与 canonical 测试 Session，重跑
需要新 data/workdir，不能附着已初始化的现有安装。

```powershell
# 在单独 PowerShell 中启动后端；变量必须指向本次隔离根和实际构建产物。
$VoiceBackendRoot = "<Desktop build.noindex 内新的本次 backend 根绝对路径>"
$VoiceBackendExecutable = "<当前源码构建并核对的 nomifun-web.exe 绝对路径>"
$VoiceBackendData = Join-Path $VoiceBackendRoot "data"
$VoiceBackendWork = Join-Path $VoiceBackendRoot "workdir"
New-Item -ItemType Directory -Path $VoiceBackendData, $VoiceBackendWork | Out-Null
$env:NOMIFUN_WORK_DIR = $VoiceBackendWork
# 仅清除本终端/子进程会继承的认证覆盖；不读取或打印其值。
Remove-Item Env:\NOMIFUN_WEB_INSECURE_NO_AUTH -ErrorAction SilentlyContinue
Remove-Item Env:\NOMIFUN_ADMIN_PASSWORD -ErrorAction SilentlyContinue
& $VoiceBackendExecutable --api-only --host 127.0.0.1 --port 0 --data-dir $VoiceBackendData
```

保持认证模式，不传 `--insecure-no-auth`，不继承禁用认证或预置 admin 的
环境值。环境处理仅作用于该测试子进程，不修改系统环境或读取真实凭据。
使用新 data，不修改 dataset/work-root marker、lineage、checkpoint 或
现有 Session 身份，不做清库/迁移来让测试通过。

运行前在 data 根的父目录保存**真实比对产生**的
`backend-source-evidence.json`，至少包含实际 `source_files_checked`、
`source_mismatch` 和二进制 SHA；不能手填匹配结果。runner 同时读取该
data 的真实 `port.json`，核对 host、端口与 pid，并检查认证状态。它不
使用默认服务端口或真实账号/密码。

### 执行 Node runner 与单独静态服务器

```powershell
# 回到 nomifun-mobile 根目录，沿用这次 VoiceWebExport/VoiceWebReport。
$VoiceBackendData = "<刚启动的 fresh data 绝对路径>"
$VoiceBackendPort = Get-Content (Join-Path $VoiceBackendData "port.json") -Raw | ConvertFrom-Json
$VoiceBackendOrigin = "http://127.0.0.1:" + $VoiceBackendPort.port
$env:NOMI_E2E_PLAYWRIGHT = "<外部运行时根目录>"
$env:NOMI_E2E_EXECUTABLE_PATH = "<Chromium 可执行文件绝对路径>"
node e2e/voice-web.mjs --export-dir $VoiceWebExport --backend-url $VoiceBackendOrigin `
  --data-dir $VoiceBackendData --report-dir $VoiceWebReport
```

`export-dir` 和 `report-dir` 必须在 Mobile `build.noindex` 内，report 必须
尚不存在，backend URL 必须与本次 port.json 相符。runner 自己启动
`127.0.0.1:0` Node 服务并 finally 关闭它，不需要同时开一个额外服务器。
它在该次导出内写 `__voice_acceptance__/endpoint.mjs` 和 `media.html`，
这些诊断页面不进入产品源码。

若只检查导出/API/媒体 WS 服务，可以独立运行：

```powershell
node scripts/voice-web-server.mjs --export-dir $VoiceWebExport --backend-url $VoiceBackendOrigin
# 定向服务器检查：8 个 Node 网络/lifecycle cases；不连接真实安装。
node --test scripts/voice-web-server.test.mjs
```

服务器只接受显式 export/backend，固定监听 `127.0.0.1:0`，输出实际端口。
Host、Origin、认证/cookie 和媒体票据子协议保持原值，API、业务 WS 和
voice media WS 继续由 Desktop 验证；它不记录请求/query/凭据/票据。
`ready` 只证明导出与本地监听，不认证后端/云/麦克风。SIGINT/TERM 或
`close()` 仅关闭本服务器持有的 listener/HTTP/upgrade socket，最多给
活动连接 300ms 收尾，不终止后端或其他服务。

浏览器、context、代理的关闭记录进入 `report.json`。后端由启动它的
持有者单独发送 SIGINT 并核对本次 PID/监听消失，另存关闭证据；不能
用 data/lock 文件或观察超时推断终态，不能清理其他自动化进程。
Windows Node child signal 单测用 `process.emit` 验证 handler 和实际 TCP
关闭，不代表 OS 控制台信号投递已验；本批后端有独立真实 SIGINT 证据。

### 证据范围与当前结果

API-only 宿主的普通 General 创建实际返回 HTTP 422，错误为
`CAPABILITY_NOT_MATERIALIZED`，缺少真实 `system.browser_use` owner。
runner 只在核对该实际拒绝后，显式通过真实 canonical API 创建官方
`chat.minimal` 空能力测试会话。它不改 Mobile 普通默认，不伪造 nativeRole，
不认证 General 的浏览器/电脑工具或普通完整任务链。

| 证据 | 可以证明 | 仍未证明 |
| --- | --- | --- |
| 实际 RN Web UI + 隔离 Desktop API | 首次设置、canonical 测试 Session、默认不获取 mic/voice store、草稿往返、绑定恢复、voice 404 故障隔离、样式截图 | General 真正原生角色、模型任务/工具/审批回执、真机交互 |
| Chromium 合成 WAV + 生产 Web endpoint/AudioWorklet | 非零 PCM、格式/时长/年龄额度、暂停恢复序号、错误 credit 与 JS 阻塞尾帧、输出 generation/未知消费、关闭 track | 云 ASR/disposition、人声识别、实体麦克风/扬声器、AEC/听感、用户已听到 |
| 源身份与 owned shutdown | 当前 source/export/bundle、无 pageerror、自己的浏览器/代理/后端关闭 | 两厂商体验、原生 Android/iOS 设备与 Swift 编译、LAN/TLS、真实并发负载及 p50/p95 |

2026-10-07 当前批次导出为 `build.noindex/voice-web-export-20261007-ui8`：
50 routes、1768 Web modules、264 份 source SHA。报告为
`build.noindex/voice-web-evidence-20261007-ui9/report.json`，15 项全部 passed
（7 项 UI/API、8 项媒体）、
page_errors=0；Chromium 149.0.7827.55。本批包含仅语音稳定 appearance
订阅与显式 palette，动态 light→dark→light 已验证；phone/wide/dark 三张
产品截图已实际查看。31 项相关定向测试/173 assertions 与最新 typecheck
通过。Node 服务器 8 项网络测试通过；Node 下额外 Bun-only guard skipped，
Bun 下只通过拒绝运行的 guard、8 项网络用例 skipped，不混合计为通过。
新增两项实际边界：无 ACK 的采集仅交付 2 帧、不超过 60ms worklet 额度；
同步提交 100ms 播放在 60ms 的 JS→worklet 预算边界失败关闭。JS 阻塞
用例证明过期 PCM 不交付，不能证明阻塞期间硬件 track 已停止：
AudioWorklet 不能调用 MediaStreamTrack.stop。旧 ui8 的 13 项报告保留，
当前记录以同源码/同导出的 ui9 完整运行结果为准。

报告 SHA256：`860bde0a8e6ceceabc6144727a61eb7af8c0faf38f06796b2793f8d2f5cfd2a8`。
生产媒体验收 bundle SHA256：`563f3abc50a2431277e448e5fb082ef9dbc0da6b09caf00c2200a7e6f52a5e0f`。
报告确认 browser/context/proxy 关闭；同目录 `backend-close.json` 确认
实际 SIGINT/应用清理、PID 36056 与端口 60007 均不存在。PTY exit1 如实
保存，未作为 Rust exit0。普通默认 `useTheme`、Main 会话/API/hooks 未改。

本批没有修改 SDK 原生源码或持久补丁，既有 APK 是之前构建时点的
快照，不能补证后续 UI 新代码。`cloud_calls=false`、物理音频/原生待验、
p50/p95=null 保留；两真实厂商、听感/AEC、真实设备生命周期、iOS native、
LAN/TLS、并发负载与用户验收仍 pending，Goal 未完成。

## Platform footguns that look like test failures

- **A new platform-specific file (`foo.web.tsx` next to `foo.tsx`) needs
  `expo start --clear`.** Metro's resolution cache keeps serving the old
  variant, and the symptom is a silently missing feature — no error, no warning.
  If a change "does nothing" on web, restart Metro with `--clear` before
  debugging anything else.
- **react-native-web drops `accessibilityState`.** Use `a11yState()` from
  `@/utils/a11y` and pass `disabled` to `Pressable` itself; RNW derives
  `aria-disabled` and tab order from that prop and overwrites anything set by
  hand. A `getByRole(..., { disabled: true })` assertion that never matches is
  usually this.
- **A toast fired while a `Modal` is open is hidden underneath it on native**
  (web portals above it). Modal flows must also assert inline feedback, so an
  e2e script that passes on web can still be wrong on a phone.
- **WebKit/Safari caches modules aggressively.** A white screen after a change,
  on iOS Safari only, is usually a stale HTTP disk cache and not your code.

## Local validation

Run the offline gates locally with `bun run check`. This repository does not
use CI; backend-dependent and platform acceptance runs remain explicit local
tasks as described above.
