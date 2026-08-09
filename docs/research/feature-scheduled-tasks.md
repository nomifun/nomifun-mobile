# 定时任务 (Scheduled Tasks / Cron) — feature research for the React Native port

Source of truth: `/home/rika/src/nomifun-tauri` @ `3bd9a566` (v0.5.1). Read-only
survey; nothing in the desktop repo was modified.

Primary desktop sources:

- Guide: `/home/rika/src/nomifun-tauri/docs/guides/scheduled-tasks.zh.md`
  (English twin: `scheduled-tasks.md`)
- UI: `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/cron/**`
- Wire layer: `/home/rika/src/nomifun-tauri/ui/src/common/adapter/ipcBridge.ts:2558-2750`
- Backend routes: `/home/rika/src/nomifun-tauri/crates/backend/nomifun-cron/src/routes.rs`
- Backend DTOs: `/home/rika/src/nomifun-tauri/crates/backend/nomifun-api-types/src/cron.rs`
- Backend WS events: `/home/rika/src/nomifun-tauri/crates/backend/nomifun-cron/src/events.rs`

---

## 1. What the feature is

A **scheduled task** (`cron_job`) is one row that says: *at time T, drive this
agent with this prompt*. `nomifun-cron` is a backend scheduler + executor; the
UI is a thin CRUD + observation surface. There is no client-side timer anywhere
— the host process owns all scheduling. A mobile client that is asleep misses
nothing except the live WS events (which have **no replay**, see §5.3).

Three schedule shapes exist on the wire (`CronScheduleDto`, tagged union on
`kind`):

| kind | payload | notes |
|---|---|---|
| `cron` | `{ expr, tz?, description? }` | the only one the desktop UI ever creates |
| `every` | `{ every_ms, description? }` | fixed interval; UI renders `every_ms === 3600000` as "每小时" |
| `at` | `{ at_ms, description? }` | one-shot absolute timestamp |

Two execution modes (`execution_mode`, **immutable after creation**):

- `new_conversation` — every trigger spawns a fresh conversation, broadcasts a
  `cron_trigger` artifact into it, then sends the prompt.
- `existing` — every trigger sends the prompt as a new message into the same
  thread. Optional `agent_config.clear_context_each_run` resets agent context
  before each run (message rows are kept).

A **busy guard** skips a run when the previous one is still in flight
(recorded as `skipped`). A **missed-trigger handler** runs at startup and after
OS resume (`POST /api/cron/internal/system-resume`, internal-header only),
records a `missed` run, posts a tips message into the affected conversation, and
re-arms the timer.

Every run is recorded with status `ok` / `error` / `skipped` / `missed`.

---

## 2. Desktop UI surface (what exists to port)

### 2.1 Routes

`/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Router.tsx:232-233`

| route | component |
|---|---|
| `/scheduled` | `pages/cron/ScheduledTasksPage/index.tsx` (382 lines) |
| `/scheduled/:cron_job_id` | `pages/cron/ScheduledTasksPage/TaskDetailPage.tsx` (445 lines) |

Sidebar entry: `components/layout/Sider/SiderNav/SiderScheduledEntry.tsx`
(AlarmClock icon, label `cron.scheduledTasks`).

Deep-link into create dialog:
`/scheduled?create=conversation&conversation_id=<id>` — parsed by
`ScheduledTasksPage/scheduledConversationId.ts`, which requires
`create === 'conversation'` **and** a parseable conversation id, then strips
both params via `replace: true`. This is how the chat header pill
(`pages/cron/components/CronJobManager.tsx`) creates a task bound to the
current conversation.

### 2.2 List page (`/scheduled`)

Composition, in order:

1. Title + description + **New task** button.
2. **Keep-awake banner** — text `cron.page.awakeBanner` ("定时任务仅在电脑唤醒
   状态下运行") plus a `keepAwake` switch (`hooks/ui/useKeepAwake.ts`).
   Toggle = optimistic local config write → `application.applyKeepAwake` (OS
   effect, no-op off-desktop) → `PUT /api/settings/client {keepAwake}`; rollback
   on failure. **Not portable to mobile** — see §7.
3. Search box (`Input.Search`) + status pills `all | active | paused`.
   Filtering is pure client-side over the full list —
   `ScheduledTasksPage/cronJobSearch.ts` builds one lowercase haystack per job
   from: `cron_job_id`, short id, `name`, `description`,
   `schedule.description`, `schedule.expr`, `message`, `execution_mode`,
   `metadata.conversation_id` + short id, `conversation_title`, `agent_type`,
   `agent_config.{backend,provider_id,name,model,workspace}`.
   Status filter is `job.enabled === (filter === 'active')`.
4. Rows. Desktop is a 5-column CSS grid
   (`scheduledTaskLayout.ts`: `minmax(0,1.6fr) minmax(150px,1.1fr) minmax(84px,auto) minmax(120px,1fr) 44px`);
   under `md` it collapses to stacked cards — **the mobile layout already
   exists in this file and is the shape to copy**. Per row: name + short id,
   `CronStatusTag`, human schedule (mobile only), next-run, agent
   avatar + execution-mode label, an enable/disable `Switch` (mobile) and a
   `⋯` dropdown (desktop, `ScheduledTaskActions.tsx`).
5. Client-side pagination, `DEFAULT_PAGE_SIZE = 20`. `useEffect` clamps `page`
   to `pageCount` because live WS removals can shrink the result set under the
   user.

`isManualOnly = schedule.kind === 'cron' && !schedule.expr` — a manual-only task
hides the enable/disable toggle entirely (nothing to pause) and its action menu
degrades to `['remove']` (`getScheduledTaskMenuActions`).

`CronStatusTag.tsx` derives three states, in priority order:
`!enabled` → gray "已暂停"; `last_status ∈ {error, missed}` → red "执行出错";
else green "运行中".

### 2.3 Detail page (`/scheduled/:cron_job_id`)

Header: back link, title, edit (pencil), delete (Popconfirm with
`cron.confirmDeleteWithConversations` — "该任务下的所有会话也将被删除"),
**Run now** primary button, and a prominent green/red enable/pause toggle
(hidden when `isManualOnly`). Then `CronStatusTag` + next-run.

Two-column body (`minmax(0,1fr) 280px`, single column under `md`):

- Left: **执行历史** — `useCronJobRuns(cron_job_id)`, one row per run showing
  `executed_at_ms` (via `toLocaleString()`) and a colored status chip.
- Right sidebar: 执行指令 (`message`, mono, pre-wrap), 执行 Agent (logo + name
  via `jobAgentMeta.ts`), 重复执行 (`formatSchedule`), 执行模式 + explanation
  card + "创建后无法更改执行模式" hint + `clear_context_each_run` line, 模型,
  项目 (workspace), and `config_options` values joined by `, `.

**Doc/code drift worth knowing:** the guide claims the detail page *"还会列出
本任务创建的会话"* and lets you *"编写/编辑该技能"*. Neither exists in
`TaskDetailPage.tsx` at `3bd9a566`. `GET /api/cron/jobs/:id/conversations` is
wired in the bridge (`ipcBridge.ts:628` as `conversation.listByCronJob`) but has
**zero callers**; the skill endpoints are only used by
`pages/conversation/Messages/components/SkillSuggestCard.tsx` (accepting an
agent-proposed skill from a chat artifact). Do not port a conversations list or
a skill editor expecting to match desktop — there is nothing to match.

### 2.4 Create/edit dialog

`ScheduledTasksPage/CreateTaskDialog.tsx` (883 lines) — one component for both
create and edit (`editJob` prop switches modes). Fields in order:

1. **名称** (required), **描述** (optional).
2. **执行模式** — radio group over three *UI* values. Note the third is a
   frontend-only affordance (`cronConversationTarget.ts`):

   | UI value | backend `execution_mode` | `conversation_id` sent |
   |---|---|---|
   | `new_conversation` | `new_conversation` | omitted (starts unbound) |
   | `existing` | `existing` | omitted (backend materializes + binds on first run) |
   | `specified` | `existing` | the user-picked conversation id |

   `specified` is offered **only in create mode**. The radio group is disabled
   entirely when `isEditMode || lockInitialTarget`.
   - `existing` additionally shows the `clear_context_each_run` switch.
   - `specified` shows a searchable conversation picker that **hides any
     conversation already bound by another `existing`-mode job**
     (`boundConversationIds`; the edited job and the current value are
     excluded). Distinct empty texts for "暂无可用会话" vs "所有会话已被其它
     定时任务绑定", plus a re-check on submit.
   - In `specified` mode the agent + workspace fields are **hidden and must not
     be sent** — the comment at `CreateTaskDialog.tsx:494-498` is explicit that
     passing `agent_config` would let `agent_config.workspace` override the
     reused conversation's own working directory.
3. **执行 Agent** (required, except `specified`) — one `Select` with two
   OptGroups: detected CLI agents (`cli:<backend>`) and reusable presets
   (`preset:<preset_id>`). `cli:nomi` is disabled when no chat provider exists.
   A preset that has since been deleted renders as a disabled
   `已移除的设定（{{id}}）` option and blocks submit.
4. **模型** — shown only when the resolved backend is `nomi`/`gemini` or the
   detected ACP agent advertises `handshake.available_models`.
5. **项目 (workspace)** — folder picker; server rejects paths with whitespace
   segments.
6. **执行指令** (`prompt`, required, textarea). Guide is emphatic: write a
   self-contained instruction, the agent never sees your framing.
7. **频率** — `manual | hourly | daily | weekdays | weekly | custom`, plus a
   `TimePicker` (daily/weekdays/weekly) and a weekday `Select` (weekly), or the
   cron builder (custom).

`resolveAgentConfig` maps the selection to `{agent_type, agent_config}`:

- `nomi` → `agent_type: 'nomi'`, config `{provider_id, name, mode: fullAuto, model, workspace, clear_context_each_run}` — throws `cron.page.form.nomiModelRequired` unless provider+model are chosen.
- ACP agent → `agent_type: <backend>`, config `{backend, name, mode, model, config_options, workspace, clear_context_each_run}`.
- preset → `agent_type: <preferred agent's backend or 'nomi'>`, config `{[backend unless nomi], name, preset_id, workspace, clear_context_each_run}`.

Edit mode sends only `{name, description, schedule, message, agent_config}`.

### 2.5 Frequency → cron expression

The UI emits **6-field, seconds-first, Quartz-flavored** expressions:

| preset | expr |
|---|---|
| `manual` | `''` (empty — no schedule, Run-now only) |
| `hourly` | `0 0 * * * ?` |
| `daily` | `0 {m} {H} * * ?` |
| `weekdays` | `0 {m} {H} ? * MON-FRI` |
| `weekly` | `0 {m} {H} ? * {MON..SUN}` |
| `custom` | whatever the builder produced |

`cronUtils.ts:createCronSchedule` always stamps
`tz = Intl.DateTimeFormat().resolvedOptions().timeZone` (falling back to
`'UTC'`).

---

## 3. `croner` — what it is actually used for

`ui/package.json:40` → `"croner": "^9.1.0"`. Sole importer:
`ScheduledTasksPage/CronExpressionBuilder.tsx:10`.

It is **purely a UX aid** — the header comment says so: *"Validation and the
'next runs' preview are computed client-side with `croner` purely as a UX aid —
the authoritative schedule is validated server-side on save."* No scheduling,
no timers, nothing persisted from it.

Exported helpers (all pure, all trivially portable):

```ts
splitExpr(expr): string[]              // normalize to exactly 6 fields
isSubMinute(expr): boolean             // seconds field !== '0'
validateCronExpression(expr, tz?, count = 3): {
  valid: boolean; error?: string; nextRuns: Date[]; subMinute: boolean
}
```

`splitExpr` promotes a 5-field Unix expression by prepending `'0'` seconds, and
pads shorter input with `'*'` (`'0'` for the seconds slot).

Two dialect rules keep the client in lockstep with the Rust `cron` crate:

1. **Seconds are shown but default to `0`.** A non-zero seconds field is a
   sub-minute task; it is allowed but flagged with a warning
   (`cron.page.cronExpression.subMinuteWarning`, "对系统开销极大").
2. **Quartz extras `L` / `W` / `#` are rejected client-side** because the
   backend `cron` crate cannot parse them — *croner can*, hence the explicit
   guard `hasUnsupportedQuartzTokens`, which only checks `[LW]` in
   day-of-month (`WED` legitimately contains a `W`) and `#`/`L` in day-of-week.
   Error key `cron.page.cronExpression.unsupportedToken`.

`validateCronExpression` also returns `valid: false, error: 'no_upcoming_run'`
when croner yields zero future runs (e.g. `0 0 0 30 2 ?`).

The builder UI itself: one raw mono `Input` (the single source of truth), six
small per-field inputs derived from it, seven checkable preset tags
(`0 * * * * ?`, `0 */5 …`, `0 */30 …`, `0 0 * * * ?`, `0 0 9 * * ?`,
`0 0 9 ? * MON`, `0 0 9 1 * ?`), the sub-minute warning, and a 3-item
next-runs preview.

### 3.1 Mobile decision on `croner`

`croner` v9 is dependency-free, pure ES/CJS TypeScript with no Node builtins
and no DOM — it uses `Intl` for timezone math, which Hermes supports when the
app is built with `hermes-intl` / `jsc-intl` (Expo SDK 57 default RN 0.86 ships
Hermes **with** Intl). So it should run under RN as-is.

Recommendation: **take `croner` if and only if you ship the custom-cron
builder.** If mobile ships only the five presets (see §8), you need zero cron
parsing at all — you emit the fixed expression strings and never validate them.
A middle option is to port `splitExpr` + `formatCronExpr` (both pure string
work, no dependency) for *display* of expressions created on desktop, and skip
`nextRuns` preview entirely since the server already returns
`state.next_run_at_ms`.

### 3.2 Human-readable schedule labels

`cronUtils.ts:formatSchedule(job, t)` is what both list and detail render. It
tries `formatCronExpr` first and falls back to `schedule.description`:

- empty expr → 手动触发
- `* * * * *` (all wildcards) → 每分钟执行
- `0 * * * *` → 每小时执行
- day/month/dow all `*` with concrete h+m → `每天 {time} 执行`
- dow `MON-FRI` → `工作日 {time} 执行`
- dow a single weekday name → `每周{day} {time} 执行`
- non-zero seconds, or anything else → `null` → falls back to `schedule.description`

`?` is normalized to `*` before matching. `kind === 'every'` with
`every_ms === 3600000` is special-cased to 每小时执行; every other non-cron
schedule renders `schedule.description` verbatim.

---

## 4. HTTP API

All responses are the standard envelope `{ success: true, data: <T> }`; the
bridge unwraps `.data` (`httpBridge.ts:648`). All routes require the normal
auth extension (`CurrentUser`) and are owner-scoped server-side.

| method + path | body / query | returns | bridge symbol |
|---|---|---|---|
| `GET /api/cron/jobs` | — | `CronJobResponse[]` | `cron.listJobs` |
| `GET /api/cron/jobs?conversation_id=<id>` | — | `CronJobResponse[]` | `cron.listJobsByConversation` |
| `POST /api/cron/jobs` | `CreateCronJobRequest` | `CronJobResponse`, **201** | `cron.addJob` |
| `GET /api/cron/jobs/{id}` | — | `CronJobResponse` | `cron.getJob` |
| `PUT /api/cron/jobs/{id}` | `UpdateCronJobRequest` | `CronJobResponse` | `cron.updateJob` |
| `DELETE /api/cron/jobs/{id}` | — | `()` | `cron.removeJob` |
| `POST /api/cron/jobs/{id}/run` | — (+ **`Idempotency-Key` header, required**) | `{ conversation_id }` | `cron.runNow` |
| `GET /api/cron/jobs/{id}/runs` | — | `CronJobRunResponse[]` (≤7) | `cron.listRuns` |
| `GET /api/cron/jobs/{id}/conversations` | — | `ConversationResponse[]`, `ORDER BY updated_at DESC` | `conversation.listByCronJob` (unused) |
| `GET /api/cron/jobs/{id}/skill` | — | `{ has_skill: bool }` | `cron.hasSkill` |
| `POST /api/cron/jobs/{id}/skill` | `{ content }` | `()` | `cron.saveSkill` |
| `DELETE /api/cron/jobs/{id}/skill` | — | `()` | `cron.deleteSkill` |
| `POST /api/cron/internal/system-resume` | — (+ `x-nomifun-internal: 1`) | `()` | not exposed to UI |

Related settings (`ipcBridge.ts:2343-2364`):

- `GET/PUT /api/settings/client?key=keepAwake`
- `GET/PUT /api/settings/client?key=cronNotificationEnabled` — see §6.
- `GET/PUT /api/settings/client?key=notificationEnabled`

### 4.1 `run` idempotency (must-copy behavior)

`routes.rs:95-124` rejects the request unless exactly one `Idempotency-Key`
header is present, ASCII, and 1..=128 visible bytes; it becomes the operation id
`http:{key}`, so a replayed key returns the same reservation instead of firing a
second run.

The desktop client's discipline (`ScheduledTasksPage/cronRunNowDelivery.ts`) is
worth porting verbatim, because a mobile network is *worse* than a desktop one:

- Before the POST, persist `{cron_job_id, idempotency_key: uuidv7()}` under
  `nomifun:cron-run-now:v1:<cron_job_id>` in `sessionStorage`. **A pending
  record always wins** — a lost response, remount, or retry reuses the exact
  same key rather than minting a second durable reservation.
- An in-process `Set` (`claimCronRunNowDelivery`) prevents two mounted
  components from submitting the same intent concurrently.
- Only the exact key whose HTTP response was accepted is removed
  (`completeCronRunNowDelivery`); on error the in-flight claim is released but
  the persisted key is **kept**.
- The bridge additionally validates the key is a canonical UUIDv7
  (`requireConversationIdempotencyKey`).

On RN, `sessionStorage` does not exist — use an in-memory map plus
AsyncStorage/MMKV, and note the semantics differ: a persisted key surviving an
app *restart* is desirable here (desktop deliberately scoped it to the session).

### 4.2 Run-now post-success flow

`TaskDetailPage.tsx:112-167`: after `runNow` resolves with a `conversation_id`,
the desktop **polls `conversation.get` up to 15 s at 300 ms intervals**, waiting
(for `new_conversation` mode) until `extra.workspace` is a non-empty string —
because the freshly minted conversation has no workspace attached yet. Then it
seeds the SWR cache and navigates to `/conversation/<id>`. Errors go through
`getConversationRuntimeWorkspaceErrorMessage`.

### 4.3 Key DTO shapes

```ts
// response
ICronJob {
  cron_job_id: CronJobId            // canonical UUIDv7, no prefix
  name: string
  description?: string
  enabled: boolean
  schedule: ICronSchedule           // {kind:'at'|'every'|'cron', …}
  message: string                   // the prompt
  execution_mode: 'existing' | 'new_conversation'
  metadata: {
    conversation_id?: ConversationId   // absent until first materialization
    conversation_title?: string
    agent_type: string                 // 'nomi' | 'acp' | 'claude' | …
    created_by: 'user' | 'agent'
    created_at: number; updated_at: number
    agent_config?: ICronAgentConfig
  }
  state: {
    next_run_at_ms?: number
    last_run_at_ms?: number
    last_status?: 'ok'|'error'|'skipped'|'missed'
    last_error?: string
    run_count: number; retry_count: number; max_retries: number
  }
}

ICronJobRun { cron_job_run_id, cron_job_id, executed_at_ms, status }
```

`CreateCronJobRequest` requires `name`, `schedule`, `agent_type`, `created_by`
and accepts `description`, `prompt`, `message`, `conversation_id`,
`conversation_title`, `execution_mode`, `agent_config`. `UpdateCronJobRequest`
accepts **only** `name`, `description`, `enabled`, `schedule`, `message`,
`agent_config`, `conversation_title`, `max_retries`.

Both request DTOs are `#[serde(deny_unknown_fields)]`, as is
`CronAgentConfigDto`. **An extra key is a 400, not a warning.** The desktop
bridge hard-whitelists the update body for exactly this reason
(`ipcBridge.ts:2607-2619`, asserted by
`ipcBridge.cron-wire.test.ts` — "update serializes only fields accepted by the
strict backend DTO"). `execution_mode`, `metadata` and `state` must never
appear in a PUT.

Also enforced at the bridge: `fromApiCronJob` **throws** if a job with
`agent_type === 'nomi'` carries `agent_config.backend` (provider selection must
travel as `provider_id`). And IDs must be canonical UUIDv7 — `10` or
`cron_<uuid>` raise `InvalidEntityIdError`.

`GET /api/cron/jobs/{id}/runs` is capped server-side:
`CRON_RUN_HISTORY_LIMIT = 7` (`crates/backend/nomifun-db/src/repository/cron.rs:6`),
enforced on insert by `insert_run_pruned`. There is no pagination and no way to
get older runs.

---

## 5. WebSocket events

Envelope: `{ name, data }` (the client also tolerates `{ event, payload }`),
delivered per-user (`send_to_user`, so events are already owner-scoped).
Emitter: `crates/backend/nomifun-cron/src/events.rs`.

| event | payload | emitted when |
|---|---|---|
| `cron.job-created` | full `CronJobResponse` | create (UI or in-chat `[CRON_CREATE]`) |
| `cron.job-updated` | full `CronJobResponse` | any mutation **and after every run** (fresh `state`) |
| `cron.job-removed` | `{ cron_job_id }` | delete |
| `cron.job-executed` | `{ cron_job_id, status: 'ok'\|'error'\|'skipped'\|'missed', error? }` | terminal outcome of every run, incl. missed-trigger sweep |

Plus, not cron-namespaced but produced by the cron subsystem:

- `message.stream` with `type: 'tips'` — `emit_conversation_tips`, used for the
  missed-trigger notice (`cron.error.missedJob`: "⏰ 定时任务 … 在系统休眠期间
  未执行").
- A `cron_trigger` **conversation artifact** in each `new_conversation` run,
  payload `{ cron_job_id, cron_job_name, triggered_at }`; the desktop renders it
  as a tappable banner (`MessageCronTrigger.tsx`) that deep-links to
  `/scheduled/<id>`.
- Per-message `cronMeta = { source: 'cron', cron_job_id, cron_job_name, triggered_at }`
  and a stream-fragment field `origin` (`'cron' | 'companion' | 'autowork' | 'idmm'`,
  absent/null = typed by a human). `MessageCronBadge.tsx` renders cronMeta as a
  timestamp pill above the message.
- A `skill_suggest` artifact when the run's output looks like a clean candidate
  skill.

### 5.1 Ordering guarantee

`service.rs:951-952`, `2213-2214`, `2340-2341`: the executor emits
`cron.job-updated` (persisted, fresh `state`) **before** `cron.job-executed`.
So by the time a client sees `job-executed`, its cached job already has the new
`last_status` / `last_run_at_ms` / `next_run_at_ms`. That ordering is what makes
a notification handler able to read the job name out of local cache.

### 5.2 What `cron.job-executed` does *not* carry

No `conversation_id`, no job name, no run id, no timestamp. To build a useful
notification you must join against a locally cached job list (name) or refetch.
For `new_conversation` jobs, `metadata.conversation_id` is the **anchor**
conversation, not the one this run created — the only way to reach that run's
thread is `GET /api/cron/jobs/{id}/conversations` (ordered `updated_at DESC`,
so element 0 is the latest) or the `cron_trigger` artifact inside the thread.
Budget for this: a completion notification cannot deep-link to the exact
conversation from the WS payload alone.

### 5.3 No replay — resync is mandatory

`useCronJobs.ts:86-107` header comment: *"WebSocket delivery has no replay: any
gap (reconnect, server lag resync) may have dropped cron job events, so
`onResync` reloads the caller's durable snapshot after every reconnect."*

Every cron hook subscribes to `conversation.reconnected` and refetches. The
server can also push `sync.resync-required` when its event bus lags, which the
transport turns into the same reconnect-recovery path (`httpBridge.ts:1069+`).

**For mobile this is the single most important behavior to get right**, because
an app returning from background is a guaranteed gap. Refetch `GET /api/cron/jobs`
on: WS reconnect, `sync.resync-required`, and every foreground transition.

### 5.4 Local state reducers (desktop hooks, `useCronJobs.ts`)

- `useAllCronJobs()` — list page. created → append if absent; updated → replace
  by id; removed → filter. `activeCount`, `hasError` derived.
- `useCronJobs(conversation_id)` — per-conversation, used by the chat header
  pill.
- `useCronJobsMap()` — conversation → jobs index for the chat list, plus an
  **unread** dot: it keeps `lastRunAtMapRef: Map<CronJobId, number>` and, on
  `cron.job-updated`, treats a changed `state.last_run_at_ms` as "a new run
  happened"; if the user is not currently viewing that conversation it marks it
  unread. Unread ids are persisted to `localStorage` under a
  dataset-generation-scoped key (`browserStorageGenerationKey('cron-unread')`)
  so a backend DB reset does not resurrect stale dots. `getJobStatus` priority:
  `none` → `unread` → `error` → `paused` → `active`.
  **This changed-`last_run_at_ms` trick is the existing "a run just finished"
  detector and is the closest thing the codebase has to a completion signal.**
- `useCronJobRuns(cron_job_id)` — refetches `/runs` on `cron.job-executed` for
  that id, and on reconnect.

`repairCronJobTimeZone.ts` — every list/detail fetch passes jobs through a
repair that, for a `cron` schedule with a non-empty `expr` but blank `tz`,
issues a `PUT` stamping the client's current IANA zone (deduped by an in-flight
map). A mobile client doing the same would silently rewrite the user's task
timezone to the phone's zone; **do not port this** (see §7).

---

## 6. Completion notifications — the actual state of things

Mobile wants "task finished" notifications. The honest finding:

**The desktop app does not currently send any notification when a scheduled
task finishes.** There is a setting, an i18n block, and a notification bridge —
and no code connecting them.

Evidence:

1. `cronNotificationEnabled` exists end-to-end as *storage*: `ipcBridge.ts:2348-2351`,
   config key `system.cronNotificationEnabled` (`ui/src/common/config/configKeys.ts:66`),
   API DTO `cron_notification_enabled` (`nomifun-api-types/src/system.rs`),
   settings service, DB column. Its **only** reader is the settings UI toggle
   (`components/settings/SettingsModal/contents/SystemModalContent/index.tsx:50,75,113-117,326-330`).
   No runtime path consults it.
2. The i18n strings are dead: `cron.notification.taskComplete`,
   `cron.notification.scheduledTask`, `cron.notification.scheduledTaskComplete`
   ("{{title}}的定时任务完成"), `cron.notification.taskDone` exist in
   `locales/{zh-CN,en-US}/cron.json` with **zero call sites** outside the
   generated key list.
3. `ipcBridge.notification.show` (→ `tauriSendNotification`, plugin
   `tauri-plugin-notification`) has **no callers anywhere** in `ui/src`.
   `notification.clicked` is an explicit `noopEmitter` with a `DEGRADE_STUB`
   comment: click→navigate needs a Rust notification-action listener that does
   not exist yet.
4. Backend-side, `notification_enabled` / `cron_notification_enabled` are only
   read in settings CRUD and the gateway capability passthrough
   (`nomifun-gateway/src/caps_system.rs:43,46,179,180`). The cron crate contains
   no notification code at all (`grep -rn "notif" nomifun-cron/src/` → empty).

**Consequence for the port:** mobile notifications are **new work, not a port**.
Nothing to mirror, nothing to stay consistent with. The upside is a free hand;
the downside is no reference implementation and no backend push channel.

### 6.1 What mobile can build on

The only completion signal is the WS pair, in order:

1. `cron.job-updated` — fresh `state.last_status`, `state.last_run_at_ms`,
   `state.next_run_at_ms`, and the job `name`.
2. `cron.job-executed` — `{cron_job_id, status, error?}`.

Recommended handler:

```
on 'cron.job-executed' (or: on 'cron.job-updated' where state.last_run_at_ms changed):
  job   = cache.get(cron_job_id)   // job-updated already landed, so this is fresh
  title = job?.name ?? shortId(cron_job_id)
  body  = i18n(`cron.notification.status.${status}`)   // ok / error / skipped / missed
  if (status === 'error' && error) body += ` — ${error}`
  present local notification, tap → /scheduled/<cron_job_id>
```

Reuse the existing dead i18n keys (`cron.notification.*`) so desktop can adopt
the same strings later if it ever wires this up.

Deliberate design notes:

- **Deep-link to the task detail route, not a conversation.** §5.2: the payload
  has no conversation id, and for `new_conversation` jobs the anchor id is the
  wrong thread. `/scheduled/<id>` is always correct and always resolvable.
- **Filter by status.** `ok` is the interesting one; `skipped` is noise (busy
  guard) and will fire repeatedly on a job whose runs overlap. Suggest
  notifying on `ok` + `error` + `missed`, never `skipped`.
- **Dedupe.** Reconnect resync can replay nothing (there is no replay) but a
  double subscription will double-fire. Key notifications on
  `(cron_job_id, state.last_run_at_ms)` — exactly the `lastRunAtMapRef` trick
  from `useCronJobsMap`.
- **Foreground-only is the honest baseline.** A WS-driven notification only
  fires while the socket is alive, i.e. app foreground (or a
  platform-permitted background socket). Genuine background delivery needs
  FCM/APNs push from the backend, which **does not exist** — the cron crate has
  no push integration. Either scope mobile notifications to "in-app + local
  notification while connected", or treat backend push as a separate,
  much larger project. Do not promise background notifications on the current
  backend.
- Honor `cronNotificationEnabled` from `GET /api/settings/client?key=cronNotificationEnabled`
  so the desktop toggle actually governs something for the first time. Add a
  device-local override too, since the server setting is shared across clients.

---

## 7. Things that must NOT be ported

| desktop behavior | why not |
|---|---|
| **Keep-awake switch + banner** | `application.applyKeepAwake` drives host OS sleep inhibition (`SetThreadExecutionState` / `caffeinate` / `systemd-inhibit`). A phone cannot keep the *desktop host* awake. Replace with a read-only explanatory line: tasks only run while the NomiFun host is awake. If you want to surface the state, `GET /api/settings/client?key=keepAwake` is readable — but making it writable from a phone is a footgun (the mobile user cannot see whether the laptop lid is shut). |
| **`repairCronJobTimeZone`** | It rewrites a task's `tz` to *the client's* zone on every list fetch. From a phone in a different zone than the desktop, this silently reschedules the user's tasks. Read `schedule.tz` and display it; never repair. |
| **`POST /api/cron/internal/system-resume`** | Internal header-gated route for the host's own resume hook. Not a client concern. |
| **Skill editor / `cron/skills/<id>/SKILL.md`** | Filesystem-backed, and the desktop UI does not even expose editing (§2.3). `has_skill` is readable if you want a badge. |
| **`config_options` free-form editor** | Per-backend ACP knobs; desktop only *displays* the values joined by commas on the detail page. Display-only on mobile too. |
| **In-chat `[CRON_*]` command blocks** | Backend middleware (StreamRelay) executes them; the renderer only strips the tags for display (`localCronCommands.ts`, 70 lines, pure regex). Port the stripping as part of the chat feature, not this one. |

---

## 8. Recommended mobile scope

### Phase 1 — read + control (high value, low risk)

- `src/app/scheduled/index.tsx` — list. Copy the sub-`md` card layout already
  present in `ScheduledTasksPage/index.tsx`: name + short id, status tag,
  human schedule, next run, agent + execution mode, enable/disable switch.
  Port `cronJobSearch.ts` (pure, 62 lines) and the `all|active|paused` pills
  verbatim. Replace desktop pagination with `FlatList` + infinite scroll or
  just render all (`GET /api/cron/jobs` is unpaginated anyway).
- `src/app/scheduled/[cron_job_id].tsx` — detail. Run history (≤7 rows, from
  `/runs`), 执行指令, agent, 重复执行, 执行模式 + explanation, model, workspace.
  Actions: **Run now**, **Pause/Resume**, **Delete** (with the
  "会话也将被删除" confirmation), **Edit**.
- Enable/disable = `PUT {enabled}`. Hide the toggle when
  `schedule.kind === 'cron' && !schedule.expr` (manual-only).
- Run now = `POST /run` with the full idempotency-key discipline from §4.1.
  Skip the 15 s workspace poll unless you also ship a conversation screen to
  navigate into; a success toast + optimistic run-history refresh is enough.
- Port `formatSchedule` + `formatNextRun` + `CronStatusTag` logic (pure).
- WS: subscribe to all four `cron.*` events with the reducers from §5.4, and
  **refetch on reconnect, on `sync.resync-required`, and on app foreground**.

### Phase 2 — completion notifications (§6)

`expo-notifications` local notifications driven by the `cron.job-executed` /
`cron.job-updated` pair, deduped on `(cron_job_id, last_run_at_ms)`, filtered to
`ok|error|missed`, tapping into `/scheduled/<id>`, gated on
`cronNotificationEnabled` plus a local override. Document plainly that this
works while the app holds a live socket, and that true background push needs
backend FCM/APNs work that does not exist yet.

### Phase 3 — create / edit

Ship the **five presets only** (`manual`, `hourly`, `daily`, `weekdays`,
`weekly`) with a native time picker and weekday picker. Emit the same six-field
expressions as §2.5 and the same `tz` stamp. This needs **no cron parsing and
no `croner`**.

Fields: name, description, prompt, execution mode, agent, model, workspace.
Two hard constraints from §2.4: `execution_mode` is immutable after creation
(disable the control in edit mode), and `specified` mode must send **no
`agent_config`** at all. Edit-mode PUT sends only
`{name, description, schedule, message, agent_config}` — remember
`deny_unknown_fields`.

Consider deferring the agent/model/workspace pickers by only allowing mobile to
create `specified`-mode tasks bound to an existing conversation (which inherits
agent + workspace, so those fields vanish) — that is by far the smallest
correct create flow. Full agent selection depends on the model-management and
preset features landing first.

### Phase 4 — optional

- Custom cron expression: only here does `croner` earn its place (§3.1).
  A read-only "shows the raw expr + `state.next_run_at_ms`" fallback covers
  desktop-created custom tasks with zero dependency.
- Chat-side integration: `cron_trigger` artifact banner, `cronMeta` timestamp
  pill, the per-conversation cron pill + unread dot from `useCronJobsMap`.
  These belong to the conversation feature.

### Explicitly out of scope

Keep-awake control, timezone repair, skill editing, `config_options` editing,
`system-resume`, and any client-side scheduling.

---

## 9. i18n

`ui/src/renderer/services/i18n/locales/{zh-CN,en-US}/cron.json` is a complete,
translated string set for everything above — including the unused
`cron.notification.*` block and every `cron.page.scheduleDesc.*` /
`cron.page.freq.*` / `cron.detail.runStatus.*` key. Copy the namespace wholesale
into `src/i18n/` rather than re-authoring Chinese copy; the existing wording
(especially `confirmDeleteWithConversations`, `executionModeDescription*`, and
`page.awakeBanner`) is what users already know.
