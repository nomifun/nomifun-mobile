# 桌面伙伴 (Companions) — feature research for the React Native port

Source of truth: `/home/rika/src/nomifun-tauri` @ `3bd9a566` (v0.5.1). Read-only
survey; nothing in the desktop repo was modified.

Primary guide read first: `/home/rika/src/nomifun-tauri/docs/guides/companions.zh.md`.
**That guide is partially stale** — see §9 "Doc vs. code drift" before trusting it
for UI structure. The API table at its bottom is accurate.

---

## 1. What the feature is

A **multi-companion family** ("多伙伴家庭"). The install owns a roster of
companions; each companion is an independent persona with:

- its own name / figure / persona prose
- its own chat model (+ fallback model, vision model, ASR/TTS/VAD voice stack)
- its own **memories** (strictly per-companion — no shared tier, no re-homing)
- its own **self-evolved skills**
- its own **learning loop** (interval + learning model + cursor into the shared event stream)
- its own **knowledge-base bindings** (`('companion', companionId)`)
- its own **quiet hours**
- its own **single canonical chat conversation** (one per companion, for life)
- its own **IM channel bots / ESP32 robots / remote access token**
- its own **desktop floating window** (`companion-{companionId}`, Tauri-only)

What is **install-level** (one per device, shared by all companions):
event *collection* config + retention, session archiving, `default_companion_id`,
`smart_collaboration`, `bridge_to_memory_dir`, the custom-figure **library**, and
the pattern statistics behind skill generation.

Two separate UI surfaces exist in the desktop app, and they must not be conflated:

| Surface | Route / file | Nature |
|---|---|---|
| **Management workspace** | `/nomi` → `ui/src/renderer/pages/nomi/index.tsx` | Normal in-app page. Sidebar entry 桌面伙伴. Already has a responsive mobile branch. |
| **Floating desktop pet window** | `#/companion?companion_id=…` → `ui/src/renderer/pages/companion/index.tsx` | Transparent always-on-top Tauri window, one per enabled companion. 1923 lines of window geometry / click-through / native menu. **Desktop-only, not portable.** |

Chat itself lives in **neither**: it is a standard `/conversation/:id` route
(conversation `type === 'nomi'` with `extra.companion_session`), rendered by
`CompanionChatPanel`. The management page's 打开聊天 button navigates there.

---

## 2. File map (desktop repo, absolute paths)

### 2.1 Management workspace — `/nomi`

```
/home/rika/src/nomifun-tauri/ui/src/renderer/pages/nomi/
  index.tsx                       # shell: 3 columns, URL state ?companion=&tab=&view=
  useNomi.ts                      # useCompanion(id) + useCompanions()  ← the two core hooks
  CompanionSidebar/index.tsx      # roster rail (drag reorder, delete, 新建伙伴, 形象库)
  CompanionSidebar/CreateCompanionModal.tsx
  CharacterPicker.tsx             # built-in characters + library figures + DIY entry
  CompanionModelControl.tsx       # model picker used in chat header
  FigureLibraryPage.tsx / FigureCardActions.tsx / FigureEditModal.tsx / useFigures.ts
  CustomFigureWizard/index.tsx    # DIY figure: pick → ML matte (Web Worker) → frame
  companion/CompanionChatPanel.tsx, companion/CompanionConversation.tsx
  workspace/
    types.ts                      # WORKSPACE_TABS + WorkspaceTabProps
    WorkspaceHeader.tsx           # avatar + name + Lv + 打开聊天 + SegmentedTabs
    AsideHost.tsx                 # third-column portal host for detail panes
    tabs/OverviewTab/             # AppearanceSection, FigurePanel, ModelsSection, PersonaSection
    tabs/MemoryTab/               # list/detail/compose/merge + KnowledgeControl
    tabs/RemoteTab/               # IM channels + ESP32 robots + access token
    tabs/EvolutionTab/            # learn, skill-gen, quiet hours, collect, retention, stop-all
    tabs/SkillsTab/               # catalog skills + self-evolved skills, draft approval
    tabs/HistoryTab/              # day index rail + day reader + digests + 去年今日
    tabs/OtherTab/                # migration (desktop-gated) + danger zone (delete)
```

### 2.2 Desktop pet window — `#/companion`

```
/home/rika/src/nomifun-tauri/ui/src/renderer/pages/companion/
  index.tsx (1923 lines)          # the whole floating window
  CompanionAvatar.tsx             # ★ THE single entry point every surface uses to draw a companion
  characters/index.ts             # roster: mochi, ink, bolt (+ 'custom')
  characters/Mochi.tsx Ink.tsx Bolt.tsx    # inline SVG + <style> CSS keyframes
  characters/CustomFigure.tsx     # user image <img> + CSS breathing + particle fx
  characters/customMeta.ts        # ★ figure URL builders + bust-crop math
  characters/types.ts             # CompanionMood / CompanionActivity / CharacterDeskSpec
  companion.css (531 lines)       # bubble, chat bar, hop/idle animations
  windowGeometry.ts, deskRestoreGeometry.ts, companionChromeLayout.*   # Tauri window math
  companionClickThrough.*, companionHitMask.ts, companionHitTarget.*   # alpha hit-testing
  companionNativeMenu.ts          # right-click native menu
  companionTurnDelivery.ts        # crash-safe turn idempotency (localStorage)
  browserNarration.ts, eventScope.ts, companionCapturePolicy.ts
```

### 2.3 Cross-cutting

```
ui/src/common/adapter/ipcBridge.ts           # `export const companion = {...}` at line ~5190; types ~4584-5030
ui/src/renderer/hooks/useCompanionWindowsSync.ts   # Tauri `sync_companion_windows` reconciler
ui/src/renderer/components/layout/Router.tsx:194-195, 248   # /companion and /nomi routes
ui/src/renderer/components/layout/Sider/SiderNav/SiderNomiEntry.tsx
ui/src/renderer/pages/conversation/SessionList/CompanionSessionGroup.tsx  # 「桌面伙伴」group in session list
ui/src/renderer/services/i18n/locales/{zh-CN,en-US}/nomi.json             # all copy
crates/backend/nomifun-companion/src/routes.rs                            # authoritative route table
```

---

## 3. Data model (wire shapes — snake_case, 1:1 with Rust JSON)

All defined in `ui/src/common/adapter/ipcBridge.ts`.

### 3.1 `ICompanionProfile` (`GET /api/companion/companions/{id}`)

```ts
{
  companion_id: string;      // branded CompanionId
  seq: number;               // registry display ordinal
  name: string;
  character: string;         // 'mochi' | 'ink' | 'bolt' | 'custom'
  persona: { preset: string; custom: string };
  model: { provider_id, model, use_model? } | null;
  fallback_model: ... | null;
  vision_model: ... | null;
  voice: {
    asr: ModelRef | null;
    tts: { provider_id, model, voice: string | null } | null;
    vad: { engine: string; sensitivity: number; min_silence_ms: number };
  };
  learn:  { enabled, interval_minutes /*5..1440*/, model: ModelRef | null };
  evolve: { enabled, interval_minutes, model, min_pattern_count, min_distinct_sessions,
            auto_activate /*= 保守/激进*/, auto_threshold, skill_half_life_days,
            skill_archive_threshold };
  skills: { enabled: string[]; disabled_auto: string[] };
  appearance: {
    companion_enabled: boolean;         // desktop pet window on/off
    companion_x?: number | null;        // window position (desktop-only)
    companion_y?: number | null;
    quiet_start: string;                // "HH:mm"
    quiet_end: string;
    custom_figure?: {                   // only when character === 'custom'
      aspect: number;
      head_box: { x, y, w, h? };        // image-fraction coords
      size_tier: 's'|'m'|'l';
      size_px?: number | null;
      figure_id?: string;               // library figure UUIDv7
    } | null;
  };
  applied_preset?: ResolvedPresetSnapshot;
  order_index?: number | null;          // user-chosen sidebar position
  created_at: number;
}
```

`GET /api/companion/companions` returns `ICompanionWithStatus[]` = profile + `status`.

### 3.2 `ICompanionStatus` (`…/{id}/status`)

```ts
{ companion_id, xp, level, mood, memories_active, memories_archived,
  model_configured, collect_any_enabled }
```

- **Level formula (client-side, `AppearanceSection.tsx:68-72`)**:
  `Lv = floor(sqrt(xp/100)) + 1`; level *L* spans `[(L-1)²·100, L²·100)`.
  Level names `nomi.levels.l1..l5` = 认识你 / 记得你 / 提醒你 / 懂你节奏 / 预判你 (clamped at 5).
- **XP sources**: learn run output; +2 per companion chat turn; +5 per memory saved in chat.
- **`mood`** ∈ `happy | content | sleepy | worried | excited`
  (i18n `nomi.moods.*` = 开心/平静/犯困/担心/兴奋). Set per-companion by the learner.

### 3.3 `ICompanionMemory`

```ts
{ memory_id, kind: 'profile'|'preference'|'knowledge'|'episode'|'task'|'affective',
  content, tags[], importance, strength, pinned, source,
  status: 'active'|'archived', created_at, updated_at, last_reinforced_at,
  companion_id /* owner, null only for un-re-homed legacy rows */,
  snippet?, rank? /* FTS query results only */ }
```
Wire contract explicitly **rejects** retired fields `scope_kind` /
`scope_companion_id` (the mapper throws `TypeError`) — don't reintroduce them.

### 3.4 `ICompanionSkill`

```ts
{ companion_skill_id, skill_name, companion_id, status: 'draft'|'active'|'archived',
  source, confidence, provenance_event_ids[], strength, version, skill_pattern_id,
  usage_count, last_used_at, created_at, updated_at, description }
```
Retired fields rejected: `provenance`, `superseded_by`, `scope_kind`, `scope_companion_id`.

### 3.5 `ICompanionSharedConfig` (`GET /api/companion/config`) — install-level

```ts
{ collect: { chat_user_messages, requirements, terminal_sessions, tool_calls,
             companion_dialogues, event_retention_days /*7..365*/,
             event_max_storage_mb /*16..512*/ },
  archive: { enabled, idle_minutes, min_chars, inject_recent_days },
  smart_collaboration: boolean,
  default_companion_id: string | null,
  bridge_to_memory_dir: string | null }
```

### 3.6 Others

`ICompanionThread { conversation_id, companion_id, title, created_at, updated_at }`,
`ICompanionHistoryDay { day: 'YYYYMMDD', message_count, has_digest }`,
`ICompanionDayDigest {…, digest: string|null, highlights: JSON string }`,
`ICompanionWeeklyDigest { since_ms, skills_learned, memories_added, new_skill_names[] }`,
`ICompanionEventStorageStatus`, `ICompanionSourceStats`, `IFigureMeta`,
`ICompanionLearnResult { status, events_processed, memories_added, error?, summary? }`.

---

## 4. Complete endpoint inventory

Verified against `crates/backend/nomifun-companion/src/routes.rs:29-108` and the
`companion` object in `ipcBridge.ts:5190-5590`.

### 4.1 Roster / profile

| Method + path | Body / query | Notes |
|---|---|---|
| `GET /api/companion/companions` | — | roster with `status` |
| `POST /api/companion/companions` | `{name, character}` | **only** these two fields; figure linked by follow-up PATCH |
| `GET /api/companion/companions/{id}` | — | profile + status |
| `PATCH /api/companion/companions/{id}` | RFC 7396 merge patch of `ICompanionProfilePatch` | nested objects merge; `null` clears |
| `DELETE /api/companion/companions/{id}` | — | cascades memories/skills/session/XP/KB bindings |
| `GET /api/companion/companions/{id}/status` | — | xp/level/mood/counters |
| `POST /api/companion/companions/{id}/apply-preset` | `{preset_id, locale?, overrides}` | |
| `GET/PATCH /api/companion/config` | `ICompanionSharedConfigPatch` | install-level |

Reordering the roster = `PATCH` each companion with `{order_index: i}`
(`pages/nomi/index.tsx:203-222` fires them in parallel then refreshes).

### 4.2 Memory (every mutation MUST carry `companion_id` — server 404s foreign rows)

| Method + path | Params |
|---|---|
| `GET /api/companion/memories` | `?kind&q&status&companion_id&sort=relevance\|time\|importance&limit&offset` |
| `POST /api/companion/memories` | `{kind, content, tags?, companion_id?}` (`companion_id` = **owner**) |
| `PUT /api/companion/memories/{memory_id}` | `{companion_id, content?, pinned?, status?}` (`companion_id` = **actor**, not new owner) |
| `DELETE /api/companion/memories/{memory_id}?companion_id=…` | |
| `POST /api/companion/memories/batch` | `{ids[], action: archive\|restore\|delete\|reclassify, kind?, companion_id}` — one transaction |
| `POST /api/companion/memories/merge-suggestions` | `{companion_id}` → duplicate clusters |
| `POST /api/companion/memories/merge` | `{group[], merged_content, kind, companion_id}` |

Pagination in `MemoryTab/useMemoryList.ts`: `limit=pageSize, offset=(page-1)*pageSize`.

### 4.3 Skills

| Method + path | Params |
|---|---|
| `GET /api/companion/companions/{id}/skills` | `?status&limit&offset` |
| `GET /api/companion/companions/{id}/skills/{skillId}` | → `{skill, content}` (SKILL.md body); 404 silenced |
| `PUT /api/companion/companions/{id}/skills/{skillId}` | `{content}` |
| `POST /api/companion/companions/{id}/skills/{skillId}/decide` | `{accept, reason?}` — draft approval |
| `POST /api/companion/companions/{id}/skills/from-session` | `{conversation_id}` → skill name (learn-by-demonstration) |

### 4.4 Learning / evolution / events

| Method + path | Notes |
|---|---|
| `POST /api/companion/companions/{id}/learn/run` | run this companion's pass now (per-companion lock) → `ICompanionLearnResult` |
| `GET /api/companion/events/stats` | per-source today/total counts |
| `GET /api/companion/events/storage` | bytes / file count / day range / retention |
| `POST /api/companion/consent` | first-launch: apply self-evolution defaults once |
| `POST /api/companion/disable-all` | master kill switch (all collection + learning, whole roster) |
| `GET /api/companion/companions/{id}/weekly-digest` | `?days=` |

Learn/evolve settings themselves are **profile fields** — edited via
`PATCH …/companions/{id}` with `{learn:{…}}` / `{evolve:{…}}`, not a separate route.

### 4.5 Chat / history

| Method + path | Notes |
|---|---|
| `GET /api/companion/companions/{id}/companion/active` | `{conversation_id: string \| null}` — pure read, never mints |
| `POST /api/companion/companions/{id}/companion/threads` | idempotent **ensure** → `ICompanionThread`. 400 if no model configured |
| `GET /api/companion/companions/{id}/history/days` | `[{day, message_count, has_digest}]`, newest first, read-only |
| `GET /api/companion/companions/{id}/digests` | `?since&until&on_day&limit` — archived day digests |
| `GET /api/conversations/{cid}/messages?day=YYYYMMDD` | one day of transcript, oldest first |

Then the standard conversation surface (shared with the rest of the app):
`POST /api/conversations/{cid}/messages` (**requires idempotency key**),
`POST …/cancel`, `POST …/clear-context`, `POST …/clear-messages`,
`PUT/DELETE …/summon` (`{companion_id, memory_ids[], skill_exclusions[]}` — loads a
companion's skills + selected memories into a *work* session; 409 when busy).

### 4.6 Figures (avatar images)

| Method + path | Auth | Notes |
|---|---|---|
| `GET /api/companion/figures` | yes | library list (`IFigureMeta[]`) |
| `POST /api/companion/figures` | yes | `{source_path, name, aspect, head_box, size_tier}` — after a two-phase `/api/fs/upload` |
| `PATCH/DELETE /api/companion/figures/{figureId}` | yes | rename / reframe / retier / delete |
| **`GET /api/companion/figures/{figureId}/image`** | **NO — auth-exempt** | `companion_public_routes`, routes.rs:104-110. Capability URL. |
| `GET/POST /api/companion/companions/{id}/figure` | yes | legacy per-companion figure image / ingest |
| `GET /api/companion/matting-model` | yes | ONNX matting model for the DIY wizard |

URL builders live in `pages/companion/characters/customMeta.ts`:
`customFigureUrlOf(baseUrl, companionId, meta)` and
`figureImageUrlOf(baseUrl, figureId, version)`; both append a `?v=` derived from
the metadata to bust image caches after a re-frame.

**Mobile-relevant**: library-backed figures (`figure_id` present) render from a
plain unauthenticated URL — perfect for RN `<Image>`. Legacy per-companion
figures need auth headers.

### 4.7 Migration (import/export)

| Method + path | Body |
|---|---|
| `POST /api/companion/export/memory` | `{dest_path, include_events}` |
| `POST /api/companion/export/companions/{id}` | `{dest_path, knowledge_names[], include_memories=true, include_skills=false}` |
| `POST /api/companion/import` | `{src_path}` — dispatches on `manifest.kind` |

`dest_path` / `src_path` are **paths on the backend host's filesystem**, chosen
via a native dialog. `OtherTab/MigrationSection.tsx:106` already renders a
「仅桌面版可用」 placeholder when `!isTauriRuntime()`. **Skip on mobile.**

### 4.8 Adjacent surfaces the tabs consume

| Purpose | Endpoint |
|---|---|
| Knowledge bindings | `GET/POST /api/knowledge/binding/companion/{companionId}` — body `IKnowledgeBinding {enabled, writeback_eagerness: 'manual'\|'auto', channel_write_enabled, kb_ids[]}`; POST is a **full replace** |
| Knowledge base list | `GET /api/knowledge/bases` |
| Channel→companion binding | `POST /api/channel/settings/companion` `{platform, companion_id?}` |
| ESP32 robots | `GET /api/robots`, `POST /api/robots/claim {code, companion_id}`, `PATCH /api/robots/{id} {name?, companion_id?}`, `DELETE /api/robots/{id}`, `GET /api/robots/statuses`, `GET /api/robots/endpoints` |
| Per-companion remote access token | `GET/POST/DELETE /api/webui/companions/{companionId}/access-token` |

### 4.9 WebSocket events (`ws://host/ws`, single multiplexed socket)

Transport: `ui/src/common/adapter/httpBridge.ts:951-1010`. Desktop passes the
local-trust secret as a **WS subprotocol**; browser/WebUI mode authenticates via
session cookie. **No replay** — every reconnect is a delivery gap, so the client
must resnapshot (`ws.reconnected` synthetic local event exists for this).

| Event | Payload |
|---|---|
| `companion.created` | `{companion_id, profile}` |
| `companion.deleted` | `{companion_id}` |
| `companion.config-updated` | `{scope: 'shared' \| companionId, companion_id?, …payload}` |
| `companion.mood-changed` | `{mood, companion_id?}` |
| `companion.learn-started` | `{companion_id?}` |
| `companion.learn-finished` | `ICompanionLearnResult & {companion_id?}` |
| `companion.memory-created` / `-updated` | `ICompanionMemory` |
| `companion.memory-deleted` | `{memory_id}` |
| `companion.skill-drafted` / `-learned` / `-archived` | `{companion_id, companion_skill_id, skill_name}` |

`useNomi.ts` subscription pattern worth copying verbatim:
- `useCompanions()` — `companion.created` → incremental `refreshOne`;
  `deleted` → local filter; `config-updated` → `refreshOne(scope)`;
  `learn-finished` → full refresh (XP badges).
- `useCompanion(id)` — per-companion scope only; a `seqRef` out-of-order guard;
  data bundled **with** its `companion_id` so a switch reads `null`
  *synchronously* during render (comment at `useNomi.ts:43-51` documents two real
  bugs this fixed — copy the pattern, don't reinvent it).

---

## 5. Live / animated aspects

### 5.1 No Live2D, no sprite sheets, no WebGL

Every built-in character is a **hand-written inline `<svg>` with a `<style>` block
of CSS `@keyframes`** — `characters/Mochi.tsx` (246 lines), `Ink.tsx` (287),
`Bolt.tsx` (242). Zero external assets. `CustomFigure.tsx` renders a user PNG/WebP
as a plain `<img>` plus CSS breathing and particle effects; its header comment
states the WebGL/mesh approach was **deliberately abandoned** (per-frame
intermediate frames made the figure flicker while dragging).

Animation state is exactly two enums (`characters/types.ts`):

```ts
type CompanionMood    = 'happy' | 'content' | 'sleepy' | 'worried' | 'excited';
type CompanionActivity = 'idle' | 'thinking';
```

Per-character CSS layers driven by them: ground-shadow pulse, whole-body
breathe/squash, ear sway, periodic blink, mouth "chew" while thinking, hop
(happy) / jump (excited) / doze (sleepy) body overrides, floating `z z` glyphs
(sleepy), sweat drop (worried), sparkle particles (excited), rising thought
bubbles (thinking).

`CompanionAvatar.tsx` is the **single entry point** used by every surface
(pet window, workspace header, appearance row, character picker, session list
group). Size is a prop; it is used at 34/40/44 px as an avatar and at
~150 px as a full figure.

### 5.2 What drives mood/activity

- `mood` ← `status.mood` on load, then live `companion.mood-changed`.
- `activity` ← `'thinking'` on `companion.learn-started`, back to `'idle'` on
  `companion.learn-finished` (`pages/companion/index.tsx:673-681`).

### 5.3 Desktop pet window behaviours (all Tauri-bound)

From `pages/companion/index.tsx`:
transparent always-on-top window per enabled companion (label
`companion-{companionId}`); drag via `getCurrentWindow().startDragging()` with
position persisted back into `appearance.companion_x/y` on `onMoved`;
multi-monitor restore math (`deskRestoreGeometry.ts`, `windowGeometry.ts`);
**alpha-mask click-through** so transparent pixels pass clicks to the desktop
(`companionHitMask.ts`, `useCompanionClickThrough.ts`,
`setIgnoreCursorEvents`); native right-click menu (`companionNativeMenu.ts`,
`@tauri-apps/api/menu`) with 打开聊天 / 隐藏 / 刷新; hover-revealed inline chat bar
(`companionBarReveal.ts`); a **forehead speech bubble** that streams the reply
live (`BUBBLE_MS = 12s`, `STREAM_STALL_MS = 45s` safety dismiss, sticky
auto-scroll, markdown rendering); inbound IM turns rendered in the bubble with a
platform-logo header (telegram/lark/dingtalk/weixin/wecom/slack/discord);
crash-safe turn idempotency in `localStorage` (`companionTurnDelivery.ts`);
window→main-window navigation via the Tauri `companion-navigate` event
(`Router.tsx:151-165`); theme sync across windows; per-window custom CSS
injection; `sync_companion_windows` Tauri command reconciles the window set from
the roster (`hooks/useCompanionWindowsSync.ts`).

Quiet hours are enforced client-side too: `inQuietHours(start, end)` (supports
overnight ranges) suppresses proactive bubbles.

### 5.4 Porting the figures to RN — assessment

The SVGs are static markup with CSS keyframes. `react-native-svg` renders the
markup, but **`@keyframes` do not exist in RN**. Three options:

1. **Static pose only** (recommended for v1): port each SVG to
   `react-native-svg`, key off mood for the discrete variants (eyes, mouth,
   brows, Z's, sparkles — these are already conditional JSX, not animation) and
   drop the continuous animations. Cheap, faithful enough at avatar sizes.
2. **Reanimated rig**: re-express breathe/hop/blink as a handful of
   `withRepeat(withTiming(...))` transforms on `<G>` groups. Roughly a day per
   character; only worth it for a large hero figure.
3. **Server-rendered image**: not available — there is no PNG endpoint for
   built-in characters, only for uploaded figures.

Note the mismatch: at 34–44 px (every management-surface use) the animation is
invisible anyway. Only a hero/full-figure view would justify option 2.

---

## 6. Mobile-appropriate vs. desktop-only

### 6.1 Ship on mobile (high value, no host coupling)

| Capability | Endpoints | Notes |
|---|---|---|
| **Roster list + switcher** | `GET /companions` + WS created/deleted/config-updated | The mobile branch in `pages/nomi/index.tsx:315-351` already replaces the sidebar with a `<Select>` — mirror that as a horizontal card strip or picker. |
| **Companion status view** | `GET …/status`, WS mood-changed / learn-finished | avatar + name + `Lv{n} · {levelName}` + XP progress bar + mood pill + `memories_active`. Level math is client-side (§3.2). |
| **Chat with companion** | `POST …/companion/threads` (ensure) → `/conversation/:id` | Reuses the mobile conversation screen entirely (task #5). Handle the "no model configured" 400 → route to settings instead of erroring (`index.tsx:224-234`). `GET …/companion/active` for a read-only pre-check. |
| **Basic settings** | `PATCH …/companions/{id}` | name, persona preset+custom, character (built-ins + existing library figures), quiet hours, `companion_enabled` toggle (label it 「桌面显示」 and say it affects the desktop app). |
| **Model config** | same PATCH + provider/model list from task #9 | main / fallback / vision / ASR / TTS. Reuse the model-management picker. |
| **Memory browse + edit** | `GET /memories` (+ `q`, `kind`, `status`, `sort`), `PUT`, `DELETE`, `POST` | This is the single best mobile surface: read-only-ish, list-shaped, genuinely useful on a phone ("what does it remember about me"). Add compose. |
| **Knowledge bindings** | `GET/POST /api/knowledge/binding/companion/{id}`, `GET /api/knowledge/bases` | Simple multi-select + writeback-eagerness toggle. Remember POST is a full replace. |
| **Chat history by day** | `GET …/history/days`, `GET /conversations/{cid}/messages?day=` | Natural mobile reading experience; the desktop rail becomes a day list → day reader. |
| **Create / delete companion** | `POST /companions {name, character}`, `DELETE` | Creation needs only name + character. Delete needs the full destructive confirmation copy (`nomi.other.deleteConfirmBody`). |

### 6.2 Second wave (works, but lower value / more UI)

| Capability | Why later |
|---|---|
| Evolution tab (learn interval / model / skill-gen preference / quiet hours / collect toggles / retention) | Many rows of settings; mostly set-once. Quiet hours alone is worth pulling into basic settings. |
| Skills tab (list, draft approve/reject, SKILL.md view) | Draft approval is a genuine "waiting on you" inbox — good push-notification target (task #11) via `companion.skill-drafted`. Editing SKILL.md markdown on a phone is not. |
| `POST …/learn/run` (run learning now) | One button, trivial to add; pair with `learn-started`/`learn-finished` events for a spinner. |
| Weekly digest | One read-only card, nice-to-have. |
| Remote tab — IM channel binding | Depends on the channels feature; binding a companion to a platform is one POST. |
| Remote tab — ESP32 robots | Depends on LAN reachability of the desktop; claim-by-code is mobile-friendly (camera/OCR) but niche. |
| Remote tab — access token | Security-sensitive secret display on a phone; defer and think first. |
| Custom-figure library browse / rename / delete | Reading is easy (`GET /figures` + public image URL). |

### 6.3 Desktop-only — do NOT port

| Thing | Why |
|---|---|
| **The floating pet window** (`pages/companion/**`, ~4000 lines) | Transparent always-on-top OS window, `startDragging`, `setIgnoreCursorEvents`, alpha hit masks, multi-monitor geometry, native menus, `sync_companion_windows`. No mobile analogue. Android overlay windows are a different product decision, not a port. |
| Window position (`appearance.companion_x/y`), desk size sliders, `size_tier`/`size_px` | Only meaningful for that window. |
| **Migration import/export** | `dest_path`/`src_path` are host filesystem paths chosen with a native dialog; already gated behind `isTauriRuntime()`. |
| **DIY custom-figure wizard** | Web Worker + ONNX matting model + `canvas.toBlob` + two-phase `/api/fs/upload`. If figure creation is ever wanted on mobile, do it server-side, not by porting this. |
| Right-click context menus, hover-reveal chat bar, forehead bubble | Pointer-hover interactions. |

### 6.4 Guard rails for a remote mobile client

- The phone reaches the desktop backend through the **WebUI LAN listener**
  (`docs/guides/webui-remote-access.zh.md`): default port **25808** (dev 25809,
  multi-instance 25810), `0.0.0.0`, password + QR login, session cookie, Host/Origin
  allowlist (IP/localhost only, anti-DNS-rebinding) and per-peer rate limiting.
  All `/api/companion/*` routes are behind that auth.
- Anything gated on `isTauriRuntime()` in the desktop UI is, by construction,
  unavailable to the mobile client too. Grep for it before porting a component.
- `POST /api/conversations/{cid}/messages` **requires** an idempotency key
  (`requireConversationIdempotencyKey` throws without one) — mobile must generate
  and persist one per turn, same as `companionTurnDelivery.ts` does.
- WS has no replay. Every reconnect ⇒ refetch the roster + open lists.

---

## 7. Recommended mobile scope (concrete)

**Route shape** — keep the desktop's URL-state idea so deep links survive:
`/companions` (roster) → `/companions/:id?tab=overview|memory|history|settings`.

**Phase 1 — 桌面伙伴 page (task #8)**

1. **Roster screen**: horizontal avatar strip (or list) from `GET /companions`;
   default badge from `config.default_companion_id`; empty state with 新建伙伴.
2. **Overview**: `CompanionAvatar` (static SVG port), name, `Lv/XP/mood`,
   `memories_active`, a prominent **打开聊天** button, and a
   「未配置模型」 warning when `!status.model_configured`.
3. **Chat**: ensure-session → push the existing conversation screen.
4. **记忆**: paginated searchable list (`q`, `kind`, `status`, `sort`), row →
   detail sheet (edit content / pin / archive / delete), FAB to compose.
   Always send `companion_id`.
5. **设置**: name, persona (preset chips + custom textarea), character picker
   (3 built-ins + library figures), model pickers, quiet hours, 桌面显示 toggle,
   knowledge-base multi-select, delete-companion danger zone.
6. Four tabs max — `总览 / 记忆 / 历史 / 设置`. Do not port all seven.

**Phase 2**: 进化 settings, 技能 list + draft approval (+ push via
`companion.skill-drafted`, task #11), `learn/run` button, weekly digest,
channel binding.

**Never**: pet window, migration, DIY figure wizard.

---

## 8. Gotchas found in the code (worth copying, not rediscovering)

1. **`useCompanion` synchronous freshness gate** (`useNomi.ts:43-51,149-155`):
   profile/status are stored *with* their `companion_id`; a switch returns `null`
   in the same render. Without it, a fresh model-less companion briefly looked
   "model configured" and fired `ensureCompanionSession` → 400.
2. **Hooks above the early `loading` return** (`pages/nomi/index.tsx:266-277`):
   a hook declared after it corrupted the React root ("Rendered more hooks…").
3. **One atomic `setSearchParams`** after create (`index.tsx:143-160`): two
   sequential functional updates both read pre-navigation params, dropping the first.
4. **Attention dots are keyed by companion id** (`index.tsx:236-265`) so a stale
   dot can't follow the user to another companion.
5. **`patch.voice.vad` needs a two-level merge** (`useNomi.ts:30-38`) — a single
   spread reset `min_silence_ms` when only sensitivity changed.
6. **Optimistic patch + rollback on failure** (`useNomi.ts:118-147`); a `model`
   change also re-reads status because `model_configured` is backend-derived.
7. **Memory mutations always pass `companion_id`** — server 404s foreign rows.
8. **Batch memory ops are one transaction**: any bad/foreign id rolls back all.
9. `POST /api/knowledge/binding/...` is a **full replace** — forward every field
   (a hand-maintained whitelist silently dropped `writeback_eagerness` and
   `channel_write_enabled` in turn; see `ipcBridge.ts:6173-6180`).
10. Empty-name guard: an emptied name field commits nothing and snaps back on
    blur (`AppearanceSection.tsx:88-94`).
11. Roster ordering: `order_index` when set, otherwise creation time; `seq` is a
    registry ordinal, **not** a sort key.

---

## 9. Doc vs. code drift (`companions.zh.md` @ 3bd9a566)

Trust the code; the guide's API table is fine but its UI description is behind.

| Guide says | Code says |
|---|---|
| Tabs: 总览 / 记忆 / **聊天** / **模型&知识** / 远程连接 / 进化 / 设置 | `WORKSPACE_TABS = ['overview','memory','remote','evolution','skills','history','other']` — labels 总览 / **记忆&知识库** / **远程控制** / 进化 / **技能** / **聊天历史** / **其他** |
| A 聊天 Tab inside `/nomi` | Removed. Chat is `/conversation/:id`; `CompanionChatPanel`'s header comment documents the migration. 打开聊天 navigates out. |
| Separate 模型&知识 Tab | Models moved into **总览** (`ModelsSection`); knowledge bindings moved into **记忆&知识库**. |
| 设置 Tab (rename/figure/persona/delete) | Split: appearance/persona → 总览; delete → 其他 (danger zone). |
| 迁移 as an install-level Tab | Inside **其他**, per-companion export + import, desktop-gated. |
| Six characters: mochi / ink / **roux** / **pixel** / bolt / **boo** | Three implemented: `mochi`, `ink`, `bolt` (+ `custom`). `roux`/`pixel`/`boo` do not exist in `characters/index.ts`. |
| Sidebar is a top 伙伴切换条 (horizontal cards) | Left vertical sidebar with drag-reorder (`CompanionSidebar/index.tsx`); on mobile it collapses to a `<Select>`. |

Also worth knowing (correct in the guide, easy to miss): memory is
**strictly per-companion with no re-homing path** in UI or API; deleting a
companion permanently deletes its memories; the memory bundle import re-homes
*all* memories onto one owner (explicit default, else earliest-created).
