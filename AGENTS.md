# Repository Guidelines (nomifun-mobile)

## Git attribution (mandatory)

AI models (Claude or any other) may assist with work in this repository but
must NEVER appear as the Git author, committer, co-author, or credited
contributor. Do not add `Co-Authored-By` trailers or any AI-credit lines to
commit messages. Commits are always attributed to the human maintainer's
configured Git identity.

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
