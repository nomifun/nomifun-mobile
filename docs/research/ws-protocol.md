# `/ws` WebSocket protocol (for RN client port)

Research notes derived from `nomifun-tauri` (read-only). Source refs are absolute
paths into `/home/rika/src/nomifun-tauri`.

## 0. Connection basics (known facts, restated)

- Route: `crates/backend/nomifun-app/src/router/routes.rs:1003` → `GET /ws`.
- Handler: `crates/backend/nomifun-realtime/src/handler.rs:62`.
- Origin validation: `handler.rs:153`.
- Auth token accepted via `Authorization: Bearer`, cookie, or the **first
  `Sec-WebSocket-Protocol` value** (server echoes that value back as the
  negotiated subprotocol).
- `/ws` is **outside** the CSRF layer.
- Server heartbeat constants (`crates/backend/nomifun-realtime/src/types.rs:76`):
  - `HEARTBEAT_INTERVAL = 30s` (server sends app-level `ping` frame)
  - `HEARTBEAT_TIMEOUT = 60s` (no pong → close `4408`)
  - `PER_CONNECTION_BUFFER = 256` outbound messages; overflow ⇒ **server
    disconnects the client** (deliberate: forces a durable resync).
- Close codes (`types.rs:38`):
  | code | meaning | client action |
  |------|---------|---------------|
  | 1000 | normal closure | — |
  | 1008 | policy violation — **auth failure only** | re-login |
  | 4408 | heartbeat timeout (liveness, not auth) | reconnect |
  | 4409 | handshake token aged out (not a logout) | reconnect w/ fresh token |

  The 1008 vs 4408/4409 split is load-bearing: only 1008 may trigger
  "session expired → login".

## 1. Message envelope

`crates/backend/nomifun-api-types/src/websocket.rs:9`

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WebSocketMessage<T> {
    pub name: String,
    pub data: T,
}
```

Wire shape, **both directions**, is exactly two keys:

```json
{ "name": "<topic>", "data": <any JSON> }
```

- There is **no** `topic`/`event`/`payload` triple, no `id`, no `ts` at the
  envelope level. Timestamps live inside `data` when present.
- `deny_unknown_fields` ⇒ any extra envelope key from the client is a **parse
  error**. RN client must send exactly `{name, data}`.
- Server-side type is `WebSocketMessage<serde_json::Value>` on the bus, so
  `data` is free-form per topic.
- Topic naming is *not* uniform: most are dot-separated (`task.created`), a few
  legacy/test ones use colons (`chat:update`).

_(sections below filled in as research proceeds)_

## 2. Topic catalog

Two delivery boundaries (`crates/backend/nomifun-realtime/src/broadcaster.rs`):

- `EventBroadcaster::broadcast(msg)` → **every** connected socket. Only for
  instance-owned state.
- `UserEventSink::send_to_user(user_id, msg)` → only sockets authenticated as
  that user. **All conversation / companion / cron / requirement traffic uses
  this.** Owner travels in `UserEventEnvelope`, never inferred from payload.

`send_to` (unicast to one ConnectionId) exists on `WebSocketManager` but is a
connection-management detail, not part of the domain event API.

**64 emitter registrations** exist on the desktop client
(`ui/src/common/adapter/ipcBridge.ts`), covering **~60 distinct wire topics**.
Server-side literals were cross-checked; the table marks the handful that are
client-local only.

### 2a. Chat / conversation streaming (highest priority)

| topic | payload (`data`) |
|---|---|
| `message.stream` | **The** assistant streaming channel. `{conversation_id, msg_id, type, data, hidden, turn_id, companion, companion_id, origin, channel_platform}` — see §5. |
| `message.userCreated` | A user message was persisted (incl. inbound from IM channels). Client maps via `fromApiUserMessageCreatedEvent`. |
| `turn.started` | Turn began. `{conversation_id, turn_id, status, phase, state, detail, can_send_message, runtime:{state, can_send_message, has_runtime, runtime_status, is_processing, pending_confirmations, active_turn_id?, processing_started_at?}, companion?, companion_id, origin, channel_platform}` |
| `turn.completed` | Turn finished; same companion/origin markers + runtime summary. Client mapper `fromApiTurnCompletedEvent`. |
| `conversation.artifact` | Artifact created/updated for a conversation (`ConversationArtifactResponse` shape). |
| `conversation.listChanged` | Conversation list mutated (reload the list). |
| `confirmation.remove` | `{conversation_id, id}` — a pending confirmation is gone. |
| `knowledge.writeback` | Agent wrote something back into a knowledge base during a turn. |
| `ws.reconnected` | **Client-synthetic**, not a server frame. Emitted locally by httpBridge after a successful reconnect; durable projections must refetch (server never replays frames). |
| `confirmation.add` / `confirmation.update` | Registered client-side but **no server emitter found** — likely legacy/Tauri-local. |

### 2b. Scheduled tasks (cron)

`crates/backend/nomifun-cron/src/events.rs` — `CronEventEmitter`, all
`send_to_user(owner_id, …)`:

| topic | payload |
|---|---|
| `cron.job-created` | full `CronJobResponse` |
| `cron.job-updated` | full `CronJobResponse` |
| `cron.job-removed` | `{cron_job_id}` |
| `cron.job-executed` | execution result summary for a run |

Note (`events.rs:56` `emit_conversation_tips`): cron **also** emits a
`message.stream` frame so a triggered run shows up inline in the conversation
transcript. A cron trigger therefore surfaces on *both* topics.

### 2c. Requirements / AutoWork

`crates/backend/nomifun-requirement/src/events.rs`:

| topic | payload |
|---|---|
| `requirement.created` | full `Requirement` |
| `requirement.updated` | full `Requirement` |
| `requirement.statusChanged` | full `Requirement` (note camelCase — server literal is `requirement.statusChanged`) |
| `requirement.deleted` | `{requirement_id}` |
| `autowork.statusChanged` | `AutoWorkState` |
| `autowork.tagPaused` | `TagPausedPayload` |

`requirement.created` is the one topic in this group emitted via `broadcast`
(instance-wide) as well — the emitter holds both sinks.

### 2d. Agent execution / IDMM

| topic | payload |
|---|---|
| `agentExecution.changed` | multi-agent execution/step state changed (`crates/backend/nomifun-agent-execution/src/event_publisher.rs`) |
| `agentExecution.leadThinking` | lead agent thinking text |
| `idmm.statusChanged` | IDMM state change |
| `idmm.intervention` | IDMM requested an intervention (`nomifun-idmm/src/events.rs`) |

### 2e. Companions (`nomifun-companion/src/events.rs`)

`companion.learn-started` `{companion_id}` · `companion.learn-finished`
(`CompanionLearnResult`, scoped by companion_id) · `companion.mood-changed`
`{companion_id, mood}` · `companion.config-updated` (shared or per-companion
profile) · `companion.created` `{companion_id, profile}` · `companion.deleted`
`{companion_id}` · `companion.memory-created` / `-updated` (`CompanionMemory`) ·
`companion.memory-deleted` `{memory_id}` · `companion.skill-drafted` /
`-learned` / `-archived` (skill id + metadata).

### 2f. Terminal / SSH / robot

`terminal.output` (chunked stdout — high-volume) · `terminal.exit` ·
`terminal.created` · `terminal.updated` · `terminal.removed` ·
`ssh.status` (`nomifun-ssh/src/events.rs`) · `robot.status`
(`nomifun-robot/src/events.rs`, ESP32 device state).

### 2g. Knowledge

`knowledge.base-created` / `-updated` / `-deleted` · `knowledge.binding-changed`
· `knowledge.tag-changed` (payload `Record<string, never>` — pure invalidation
signal) · `knowledge.writeback` (also listed in 2a).

### 2h. Channels (IM integrations) — `nomifun-channel/`

`channel.pairing-requested` · `channel.plugin-status-changed`
`{plugin_id, status}` · `channel.user-authorized` · `channel.weixin-login`.

### 2i. Extensions / hub / browser / files / sync

| topic | payload |
|---|---|
| `extensions.state-changed` | `{name, enabled, reason?}` |
| `extensions.lifecycle` | install/enable/disable lifecycle progress |
| `hub.state-changed` | extension-hub state |
| `browser.inventory.changed` | browser lane inventory changed |
| `browser.lifecycle.changed` | browser lane lifecycle |
| `browser.resourcePolicy` | resource-pressure policy change |
| `fileStream.contentUpdate` | streamed file content update |
| `workspaceOfficeWatch.fileAdded` | `{file_path, workspace}` |
| `sync.resync-required` | `{scope:"all", skipped:<u64>}` — the server's event bus lagged and dropped an unknown set of envelopes. **`broadcast_all` to every client at once**; the socket is fine, but projections are stale → refetch. `routes.rs:188` fires `browser.inventory.changed` first (legacy clients) then this marker. |
| `ping` | server heartbeat, `{timestamp}` (see §4) |

### 2j. Client-local only (no server emitter — skip for RN)

`preview.open`, `ppt-preview.status`, `word-preview.status`,
`excel-preview.status`, `system-settings:language-changed`, `ws.reconnected`,
`confirmation.add`, `confirmation.update`. These ride the same event bus on
desktop but are produced locally (Tauri/webview), not by `/ws`.

Legacy colon-style names (`chat:message`, `chat:update`, `status:update`,
`list:update`) appear only in unit tests / doc examples — **not live topics**.

## 3. Client side (`ui/src/common/adapter/httpBridge.ts`)

Single module-level singleton socket shared by every subscriber. Key state
(lines 764–803): `wsListeners: Map<topic, Set<cb>>`, `ws`, `wsReconnectTimer`,
`wsReconnectAttempt`, `wsLastActivityAtMs`, `wsHadDeliveryGap`.

### URL (`getWsUrl`, httpBridge.ts:163)

```ts
// browser / WebUI mode — same origin
`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`
// desktop shell
`ws://127.0.0.1:${getBackendPort()}/ws`
```

### Subprotocol = auth (httpBridge.ts:963)

```ts
const trustSecret = getLocalTrustSecret();
ws = trustSecret ? new WebSocket(url, [trustSecret]) : new WebSocket(url);
```

Browsers cannot set headers on a WS handshake, so the token rides as the sole
subprotocol; the server reads `Sec-WebSocket-Protocol` and **echoes it back** so
the handshake completes. WebUI browser mode omits it and relies on the session
cookie. **RN implication:** RN's `WebSocket(url, protocols, options)` accepts a
`headers` option, so RN can use `Authorization: Bearer` *or* the subprotocol
trick. The subprotocol path is the safer bet (it is the exercised code path) —
but the value must be a valid subprotocol token (no spaces, no commas).

### Lifecycle / reconnect

- **Lazy connect:** `ensureWs()` is called from `wsEmitter().on()` — the socket
  only opens once something subscribes, and the reconnect timer + watchdog stop
  when `wsListeners.size === 0`.
- **Backoff (httpBridge.ts:1096):**
  `delay = min(1000 * 2 ** attempt, 30_000)`, no jitter. Attempt counter is
  reset on the **first inbound frame**, deliberately *not* on `open` — an
  auth-rejecting server also reaches `open` before closing.
- **Close handling (httpBridge.ts:1002):**
  - `1008` → `handleHttpAuthExpired()` (logout/redirect) **and** floor the
    attempt counter at 5 so it degrades to a slow background probe instead of a
    1 s reconnect/403 storm.
  - `4409` → reset attempt to 0 and reconnect immediately (cookie has slid).
  - anything else → normal backoff.
  - Every close sets `wsHadDeliveryGap = true`.
- **`error` event** → just `current.close()` (lets the close path own recovery).
- **Stale-socket watchdog (httpBridge.ts:895, `ensureWsWatchdog`):**
  `setInterval` every **15 s**; recycles the socket when
  `now - lastActivity > 75_000` (`WS_STALE_THRESHOLD_MS`, ≈2.5 server
  heartbeats) while `readyState === OPEN`, or when a `CONNECTING` handshake
  outlives `WS_CONNECT_TIMEOUT_MS = 30_000`. This exists because a half-open
  socket reports OPEN forever and no close event ever fires.
- **Foreground recovery:** a `visibilitychange` → visible listener
  (httpBridge.ts:945) calls `__handleVisibilityRecovery()` which recycles with
  `{immediate: true}` (skips backoff) if the socket is closed/closing/stale.
  **RN needs `AppState` ('active') instead of `visibilitychange`.**
- **`ws.reconnected` (synthetic):** after any delivery gap the client locally
  dispatches `ws.reconnected` to its own listeners. The server **never replays
  frames**, so every store with a durable projection re-fetches its snapshot on
  this signal. This is the single most important pattern to port.
- **Guard against zombie sockets:** every handler starts with
  `if (ws !== current) return;` so a recycled socket's late events cannot
  corrupt shared state.

### Dispatch (httpBridge.ts:1035)

On each `message`:
1. `wsLastActivityAtMs = Date.now(); wsReconnectAttempt = 0;` — recorded
   **before** parsing, so even a malformed frame counts as liveness.
2. `JSON.parse`, then `const eventName = msg.name ?? msg.event;` and
   `const payload = msg.data ?? msg.payload;` — the `event`/`payload` fallback is
   defensive only; the server always sends `name`/`data`.
3. `ping` → reply `pong`, return (see §4).
4. `sync.resync-required` → `scheduleResyncDispatch()`: a **0–2000 ms random
   jitter** then dispatch `ws.reconnected`; repeats inside the window coalesce.
   The jitter exists because the server broadcasts this to *all* clients at once
   (bus lag is instance-global) and an unjittered refetch fan-out would stampede
   an already-overloaded backend.
5. Otherwise: `wsListeners.get(eventName)` and call each callback with `payload`.
   Unknown topics are silently ignored; non-JSON frames are swallowed.

### Event-bus mapping (topic → `ipcBridge` handle)

```ts
wsEmitter<T>(topic)            // raw: on(cb) registers cb in wsListeners[topic]
wsMappedEmitter<T, Raw>(topic, transform)  // same + payload transform
```

Both return `{on, emit}`; `emit` is a **no-op stub** (client cannot publish).
`on()` returns an unsubscribe closure that removes the callback, deletes the
topic key when empty, and — when the last topic goes away — clears the resync
timer, resets the backoff, and stops the watchdog.

`wsMappedEmitter` runs `transform` *outside* the subscriber call
(httpBridge.ts:1180) so a decoder rejection is logged as a `transform` failure
rather than looking like a listener bug. Handler/transform throws are warned via
`warnWsHandlerFailure`, rate-limited to **one warning per (kind, topic) per
60 s** so a streaming topic cannot flood the console.

`ipcBridge.ts` is just a declarative registry: e.g.
`pluginStatusChanged: wsMappedEmitter<...>('channel.plugin-status-changed', raw => …)`
(ipcBridge.ts:3581), consumed as
`ipcBridge.channel.pluginStatusChanged.on(handler)`.

Also exported for consumers that gate fallback polling on realtime health:
`isWsConnected()` (nominal `readyState === OPEN`) and `wsLastActivityAt()`.
The doc comment is explicit that `readyState` alone is insufficient — a wedged
half-open socket still reports OPEN, so combine both.

## 4. Client → server messages

The upstream direction is almost empty by design.
`crates/backend/nomifun-realtime/src/handler.rs:559` (`handle_text_message`):

> "Business requests flow over HTTP, not the WebSocket: any upstream message
> other than `pong` / `subscribe-show-open` is discarded with a debug log."

| direction | frame | purpose |
|---|---|---|
| S→C | `{"name":"ping","data":{"timestamp":<ms>}}` | app-level heartbeat, every 30 s (`manager.rs:301`) |
| C→S | `{"name":"pong","data":{"timestamp":<ms>}}` | resets `last_ping`; **required** or the server closes with 4408 after 60 s |
| C→S | `{"name":"subscribe-show-open","data":{id, data:{properties:[...]}}}` | desktop-only file/dir picker bridge |
| S→C | `{"name":"show-open-request","data":{id, properties, isFileMode}}` | reply to the above (unicast) |

- **There is NO subscribe/unsubscribe protocol.** A socket receives every event
  its authenticated user is entitled to; client-side filtering is the
  `wsListeners` map. Nothing to send at connect time.
- **There is no ack protocol** — delivery is fire-and-forget with no replay.
- **Malformed JSON** gets a non-envelope reply (note: this frame is *not* in
  `{name,data}` form, `handler.rs:584`):
  `{"error":"Invalid message format","expected":"{ \"name\": \"event-name\", \"data\": {...} }"}`
- WebSocket-protocol-level Ping/Pong frames are handled automatically by
  axum/tungstenite and are **separate** from the app-level `ping`/`pong` topics.
  Binary frames are ignored.
- `subscribe-show-open` is a desktop picker bridge — **skip it in RN.**

## 5. Chat streaming shape

**One topic carries the whole assistant reply: `message.stream`.**
Bracketing topics are `turn.started` (before) and `turn.completed` (after).

Built at `crates/backend/nomifun-conversation/src/stream_relay.rs:3474`
(`forward_to_websocket_with_msg_id_and_visibility`) then stamped at
`stream_relay.rs:5140` (`broadcast_stream_payload`):

```json
{
  "name": "message.stream",
  "data": {
    "conversation_id": "...",
    "msg_id": "...",          // id of the assistant message being built
    "type": "content",        // AgentStreamEvent variant tag (snake_case)
    "data": { "content": "…" },// variant-specific body
    "hidden": false,          // true = internal frame, don't render
    "turn_id": "...",         // root turn id (stable for the whole turn)
    "companion": false,
    "companion_id": null,
    "origin": null,           // null = typed by a human;
                              // "companion"|"cron"|"autowork"|"idmm" otherwise
    "channel_platform": null  // e.g. "telegram" for IM-channel conversations
  }
}
```

### The inner `type` / `data` union

`AgentStreamEvent` at
`crates/backend/nomifun-ai-agent/src/protocol/events/mod.rs:32`:

```rust
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
```

The relay lifts that tag/content pair into the outer payload's `type`/`data`
keys, so the client switches on `data.type`:

| `type` | inner `data` | notes |
|---|---|---|
| `start` | `{session_id?}` | turn opened on the agent side |
| `session_assigned` | `{session_id}` | |
| **`content`** | `{content: string}` | **the text delta** — variant is `Text`, renamed to `content` on the wire. Append to `msg_id`'s buffer. |
| `thinking` | `{content, subject?, duration?, status?}` | reasoning stream |
| `tips` | `{content, type}` | inline notice (also used for error tips) |
| `tool_call` | `ToolCallEventData` (id/name/status/args/result) | |
| `acp_tool_call` | ACP-shaped tool call update | |
| `tool_group` | `[ToolGroupEntry]` | |
| `agent_status` | `{backend, status, agent_name?, session_id?}` | |
| `plan` | `PlanEventData` | |
| `permission` / `acp_permission` | permission request | needs a user decision |
| `skill_suggest` | skill suggestion | |
| `cron_trigger` | cron kicked this turn | |
| `available_commands`, `slash_commands_updated` | command list refresh | |
| `acp_model_info`, `acp_mode_info`, `acp_config_option`, `acp_session_info`, `acp_context_usage` | raw JSON | |
| `turn_completed` | aggregate metrics (duration, tokens) | additive, ignorable |
| **`finish`** | `{session_id?, stop_reason?}` | **the done flag.** `stop_reason`: absent/`end_turn` = success; `max_tokens`/`max_turn_requests`/`refusal`/`cancelled` = the turn did not accomplish its goal. |
| `error` | `ErrorEventData` | terminal failure; also persisted as an error `tips` row |
| `system`, `request_trace` | raw JSON | diagnostics |

### Deltas: what to accumulate

- There is **no chunk index and no sequence number**. Ordering is the socket's
  ordering; a dropped/backpressured connection is closed rather than gap-filled.
- Identity is `(conversation_id, turn_id, msg_id)`. A single turn can mint
  **several** `msg_id`s (e.g. an error message gets its own minted id at
  `stream_relay.rs:1976`), so key buffers by `msg_id`, not by turn.
- Nested ACP payloads are force-normalized to snake_case
  (`normalize_keys_to_snake_case`, `stream_relay.rs:3490`) — the whole wire
  contract is snake_case inside `data`, even though a few *topic names* are
  camelCase.
- `hidden: true` frames must be swallowed by the UI (they exist for collectors).
- Robot-gateway threads strip bracketed stage directions from `content` before
  the WS forward, so mobile gets the cleaned copy for free.

### End-of-turn ordering

`finish` (inner type) arrives on `message.stream`; the durable turn close is a
separate `turn.completed` topic emitted by `ConversationService` after its
finalize → exact-release → event fence. Treat `turn.completed` as authoritative
for "input re-enabled", and `finish` as "no more text coming".

## RN client checklist

1. Envelope is exactly `{name, data}` both ways — `deny_unknown_fields`, so never add envelope keys.
2. Connect `ws(s)://<host>/ws`; pass the token as the **single subprotocol** (server echoes it) or as a `Bearer` header via RN's `WebSocket(url, protocols, {headers})`.
3. **Must** answer `{"name":"ping"}` with `{"name":"pong","data":{"timestamp":Date.now()}}` or the server closes 4408 after 60 s.
4. Close codes: only **1008** = logout (and floor backoff at attempt 5); **4408/4409** = plain reconnect, never log the user out.
5. Backoff `min(1000 * 2**attempt, 30_000)`; reset the counter on first **inbound frame**, not on `open`.
6. Port the liveness watchdog: 15 s interval, recycle when no inbound frame for 75 s while OPEN, or a 30 s stuck CONNECTING. Replace `visibilitychange` with `AppState` → `active` (immediate, no backoff) — mobile backgrounding makes this the dominant failure mode.
7. No replay: after **any** gap, and on `sync.resync-required` (with 0–2 s jitter), fire a local `ws.reconnected` and refetch every durable snapshot.
8. No subscribe/ack protocol — filter client-side by `name`; skip `subscribe-show-open` entirely.
9. Chat: buffer `message.stream` by `msg_id`; append `data.type === 'content'` → `data.data.content`; stop on `finish` (check `stop_reason`); re-enable input on `turn.completed`; drop `hidden: true`.
10. Backpressure: >256 queued frames server-side ⇒ **the server disconnects you**. Never block the read loop; treat `terminal.output` / `message.stream` / `conversation.artifact` as high-volume (they are the desktop's `NOISY_WS_EVENTS`).
