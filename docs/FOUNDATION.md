# Foundation contract (for feature implementers)

This app is a thin React Native (Expo SDK 57, expo-router, RN 0.86, React
19) client for the nomifun desktop server. TypeScript strict; path alias
`@/*` → `src/*`. All UI text is Chinese-first via i18next.

## Data layer

```ts
import { api, rawRequest, apiFetcher } from '@/api/client';
```

- `api<T>(path, opts?)` — calls `/api/*`, injects the connection's bearer credential,
  unwraps the `{success, data, message}` envelope,
  throws `ApiError` (message from server) on failure. `opts.method`,
  `opts.body` (JSON-serialized). GET by default; POST when `body` given —
  pass `method` explicitly for PUT/PATCH/DELETE.
- `rawRequest<T>(path, opts?)` — same but returns the raw JSON (for non-envelope
  endpoints like auth).
- Web requests use same-origin `/api/...`; native requests use the active
  connection's base URL. Never embed a desktop address in a feature.
- Non-JSON responses and malformed API envelopes throw `INVALID_API_RESPONSE`.
  Data-bearing endpoint adapters validate their DTO before publishing it;
  a missing `items` field is a protocol error, not an empty list.
- SWR is configured per connection epoch with `apiFetcher`, so
  `useSWR<T>('/api/whatever')` just works; the key IS the path. Use
  the active provider's `mutate` for these queries. Session entities and their
  list have a dedicated owner described below.
- Rejected or revoked credentials are handled globally (store changes → router
  returns to /connect). An ordinary permission-denied 403 remains a feature error.
- Server rows use snake_case business ids (`conversation_id`, `cs_agent_id`,
  never `id`). Bodies with unknown fields are often rejected
  (`deny_unknown_fields`) — send exactly the documented fields.

## Connection identity

The connection protocol is v2. Every phone pairing, password login and setup
request carries the independently persisted, Desktop-scoped `installation_key`.
`src/api/device-identity.ts` owns Keychain/Keystore storage on native and
a single IndexedDB store on H5; connection metadata, logout and local forget
actions must not own or delete it. `device-identity-core.ts` merges native
initialization; `device-identity-indexeddb.ts` uses an atomic read/write
get-or-create transaction across same-origin tabs. Neither returns an identity
before its storage commit succeeds. Web has no localStorage or temporary-key
fallback when IndexedDB is unavailable.

Native randomness uses the existing Expo Core OS UUID v4 generator twice
(244 random bits); Web uses `crypto.getRandomValues`, including on HTTP LAN
origins. Missing secure randomness or unreadable storage fails before auth.
Device names are labels, never identity or deduplication keys. A fresh
registration rotates the credential while retaining the same installation's
device ID. An old device token is a claim proof only for the same Desktop;
never send the active Desktop's token to a different target during login.

## Session data ownership

`SessionDataProvider` in the authenticated layout owns one `createSessionData`
instance for the current connection epoch. The session list, navigation,
project-directory shortcuts, voice session selector and detail headers all
read the same catalog and entity map.

```ts
import { useSessionData, useSessionDetail } from '@/features/sessions/provider';
// useSessionList from features/sessions/list-context is an alias of useSessionData.
const sessions = useSessionData();
const detail = useSessionDetail(conversationId);
```

- Use `sessions.create`, `patch`, `remove` and `setModel` for UI commands. These
  apply committed server projections to the shared entities and reconcile the
  list. Do not add another list cache, detail-row SWR query, or substring-based
  cache invalidation in a screen.
- A successful create returns `{conversation_id, epoch}` from the durable POST
  receipt. Navigate using that ID. Projection reads have their own loading and
  error states; a failed follow-up GET does not turn the committed create into
  a failure. The owner retains one idempotency key for uncertain retries.
- `catalog.ts` owns list IDs, entities, pagination and request generations.
  Only one older-page request runs at a time. Refresh reads the first page
  independently, then replaces the old page window. Changes during a read latch
  another read instead of being dropped. Preserve the server's row order.
- Detail observations update the same entities without adding unknown IDs to
  list membership. Runtime status comes from these authoritative rows, without
  persistent client-side generating overrides.
- Connection changes dispose the old owner. Requests carry `expectedEpoch`;
  aborted or late responses from the previous owner cannot populate the new one.
- Filters and recent-project shortcuts operate on the loaded window. The voice
  selector and list can request more pages; recent shortcuts are not a complete
  project registry. There is no mobile project database.
- Message history and streaming remain in `useChatSession`; they are separate
  from the session-row catalog.

## Realtime

```ts
import { useWsTopic, useWsStatus } from '@/hooks/use-ws';
import { nomifunSocket } from '@/api/ws';
```

- `useWsTopic('topic.name' | ['a','b'], handler)` — subscribe while mounted.
- Envelope is `{name, data}`; handlers receive `data` only.
- `ws.ready` is a local signal for every successful socket opening;
  `ws.reconnected` signals recovery after a delivery gap. Neither is a server
  domain event. The server does not replay missed events.
- `attachSessionSync` subscribes before starting its first snapshot. Socket
  readiness/recovery, list or agent metadata changes, turn lifecycle events and
  foreground recovery reconcile the shared session owner. Screens do not each
  install their own session-list subscription.
- `useWsStatus()` → `'idle'|'connecting'|'open'|'reconnecting'` for banners.

## Metro module identity

SWR's provider, hooks and cache registry must resolve to one module instance.
`metro.config.js` normalizes the public `swr` and `swr/*` exports to their
CommonJS family before delegating to Metro. Keep package exports enabled for
other dependencies; do not import SWR's private hashed `dist` files.

`bun test tests/cache-module-identity.test.mjs` exercises the real Metro resolver
and React provider/consumer hooks in an isolated Node process. It reproduces the
original ESM/CJS split and checks that the configured provider, fetcher, cache
and mutator share identity.

For changes to native bundling, export the actual Android graph as well:

```sh
bunx expo export --platform android --output-dir /tmp/nomifun-native-cache-check --no-bytecode --no-minify --source-maps --max-workers 2
node scripts/check-cache-module-graph.mjs --compare --source-map /path/to/emitted/android/entry-HASH.js.map
```

Pass the `.js.map` path printed by the export. The check rejects a graph with
multiple SWR contexts. This validates native JavaScript resolution; device
installation and UI acceptance are separate checks.

## UI kit (`@/components/ui`)

`Screen` (page wrapper: safe area, bg, web max-width; `scroll={false}` for
FlatList screens; `refreshing/onRefresh` wired to pull-to-refresh),
`Card`, `SectionTitle`, `Button` (primary/secondary/danger/ghost, `loading`),
`TextField` (label/hint/error), `Tag` (tone: primary/success/warning/danger/
neutral), `ListRow` (title/subtitle/left/right/chevron/onPress/onLongPress),
`Avatar` (monogram), `EmptyState`, `ErrorState` (message+onRetry), `Loading`,
`toast.success/error/info(text)`.

Theme: `useTheme()` → `{colors, scheme}`; tokens in `@/constants/theme`
(`Spacing`, `Radius`, `FontSize`, `Palette`). NEVER hardcode hex colors in
screens — use `colors.*`. Icons: `@expo/vector-icons` `Ionicons` only.

## Routing (expo-router, file-based)

- Authenticated screens live under `src/app/(app)/`; tabs under
  `src/app/(app)/(tabs)/`. Files there are auto-guarded (redirect to /connect
  when logged out).
- Detail screens: create e.g. `src/app/(app)/session/[id].tsx`; read params
  via `useLocalSearchParams<{id: string}>()`.
- Set the header title INSIDE your screen component:
  `<Stack.Screen options={{ title: ... }} />` (import Stack from expo-router).
- Navigation: `router.push('/session/abc')`.

## i18n

- Add strings to the feature namespace files:
  `src/i18n/locales/zh-CN/<ns>.json` + `src/i18n/locales/en-US/<ns>.json`.
  zh-CN is the primary language — write it first,
  en-US must have the same keys.
- Usage: `const { t } = useTranslation('<ns>');` — shared strings come from
  the `common` namespace (`useTranslation('common')` or `t('actions.save',
  {ns:'common'})`): actions.save/cancel/delete/create/retry/refresh/send…,
  state.loading/empty/error, feedback.saved/deleted/requestFailed,
  confirm.deleteTitle/irreversible, time.justNow/minutesAgo/hoursAgo/daysAgo.

## Conventions

- Feature logic belongs in `src/features/<feature>/`: typed endpoint adapters,
  the feature's state owner/hooks, and components. Screens in `src/app/` stay thin.
- Keep optimistic presentation in the relevant feature owner. Session-row
  updates use committed projections; failures surface inline as well as in a
  toast when a native modal could cover the toast.
- Dates: `dayjs` is installed. Relative times via common time.* keys are fine.
- Markdown (chat): `react-native-markdown-display` is installed.
- Destructive actions need confirmation (Alert on native, window.confirm on
  web — see `(tabs)/more.tsx` for the pattern).
- Pull-to-refresh on every list screen; EmptyState with a helpful hint; error
  states always offer retry. Loading skeletons optional, `Loading` suffices.
- Design: mobile-first, generous touch targets (min 44px), one primary action
  per screen. This is a companion app to a desktop product — read-and-monitor
  first, light editing second. When the desktop does something mobile can't,
  show a hint like „请在桌面端操作" rather than a broken control.
- Follow `AGENTS.md` for repository scope and efficient local validation. Choose
  checks for the changed behavior; documentation-only edits do not need a build.
