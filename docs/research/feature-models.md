# 模型管理 (Model Management) — feature research for the React Native port

Source of truth: `/home/rika/src/nomifun-tauri` @ `3bd9a566` (v0.5.1),
`ui-api-contract-version.txt` = `16`. Read-only survey; nothing in the desktop
repo was modified.

Related desktop docs read: `docs/guides/model-routing.zh.md` (relevant — it is
the spec for the 故障转移 section) and `docs/guides/presets.zh.md` (only
tangentially relevant: presets *reference* a provider+model but own no model
CRUD; its `POST /api/presets/{id}/resolve` validates model availability).

---

## 1. What the feature actually is

**模型管理** (`/models`, `ModelHubPage`) is a **capability-first** configuration
domain. It is not a chat surface and not an "agent/engine" page — execution
engines were deliberately moved out to `/settings/execution-engines`, and there
is a bookmark-compat redirect + a regression test asserting they never come back
(`ui/src/renderer/pages/modelHub/modelConfigurationPlacement.test.ts`).

The page has **one secondary sidebar with 10 sections in 3 groups**:

| group | section key | 中文 | what it owns |
|---|---|---|---|
| 接入 | `models` | 供应商与密钥 | The ONLY write surface for providers, credentials, model rows, tasks/traits tagging, connection profiles |
| 按能力挑模型 | `chat` | 对话 | Projection of catalog rows with task `chat`; **also owns the install-wide default chat model** |
| | `asr` | 语音识别 | Global ASR model + voice-activity-detection prose |
| | `tts` | 语音合成 | Global TTS model + voice id |
| | `vision` | 视觉 | Projection: task `chat` **and** trait `vision_input` |
| | `image` | 图像生成 | Read-only projection of `image_generation ∪ image_edit` |
| | `video` | 视频生成 | Read-only projection of `video_generation` |
| | `embedding` | 嵌入与检索 | Projection of `embedding ∪ rerank` |
| 进阶 | `free` | 免费模型 | The NomiFun-managed free-model service (separate API) |
| | `failover` | 故障转移 | The global model-failover queue |

Section state syncs to `?section=`. Retired keys still resolve:
`speech → asr`, `creation → image`, `global → failover`, and
`?section=agents` hard-redirects to `/settings/execution-engines`.

### The single load-bearing architectural rule

> **供应商与密钥 is the only editor. Every other section is a projection.**

`ModalityModelsPanel.tsx` states it explicitly: task TAGGING is not in the
modality panels on purpose, because a second editor would be a second write path
for the same row. The modality panels may only toggle `enabled` and edit
`description`. `providerSectionScope.test.ts` locks this in.

Corollary for mobile: if you port only the projections, the user can look but
cannot fix anything. If you port only 供应商与密钥, everything is configurable
but "which model does voice?" has no home.

### Three data layers you must not confuse

1. **`providers`** — the account/credential entity. `(platform, name, base_url,
   api_key, bedrock_config, enabled, sort_order, is_full_url)`.
2. **`provider_models`** — the authoritative **per-model catalog row**, natural
   key `(provider_id, model)`. Carries `enabled`, `sort_order`, `tasks`,
   `traits`, `protocol`, `connection_role`, `params`, `context_limit`,
   `description`, `source`, `health`. Since migration 016 the legacy
   provider-level maps are *projections* of these rows, not storage.
3. **`model_profiles`** — `(provider_id, model) → (tasks, traits, params,
   source)`. Historically separate; today `ProviderResponse.models_detail`
   already carries the same tasks/traits, so the UI prefers `models_detail` and
   falls back to `/api/model-profiles` only for providers with no rows.

`ProviderResponse.models` (string array) and `model_context_limits` /
`model_protocols` / `model_descriptions` / `model_enabled` / `model_health`
(maps) are **read projections** of layer 2. Writing them via
`PUT /api/providers/{id}` still works (the repo syncs rows and seeds inferred
profiles), and that is exactly how "add a model to an existing provider" is
implemented today — but every *partial* per-model edit goes through
`POST /api/provider-models/update` instead, deliberately, to avoid the
read-modify-write race of PUTting a whole map.

---

## 2. File map (desktop repo, absolute paths)

### 2.1 Page shell + sections

- `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/modelHub/index.tsx` (381) — sidebar, section routing, mobile fallback
- `.../modelHub/ChatModelsContent.tsx`, `VisionModelsContent.tsx`, `EmbeddingModelsContent.tsx` — thin wrappers over `ModalityModelsPanel`
- `.../modelHub/ModalityModelsPanel.tsx` (287) — the projection panel (toggle + description + default-model row)
- `.../modelHub/modalityModels.ts` (134) — pure projection logic (`MODALITY_SPECS`, `buildModalityGroups`, `buildUntaggedGroups`)
- `.../modelHub/ImageModelsContent.tsx`, `VideoModelsContent.tsx` → `CreationModelsPanel.tsx` (172) + `creationModels.ts` (170) — read-only
- `.../modelHub/SpeechToTextContent.tsx` (167), `TextToSpeechContent.tsx` (101)
- `.../modelHub/FreeModelsContent.tsx` (570) + `useFreeModels.ts` (182)
- `.../modelHub/ModelFailoverContent.tsx` (223) + `modelFailoverQueue.ts` (34)

### 2.2 The editor (供应商与密钥)

- `/home/rika/src/nomifun-tauri/ui/src/renderer/components/settings/SettingsModal/contents/ModelModalContent.tsx` (1311) — **the whole editor**: sortable provider cards → sortable model rows, all inline popovers
- `.../contents/providerInUse.ts` — parses the 409 `PROVIDER_IN_USE` details payload into feature groups + deep-link routes
- `.../contents/modelProviderOrdering.ts` — `reorderById` / `reorderStrings`
- `/home/rika/src/nomifun-tauri/ui/src/renderer/pages/settings/components/AddPlatformModal.tsx` (996) — add provider (platform picker, base_url, keys, protocol detection, first model + its tasks)
- `.../settings/components/EditModeModal.tsx` (379) — edit provider (name/base_url/keys/models/bedrock)
- `.../settings/components/AddModelModal.tsx` (198) — add one model to an existing provider
- `.../settings/components/ApiKeyEditorModal.tsx` — multi-key list editor with per-key test
- `.../settings/components/ModelAdvancedEditor.tsx` (202) + `providerModelAdvanced.ts` — `protocol` / `connection_role` / `params`
- `.../settings/components/ProviderConnectionsSection.tsx` (408) + `providerConnectionForm.ts` — per-role connection profiles
- `.../settings/components/ContextLimitSelect.tsx` — context-window presets

### 2.3 Shared hooks / selectors

- `.../hooks/agent/useModelProviderList.ts` (71) — `PROVIDERS_SWR_KEY='providers'`, `fetchProviders`, `orderModelSelectorProviders`
- `.../hooks/agent/useModelsForTask.ts` (118) — the ONE "which models can do X" hook
- `.../hooks/agent/useModelProfiles.ts` (35) — `MODEL_PROFILES_SWR_KEY`
- `.../hooks/agent/modelProfileEditing.ts` (57) — `MODEL_TASK_ORDER`, `MODEL_TRAIT_ORDER`, upsert builder
- `.../hooks/agent/modelSelectorProviderOrdering.ts` — managed free provider ranks LAST
- `.../hooks/agent/useModelSelectorProviderLabel.ts` — free provider gets a localized label, never its raw name
- `.../components/model/TaskModelSelect.tsx` (187) + `taskModelSelectState.ts` + `ttsVoiceOptions.ts` — the shared provider+model(+voice) picker
- `.../hooks/agent/useModeModeList.ts` — anonymous fetch-models for the forms
- `.../utils/model/modelPlatforms.ts` (460) — `MODEL_PLATFORMS` (~45 presets), `NEW_API_PROTOCOL_OPTIONS`, logo resolution

### 2.4 Backend

- `/home/rika/src/nomifun-tauri/crates/backend/nomifun-system/src/routes.rs` (705) — the route table
- `.../nomifun-system/src/provider.rs` (2114) — provider CRUD, clone, validation, encryption, row projection
- `.../nomifun-system/src/provider_model.rs` (748) — row-level CRUD
- `.../nomifun-system/src/model_profile.rs` (539) — profiles + inferred seeding
- `.../nomifun-system/src/provider_connection.rs` (506) — per-role connections
- `.../nomifun-system/src/managed_model.rs` (2760) — free-model service
- `.../nomifun-api-types/src/provider.rs` (1230), `provider_model.rs` (446), `model_task.rs` (339), `model_catalog.rs` (200)
- `.../nomifun-ai-agent/src/routes/agent.rs` — `POST /api/agents/provider-health-check`
- `.../nomifun-app/src/router/model_failover.rs` — `GET|PUT /api/agent/model-failover`
- `.../nomifun-conversation/src/model_failover.rs`, `failover_seam.rs` — the runtime that consumes the queue

---

## 3. Complete endpoint inventory

Envelope: `{ success: bool, data?: T, message?: string }` — the client unwraps
`data`. Errors: `{ success: false, error, code, details? }` with an HTTP status.
**Every endpoint below is `protect_instance_owner`** (auth middleware +
installation-owner check, `crates/backend/nomifun-app/src/router/routes.rs:202`).
A companion access token is NOT the owner → 403. The QR/password login flow
described in `connectivity.md` does yield the owner, so mobile is fine.

### 3.1 Providers

| method + path | body / query | notes |
|---|---|---|
| `GET /api/providers` | — | `ProviderResponse[]`, ordered by `(sort_order, …)`. **Returns `api_key` in PLAINTEXT.** |
| `POST /api/providers` | `CreateProviderRequest` | `deny_unknown_fields`. `provider_id` optional (canonical UUIDv7); server generates if absent. 409 on duplicate id. |
| `PUT /api/providers/{id}` | `UpdateProviderRequest` | Partial. `deny_unknown_fields` — do **not** send `models_detail` / `model` / form-only fields. |
| `DELETE /api/providers/{id}` | — | 409 `PROVIDER_IN_USE` with `details.usages[]` when bound. |
| `POST /api/providers/{id}/clone` | `{ name?: string }` (body optional) | Server-side clone: provider row + every `provider_models` row (minus health) + every connection profile. |
| `POST /api/providers/{id}/models` | `{ try_fix?: bool }` | Fetch the upstream catalog for a SAVED provider. → `{ models: {id, name?}[], fixed_base_url? }` |
| `POST /api/providers/fetch-models` | `FetchModelsAnonymousRequest` = `{ platform, base_url, api_key, bedrock_config?, try_fix? }` | Pre-create preview; no provider row needed. |
| `POST /api/providers/detect-protocol` | `{ base_url, api_key, timeout?, test_all_keys?, preferred_protocol? }` | **The connectivity test.** See §5. |

`ProviderResponse` (wire, snake_case):

```
provider_id: string (uuidv7)   platform: string        name: string
base_url: string               api_key: string         models: string[]
enabled: bool                  sort_order: number      is_full_url: bool
created_at, updated_at: number (ms epoch)
model_context_limits?: Record<string, number>
model_protocols?:      Record<string, string>
model_descriptions?:   Record<string, string>
model_enabled?:        Record<string, boolean>
model_health?:         Record<string, {status, last_check?, latency?, error?}>
bedrock_config?: { auth_method: 'accessKey'|'profile', region, access_key_id?, secret_access_key?, profile? }
models_detail: ProviderModelResponse[]   // omitted when empty
```

Create/update validation (`provider.rs:530`): `platform` and `name` non-empty;
`base_url` must start with `http://` or `https://`; `api_key` non-empty —
**except** `platform === 'bedrock'`, where `bedrock_config` is required instead
and both may be blank. `model_health` on write is **accepted-and-ignored** since
P3 (the server probe is the only health writer). Providers with platform
`nomifun-free-model` are rejected by generic create/update (403).

### 3.2 Provider model rows (the per-model catalog)

| method + path | body | notes |
|---|---|---|
| `GET /api/provider-models[?provider_id=…]` | — | `ProviderModelResponse[]` |
| `POST /api/provider-models` | `CreateProviderModelRequest` | Empty `tasks` → server seeds the heuristic profile with `source='inferred'`; non-empty → `source='user'`. 404 if provider missing, 409 on duplicate `(provider_id, model)`. |
| `POST /api/provider-models/update` | `UpdateProviderModelRequest` | Partial by natural key. `protocol` / `connection_role` / `context_limit` / `description` are **double-Option**: field absent = keep, `null` = clear, value = set. |
| `POST /api/provider-models/delete` | `{ provider_id, model }` | |

`ProviderModelResponse`:

```
provider_id, model, enabled: bool, sort_order: number,
tasks: ModelTask[], traits: ModelTrait[],
protocol?: string, connection_role?: string, params: unknown,
context_limit?: number, description?: string,
source: 'inferred' | 'user',
health?: {status:'unknown'|'healthy'|'unhealthy', last_check?, latency?, error?},
health_checked_at?: number, created_at: number, updated_at: number
```

### 3.3 Model profiles + the capability resolver

| method + path | body | notes |
|---|---|---|
| `GET /api/model-profiles` | — | `ModelProfile[]` |
| `POST /api/model-profiles` | `{ provider_id, model, tasks[], traits[], params?, source? }` | `source` defaults to `user` (this is the user-edit path). |
| `POST /api/model-profiles/delete` | `{ provider_id, model }` | |
| `POST /api/model-profiles/resolve` | `{ task: ModelTask, required_traits?: ModelTrait[] }` | → `{ models: {provider_id, model}[] }` |

`resolve` is the **authority for every model selector**. Semantics
(`model_catalog.rs:52`): skips disabled providers and disabled models; stored
profile wins; a model with no profile falls back to the name/platform heuristic
so results are never empty before backfill. Note it returns **enabled rows
only** — which is exactly why the management projections read
`GET /api/provider-models` instead (a management view must show a disabled row,
otherwise its own toggle could turn a model off and then lose it).

Vocabulary (`model_task.rs`):

```
ModelTask  = chat | image_generation | image_edit | video_generation
           | speech_synthesis | speech_recognition | embedding | rerank
ModelTrait = vision_input | function_calling | reasoning | web_search
```

Display order used by the editors (`modelProfileEditing.ts`) is exactly the
`ModelTask` order above and the `ModelTrait` order above. i18n keys:
`settings.modelTask.{task}`, `settings.modelTrait.{trait}`.

### 3.4 Per-role connection profiles

| method + path | body | notes |
|---|---|---|
| `GET /api/providers/{id}/connections` | — | `ProviderConnectionResponse[]`, role-ordered |
| `POST /api/providers/{id}/connections` | `UpsertProviderConnectionRequest` | Upsert by `(provider_id, role)` |
| `DELETE /api/providers/{id}/connections/{role}` | — | |

```
ProviderConnectionResponse = { connection_id, provider_id, role, label?,
  base_url, auth_scheme, has_credentials: bool, is_full_url: bool,
  extra: unknown, created_at, updated_at }
UpsertProviderConnectionRequest = { role, label?, base_url, auth_scheme?,
  credentials?: unknown, is_full_url?, extra? }
```

Rules: `role` must match `^[a-z][a-z0-9_-]{0,31}$` and **`default` is reserved**
(the provider row itself is the default connection). Credentials are
**write-only** — never echoed; omitting `credentials` on update keeps the stored
ciphertext. Auth-scheme presets and their credential shapes
(`providerConnectionForm.ts`):

| scheme | credentials JSON |
|---|---|
| `bearer`, `token`, `header_key:*`, `query_key:*` | `{ api_keys: string[] }` |
| `volc_voice` | `{ app_key, access_key, resource_id }` — all three required together |
| anything else | raw non-empty JSON object |

Ark / Volcengine platforms need a dedicated `role: voice` connection because the
volc voice API lives on another host with its own scheme.

### 3.5 Connectivity / health

| method + path | body | notes |
|---|---|---|
| `POST /api/providers/detect-protocol` | see §3.1 | pre-save credential + protocol probe |
| `POST /api/agents/provider-health-check` | `{ provider_id, model, task? }` | **real inference** through the model. `task` omitted → the model's stored primary task, falling back to Chat. |

`ProviderHealthCheckResponse = { provider_id, platform, model, status:
'unknown'|'healthy'|'unhealthy', elapsed_ms, message?, error_kind?, http_status?,
timeout_stage? }`. `error_kind` ∈ `timeout | invalid_authorization_header |
unauthorized | forbidden | not_found | insufficient_quota | aws_credentials |
invalid_request | rate_limited | …`.

The probe **persists** the result into the model's catalog row, so the UI just
re-fetches `/api/providers` afterwards — it must NOT PUT the health map back
(the desktop code has an explicit comment that this redundant write was removed).

### 3.6 Free (NomiFun-managed) model service

| method + path | body | notes |
|---|---|---|
| `GET /api/model-services/free/status` | — | `ManagedModelServiceStatus` |
| `GET /api/model-services/free/models` | — | `ManagedModel[]` |
| `POST /api/model-services/free/refresh` | — | re-fetch upstream catalog → status |
| `POST /api/model-services/free/activate` | `{ enabled }` | master switch → status |
| `PATCH /api/model-services/free/models/{model_id}` | `{ enabled }` | → status |
| `GET /api/model-services/free/health` | — | `ManagedModelHealthResult[]` snapshot |
| `POST /api/model-services/free/health` | — | probe ALL → `ManagedModelHealthBatchResult` |
| `POST /api/model-services/free/models/{model_id}/health` | — | probe one |

```
ManagedModelServiceStatus = { protocolVersion, providerId|null, enabled, ready,
  upstream, models: {id,name,enabled,source}[], lastRefresh|null, lastError|null,
  automaticRefresh, refreshIntervalMs, nextRefresh|null, privacyNotice,
  availability: 'unverified'|'ready'|'degraded' }
```

Note this is the one **camelCase** wire shape in the whole feature. Every
mutation returns the complete latest status, so the client installs the response
optimistically and then also revalidates `providers` + `model-profiles` (the free
provider is projected into every selector). Desktop polls status every 60 s.

**Privacy rule the desktop enforces deliberately**: never surface the backend
`source` string, the upstream URL, or raw upstream errors. `FreeModelsContent`
maps every source to the constant alias `'oc'`. Copy this.

### 3.7 Global defaults (client preferences)

| method + path | notes |
|---|---|
| `GET /api/settings/client` | whole map, or `?key=…` |
| `PUT /api/settings/client` | batch `{ [key]: value }`; `null` deletes the key |

Keys owned by this feature (`ui/src/common/config/configKeys.ts`):

| key | value | written by |
|---|---|---|
| `nomi.defaultModel` | `{ provider_id, model }` | 对话 section (`ModalityModelsPanel`), onboarding |
| `tools.textToSpeech` | `{ provider_id, model, voice: string\|null }` | 语音合成 section |
| `tools.speechToText` | `{ enabled, provider, provider_id, model, language }` | 语音识别 section |
| `nomi.collaborationModels` | `{provider_id, model}[]` | conversation surfaces (not this page) |
| `knowledge.autogenModel`, `tools.imageGenerationModel` | `{provider_id, model}` | other features |

Two gotchas:

1. Some of these keys are registered backend-side as **required Provider
   references**. Writing a `{provider_id, model}` that does not exist returns
   **409 Conflict**, and a mixed batch is **not partially persisted**
   (`client_pref.rs` test `provider_reference_conflict_is_not_reported_as_internal_error`).
   So "no default" must be expressed by *deleting the key* (`null`), never by
   writing a half-empty object — `saveTextToSpeechConfig` does exactly that.
2. Keys prefixed `managedModel.` or `agent.browserUse.displayMode` are
   system-reserved → 403 from this endpoint.

### 3.8 Failover queue

| method + path | body | notes |
|---|---|---|
| `GET /api/agent/model-failover` | — | `ModelFailoverConfig`; defaults to disabled when unset/malformed |
| `PUT /api/agent/model-failover` | `ModelFailoverConfig` | echoes back the saved value |

```
ModelFailoverConfig = { enabled: bool (default false),
  queue: { provider_id, model, use_model? }[],
  max_switches: number (default 4, UI clamps 1..20),
  stamp_unhealthy: bool (default true) }
```

`deny_unknown_fields`, and every queue entry's `provider_id` must be a canonical
UUIDv7 or the whole PUT fails deserialization. Stored as one JSON blob under the
`agent.model_failover` client preference. Per `docs/guides/model-routing.zh.md`:
this is a **failover queue, not a multi-credential round-robin pool**; it only
affects **Nomi-engine sessions** (ACP/CLI agents call providers inside their own
runtime), and IDMM's fault watch can reuse it. The doc explicitly disclaims an
older version of itself that described it as round-robin routing.

### 3.9 Not part of this feature (checked, excluded)

`/api/agents*` (execution engines), `/api/presets*`, `/api/idmm*`,
`/api/system/*`, `connection_test_routes` (Bedrock/Gemini wizard probes used by
onboarding).

---

## 4. The editor UI, concretely (what a mobile port would have to reproduce)

`ModelModalContent` is a **two-level sortable list**. Provider card header:

- drag handle (provider priority → `PUT /api/providers/{id}` with `sort_order`
  for every changed row, in parallel)
- provider name
- `模型数（N）` (click = expand) `|` `密钥数（M）` (click = open edit dialog);
  M = `api_key.split(/[,\n]/)` non-blank count
- provider `enabled` switch → `PUT {enabled}` (semantically the provider itself;
  it explicitly no longer bulk-flips `model_enabled`)
- buttons: `+` add model · `−` delete provider · ✎ edit provider · ⧉ clone

Model row (each control is a separate write):

| control | write |
|---|---|
| drag handle | `provider-models/update {sort_order}` per changed row |
| health dot (hidden when `unknown`) + tooltip latency/error/last_check | read-only |
| model name | — |
| task badges (`chat` neutral grey, others purple) | read-only, from `tasks` |
| New-API protocol tag (click cycles openai→gemini→anthropic) | `provider-models/update {protocol}` |
| context-limit popover (presets 默认200k/32k/64k/128k/200k/1M + custom) | `{context_limit: n \| null}` |
| 模态能力 popover: multi-select tasks + 4 trait checkboxes; shows a 系统推断 tag when `source==='inferred'`; saving converts to `user` | `POST /api/model-profiles` upsert, then revalidate profiles + providers |
| 高级 popover: `protocol` select, `connection_role` select (from that provider's connections), `endpoint`, `request_shape` (json/multipart), rest-of-`params` raw JSON | `provider-models/update {protocol, connection_role, params}` |
| model `enabled` switch | `{enabled}` |
| 描述 popover (drives collaboration auto-selection) | `{description: text \| null}` |
| 心跳 button | `POST /api/agents/provider-health-check {provider_id, model, task: primaryTask}` then revalidate |
| 删除 button | `provider-models/delete` |

Then a **连接档案** section per provider (`ProviderConnectionsSection`) with an
add/edit drawer.

Known `protocol` values (`providerModelAdvanced.ts`, mirroring
`nomifun-model-invoke/src/routes_table.rs`): `openai.images`, `openai.videos`,
`openai.chat_text`, `openai.embeddings`, `openai.audio_speech`,
`openai.audio_transcriptions`, `gemini.generate_content`,
`gemini.generate_text`, `deepgram.listen`, `ark.images`, `ark.video_jobs`,
`volc.asr_file`. Empty = auto-route by task.

### 4.1 Add-provider flow (`AddPlatformModal`, 996 lines — the heaviest form)

1. **Platform select** from `MODEL_PLATFORMS` (~45 presets with logos + preset
   `base_url`): Custom, New API, Gemini, Gemini Vertex AI, OpenAI, Anthropic,
   AWS Bedrock, DeepSeek, MiMo (+3 token-plan regions), MiniMax (+Code/Plan),
   Novita, OpenRouter, Dashscope (+Coding), SiliconFlow (CN/global), Zhipu, GLM
   Coding Plan, Moonshot (CN/global), xAI, Ark/Doubao (+Coding/Agent Plan),
   Qianfan (+Coding), Hunyuan, Lingyi, Poe, PPIO, ModelScope, InfiniAI, Ctyun,
   StepFun, StepFun Step Plan.
2. **Name** — auto-filled from the platform, but forced blank + required for
   `custom` and `new-api` (one aggregator gateway hosts many vendors).
3. **Base URL** — shown for custom / new-api / gemini only; has a tips popover
   listing every preset's URL; a `fixed_base_url` returned by fetch-models is
   surfaced as a **suggestion the user may dismiss**, never auto-applied.
4. **API key** (multi-key, comma/newline) with the `ApiKeyEditorModal` sub-modal
   (per-key test / test-all / delete-invalid).
5. **Protocol auto-detection** — debounced 1000 ms, 10 s timeout, only when the
   platform is Custom or the base_url is non-official. Renders detected
   protocols (an aggregator can serve several), a switch-platform suggestion,
   and multi-key valid/invalid counts.
6. **First model** (from anonymous fetch-models, `allowCreate`), its
   context-limit, its tasks + a `vision_input` checkbox, and for new-api its
   per-model protocol (auto-guessed from the model name prefix).
7. **Save** = pre-save key probe (skipped for Bedrock, `is_full_url`, and the
   subscription-plan gateways in `PLATFORMS_WITHOUT_MODELS_ENDPOINT` plus
   `stepfun`, whose base URLs have no `/models`) → `POST /api/providers` →
   `POST /api/model-profiles` for the first model.

`is_full_url` means "this base_url is the complete endpoint; do not append a
path" — it also disables auto model-fetching.

---

## 5. Connectivity test — there are THREE, and they are not interchangeable

| # | endpoint | what it proves | where used |
|---|---|---|---|
| 1 | `POST /api/providers/detect-protocol` | this `(base_url, api_key)` pair authenticates and speaks protocol X; can test every key of a multi-key string | pre-save validation in Add/Edit provider, per-key test in the key editor |
| 2 | `POST /api/providers/fetch-models` (anonymous) / `POST /api/providers/{id}/models` | the catalog endpoint is reachable; also yields the model dropdown and a `fixed_base_url` suggestion | the forms |
| 3 | `POST /api/agents/provider-health-check` | a **real inference call** at the right endpoint for the model's task succeeded; writes `health` onto the row | the 心跳 button per model row |

Test #1 is implemented as an OpenAI-style `/models` probe, which is why it
**404s on subscription-plan gateways** and would wrongly reject a valid key —
hence `platformSkipsPreSaveKeyProbe()`. For those platforms #3 is the only
correct validation. Any mobile port must keep that carve-out or users of
Ark/MiniMax/GLM/Qianfan/Dashscope coding plans and StepFun cannot save a
provider at all.

The managed free service has its own fourth probe (§3.6) with its own error
kinds (`service_disabled | model_disabled | busy | timeout | unavailable |
invalid_response | unknown`).

---

## 6. Default model selection

Two distinct mechanisms, do not merge them:

- **Install-wide defaults** = client-preference keys (§3.7). Only 对话 (`nomi.defaultModel`),
  语音识别 and 语音合成 have one. Every other modality panel renders the row
  "这一类没有全局默认，由用到它的功能各自选择。" That is a product decision, not
  an omission.
- **Per-surface selection** = `TaskModelSelect`, used everywhere (companion
  model, customer-service agent model, knowledge autogen, workshop, failover
  queue…).

`TaskModelSelect` behaviour worth copying verbatim:

- Candidates from `useModelsForTask(task, traits)` → `POST /api/model-profiles/resolve`.
- Provider list = enabled providers ordered by `orderModelSelectorProviders`,
  which forces the managed free provider **last** (the backend returns it first
  because it is auto-created before the user configures anything).
- A **stale saved reference is rendered as an explicit disabled
  "(不可用)" option plus a warning line**, never silently blanked — so the user
  sees what they had and is told to re-pick.
- Both `useModelProviderList` and `useModelsForTask` treat "request errored,
  data undefined" as **catalog unresolved, not empty**, precisely so consumers
  never purge persisted model references after a transient failure. This is a
  real footgun the desktop already stepped on; keep the guard.
- The voice field for `speech_synthesis` is free text with suggestions
  (`ttsVoiceOptionsFor(platform)`).

---

## 7. Mobile-appropriate vs. desktop-only

### Ship (high value, no host coupling)

- Provider list, enable/disable, delete (with the 409-in-use dialog).
- Provider add/edit incl. multi-key management and connectivity test #1/#2.
- Per-model row: enable toggle, health-check button + health dot, description,
  context limit, tasks/traits tagging, delete.
- 对话 / 视觉 / 嵌入 projections with the enable toggle.
- 语音识别 / 语音合成 global model pickers.
- Default chat model.
- 免费模型: master switch, per-model switch, refresh, health check.
- Failover queue.

### Second wave

- 图像生成 / 视频生成 (read-only lists — low value until the mobile app can
  actually generate).
- 连接档案 (per-role connections) — a real drawer with three credential shapes;
  only Ark/Volc voice users need it.
- 高级 per-model editor (`protocol` / `endpoint` / `request_shape` / raw JSON
  params) — power-user, and a raw-JSON editor on a phone is unpleasant.
- Provider clone.

### Do NOT port

- **Drag-and-drop reordering** of providers and models (`@dnd-kit`). It is pure
  desktop pointer/keyboard affordance. If ordering matters on mobile, use
  explicit 上移/下移 buttons like `ModelFailoverContent` already does — that
  component is your template, it is DnD-free by design.
- The resizable secondary sidebar (`useResizableSplit`, persisted px width).
  `ModelHubPage` already degrades to a flat horizontal `SegmentedTabs` when
  `isMobile` — 10 flat tabs is a lot; consider a grouped list screen →
  push-navigation instead.
- Deep-link provider prefill (`nomifun://` `consumePendingDeepLink`) unless you
  also port the desktop protocol handler.
- Arco popovers-inside-collapse-inside-sortable: on mobile every popover should
  become a bottom sheet or its own screen. A model row has **9** interactive
  controls; they will not fit on one line.

### Guard rails for a remote mobile client

1. **`GET /api/providers` returns every API key in plaintext.** Do not log it,
   do not cache it in AsyncStorage, mask it in the UI (`密钥数（N）` + an editor
   that only shows a key when the user taps 编辑), and never put a provider
   object into a crash report. Note the desktop repo's own memory note
   (`ux-over-strict-security`) says credentials are meant to be stored — that is
   about the *desktop* keeping them; it is not licence to persist them on a
   phone that leaves the LAN.
2. **All of it is owner-only.** If the mobile session was established with a
   companion token rather than an owner login, hide the whole 模型管理 tab
   rather than letting every request 403.
3. **CSRF**: per `connectivity.md` §6.5, native writes need the CSRF
   double-submit header. Every mutation here is POST/PUT/PATCH/DELETE, so this
   feature is 100% blocked if that is not solved first.
4. `provider_id` must be a **canonical UUIDv7** on every wire boundary; the
   backend rejects `"openai"`-style ids with a deserialization error. Generate
   with a uuidv7 helper client-side (the desktop does: `parseProviderId(uuidv7())`).
5. Request DTOs are `deny_unknown_fields`. Build request bodies from explicit
   field lists; never spread a UI record into a PUT.

---

## 8. Recommended mobile scope (concrete)

**Phase 1 — "can I use my models at all?" (one screen + two sheets)**

1. Screen `模型` → provider list (`GET /api/providers`), each row: name,
   platform, model count, enabled switch, chevron.
2. Provider detail screen: credentials summary (masked), model rows with
   `enabled` switch + 心跳 button + health dot, delete-model swipe.
3. Sheet 添加供应商: platform picker → base_url (prefilled) → api_key →
   fetch-models dropdown → first model → tasks multi-select. Keep protocol
   detection but make it explicit ("测试连接" button) rather than
   debounce-on-type — mobile keyboards + a 1 s debounce means many probes.
4. Sheet 编辑供应商: name / base_url / api_key / models / enabled.
5. Delete provider with the 409 `PROVIDER_IN_USE` dialog (parse
   `details.usages[]`, list them by feature; the deep-link "前往处理" button can
   be dropped in phase 1).

Endpoints: `GET/POST/PUT/DELETE /api/providers`, `POST /api/providers/fetch-models`,
`POST /api/providers/detect-protocol`, `POST /api/provider-models/update`,
`POST /api/provider-models/delete`, `POST /api/model-profiles`,
`POST /api/agents/provider-health-check`.

**Phase 2 — "which model does what?"**

6. 用途 tab with 对话 / 视觉 / 语音识别 / 语音合成 / 嵌入 sub-screens, each a
   `GET /api/provider-models` projection with the enable toggle + description.
7. Default chat model + TTS/ASR defaults via `PUT /api/settings/client`
   (remember: delete the key to clear, and handle 409 on a dead reference).
8. A reusable `TaskModelSelect` equivalent backed by
   `POST /api/model-profiles/resolve`, including the stale-reference rendering
   and the "error ⇒ unresolved, not empty" guard.

**Phase 3 — 进阶**

9. 免费模型 screen (status card + model list with switches + 检测可用性), with
   the source-aliasing privacy rule.
10. 故障转移 screen — nearly a straight port, it is already DnD-free
    (up/down/remove buttons) and only needs `TaskModelSelect`.

**Explicitly out of scope**: reordering, 连接档案, per-model 高级 params,
图像/视频 read-only lists, provider clone, deep-link prefill.

---

## 9. Gotchas found in the code (copy, don't rediscover)

1. `UpdateProviderModelRequest`'s nullable fields are **tri-state**. Sending
   `{context_limit: undefined}` keeps the old value; you must send `null` to
   clear. Same for `protocol`, `connection_role`, `description`.
2. `PUT /api/providers` with a whole map is a read-modify-write race — the
   desktop moved every per-model edit to `provider-models/update` for exactly
   this reason (comment at `ModelModalContent.tsx:~545`). Do not regress.
3. `model_health` sent on provider create/update is silently ignored. The only
   health writer is the server probe.
4. After a health check, **refresh the provider projection** — do not merge the
   response into a local health map and PUT it back.
5. Provider reorder must preserve the managed free provider's slot: the desktop
   refills only editable slots and assigns their *full-list* index as
   `sort_order` to avoid colliding with the protected managed row.
6. `sort_order` is validated server-side; negative values are rejected
   (`provider_routes.rs` tests a `-1` rejection).
7. A row with `tasks: []` belongs to **no** modality and is invisible in every
   selector. The chat section therefore renders an extra "还没有任务标签的模型"
   bucket (`buildUntaggedGroups`) so those rows are reachable. Port that bucket
   or those models are unfixable from mobile.
8. `视觉` is a **trait-filtered `chat` projection**, not its own `ModelTask` —
   because `ModelTrait::VisionInput` modifies `ModelTask::Chat` in the backend
   vocabulary. Do not invent a `vision` task.
9. `图像生成` folds `image_edit` into it (an edit-capable model can also
   produce images), so the image picker offers both.
10. `derive_tasks_and_traits(platform, model)` is a **seed, not the authority**.
    `platform === 'stepfun-plan'` forces image tasks regardless of the model
    name. Once a row exists (especially `source='user'`) the stored profile wins.
11. Free-model service replies are camelCase while everything else is
    snake_case. One normalizer per API family, not one global one.
12. `Message`/toast copy for a failing free-model action must stay generic
    (`操作失败，请稍后重试`) — the desktop deliberately does not surface upstream
    error text there.

---

## 10. Doc vs. code drift

- `docs/guides/model-routing.zh.md` (48 lines) is accurate and self-aware — it
  ends by disowning its own previous version ("本页旧版本曾把该功能描述成多凭据
  round-robin 路由。那不是当前实现"). Trust it. It does not mention
  `max_switches` / `stamp_unhealthy`, which are real config fields; take those
  from `nomifun-api-types/src/idmm.rs:703`.
- `docs/guides/presets.zh.md` (86 lines) is accurate for presets and correctly
  links model-routing as related. It has **no** provider/model-CRUD content —
  presets only *reference* `(provider_id, model)` and snapshot the resolved
  choice into an immutable `ResolvedPresetSnapshot`. Nothing in the model-hub
  port depends on it.
- There is **no** dedicated guide for 模型管理 itself. The prose that exists is
  in the i18n bundle (`settings.modelHub.*` in
  `ui/src/renderer/services/i18n/locales/zh-CN/settings.json`) and in the
  file-header comments of `modelHub/index.tsx`, `ModalityModelsPanel.tsx`,
  `modalityModels.ts` and `SpeechToTextContent.tsx` — those headers are the de
  facto spec and are worth reading in full before implementing.
