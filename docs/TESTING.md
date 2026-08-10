# Testing & verification

Three gates, in the order of how often you should run them:

| Command | Needs a backend? | What it proves |
| --- | --- | --- |
| `bun run typecheck` | no | `tsc --noEmit` over `src/`, `tests/`, `e2e` types |
| `bun test` | no | pure functions behave, including on dirty input |
| `bun run check:i18n` | no | zh-CN / en-US stay in lockstep, no missing keys |
| `bun run e2e` | **yes** | the H5 build boots and every surface mounts |
| `bun run e2e:project` | **yes** | the whole project-session flow works |

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
`@/api/client`. Bun runs plain Node — `react-native` will not resolve and there
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

Playwright scripts that drive the **web build** — the only target that can be
automated on Linux, and the one AGENTS.md says to verify on. They are acceptance
scripts, not a test framework: numbered steps, a verdict per step, a screenshot
per step, non-zero exit if anything failed.

### Prerequisites

Playwright is **not** a dependency of this repo (it pulls a ~150 MB browser that
CI never needs). There are two ways to get one:

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
- **`e2e/lib.mjs`** — launch/login/step/screenshot helpers and, importantly, the
  `ui` table of on-screen strings. The scripts match Chinese copy (the app boots
  into zh-CN unconditionally), so a wording change is a one-line fix there
  instead of a hunt through every script.

Selectors follow the app's accessibility surface wherever there is one
(`getByRole('button', { name: '查看工作目录' })`) and fall back to visible text.
Do not add `testID`s just for these scripts — if a control is hard to address,
it is usually missing an `accessibilityLabel`, which is worth fixing anyway.

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

## CI

`.github/workflows/ci.yml` runs the three offline gates on push/PR. This
repository has **no git remote yet**, so that workflow has never executed — it is
committed so the gate exists the moment the repo is pushed.
