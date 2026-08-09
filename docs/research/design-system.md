# Design System — desktop (nomifun-tauri) source of truth

Research notes for the React Native port. Source repo: `/home/rika/src/nomifun-tauri`.

## Where tokens live

- **Base/default theme (the one to port):**
  `/home/rika/src/nomifun-tauri/ui/src/renderer/styles/themes/default-color-scheme.css`
  148 lines, two blocks: `:root, [data-color-scheme='default']` (light) and
  `[data-color-scheme='default'][data-theme='dark']` (dark).
- **Alternate presets** (5 optional user themes, NOT needed for the port):
  `ui/src/renderer/pages/settings/DisplaySettings/presets/*.css` —
  `codex-neutral`, `frosted-glass`, `neon-rainbow`, `rhythm-dark`, `sunset-afterglow`.
- **Contract checker:** `scripts/check-theme-contract.mjs` validates every preset against
  `presets/README.md`: dual-block structure (dark block must come last), full coverage of
  contract table A (app vars) + table B, `--primary-rgb`/`--primary-1..7` must be RGB triplets,
  no layout properties, no `@import`/external `url()`, no vars inside `@media`.
  This is the list of variables a theme MUST define — useful as the port's token interface.

## Core palette

| Role | Token | Light | Dark |
|---|---|---|---|
| Page background | `--bg-base` | `#ffffff` | `#0e0e0e` |
| Surface / card (L2) | `--bg-1` | `#f9fafb` | `#1a1a1a` |
| Surface (L3) | `--bg-2` | `#f2f3f5` | `#262626` |
| Border / divider | `--bg-3` = `--border-base` | `#e5e6eb` | `#333333` |
| Border light | `--border-light` | `#f2f3f5` | `#262626` |
| Hover bg | `--bg-hover` | `#f3f4f6` | `#1f1f1f` |
| Active/pressed bg | `--bg-active` | `#e5e6eb` | `#2d2d2d` |
| Text primary | `--text-primary` | `#000000` | `#ffffff` |
| Text secondary | `--text-secondary` | `#454d5f` | `#ced3da` |
| Text tertiary | `--bg-6` (see note) | `#86909c` | `#5a5a5a` |
| Text disabled | `--text-disabled` | `#c9cdd4` | `#737373` |
| Primary / accent | `--primary` | `#165dff` | `#4d9fff` |
| Brand | `--brand` | `#7583b2` | `#a1aacb` |
| Brand light (bg) | `--brand-light` | `#eff0f6` | `#3d4150` |
| Brand hover | `--brand-hover` | `#b5bcd6` | `#6a749b` |
| Success | `--success` | `#00b42a` | `#23c343` |
| Warning | `--warning` | `#ff7d00` | `#ff9a2e` |
| Danger | `--danger` | `#f53f3f` | `#f76560` |
| Info | `--info` | `#165dff` | `#4d9fff` |
| Fill | `--fill` | `#f7f8fa` | `#1a1a1a` |

Notes:
- **Text tertiary has no dedicated token.** `uno.config.ts` maps `text-t-tertiary → var(--bg-6)`,
  and `text-t-quaternary → var(--text-secondary)`. In dark mode `--bg-6` is `#5a5a5a`, which is
  *darker* than `--text-secondary` — a real contrast smell worth fixing in the RN port rather
  than copying.
- Light mode text-primary is pure `#000000`, dark is pure `#ffffff` (not softened).

### Neutral ramp (`--bg-*`, doubles as border scale)

| | 4 | 5 | 6 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|
| Light | `#c9cdd4` | `#adb4c1` | `#86909c` | `#4e5969` | `#1d2129` | `#0c0e12` |
| Dark | `#404040` | `#4d4d4d` | `#5a5a5a` | `#737373` | `#a6a6a6` | `#d9d9d9` |

There is no `--bg-7`. Palette is Arco Design's neutral/semantic set in light mode; dark mode is a
pure-grey ramp (not Arco's).

### AOU brand ramp (`--aou-1..10`) — purple-slate, the product's identity color

| | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Light | `#eff0f6` | `#e5e7f0` | `#d1d5e5` | `#b5bcd6` | `#97a0c5` | `#7583b2` | `#596590` | `#3f4868` | `#262c41` | `#0d101c` |
| Dark | `#2a2a2a` | `#3d4150` | `#525a77` | `#6a749b` | `#838fba` | `#a1aacb` | `#b5bcd6` | `#d1d5e5` | `#e5e7f0` | `#eff0f6` |

The ramp **inverts** between modes (light: 1=lightest; dark: 1=darkest). `--brand` = `aou-6` in both
modes. File header calls the default theme "AOU Purple Theme".

### Component colors worth porting

| Purpose | Token | Light | Dark |
|---|---|---|---|
| User message bubble | `--message-user-bg` | `#e9efff` | `#1e2a3a` |
| Tip/system bubble | `--message-tips-bg` | `#f0f4ff` | `#1a2333` |
| Dialog fill | `--dialog-fill-0` | `#ffffff` | `#333333` |
| Terminal surface | `--terminal-surface-bg` | `#1b1d23` | `#1b1d23` (constant) |
| Terminal border | `--terminal-border` | `rgba(0,0,0,.12)` | `rgba(255,255,255,.08)` |
| Agent picker bar (home) | `--color-guid-agent-bar` | `#eaecf7` | `= --aou-2` |
| Inverse (always white) | `--inverse` | `#ffffff` | `#ffffff` |
| Fill 0 | `--fill-0` | `#ffffff` | `rgba(255,255,255,.08)` |

## Typography (`ui/uno.config.ts` + `styles/arco-override.css`)

`uno.config.ts` has **no font config at all** — its `theme` block contains only `colors`. Fonts are
set once in `/home/rika/src/nomifun-tauri/ui/src/renderer/styles/arco-override.css`:

```
html, body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue',
               Arial, 'Noto Sans', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
}
```

Deliberate override: Arco's own CSS puts `Inter` first, which renders too thin where Inter is
installed. **There is no global monospace token** — code/terminal surfaces set their own. For RN this
maps to the platform default (`System` on iOS / Roboto on Android) plus `PingFang SC` for zh.

Only global type tokens defined: tooltip metrics — `--nomi-tooltip-font-size: 12px`,
`--nomi-tooltip-line-height: 16px`, padding `3px / 7px`. Nav item text is `14px / 500 / 24px`.

### UnoCSS color aliases (name → var), useful as the RN token naming convention

- Text: `t-primary`→`--text-primary`, `t-secondary`→`--text-secondary`, `t-tertiary`→`--bg-6`,
  `t-quaternary`→`--text-secondary`, `t-disabled`→`--text-disabled`
- Semantic: `primary` / `success` / `warning` / `danger` / `info`
- Backgrounds (also serve as border scale): `base`, `1`-`6`, `8`, `9`, `10`, `hover`, `active`
- Brand: `brand`, `brand-light`, `brand-hover`; AOU ramp `aou-1..10`
- Arco passthrough rules: `text-1..4`→`--color-text-*`, `bg-fill-1..4`, `border-arco-1..4`,
  `bg-{primary|success|warning|danger|link}-light-1..4`, `{bg|text|border}-{primary|success|warning|danger}-1..9`

Two UnoCSS footguns documented in the config that do NOT carry to RN but explain odd class names:
numeric bg keys hijack directional border classes (`border-b-2` = bottom *color* `--bg-2`, not 2px),
and there is no CSS reset, so `border-style` stays `none` unless `border-b-solid` is added.

## Sidebar navigation (informs the mobile tab bar)

Source: `/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Sider/index.tsx` (render
order, lines 199-330) and one component per item under
`/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Sider/SiderNav/`.

Icons are all from `@icon-park/react`. Entries take `onClick` handlers (no `<Link>`); the route is
visible only through the `isActive` pathname predicate, listed below.

### Scrolling group, in order

| # | Section | Label (zh) | i18n key | Icon | Route / active predicate |
|---|---|---|---|---|---|
| | **常用** `common.siderSection.common` | | | | |
| 1 | 常用 | 会话 | `sessionList.title` | `MessageOne` | `/guid`, `/conversation/*`, `/terminal-new`, `/terminal/*` |
| 2 | 常用 | 桌面伙伴 | `nomi.siderTitle` | `Peoples` | `/nomi*` |
| 3 | 常用 | 创意工坊 (Beta) | `workshop.nav.entry` | `Platte` | `/workshop*` |
| | **数据空间** `...data` | | | | |
| 4 | 数据空间 | 知识库 | `knowledge.title` | `BookOne` | `/knowledge*` |
| 5 | 数据空间 | 资产库 | `assetLibrary.title` | `ImageFiles` | `/assets*` |
| | **自动化** `...automation` | | | | |
| 6 | 自动化 | 定时任务 | `cron.scheduledTasks` | `AlarmClock` | `/scheduled` (exact) |
| 7 | 自动化 | 需求平台 | `requirements.title` | `ListView` | `/requirements*` |
| | **增强工具** `...tools` | | | | |
| 8 | 增强工具 | 设定 | `settings.presetsHub.railTitle` | `Robot` | `/presets*` |
| 9 | 增强工具 | 技能 | `settings.skillsHub.railTitle` | `Puzzle` | `/skills*` |
| 10 | 增强工具 | MCP | `settings.mcpHub.railTitle` | `Lightning` | `/mcp*` |
| | **服务** `...services` | | | | |
| 11 | 服务 | 客服 | `customerService.siderTitle` | `Headset` | `/customer-service*` |

### Bottom pinned group (`设置` section, above a `border-t` divider)

| # | Label (zh) | i18n key | Icon | Route | Note |
|---|---|---|---|---|---|
| 12 | 浏览器 | `browser.sider.label` | `WebPage` | `/browser` (exact) | **Conditionally hidden** when the browser capability is unavailable/unsupported/disabled; shows running+queued lane counts as a badge |
| 13 | 模型管理 | `settings.modelHub.railTitle` | `LinkCloud` | `/models*` | |
| 14 | 远程&开放能力 | `settings.openCapabilities.railTitle` | `LinkCloud` | `/open-capabilities*` | same icon as #13 |

Then `SiderFooter` (settings/account/logout; `Cmd/Ctrl+Shift+L` = logout).

Not in the main list — contextual/secondary entries also living in `SiderNav/`:
`SiderNewConversationEntry` (`Plus`, `Terminal`), `SiderSearchEntry`, `ConversationSiderActions`
(`FolderPlus`, `ListCheckbox`, `Plus`), `SiderSectionHeader`. On `/settings*` the whole nav is
replaced by a lazy-loaded `SettingsSider`.

Sider already knows about mobile: every entry takes an `isMobile` prop, and tooltips are suppressed
when `collapsed && !isMobile`.

### Tab-bar implication

14 destinations is far too many for a tab bar. The five section headers are the natural grouping:
常用 / 数据空间 / 自动化 / 增强工具 / 服务, with 设置 pinned. A 4-5 tab bar would most likely be
会话 + 桌面伙伴 + one aggregate ("更多" or a drawer holding the other sections) + 设置.

## i18n namespace layout

Directory: `/home/rika/src/nomifun-tauri/ui/src/renderer/services/i18n/locales/zh-CN/`
One JSON file per namespace, plus `index.ts` that aggregates them. 38 namespaces:

```
acp            agent          agentExecution  agentMode      assetLibrary
autowork       browser        codex           collaboration  common
conversation   cron           customerService fileSelection  google
guid           idmm           knowledge       login          mcp
messages       modelFailover  nomi            preview        requirements
sessionList    settings       ssh             starOffice     terminal
tools          update         webhook         workshop       workshopAgent
workshopAssets workshopCanvas workshopEditor  workshopGeneration
```

(`index.ts` is the aggregator, not a namespace.) Nav labels are spread across `common` (section
headers), `sessionList`, `nomi`, `workshop`, `knowledge`, `assetLibrary`, `cron`, `requirements`,
`customerService`, `browser` and `settings` — `settings` alone owns presets/skills/mcp/modelHub/
openCapabilities rail titles.

## `ui-api-contract-version` (currently `16`)

**It is not an HTTP header and there is no runtime negotiation.** It is a build-artifact stamp
checked once at backend startup. The browser client never reads it; there is no mismatch banner.

- **Source of truth:** `/home/rika/src/nomifun-tauri/ui-api-contract-version.txt` — one integer, `16`.
- **Baked into the frontend at build time:** `/home/rika/src/nomifun-tauri/ui/vite.config.ts`
  (`uiBuildManifestPlugin`, line 12) reads the txt and, via
  `/home/rika/src/nomifun-tauri/scripts/ui-build-manifest.ts`, emits
  `nomifun-build.json` into the dist as `{ schema, app_version, api_contract_version, frontend_build_id }`.
- **Compiled into the backend:** `/home/rika/src/nomifun-tauri/crates/backend/nomifun-app/src/bootstrap/webui_dist.rs`
  `include_str!`s the same txt (line 9) and exposes `ui_api_contract_version() -> u32`.
- **The check:** `validate_webui_manifest_bytes()` (same file, lines 56-109) compares four things —
  `schema` vs `UI_BUILD_MANIFEST_SCHEMA` (=1), `app_version` vs `CARGO_PKG_VERSION`,
  `api_contract_version` vs the compiled-in value, and `frontend_build_id` vs
  `NOMIFUN_FRONTEND_BUILD_ID`. `deny_unknown_fields` on the struct rejects legacy manifest shapes.
- **On mismatch: hard fatal startup error**, never a warning or degraded mode. Each `ensure!`
  produces e.g. `WebUI api_contract_version mismatch at <path>: backend expects 16, manifest
  contains 15. Run \`bun run build:ui\` and restart the backend.`
- **Call sites (all propagate with `?`, aborting boot):**
  - `/home/rika/src/nomifun-tauri/apps/web/src/main.rs:198` — `validate_webui_dist(&args.dist, ...)`,
    wrapped as `refusing to serve incompatible WebUI assets from <dir>`. Skipped when `--api-only`.
  - `/home/rika/src/nomifun-tauri/apps/desktop/src/main.rs:144` — directory-based SPA dir, production only
    (`tauri::is_dev()` bypasses it).
  - `/home/rika/src/nomifun-tauri/apps/desktop/src/main.rs:244` — embedded Tauri assets, via
    `validate_webui_manifest_bytes` (custom-protocol builds have no filesystem dist).
- Also referenced by `/home/rika/src/nomifun-tauri/apps/build-support/ui_build_manifest.rs`.

### What this means for the RN port

The mechanism guards the *bundled* WebUI against its own backend binary — it assumes frontend and
backend ship together as one artifact. A mobile app updated independently of the server has no
equivalent guard: nothing on the wire carries the contract version, so a stale mobile client would
fail with per-endpoint 4xx/deserialize errors rather than one clear message. If the port talks to a
backend it does not ship with, the version needs to move onto the wire (a header or a
`/api/version`-style endpoint) — that does not exist today. Note that the number is a *frontend-API*
contract, so REST shapes copied into the port are only valid against a v16 backend.

Related but separate: the many `ui/src/common/types/**` files with `Wire-contract types for /api/...`
headers (some are generated `ts-rs` re-exports from the Rust structs) are the per-endpoint payload
contracts. Those are the real porting surface, and a few carry inline notes like "at ui-api-contract
v4 ..." recording when a field changed.
