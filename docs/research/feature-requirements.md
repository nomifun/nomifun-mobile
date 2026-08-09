# Feature research: 需求平台 (AutoWork Requirements)

Source of truth: `/home/rika/src/nomifun-tauri` (desktop/Tauri). Guide read in full:
`/home/rika/src/nomifun-tauri/docs/guides/autowork-requirements.zh.md` (191 lines).

## 1. Concept (per the guide)

AutoWork = a **requirements board** + a per-target **execution loop** that drives an AI
agent (or an agent CLI running in a terminal) through requirements one at a time,
unattended. It is **backend-authoritative**: loops are resumed at process start and run
whether or not any UI is open. Mobile is therefore a *viewer/editor*, never the engine.

Core nouns:

- **Requirement** — one unit of work: title, content (the actual instruction), `tag`,
  `order_key` (string, compared lexicographically), status. Stored in SQLite.
- **Tag** — arbitrary string that groups requirements into a queue. Bindings, board
  columns and webhook routing are all keyed by tag. Tags are created on first use.
- **Status / lifecycle** — `pending` → `in_progress` → `done` | `failed` | `cancelled`.
  Board view = one column per status.
- **Claim & lease** — the loop atomically flips the lowest-`order_key` `pending` row of a
  tag to `in_progress` and writes a lease with an expiry.
- **Lease sweeper** — background task (every 60s) resets `in_progress` rows back to
  `pending` when the lease expired and the holding session is gone (crash safety).
- **AutoWork loop** — per target: claim → inject → wait → finalize → repeat. Long-lived:
  it idles on an empty queue instead of exiting (wake Notify + 10s fallback poll).

Who executes it — **Target** = `(target_kind, target_id, tag, max_requirements?)`:

- **agent/session target**: a conversation. The loop injects a hidden prompt naming the
  requirement. Nomi-engine sessions get `requirement_complete` /
  `requirement_update_status` tools; every other engine (ACP/Codex/Gemini/Openclaw/
  Nanobot/Remote) uses the **tool-less protocol** — finish the turn cleanly ⇒ auto `done`;
  failure is reported as plain text whose last line starts with `Requirement failed:`.
- **terminal target**: a PTY running `claude` or `codex` preset (plain shells and Gemini
  are rejected). Prompt is written wrapped in bracketed-paste markers + a separate `CR`.
  Completion = output **quiescence** (≥10s silent after a 3s minimum, PTY still alive).
  PTY death mid-turn → reset to pending. Hard per-turn timeout 1 hour.

Link to sessions/tasks:

- `requirements.conversation_id` is deliberately **not** a foreign key — a requirement
  rotates across sessions as it is re-pended; treat the column as informational only.
- Agent output of the turn is captured into a tail-biased **completion note** stored on
  the requirement (`MAX_NOTE_CHARS = 4000`); on tool-less engines that note *is* the
  downstream report.
- Terminal state persists in the session's `extra.autowork` / the terminal's `autowork`
  column, so `enabled` / `tag` / `max_requirements` survive restarts.
- **CompletionNotifier** fires on `done`/`failed`/`cancelled`: per-tag settings → bound
  Lark/飞书 webhook → interactive card (`需求id`, `需求名`, `需求内容` trunc 500,
  `完成状态`, `完成记录(报告)` trunc 500). Failures are logged and swallowed.
- **IDMM** (`nomifun-idmm`) is an orthogonal per-session supervisor that keeps a stalled
  turn alive; toggled in the same place (session header). Not needed for a mobile port.

## 2. Routes + main components

Routes are declared in `/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Router.tsx`
(lines 234–247). The current shell is **one nested route with query-param state**, not
separate list/kanban/detail routes — the guide's `/requirements/:id/edit` etc. are legacy
redirects only.

| Route | Element |
| --- | --- |
| `/requirements` (layout) | `RequirementsLayout` — persistent left rail |
| `/requirements` (index) | `WorkspacePage` — list + board + drawer |
| `/requirements/extensions` | `ExtensionsPage` — `?tab=autowork` / `?tab=notify` |
| `/requirements/sources` | `SourcesPage` |
| `/requirements/kanban` → `?view=board`, `/requirements/new` → `?new=1`, `/requirements/:id/edit` → `?req=<id>&edit=1`, `/requirements/tag-sessions` & `/autowork` → `extensions?tab=autowork`, `/other` → `extensions?tab=notify` | `<Navigate replace>` |

Workspace query params (`WorkspacePage/index.tsx` lines 50–210): `?view=board|list`
(default list), `?new=1` = create drawer, `?req=<id>` = view drawer, `?req=<id>&edit=1` =
edit drawer.

All paths below are under `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/requirements/`:

- `RequirementsLayout/index.tsx` (159) — shell: rail + `<Outlet/>`; `RequirementsLayout/sections.tsx` (54) defines the 3 rail sections (workspace / extensions / sources).
- `WorkspacePage/index.tsx` (361) — orchestrator: view toggle, filters, selection, pagination, drawer URL state.
- `WorkspacePage/RequirementListView.tsx` (144) + `RequirementListRow.tsx` (203) — flat table with checkbox multi-select and batch delete.
- `WorkspacePage/RequirementBoardView.tsx` (175) + `RequirementBoardCard.tsx` (112) — one column per status for the selected tag; drag-to-change-status is deliberately absent.
- `WorkspacePage/RequirementFilters.tsx` (343) — tag / status / full-text `q` / sort toolbar; `requirementFilterToolbarState.ts` holds its derived state.
- `WorkspacePage/useWorkspaceTags.ts` (48), `WorkspaceEmptyState.tsx` (53).
- `RequirementDrawer/index.tsx` (290) — the detail drawer; hosts view / edit / create in one surface.
- `RequirementDrawer/RequirementForm.tsx` (245) — the create/edit form; `AttachmentsField.tsx` (210) for image attachments.
- `components/StatusPill.tsx` (122) — status chip; `components/RequirementDisplayNumber.tsx` (79) renders `#N`.
- `useRequirements.ts` (95) — `useRequirements(params)` + `useRequirementTags()`; both are list-invalidate-on-any-event hooks (see §4).
- `ExtensionsPage/index.tsx` (75) + `AutoWorkPanel.tsx` (260) — tag bindings / run state admin; `ExtensionsPage/NotifyPanel/*` — webhook CRUD + per-tag routing.

## 3. HTTP endpoints

Rust router: `/home/rika/src/nomifun-tauri/crates/backend/nomifun-requirement/src/routes.rs`
lines 18–41 (mounted in `crates/backend/nomifun-app/src/router/routes.rs:821-823` behind
`protect_instance_owner`, i.e. authenticated). Request/response types:
`crates/backend/nomifun-api-types/src/requirement.rs`. TS client:
`ui/src/common/adapter/ipcBridge.ts` lines 3854–3919 (`export const requirements`).
All responses are wrapped in `ApiResponse<T>` =
`{ success: bool, data?: T, message?: string }`
(`crates/backend/nomifun-api-types/src/response.rs:9-15`).

| Method + path | Purpose / key fields |
| --- | --- |
| `GET /api/requirements` | List. Query: `tag`, `status`, `conversation_id`, `q`, `order_by` (`display_no\|requirement_id\|created_at\|updated_at\|status`), `order` (`asc\|desc`, default `desc`), `page` (default 1), `page_size` (default 20, clamped 1–200). Returns `PaginatedResult<Requirement>` (`items`, `total`). Rows omit `attachments`. |
| `POST /api/requirements` | Create → **201**. Body `CreateRequirementRequest`: `title` (required, non-blank), `tag` (required, non-blank), `content` (default `""`), `order_key` (default `""`), `status` (default `pending`), `created_by` (default `"user"`), `attachments: [{ source_path, file_name }]`. `deny_unknown_fields`. |
| `GET /api/requirements/{requirement_id}` | Single row **with** `attachments`. |
| `PUT /api/requirements/{requirement_id}` | Update. All optional: `title`, `content`, `tag`, `order_key`, `status`, `completion_note`, `add_attachments`, `remove_attachment_ids`. |
| `DELETE /api/requirements/{requirement_id}` | Delete one. |
| `POST /api/requirements/batch-delete` | `{ requirement_ids: [...] }` → `{ deleted: N }`. Used by the list page's multi-select. |
| `POST /api/requirements/{requirement_id}/status` | **State transition** (CAS-guarded). Body `UpdateStatusRequest`: `{ status, note? }`. |
| `POST /api/requirements/{requirement_id}/complete` | Mark done + attach report. Body `CompleteRequest`: `{ completion_note? }`. |
| `GET /api/requirements/tags` | `TagSummary[]`: `tag`, per-status counts (`pending`/`in_progress`/`done`/`failed`/`cancelled`/`needs_review`), `total`, `paused`, `paused_reason?`. |
| `POST /api/requirements/tags/{tag}/resume` | Un-pause a tag. `{ requeue_failed?, requeue_requirement_ids? }` → `TagSummary`. |
| `GET /api/requirements/board?tag=…` | `BoardResponse`: `tag` + one array per status (six arrays). |
| `GET /api/requirements/tag-bindings` | `TagBindings[]` — per tag, the bound conversations/terminals + live run state. |
| `POST /api/requirements/autowork` | Toggle a loop: `{ kind: 'conversation'\|'terminal', target_id, enabled, tag?, max_requirements?, from_admin? }` → `AutoWorkState`. |
| `GET /api/requirements/autowork/{kind}/{target_id}` | `AutoWorkState`: `enabled`, `tag?`, `running`, `run_state` (`off\|idle\|active`), `current_requirement_id?`, `completed_count`. |
| `POST /api/fs/upload` | Prerequisite for attachments — returns the `source_path` you pass in `attachments` / `add_attachments`. |
| Webhooks (separate crate `nomifun-webhook`, mounted at `routes.rs:875-876`) | `GET\|POST /api/webhooks`, `…/{id}` (`PUT`/`DELETE`), `POST …/{id}/test`; per-tag routing `GET\|PUT /api/tags/{tag}/settings`. |

**No comment / progress / log sub-resources exist.** There is no `/api/requirements/:id/
comments`, no progress endpoint, and no per-requirement log route. Progress is expressed
only by `status` + `attempt_count`; the "report" is the single `completion_note` string.

Doc drift to note for the port: the guide lists `POST …/:id/claim`, but **there is no
`/claim` HTTP route** — claiming happens in-process inside the AutoWork loop
(`RequirementService::claim_next()`). The guide also omits the `needs_review` status,
`batch-delete`, and `tags/{tag}/resume`, all of which exist in code.

## 4. WS topics

Emitted from `/home/rika/src/nomifun-tauri/crates/backend/nomifun-requirement/src/events.rs`
(lines 28–77); subscribed in `ipcBridge.ts` lines 3897–3907 via `wsMappedEmitter`.

| Topic | Payload | ipcBridge handle |
| --- | --- | --- |
| `requirement.created` | full `Requirement` | `requirements.onCreated` |
| `requirement.updated` | full `Requirement` | `requirements.onUpdated` |
| `requirement.statusChanged` | full `Requirement` | `requirements.onStatusChanged` |
| `requirement.deleted` | `{ requirement_id }` | `requirements.onDeleted` |
| `autowork.statusChanged` | `AutoWorkState` (kind, target_id, enabled, tag, running, run_state, current_requirement_id, completed_count) | `requirements.onAutoWork` |
| `autowork.tagPaused` | `{ tag, reason, requirement_id? }` | `requirements.onTagPaused` |

Consumption pattern worth copying (`useRequirements.ts:44-54`): **every** event just calls
`refresh()` — the WS stream is treated as an invalidation signal, not a patch stream,
because WS delivery has no replay. It also refreshes on `conversation.reconnected` to close
reconnect gaps. Requirement events carry the full row, so a mobile client *could* patch in
place, but the resync-on-reconnect refetch is mandatory either way.

## 5. Requirement TS type

`/home/rika/src/nomifun-tauri/ui/src/common/adapter/ipcBridge.ts` lines 3632–3694
(mirrors `crates/backend/nomifun-api-types/src/requirement.rs`). Ids cross the wire as
opaque strings (bare UUIDv7) and are branded on the client by `fromApiRequirement`
(`ipcBridge.ts:3821`); SQLite row ids never cross the boundary.

```ts
type RequirementStatus = 'pending' | 'in_progress' | 'done' | 'failed' | 'cancelled' | 'needs_review';

interface IRequirement {
  requirement_id: RequirementId;   // bare UUIDv7, stable identity
  display_no: number;              // immutable human id, rendered as `#N`
  title: string;
  content: string;                 // the instruction given to the agent/CLI
  tag: string;
  order_key: string;               // lexicographic queue order ('1.0', '1.2.1', …)
  status: RequirementStatus;
  completion_note?: string;        // tail-biased agent report (MAX_NOTE_CHARS = 4000)
  owner_conversation_id?: ConversationId; // linked session (informational, no FK)
  owner_terminal_id?: TerminalId;         // or the linked terminal
  started_at?: number;             // epoch ms
  completed_at?: number;           // epoch ms
  attempt_count: number;           // retries so far — the only "progress" signal
  created_by: string;              // 'user' | 'agent'
  created_at: number;
  updated_at: number;
  attachments?: IAttachment[];     // get/create/update only; list & board omit these
}
```

Mobile list row needs: `display_no`, `title`, `tag`, `status`, `updated_at`, plus
`attempt_count` (retry badge). Mobile detail additionally needs: `content`,
`completion_note`, `order_key`, `owner_conversation_id` / `owner_terminal_id` (deep link
into the session), `started_at` / `completed_at`, `created_by`, `attachments`.
`IAttachment` = `{ id, file_name, mime, size_bytes, created_at, abs_path }` — `abs_path` is
resolved server-side for base64 image display, which will need an HTTP fetch on mobile.

## 6. Creation flow

Validation lives in `RequirementService::create`
(`/home/rika/src/nomifun-tauri/crates/backend/nomifun-requirement/src/service.rs:250-290`).

Minimal valid payload:

```json
POST /api/requirements
{ "title": "Fix login redirect", "tag": "web" }
```

- `title` and `tag` must be non-blank after trim (else 400 `title must not be empty` /
  `tag must not be empty`). Unknown fields are rejected (`deny_unknown_fields`).
- Server defaults: `content = ""`, `order_key = ""` (→ `sort_seq` via `to_sort_seq`),
  `status = pending`, `created_by = "user"`, `display_no` assigned by the server.
- `status: "in_progress"` on create is **rejected** — `in_progress` is execution authority
  only. The UI form allows `pending` / `done` / `cancelled` / etc. and, in edit mode,
  disables the status field while the row is `in_progress`
  (`RequirementDrawer/RequirementForm.tsx:87,155-158` — it also omits `status` when
  unchanged so the backend's dedicated status CAS path stays authoritative).
- The tag is created implicitly on first use; no separate "create tag" call.
- Attachments require a prior `POST /api/fs/upload`, then pass
  `attachments: [{ source_path, file_name }]`.
- Response is 201 with the full `Requirement` (including `attachments`). A
  `requirement.created` WS event is broadcast, and if a session/terminal is bound to that
  tag its AutoWork loop is woken immediately.

## Minimal mobile scope

1. One list screen: `GET /api/requirements` (tag/status/`q` filters, page_size 20) +
   `GET /api/requirements/tags` for the tag chips and per-status counts.
2. Optional board view: `GET /api/requirements/board?tag=…` — six status columns, read-only
   (no drag-to-transition, same as desktop).
3. Detail screen: `GET /api/requirements/{id}`; show `content` + `completion_note`, and
   deep-link `owner_conversation_id` into the existing session screen.
4. Create/edit: `POST /api/requirements` needs only `{ title, tag }`; `PUT` for edits;
   status changes via `POST …/{id}/status` (never send `in_progress`).
5. Delete: `DELETE …/{id}`; multi-select can use `POST /api/requirements/batch-delete`.
6. Live: subscribe `requirement.created|updated|statusChanged|deleted` and
   `autowork.tagPaused`, treat each as invalidate-and-refetch, and always refetch on
   WS reconnect (no replay).
7. Skip for v1: AutoWork toggles/tag-bindings admin, webhook/notify config, sources page,
   attachments upload, IDMM.
8. Never reimplement the loop — the backend owns claiming, leases and completion.

