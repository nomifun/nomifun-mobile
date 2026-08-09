# Feature research: 会话 (chat sessions / conversations)

Source: `nomifun-tauri` desktop app (`ui/` React renderer + Rust backend `crates/backend/nomifun-app`).
Goal: port the chat-session feature to React Native.

Status: complete (2026-08-09). Rust route table cross-checked against
`crates/backend/nomifun-conversation/src/routes.rs` L26-82 (core) and
`.../routes_aux.rs` L18-47 (`side-question`, `slash-commands`, `mode`, `model`,
`workspace`, `clear-context`, `clear-messages`) — every path below matches.

## 1. Routes + main components

Route table: `ui/src/renderer/components/layout/Router.tsx` (~L205-212). The session
section is a nested layout: all four routes below render inside one persistent shell,
so the session list (secondary sidebar) never unmounts when you switch chats.

```
<Route element={<SessionShellRoute />}>          // ConversationShell + secondary sidebar
  <Route path='/guid'              .../>          // "new chat" landing / launcher
  <Route path='/conversation/:id'  .../>          // chat detail  ← the mobile screen
  <Route path='/terminal-new'      .../>          // desktop-only
  <Route path='/terminal/:id'      .../>          // desktop-only
</Route>
```

| Path (absolute) | Role |
| --- | --- |
| `ui/src/renderer/components/layout/Router.tsx` | Route table; `/conversation/:id` is the chat detail route, wrapped by `SessionShellRoute`. |
| `ui/src/renderer/pages/conversation/index.tsx` | Chat detail page entry: reads `:id`, loads the conversation, picks the platform adapter, renders `ChatConversation`. |
| `ui/src/renderer/pages/conversation/components/ConversationShell/` | Persistent shell for the whole session section (hosts the list sidebar + outlet). |
| `ui/src/renderer/pages/conversation/SessionList/index.tsx` (769 L) | The session list itself: grouping, pin, rename, delete, search entry. **Mobile = the list screen.** |
| `ui/src/renderer/pages/conversation/SessionList/hooks/useConversationListSync.ts` (474 L) | Keeps the list live: initial fetch + `conversation.listChanged` WS invalidation. |
| `ui/src/renderer/pages/conversation/components/ChatConversation.tsx` (762 L) | Chat detail composition: message list + send box + per-platform controls. |
| `ui/src/renderer/pages/conversation/components/ChatLayout/index.tsx` | Layout frame (messages pane / workspace rail / preview pane split). Mobile keeps only the messages pane. |
| `ui/src/renderer/pages/conversation/Messages/MessageList.tsx` (1581 L) | Renders the transcript: turn grouping, disclosure, auto-scroll. |
| `ui/src/renderer/pages/conversation/Messages/hooks.ts` (1202 L) | The core streaming/merge reducer: history fetch + WS delta accumulation. |
| `ui/src/renderer/pages/conversation/platforms/nomi/NomiSendBox.tsx` (1075 L) | Composer for the default (`nomi`) platform. |
| `ui/src/renderer/pages/conversation/platforms/` | Per-agent-type adapters: `nomi`, `acp`, `nanobot`, `openclaw`, `remote`. Mobile should target `nomi` only. |

## 2. HTTP endpoints

All under the app's HTTP API (`/api/...`), declared in
`ui/src/common/adapter/ipcBridge.ts`. Rust side: `crates/backend/nomifun-app/src/router/routes.rs`.

### Session list / CRUD

| Op | Method + path | Key body / query |
| --- | --- | --- |
| List conversations | `GET /api/conversations?cursor=&limit=` | keyset `cursor`, `limit`; returns `{ items, total, has_more }` |
| Get one | `GET /api/conversations/:id` | 404 is silent (may not exist yet) |
| Create | `POST /api/conversations` | `type` (`'nomi' | 'acp' | ...`), `name`, `preset_id`, `preset_overrides`, `extra`, and **nomi-only** `model` (`{provider, model}`), `delegation_policy`, `execution_model_pool`, `decision_policy`, `execution_template_id`. ID is minted server-side — never send one. |
| Clone | `POST /api/conversations/clone` | `{ conversation: {...} }` minus `id` |
| Rename / update / pin | `PATCH /api/conversations/:id` | flat updates body: `name`, `pinned`, `model`, `extra`, plus `merge_extra?: boolean` |
| Delete | `DELETE /api/conversations/:id` | — |
| Active turn count (badge) | `GET /api/conversations/active-count` | `{ count }` |

### Messages

| Op | Method + path | Key body / query |
| --- | --- | --- |
| History | `GET /api/conversations/:id/messages` | `page`, `page_size` (default 50), `order`, `content_mode=compact\|full`, `cursor` (`''` = newest window, `'<created_at>:<message_id>'` = older page; presence of `cursor` disables offset paging), `day=YYYYMMDD` (one local day, mutually exclusive with `cursor`) |
| One message | `GET /api/conversations/:id/messages/:message_id` | — |
| Send | `POST /api/conversations/:id/messages` | `{ content, files?: string[], inject_skills? }` + **required `Idempotency-Key` header** |
| Steer (interject mid-turn) | `POST /api/conversations/:id/steer` | same body + idempotency key |
| Edit & resubmit | `POST /api/conversations/:id/messages/:msg_id/edit-resubmit` | `{ content, files? }` + idempotency key |
| Stop generation | `POST /api/conversations/:id/cancel` | no body |
| Clear runtime context | `POST /api/conversations/:id/clear-context` | keeps messages |
| Clear all messages | `POST /api/conversations/:id/clear-messages` | keeps the conversation row |
| Reset | `POST /api/conversations/:id/reset` | — |
| Warm up runtime | `POST /api/conversations/:id/warmup` | pre-attaches the agent |
| Global message search | `GET /api/messages/search?keyword=&page=&page_size=` | — |

### Model / agent switching for a conversation

- **nomi (default) platform**: the model lives on the conversation row →
  `PATCH /api/conversations/:id` with `{ model: { provider, model } }`.
- **ACP platform** (`ipcBridge.ts` ~L1573-1596): `GET /api/conversations/:id/model` →
  `{ model_info, }`; `PUT /api/conversations/:id/model` `{ model }`;
  `GET /api/conversations/:id/mode` → `{ mode, initialized }`;
  `PUT /api/conversations/:id/mode` `{ mode }`. **404 before warmup is expected** (agent not attached yet).
- **Companion / agent binding**: `PUT /api/conversations/:id/summon`
  `{ companion_id, memory_ids?, skill_exclusions? }` — loads a companion's skills +
  selected read-only memories into this session; `DELETE .../summon` to release.
  Both return **409 if the session is not idle**; effective from the next message.

### Other per-conversation endpoints (mostly desktop)

`/slash-commands`, `/side-question`, `/confirmations[/:call_id/confirm]`,
`/approvals/check`, `/artifacts[/:artifact_id]`, `/workspace?path=`,
`/messages/:id/knowledge-writeback/retry`, `/openclaw/runtime`, `/associated`,
`/api/cron/jobs/:id/conversations`.

## 3. Message data model

Canonical TS model: `ui/src/common/chat/chatLib.ts` (base `IMessage<T, Content>` at L63-103,
union `TMessage` at L686). Persisted-row wire shape + validator:
`ui/src/common/adapter/storedMessageMapper.ts` (`StoredMessageResponse`, L15-25).

### Base envelope (every message)

```ts
{
  id: string;              // frontend-local render key (uuid), NOT a backend id
  message_id?: MessageId;  // durable entity id — present on persisted history rows
  msg_id?: MessageId;      // stable backend UUIDv7 — THE delta-merge key
  turn_id?: MessageId;     // turn correlation; one turn -> many rows
  conversation_id: ConversationId;
  type: TMessageType;
  content: <depends on type>;
  created_at?: number;                              // epoch ms; ordering key
  position?: 'left' | 'right' | 'center' | 'pop';   // left=assistant, right=user, center=system/tips
  status?: 'finish' | 'pending' | 'error' | 'work';
  hidden?: boolean;        // persisted + sent to the agent, but NOT rendered
}
```

There is **no `role` field** — the speaker is encoded by `position`
(`'right'` = user, `'left'` = assistant/agent, `'center'` = system notices/errors)
plus `type`. Ordering is by `created_at`, tie-broken by `message_id`
(the history cursor is literally `'<created_at>:<message_id>'`).

### Content block types (`TMessageType`, 11 variants)

| type | content essentials | mobile |
| --- | --- | --- |
| `text` | `{ content: string; replace?: boolean; agentMessage?, senderName?, senderAgentType?, knowledge_writeback? }` — markdown body | **must render** |
| `thinking` | `{ content: string; subject?, duration?, status: 'thinking'\|'done' }` | render collapsed |
| `tips` | `{ content: string; type: 'error'\|'success'\|'warning'; error?: AgentStreamErrorInfo }` — system/error notice | **must render** |
| `tool_call` | `{ call_id, name, args?, input?, output?, description?, status?: 'running'\|'completed'\|'error', error?, retry?, artifacts? }` | render as a compact one-line chip |
| `tool_group` | array of `{ call_id, name, description, status: 'Executing'\|'Success'\|'Error'\|'Canceled'\|'Pending'\|'Confirming', render_output_as_markdown, result_display?: string \| {file_diff,file_name} \| {img_url,relative_path}, confirmationDetails? }` | collapse to a chip; skip diff/img viewers |
| `permission` | `IConfirmation` — `{ id, call_id, title?, description, options: [{label, value, params?}], command_type? }` | optional (approval prompt) |
| `agent_status` | `{ backend, status: connecting\|connected\|…\|error, agent_name?, session_id? }` | small status line |
| `plan` | `{ session_id, entries }` — ACP todo plan | skip v1 |
| `acp_permission` / `acp_tool_call` / `available_commands` | ACP-agent specific | skip v1 |

Attachments are **not** a content block: the send API takes `files: string[]`
(server-side paths). Inline images only surface via `tool_group.result_display.img_url`.

## 4. Streaming

Transport is a single app-wide WebSocket with topic-named frames, wrapped by
`wsEmitter` / `wsMappedEmitter` in `ui/src/common/adapter/ipcBridge.ts`
(implementation: `ui/src/common/adapter/httpBridge.ts` L960-1160).
Every frame carries `conversation_id`, so a mobile client filters by the open chat.

### Transport details (httpBridge.ts)

- URL: `ws://127.0.0.1:<backendPort>/ws` (desktop) or `{ws,wss}://<host>/ws` (web-ui mode).
- Frame envelope: `{ name | event: string, data | payload: unknown }` — the topic
  is `name ?? event`, the body `data ?? payload`.
- `name: 'ping'` → reply `{ name: 'pong', data: { timestamp } }` (keep-alive).
- `name: 'sync.resync-required'` → the server's event bus lagged and dropped
  envelopes; the client fans this out as `ws.reconnected` after a jittered delay so
  every store reloads its durable snapshot.
- Auth: an optional trust secret is passed as the WebSocket subprotocol.
- `Idempotency-Key` is a real HTTP **header** (httpBridge L518) — required on send /
  steer / edit-resubmit; the bridge throws locally if it is missing.

### Topics

| Topic | Payload | Meaning |
| --- | --- | --- |
| `message.stream` | `IResponseMessage` (ipcBridge L3087-3117) | the assistant delta stream — the main one |
| `message.userCreated` | `IUserMessageCreatedEvent` (L3154) | a user message was persisted (also covers IM-channel inbound) |
| `turn.started` | `IConversationTurnStartedEvent` (L3209) | a turn began / phase changed |
| `turn.completed` | `IConversationTurnCompletedEvent` (L3241) | **the authoritative turn terminator** |
| `conversation.listChanged` | `{ conversation_id, action: 'created'\|'updated'\|'deleted', source? }` | invalidate the session list |
| `conversation.artifact` | artifact rows (cron_trigger / skill_suggest cards) | optional |
| `knowledge.writeback` | `IKnowledgeWritebackEvent` | optional; post-turn memory write status |
| `confirmation.add` / `.update` / `.remove` | `IConfirmation & { conversation_id }` | approval prompts |
| `ws.reconnected` | `undefined` | **the server does NOT replay frames** — on reconnect you must refetch history and pending confirmations |

### `message.stream` payload (IResponseMessage)

```ts
{ type: string; data: unknown; status?: 'finish'|'pending'|'error'|'work';
  msg_id: MessageId; turn_id?: MessageId; conversation_id: ConversationId;
  created_at?: number; hidden?: boolean;
  replace?: boolean;          // replace accumulated text for this msg_id instead of appending
  stream_complete?: boolean;  // self-contained finalized projection — do NOT raise "generating" state
  companion?, companion_id?, channel_platform?, origin? }
```

Wire `type` values handled (`transformMessage`, chatLib L1277+): `error`, `tips`,
`text` | `content` | `user_content`, `tool_call`, `tool_group`, `agent_status`,
`permission`, `acp_permission`, `acp_tool_call`, `plan`, `thinking`,
`available_commands`; **ignored/swallowed**: `start`, `finish`, `thought`,
`skill_suggest`, `cron_trigger`, `info`, `system`, `acp_model_info`,
`codex_model_info`, `acp_context_usage`, `request_trace`.

### Delta accumulation

`transformMessage(IResponseMessage) -> TMessage | undefined`, then
`composeMessage(msg, list, handler) -> TMessage[]` (chatLib L1535-1700). Rules:

1. Key on **`msg_id` + `type`**. If the tail message has a different `msg_id` or
   `type`, push a new bubble; otherwise merge into the tail.
2. `text`: concatenate `content.content` onto the tail unless `replace === true`,
   in which case swap the accumulated text wholesale (`mergeTextMessageContent`,
   `isTextContentReplacement`).
3. `thinking`: append while `status: 'thinking'`; a `status: 'done'` frame
   back-patches the matching `msg_id` in place with `duration`/`subject`.
4. `tool_call` / `tool_group`: merge by `call_id` (`mergeToolCallContent`,
   `normalizeToolGroupContent`) — **error is absorbing**, later non-error frames
   don't overwrite an error status.
5. `plan`: replaces the existing plan message for the same session.

Renderer-side orchestration (history fetch + WS merge + refetch after settle) lives in
`ui/src/renderer/pages/conversation/Messages/hooks.ts` and
`.../Messages/hooks.mergeFetchedMessages.test.ts` — that test file is the best
spec of the merge semantics (server rows win over optimistic/streamed ones).

### What signals finished / failed / stopped

- **Authoritative**: `turn.completed` with `status: 'finished'` and
  `state: 'ai_waiting_input'` (ok) | `'stopped'` (user cancelled) | `'error'` (failed).
  It also carries `runtime.{state, is_processing, can_send_message, pending_confirmations}`,
  the resolved `model {platform, name, use_model}`, and `last_message` — so a mobile
  client can reconcile the tail bubble without a refetch.
- Per-message: `status: 'finish' | 'error'` on the last `message.stream` frame for
  that `msg_id`; `stream_complete: true` marks a finalized non-turn projection.
- Failure also arrives as a `type: 'error'` stream frame → rendered as a
  `tips` message with `content.type: 'error'` and structured `error`
  (`AgentStreamErrorInfo`: ownership `nomifun|user_agent|user_llm_provider|unknown_upstream`
  + a resolution hint like `retry`, `check_provider_credentials`).
- Composer enablement is driven by `can_send_message` (top-level and `runtime.*`),
  not by guessing from the last message.
- `turn.completed.turn_id` may be absent on older servers — keep a
  runtime-state fallback.

## 5. Session-level metadata for a list view

Model: `IChatConversation<T, Extra>` / `TChatConversation` in
`ui/src/common/config/storage.ts` (L38-94 base, L105-275 the `acp` | `nomi` union).
Wire→TS normalization: `fromApiConversation` in `ui/src/common/adapter/apiModelMapper.ts`.

Fields a mobile list actually needs (all from `GET /api/conversations`):

| Field | Source | Use |
| --- | --- | --- |
| `id: ConversationId` | row | route param |
| `name: string` | row | title (rename = `PATCH { name }`) |
| `modified_at: number` | row | **the sort/"updated at" key** (epoch ms); `created_at` also present |
| `pinned` / `pinned_at` | row | pin section; `pinned_at` maintained server-side when you `PATCH { pinned: true }` |
| `type: 'nomi' \| 'acp'` | row | which platform adapter / composer |
| `model: TProviderWithModel` | row (nomi only; acp omits it) | model chip in the header |
| `status?: 'pending'\|'running'\|'finished'` | row | coarse state |
| `runtime?: TConversationRuntimeSummary` | row | `{ state: idle\|starting\|running\|waiting_confirmation, can_send_message, has_runtime, is_processing, pending_confirmations, active_turn_id?, processing_started_at? }` — drives the "generating" spinner and the elapsed timer (anchor on `processing_started_at` so it survives remount) |
| `source?: ConversationSource` | row | `'nomifun' \| 'telegram' \| 'lark' \| 'dingtalk' \| 'weixin' \| 'wecom'` — channel origin badge |
| `desc?` | row | subtitle if you want one |
| `extra.workspace` | row extra | desktop grouping key — mobile can ignore |
| `extra.companion_session` + `extra.companion_id` | row extra (nomi) | **companion binding**: a companion's single per-companion session (单会话契约). Desktop *excludes* these from the work list; they live under 桌面伙伴 → 伙伴 → 聊天 |
| `extra.summon` | row extra (nomi) | `{ companion_id, memory_ids, skill_exclusions, summoned_at }` — an in-session companion binding (write via `PUT .../summon`); render a badge |
| `extra.channel_platform` | row extra | IM-channel origin of companion turns |
| `extra.last_token_usage` | row extra (nomi) | `{ total_tokens, context_tokens?, context_window? }` — context gauge |
| `preset_id` / `preset_revision` / `preset_snapshot` | row | agent preset lineage (which "agent" this chat is) |
| `cron_job_id` | row | spawned by a scheduled task |

**No server-side unread field.** The desktop derives it client-side in
`ui/src/renderer/pages/conversation/SessionList/hooks/useConversationListSync.ts`:

- The whole list is one flat fetch — `getUserConversations({ limit: 10000 })`, no paging in practice.
- Refetch triggers: `conversation.listChanged` (any action), `ws.reconnected`
  (WS has no replay, so re-snapshot), and after an accepted `turn.completed`.
- `generatingConversationIds`: set on `turn.started` when
  `runtime.is_processing && runtime.active_turn_id === turn_id`; cleared on completion.
- `completionUnreadConversationIds`: marked on `turn.completed` when the turn was
  generating, `state` is terminal, **and the conversation is not the currently open
  one**; cleared when you open the chat or the conversation is deleted.
- Desktop filters the list into buckets (ordinary work / SSH-bound / robot-bound) and
  hides every companion-marked row. Mobile likely wants ordinary + companion sessions
  and can drop the SSH/robot buckets.

## 6. Desktop-only capabilities to SKIP

| Capability | Where | Why skip |
| --- | --- | --- |
| Embedded terminal sessions | routes `/terminal-new`, `/terminal/:id`; `.../conversation/components/ConversationTerminalPanel.tsx` | pty in a chat pane; no mobile analogue |
| Workspace file rail (browse/open the agent's working dir) | `.../conversation/Workspace/` + `GET /api/conversations/:id/workspace?path=` | filesystem UI |
| Preview pane (markdown/code/image/diff viewers, preview history) | `.../conversation/Preview/` (`PreviewPanel`, `MarkdownViewer`, `/api/preview-history/*`) | large split-pane viewer |
| File-diff rendering inside tool results | `.../Messages/MessageFileChanges.tsx`, `tool_group.result_display.file_diff`, `confirmationDetails.kind: 'edit'` | collapse to a text chip instead |
| Collaboration / execution graph (delegation, attempts, model pool) | `.../conversation/execution/` (`ProjectedAttemptView`), `delegation_policy`, `execution_*` fields | multi-agent orchestration viz |
| Computer-use / browser-use takeover approvals | `IConfirmation.pagePreview` (base64 page screenshot), `/settings/computer-use`, `/browser` | desktop automation |
| Knowledge panel + write-back retry UI | `.../Workspace/KnowledgePanel/`, `KnowledgeControl.tsx`, `knowledge.writeback` topic, `/knowledge-writeback/retry` | optional; a read-only status line is enough |
| ACP / openclaw / nanobot / remote platform adapters | `.../conversation/platforms/{acp,openclaw,nanobot,remote}` incl. per-conversation `mode`/`model` PUTs, slash commands, ACP plans | mobile should ship the `nomi` platform only |
| MCP / skills per-session pickers | `extra.mcp_*`, `extra.skills`, `inject_skills` on send | leave at server defaults |
| SSH-bound and robot-bound session groups | `useConversationListSync` buckets, `/settings/ssh-hosts` | desktop-host features |
| Conversation title minimap, summon panel, IDMM control, batch select/export | `.../components/ConversationTitleMinimap`, `SummonPanel`, `IdmmControl.tsx`, `SessionList/hooks/{useBatchSelection,useExport}.ts` | power-user desktop chrome |
| Artifact cards (cron_trigger / skill_suggest) | `conversation.artifact` topic, `/artifacts` | optional |
| Side questions / slash commands | `/side-question`, `/slash-commands` | optional |

## 7. Minimal mobile chat scope

1. Two screens: session list (`GET /api/conversations`) and chat detail
   (`/conversation/:id` equivalent). `nomi` platform only.
2. List row: `name`, relative `modified_at`, pin, a generating spinner
   (`runtime.is_processing`), and a client-derived unread dot.
3. List actions: create (`POST /api/conversations` `{type:'nomi', name, model}`),
   rename/pin (`PATCH`), delete (`DELETE`). Refetch on `conversation.listChanged`
   + `ws.reconnected`.
4. History: `GET /api/conversations/:id/messages?cursor=&page_size=50&content_mode=compact`,
   newest window first, paginate older with `cursor='<created_at>:<message_id>'`.
5. Render 4 message types: `text` (markdown), `thinking` (collapsed),
   `tips` (error/notice banner), and `tool_call`/`tool_group` as a one-line
   status chip. Everything else → ignore silently.
6. Speaker from `position` (`right`=user, `left`=assistant, `center`=system); order
   by `created_at`, tie-break `message_id`.
7. Send: `POST /api/conversations/:id/messages` `{ content }` with a per-attempt
   `Idempotency-Key`; optimistic bubble reconciled by `message.userCreated`.
8. Stream: subscribe `message.stream`, merge by `msg_id`+`type` (append text unless
   `replace`), and treat `turn.completed` as the single source of truth for
   finished / `stopped` / `error` + composer enablement (`can_send_message`).
9. Stop button → `POST /api/conversations/:id/cancel`.
10. On reconnect, refetch history and the conversation row — the server never replays
    WS frames.
