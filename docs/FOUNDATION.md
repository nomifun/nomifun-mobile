# Foundation contract (for feature implementers)

This app is a thin React Native (Expo SDK 57, expo-router v6, RN 0.86, React
19) client for the nomifun desktop server. TypeScript strict; path alias
`@/*` → `src/*`. All UI text is Chinese-first via i18next.

## Data layer

```ts
import { api, rawRequest, apiFetcher } from '@/api/client';
```

- `api<T>(path, opts?)` — calls `/api/*`, injects `Authorization: Bearer`,
  CSRF pair on writes, unwraps the `{success, data, message}` envelope,
  throws `ApiError` (message from server) on failure. `opts.method`,
  `opts.body` (JSON-serialized). GET by default; POST when `body` given —
  pass `method` explicitly for PUT/PATCH/DELETE.
- `rawRequest<T>(path, opts?)` — same but returns the raw JSON (for non-envelope
  endpoints like auth).
- SWR is configured globally with `apiFetcher`, so
  `useSWR<T>('/api/whatever')` just works; the key IS the path. Use
  `mutate(key)` for invalidation.
- 403 auth-expiry is handled globally (store resets → router returns to
  /connect). Don't handle it per-feature.
- Server rows use snake_case business ids (`conversation_id`, `cs_agent_id`,
  never `id`). Bodies with unknown fields are often rejected
  (`deny_unknown_fields`) — send exactly the documented fields.

## Realtime

```ts
import { useWsTopic, useWsStatus } from '@/hooks/use-ws';
import { nomifunSocket } from '@/api/ws';
```

- `useWsTopic('topic.name' | ['a','b'], handler)` — subscribe while mounted.
- Envelope is `{name, data}`; handlers receive `data` only.
- After every reconnect the synthetic topic `'ws.reconnected'` fires — treat
  it as "refetch everything" (there is NO server-side replay).
- `useWsStatus()` → `'idle'|'connecting'|'open'|'reconnecting'` for banners.

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
  DO NOT edit `(app)/_layout.tsx` or `(tabs)/_layout.tsx`.
- Navigation: `router.push('/session/abc')`.

## i18n

- Fill ONLY your namespace files:
  `src/i18n/locales/zh-CN/<ns>.json` + `src/i18n/locales/en-US/<ns>.json`
  (they exist as `{}` stubs). zh-CN is the primary language — write it first,
  en-US must have the same keys.
- Usage: `const { t } = useTranslation('<ns>');` — shared strings come from
  the `common` namespace (`useTranslation('common')` or `t('actions.save',
  {ns:'common'})`): actions.save/cancel/delete/create/retry/refresh/send…,
  state.loading/empty/error, feedback.saved/deleted/requestFailed,
  confirm.deleteTitle/irreversible, time.justNow/minutesAgo/hoursAgo/daysAgo.

## Conventions

- Feature logic in `src/features/<feature>/` (api.ts with typed endpoint
  functions + hooks.ts with SWR hooks + components/). Screens in `src/app/`
  stay thin.
- Optimistic updates: mutate local SWR cache, call API, on failure refetch
  authoritative state + `toast.error`.
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
- Do NOT run `bun install` / add dependencies. Do NOT modify files outside
  your ownership list. Never touch `/home/rika/src/nomifun-tauri`.
- Definition of done: `bun x tsc --noEmit` (run from repo root) passes with
  YOUR files included and zero errors.
