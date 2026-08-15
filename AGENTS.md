# Repository Guidelines (nomifun-mobile)

## Efficient validation

- Choose the smallest checks that cover the changed behavior. Documentation-
  only edits do not require an application build.
- For UI or API changes, prefer targeted type checks and tests for the affected
  feature before broader web validation. Android and iOS builds are only
  required when the change is platform-specific or release-bound.
- If a relevant platform or tool is unavailable, report the gap; unrelated
  changes are not blocked by a repository-wide test requirement.

## Git workflow

- Use the contributor's configured Git identity; no custom attribution hook is
  required.
- Preserve unrelated work, inspect staged files, and do not force-push shared
  branches without explicit authorization.

## Project shape

- Expo (React Native) app targeting **Android / iOS / Web (H5)**.
- On Ubuntu, develop and verify with **web only** (`bun run web`); Android/iOS
  configs are maintained but not built locally.
- The app is a thin client: ALL business logic lives in the nomifun desktop
  app (`~/src/nomifun-tauri`), which exposes the same HTTP + WebSocket API as
  its WebUI (`nomifun-web`). The mobile app must not re-implement engine
  behavior — it renders state and sends commands.
- API base: relative (`/api/...`) on web (same-origin, dev proxy handles it),
  absolute `http://<host>:<port>` on native. Never hardcode a server address.

## Conventions

- TypeScript strict. Path alias `@/*` → `src/*`.
- User-facing strings go through i18n (`src/i18n/`), Chinese first.
- Screens live in `src/app/` (expo-router file routes); shared UI in
  `src/components/`; API layer in `src/api/`; keep them separated.
- Match the nomifun design tokens in `src/constants/theme.ts` — do not invent
  new colors ad hoc.
- Adding a NEW platform-specific file (`foo.web.tsx` next to `foo.tsx`) needs a
  Metro restart with `--clear`: its resolution cache keeps serving the old
  variant, and the symptom is a silently missing feature, not an error.
- react-native-web drops `accessibilityState`, so use `a11yState()` from
  `@/utils/a11y` (emits both shapes), and pass `disabled` to `Pressable`
  itself — RNW derives `aria-disabled` and tab-order from that prop and
  overwrites anything you pass by hand.
- A toast fired while a `Modal` is open is hidden underneath it on native
  (web portals above it). Modal screens must also show inline feedback.
