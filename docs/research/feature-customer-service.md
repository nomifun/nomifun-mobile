# 客服 (Customer Service) — feature research for the React Native port

Source of truth: `/home/rika/src/nomifun-tauri` @ `3bd9a566` (v0.5.1). Read-only
survey; nothing in the desktop repo was modified.

---

## 1. What the feature actually is

**Not** an inbox, **not** a human-agent console, **not** a channels-integration
page. It is a **standalone AI customer-service-bot configuration domain**:
the owner defines one or more "客服员工" (customer-service employees), each with
a model, mounted knowledge bases, persona/policy prose and a set of IM bots.
Inbound messages from **strangers** on a bound bot are answered automatically by
a disposable, tool-restricted LLM turn. There is no human hand-off, no ticket
state, no operator reply UI.

Its defining property is the **security posture**, repeated verbatim across the
code, i18n and docs:

> 面向陌生访客的客服员工 —— 只依据知识库与客服笔记回答，高危能力从不注册。

Concretely (`crates/backend/nomifun-customer-service/src/tools.rs`):
a customer-service engine turn is constructed with a **fixed whitelist of
exactly three read-only tools** —

| tool | input | what it does |
|---|---|---|
| `knowledge_search` | `{query}` | search only the agent's mounted KBs, ≤8 hits |
| `knowledge_read` | `{path}` = `"{kb_id}:{rel_path}"` | read one doc, ≤6000 chars, kb_id re-validated against the whitelist so prompt injection cannot escape |
| `cs_notes_search` | `{query}` | LIKE search over the agent's enabled notes (shared + private), ≤10 hits |

Terminal / file-write / computer-use / browser / gateway tools are **never
registered** for this domain. There is a unit test asserting the whitelist is
exactly those three names.

### Relation to the two neighbouring domains

- **vs. 桌面伙伴 (companion)** — deliberately, totally separate. Different
  tables, different routes, different sidebar entry, never in the conversation
  sidebar. Comment in `useCsAgents.ts`: *"与「桌面伙伴」完全独立：独立数据 /
  配置 / 控制台，绝不混入桌面伙伴列表或会话侧边栏。"*
- **vs. channels (`docs/guides/channels.zh.md`)** — customer service *consumes*
  the channel plugin machinery but owns a disjoint slice of it. Migration
  `020_channel_owner_domain.sql` added `channel_plugins.owner_domain TEXT NOT
  NULL DEFAULT 'companion' CHECK (owner_domain IN ('companion',
  'customer_service'))` plus insert/update **triggers** enforcing that a
  `customer_service` row can never carry a `companion_id`. So a bot belongs to
  exactly one domain, forever, and the two bot pools never mix in any picker.
  `docs/guides/channels.zh.md:97-100,155-156` is the authoritative prose.

### Runtime message path (backend, no UI involvement)

`crates/backend/nomifun-channel/src/message_loop.rs:468-500` — the "客服接缝":

1. Inbound IM message → `msg_svc.cs_bound_agent(plugin_id)`.
2. If the bot is CS-bound, the **whole** message is handed to
   `CsDialogueEngine::handle_visitor_message` — no Conversation row, no
   decision interception, no per-chat busy guard.
3. `crates/backend/nomifun-channel/src/action.rs:1356+` and `pairing.rs:225-257`:
   a **stranger on a CS-bound bot is auto-registered with no pairing code**
   (`"customer-service channel auto-registered a stranger (no pairing)"`). This
   is the one place the normal pairing-approval gate is bypassed.
4. Reply is sent as plain text via `sender.send_message`. Empty reply = this
   text was merged into another in-flight batch → send nothing.

### Concurrency model (`dialogue.rs`)

- A **dialogue lane** = the `(channel_plugin_id, channel_user_id, chat_id)`
  triple (UNIQUE index).
- **Cross-visitor turns run in parallel**, capped per agent by a semaphore
  sized from `cs_agents.max_concurrent` (1..=64, default 8).
- **Same-visitor turns are serial**: a message arriving while the lane is busy
  is buffered and merged into the next window, producing **one merged reply**.
  The absorbed caller gets `None`.
- Context window: ≤30 recent messages within ≤8000 chars, taken *before*
  persisting the new batch (the batch is the one-shot `user_text`).
- Hard turn budget `TURN_TIMEOUT_SECS = 120`.
- Failure → fixed visitor-facing notice `"暂时无法回复，请稍后再试"`; the real
  error goes to `cs_audit_events`.
- System prompt is assembled per turn from `name` / `persona` /
  `service_policy` / `greeting` + a fixed 回答边界 clause
  (`dialogue.rs:278-298`).

---

## 2. Routes & components (desktop, `ui/src/renderer`)

Registered in `ui/src/renderer/components/layout/Router.tsx:32-33,250-251`,
both lazy-loaded:

| route | component |
|---|---|
| `/customer-service` | `pages/customerService/index.tsx` — roster (花名册) |
| `/customer-service/:cs_agent_id` | `pages/customerService/CsAgentDetailPage.tsx` |

Sidebar entry: `components/layout/Sider/SiderNav/SiderCustomerServiceEntry.tsx`
— a top-level rail item under the 服务 group, `Headset` icon, mirrors
`SiderNomiEntry`.

### File inventory

| file | lines | role |
|---|---|---|
| `pages/customerService/index.tsx` | 177 | Roster page: header + trust banner + agent card grid + empty state + create modal |
| `pages/customerService/CsAgentDetailPage.tsx` | 631 | Detail page: 2-column grid of 4 card sections |
| `pages/customerService/CsAgentDetailPage.module.css` | 369 | Detail-page layout (CSS module, not utility classes) |
| `pages/customerService/CreateCsAgentModal.tsx` | 146 | Arco `Form` create modal |
| `pages/customerService/CsChannelBotsSection.tsx` | 341 | Self-closed CS-domain bot pool: list, checkbox bind, in-page bot creation |
| `pages/customerService/csChannelBots.ts` | 61 | **Pure functions** — port these verbatim |
| `pages/customerService/useCsAgents.ts` | 97 | `useCsAgents()` (list+create), `useCsAgent(id)` (get+optimistic patch) |
| `pages/customerService/useKnowledgeBaseOptions.ts` | 38 | KB multi-select options from the shared knowledge catalog |
| `pages/customerService/customerServicePages.structure.test.ts` | 88 | Source-text structure assertions (desktop-specific; do not port) |
| `pages/customerService/csChannelBots.test.ts` | 70 | Real unit tests for the pure functions — **port these** |

### Roster page (`index.tsx`)

- Header: title 客服 + subtitle + `创建客服` primary button.
- **Trust banner** — a gradient strip stating the two guarantees (three
  read-only tools / high-risk capabilities never registered). This is
  intentional product messaging, keep it on mobile.
- Card grid `repeat(auto-fill, minmax(min(320px,100%), 1fr))`. Each card shows
  name, `服务中`/`已停用` tag, model name (or `未配置模型`), and
  `{{count}} 个知识库`. Whole card is a button (`role='button'`, Enter/Space
  handled) navigating to the detail route.
- Empty state: headset circle + copy + `创建第一位客服`.

### Detail page (`CsAgentDetailPage.tsx`) — four sections

Route param is parsed through `parseCsAgentId` in a `try/catch`; a malformed id
yields the 不存在 state rather than a crash.

1. **模型与知识库** — provider `NomiSelect` + model `NomiSelect` (cascading:
   changing provider PATCHes `{provider_id, model: null}`), KB multi-select
   rendered as a `Button` trigger showing `已挂载{{count}}个`, closable KB tags
   below, and a `并发上限` `InputNumber` (min 1, max 64). **Every control here
   PATCHes immediately.**
2. **身份与话术** — `name` / `greeting` / `persona` / `service_policy` held in
   a local `draft` with an **explicit 保存 button**. The comment is explicit
   about why: *"explicit save; text fields shouldn't PATCH per keystroke"*.
3. **渠道机器人绑定** → `CsChannelBotsSection` (below).
4. **客服笔记** — Arco `Table`, `NOTE_PAGE_SIZE = 5`, columns 类型 / 内容
   (3-line clamp) / 范围 (私有|共享 tag) / 启用 (inline `Switch`) / ⋯ dropdown
   (查看 / 编辑 / 删除). One modal serves all three modes
   (`'create' | 'edit' | 'view'`). Kind is a 3-option select
   (`faq` / `script` / `fact`). The 共享 checkbox is **only editable on create**
   — *"笔记范围创建后不可修改"*.

Header also carries the 启用 `Switch` (immediate PATCH) and a danger 删除 with
`Popconfirm` warning that bindings, dialogues and private notes cascade.

### `CsChannelBotsSection.tsx` — the subtle part

A self-closed loop over the customer-service bot pool:

- Lists **only** `owner_domain === 'customer_service'` bots
  (`selectCsChannelBots`). Companion bots never enter the pool.
- Builds a full `bot → cs_agent_id` ownership map by fanning out
  `listBindings` across **every** agent, so each row can render one of three
  states: `boundToThis` (checkbox checked) / `boundToOther` (orange
  `已绑客服：{{name}}` tag) / `unbound` (grey tag).
- Toggling the checkbox calls `replaceBindings` with the **full** next id list
  (the PUT is a whole-set replacement, not a delta).
- Status tag derived from `hasToken` / `enabled` / `connected`, reusing
  `nomi.settings.remoteStatus*` i18n keys.
- In-page bot creation: platform picker modal → shared `PlatformConfigBody`
  with `channelTarget={{ channelPluginId, ownerDomain: 'customer_service' }}`.
  Crucially it **never** sends `companionId`.
- **Auto-bind by snapshot diff**: `knownIdsRef` snapshots all plugin ids when
  the create modal opens; `findNewlyCreatedCsBot` then finds the first
  CS-domain bot of that platform whose id is not in the snapshot, adopts the
  modal onto that entity and auto-binds it. The comment explains why a
  callback-based approach was rejected: *"各平台表单的 create-mode 状态解析是
  启发式的"* — so the diff is done on business UUIDs instead. `autoBoundRef`
  prevents double-binding.
- Live refresh via `ipcBridge.channel.pluginStatusChanged.on(...)`.

`csChannelBots.ts` exports the three pure functions worth porting unchanged:
`selectCsChannelBots(statuses)`, `csBotBindingState(pluginId, csAgentId,
ownerByBot)` → `{kind:'boundToThis'|'boundToOther'|'unbound'}`, and
`findNewlyCreatedCsBot(statuses, platform, knownIds)`.

---

## 3. Data hooks

All data flows through `ipcBridge.customerService.*`, which is **plain HTTP**
against the local backend (`ui/src/common/adapter/ipcBridge.ts:5799-6023`) —
no Tauri IPC, no Electron preload. That makes it directly reusable from RN.

- `useCsAgents()` → `{ agents, loading, refresh, create }`. `create` calls
  `createAgent` then `refresh()`.
- `useCsAgent(csAgentId)` → `{ agent, loading, reload, patch }`. `patch` is
  **optimistic**: it merges locally first, then on failure re-reads the
  authoritative record — *"Re-sync to the authoritative record so the UI never
  lies after a failed save."* Port this behaviour.
- `useKnowledgeBaseOptions()` → `[{value: knowledge_base_id, label: name}]`
  from `ipcBridge.knowledge.listBases` (`GET /api/knowledge/bases`).
- `useModelsForTask('chat')` (shared, `renderer/hooks/agent/useModelsForTask.ts`)
  → `groups: {provider, models[]}[]`. SWR-backed; posts
  `POST /api/model-profiles/resolve` with `{task:'chat'}` and joins against the
  provider list. Both the create modal and the detail page derive their
  provider/model selects from this.
- Notes / bindings / dialogues are called directly on `ipcBridge`, no hook.

Local state only — there is **no** Redux/Zustand store for this domain.

---

## 4. API endpoints

Router: `crates/backend/nomifun-customer-service/src/routes.rs`, mounted in
`crates/backend/nomifun-app/src/router/routes.rs:842-848` behind
`protect_instance_owner` (auth middleware + instance-owner check). Every
response is the standard envelope `{ success, data?, message? }`
(`nomifun-api-types/src/response.rs`).

| method | path | body / query | returns |
|---|---|---|---|
| GET | `/api/customer-service/agents` | — | `CsAgentRow[]` |
| POST | `/api/customer-service/agents` | `CreateCsAgentInput` (`name` required) | `CsAgentRow` |
| GET | `/api/customer-service/agents/{cs_agent_id}` | — | `CsAgentRow` |
| PATCH | `/api/customer-service/agents/{cs_agent_id}` | `UpdateCsAgentInput` (partial merge) | `CsAgentRow` |
| DELETE | `/api/customer-service/agents/{cs_agent_id}` | — | `true` |
| GET | `/api/customer-service/agents/{cs_agent_id}/bindings` | — | `CsChannelBindingRow[]` |
| PUT | `/api/customer-service/agents/{cs_agent_id}/bindings` | `{channel_plugin_ids: string[]}` | `CsChannelBindingRow[]` |
| GET | `/api/customer-service/notes` | `?cs_agent_id=` (optional) | `CsNoteRow[]` |
| POST | `/api/customer-service/notes` | `{cs_agent_id?, kind='faq', content, enabled=true}` | `CsNoteRow` |
| PATCH | `/api/customer-service/notes/{cs_note_id}` | `{kind?, content?, enabled?}` | `CsNoteRow` |
| DELETE | `/api/customer-service/notes/{cs_note_id}` | — | `true` |
| GET | `/api/customer-service/dialogues` | `?cs_agent_id=` (**required**) | `CsDialogueRow[]` |
| GET | `/api/customer-service/dialogues/{cs_dialogue_id}/messages` | — | `CsMessageRow[]` |

### Contract gotchas that will bite a fresh client

1. **PATCH `provider_id` / `model` are double-Option.** Field absent = keep;
   present-`null` = clear; present-value = set
   (`service.rs:55-58` + the `double_option` serde helper). A client that
   naively spreads `undefined` into JSON will silently fail to clear. The
   desktop UI clears deliberately: changing provider sends
   `{provider_id: <new>, model: null}`.
2. **`knowledge_base_ids` is stored as a JSON-array *string***, and the wire
   payload may arrive as either a real array or that string. The desktop
   normalizer handles both (`ipcBridge.ts:5889-5892`) — replicate it.
3. **No `id` field, ever.** `fromApiCsAgent` *throws* if the payload has an
   `id` key: `"customer-service agent wire payload must use cs_agent_id, not
   id"`. Business UUIDv7 ids only (`cs_agent_id`, `cs_note_id`,
   `cs_dialogue_id`, `cs_message_id`, `channel_plugin_id`).
4. **PUT bindings is a full-set replacement** and it *steals*: listing a bot
   currently bound to another agent re-binds it to this one (same-domain
   rebind is allowed and tested). Sending `[]` unbinds everything.
5. **PUT bindings validates ownership at the route layer** and rejects with
   400 before writing anything: unknown plugin → `"channel plugin '…' not
   found"`; companion-domain plugin → `"channel bot … belongs to the companion
   domain; create a customer-service bot instead"`. A rejected PUT writes no
   binding (explicitly tested).
6. Validation: `name` non-empty (400 `客服名称不能为空`), `max_concurrent`
   ∈ 1..=64, `audit_retention_days` ≥ 1, note `content` non-empty
   (`笔记内容不能为空`), private note must reference a live agent.
7. `list_notes` with `cs_agent_id` returns **shared + private** notes for that
   agent; omitting it returns every note.
8. Note *scope* (`cs_agent_id` null-or-not) has **no PATCH path** — it is
   immutable after creation. The UI disables the checkbox accordingly.

### Channel endpoints the feature also needs

Bot management inside the detail page uses the shared channel surface:

| method | path | note |
|---|---|---|
| GET | `/api/channel/plugins` | all plugin statuses; filter client-side by `owner_domain` |
| POST | `/api/channel/plugins/enable` | create/update. `owner_domain` is accepted **only on create** (omit `plugin_id`, pass `plugin_type`); it is mutually exclusive with `companion_id` (400 / trigger ABORT) |
| POST | `/api/channel/plugins/disable` | `{plugin_id}` |
| POST | `/api/channel/plugins/delete` | `{plugin_id}` — stops the instance, clears sessions, keeps produced dialogues |
| POST | `/api/channel/plugins/test` | credential probe |

Supported platforms (`PlatformConfigBody.tsx:46-59`): weixin, lark, wecom,
dingtalk, qqbot, telegram, discord, slack, matrix, mattermost, twitch, nostr.

Also consumed: `GET /api/knowledge/bases`, `POST /api/model-profiles/resolve`.

---

## 5. WebSocket events

**There are no customer-service-specific WS events.** The domain is entirely
request/response. The only realtime signal the feature listens to is a channel
event:

| topic | payload | consumer |
|---|---|---|
| `channel.plugin-status-changed` | `{plugin_id, status: IChannelPluginStatus}` | `CsChannelBotsSection` → full `refreshAll()` |

Adjacent channel topics that exist but are **not** used by this feature:
`channel.pairing-requested` (CS bots bypass pairing by design),
`channel.user-authorized`, `channel.weixin-login` (needed only if you port
WeChat QR bot creation), `ws.reconnected`.

Implication for mobile: **live visitor conversations do not stream.** If you
want a monitoring view you must poll `/dialogues` + `/dialogues/{id}/messages`.
Note also that WS auth on desktop relies on the `x-nomi-local-trust` header —
`EventSource`/SSE was abandoned precisely because it cannot set headers
(comment at `ipcBridge.ts:3573-3576`). Verify the mobile client's auth path
before assuming WS works.

---

## 6. Data model (SQLite, migration `018_customer_service.sql` + `020`)

| table | key facts |
|---|---|
| `cs_agents` | `cs_agent_id` UUIDv7 PK; `name`, `greeting`, `persona`, `service_policy`, `provider_id?`, `model?`, `knowledge_base_ids` (JSON string), `enabled`, `max_concurrent` (1..64, dflt 8), `audit_retention_days` (dflt 30), timestamps |
| `cs_channel_bindings` | `(cs_agent_id, channel_plugin_id)`; `channel_plugin_id` **UNIQUE** → one bot serves at most one agent |
| `cs_dialogues` | `UNIQUE(channel_plugin_id, channel_user_id, chat_id)`; `state` `open`\|`closed`; `last_activity` |
| `cs_messages` | `role` `visitor`\|`agent`\|`system`; `content`; `created_at` |
| `cs_notes` | `cs_agent_id NULL` = shared across all agents; `kind`, `content`, `enabled` |
| `cs_audit_events` | `kind` (`turn` / `turn_error`), `detail` JSON, pruned by `audit_retention_days` |
| `channel_plugins.owner_domain` | added by `020`; CHECK `('companion','customer_service')`; insert+update triggers forbid `customer_service` + non-null `companion_id` |

`provider_id` is a **logical** reference — the provider row may be deleted
afterwards (KeepHistory), so resolve at call time and tolerate a dangling id.
Provider deletion surfaces CS usage via
`CustomerServiceService::providers_in_use` →
`ProviderUsageFeature::CustomerService`.

---

## 7. i18n

`ui/src/renderer/services/i18n/locales/{zh-CN,en-US}/customerService.json` —
a self-contained namespace (`customerService.*`) covering siderTitle, title,
subtitle, status, trust, card, create, empty, fields, detail, sections,
bindings, notes. Every `t()` call in the source also carries a Chinese
`defaultValue`, so the zh-CN strings are recoverable straight from the
components. `CsChannelBotsSection` additionally borrows
`nomi.settings.remote*` keys for bot status/config/delete labels — decide
whether to copy those into the CS namespace on mobile rather than importing the
whole `nomi` namespace.

---

## 8. Recommended mobile scope

### Phase 1 — read + light edit (highest value / lowest risk)

1. Roster list (`GET /agents`) with the trust banner. Cards → detail.
2. Detail: 身份与话术 form with explicit save (`PATCH`), 启用 switch, delete.
3. 模型与知识库: provider/model cascade + KB multi-select + 并发上限.
   Requires porting `useModelsForTask('chat')` and `listBases`.
4. Notes CRUD — maps cleanly to a mobile list + bottom sheet. Remember scope
   is create-only and there is no scope PATCH.
5. Create-agent flow. On mobile prefer a full-screen form or a 2-step wizard
   over the desktop's dense single modal.

### Phase 2 — bindings, but simplified

Port the *binding* half of `CsChannelBotsSection` (list CS-domain bots,
checkbox/toggle bind via the full-replacement PUT, three-state ownership tags).
Port `csChannelBots.ts` and its test file verbatim — pure functions, no DOM.

**Defer bot creation.** In-page creation drags in `PlatformConfigBody`, twelve
platform credential forms, the WeChat QR/WS login flow, and the fragile
snapshot-diff auto-bind heuristic. On mobile, show *"在桌面端创建渠道机器人"*
for the empty pool and let mobile only bind/unbind/enable/disable/delete
existing bots. If a single platform is eventually needed, Telegram (one token
field) is the cheapest.

### Phase 3 — the gap worth filling: dialogue monitoring

`listDialogues` and `listDialogueMessages` are **defined in `ipcBridge` but
consumed by zero desktop components** (verified by grep). The backend read
surface exists and is unused. A mobile "who is my bot talking to right now"
view is therefore a genuinely new capability, not a port, and it fits a phone
far better than the desktop's config-dense layout. Poll-based; ~30s interval,
or on-focus refresh.

### Explicitly out of scope

- Any human hand-off / takeover UI — the backend has no such concept
  (`cs_messages.role` has no human-operator value beyond `system`).
- `cs_audit_events` — no REST surface exists.
- The desktop `CsAgentDetailPage.module.css` two-column grid; rebuild as a
  vertical stack of cards or tabbed sections.
- `customerServicePages.structure.test.ts` — it asserts on desktop source text
  and will not transfer.

### Porting notes

- The whole domain is **HTTP-only**; lift `ipcBridge.customerService` (~220
  lines incl. the `fromApiCs*` normalizers) nearly verbatim. Keep the
  normalizers: the `id`-rejection guard and the `knowledge_base_ids`
  string-or-array handling are real defences, not ceremony.
- Keep the optimistic-patch-then-resync semantics of `useCsAgent`.
- Respect the double-Option PATCH contract explicitly — build request bodies
  with intentional `null`s, never by spreading a partial object with
  `undefined` values.
- Keep the trust banner and the 服务策略 / 回答边界 framing. The security story
  is the product story here.
- Arco Design components (`Table`, `Select mode='multiple'`, `Popconfirm`,
  `Dropdown`, `Message`) have no RN equivalent — every one needs a native
  replacement (FlatList, bottom-sheet multi-select, Alert, ActionSheet, toast).

---

## 9. Key file paths (absolute)

Frontend:
- `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/customerService/` (all 10 files)
- `/home/rika/src/nomifun-tauri/ui/src/common/adapter/ipcBridge.ts` (lines 5799-6023 CS; 3495-3607 channel)
- `/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Router.tsx` (lines 32-33, 250-251)
- `/home/rika/src/nomifun-tauri/ui/src/renderer/components/layout/Sider/SiderNav/SiderCustomerServiceEntry.tsx`
- `/home/rika/src/nomifun-tauri/ui/src/renderer/components/channels/channelStatusSelection.ts`
- `/home/rika/src/nomifun-tauri/ui/src/renderer/components/channels/PlatformConfigBody.tsx`
- `/home/rika/src/nomifun-tauri/ui/src/renderer/hooks/agent/useModelsForTask.ts`
- `/home/rika/src/nomifun-tauri/ui/src/renderer/services/i18n/locales/zh-CN/customerService.json`
- `/home/rika/src/nomifun-tauri/ui/src/common/types/channel/channel.ts`

Backend:
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-customer-service/src/{routes,service,dialogue,tools,lib}.rs`
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-db/src/models/customer_service.rs`
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-db/src/repository/{customer_service,sqlite_customer_service}.rs`
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-db/migrations/018_customer_service.sql`
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-db/migrations/020_channel_owner_domain.sql`
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-channel/src/message_loop.rs` (CS seam, ~line 468)
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-channel/src/message_service.rs` (`CsRouting` seam trait)
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-channel/src/{action,pairing}.rs` (stranger auto-serve)
- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-app/src/router/routes.rs` (lines 842-848)

Docs:
- `/home/rika/src/nomifun-tauri/docs/guides/channels.zh.md` (lines 97-100, 155-156)
- `/home/rika/src/nomifun-tauri/docs/architecture/backend-crates.zh.md`
- `/home/rika/src/nomifun-tauri/CHANGELOG.md` (lines 507-517)
