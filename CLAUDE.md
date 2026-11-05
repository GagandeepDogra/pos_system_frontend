# Dhaba POS — guide for coding sessions

## Stack
- npm workspaces monorepo, TypeScript everywhere, Node 20.
- `apps/pos-web`: React 19 + Vite 6 PWA (static build in `apps/pos-web/dist`, served later by pos-api).
  The planning documents say "Next.js static export"; the ticket's stack is React + Vite, which gives the same
  single static artefact. Keep it a pure SPA (no SSR).
- `packages/shared` (`@dhaba/shared`): every enum and DTO type used by more than one app. Import types from here.
- Tests: Vitest 3 with root `vitest.config.ts` `projects` (shared, pos-web [jsdom], tools [node]).
  Testing Library + jest-dom for components.
- Lint: ESLint 9 flat config (`eslint.config.js`).

## Commands (from the repo root)
- `npm install`
- `npm test` — all tests (the service runs this).
- `npm run dev` — Vite dev server on http://localhost:5173 (proxies `/api` to `POS_API_URL`, default http://localhost:3000).
  To pick a port run `npx vite --port N` inside `apps/pos-web` (args after `npm run dev --` do NOT reach vite).
- `npm run build` — typecheck + build `apps/pos-web/dist` (emits `sw.js` with the precache list).
- `npm run ci` — lint, i18n key diff, banned words, shared-enum check, typecheck, tests with coverage, storage/billing
  coverage gate (`tools/check-coverage.mjs`, 80% per file under any `storage/` or `billing/` folder), build.

## Layout (apps/pos-web/src)
- `api/client.ts` — `createApiClient` (base `/api/v1`, bearer token, Idempotency-Key, If-Match, X-Approval-Token,
  timeout + retries with the SAME key, phases pending→checking→saved/failed, 409 returns `current` + `onConflict`,
  errors normalised to `{code, message_en, message_hi, details}` with messages from the locale files).
- `api/endpoints.ts` — one typed function per pos-api operation. Creating POSTs take a `key` argument: create it
  once per tap with `newIdempotencyKey()` and keep it until the server confirms (store it with the cart).
- `i18n/` — `locales/en.json`, `locales/hi.json`; `createTranslator(lang)` → `t`, `en`, `pair` (dashboard buttons
  use `pair()` → 'रसोई / Kitchen' in Hindi); `I18nProvider`/`useI18n`; `languageStore` (per-user cache keyed by
  user id); `switchUserLanguage` (PATCH /me/language, one refresh on 409).
- `components/` — `ResultBar` (green 2 s / red with next step), `PendingButton` (disabled + spinner while pending,
  'Checking...' on retry), `KeypadField` (read-only, `inputMode="none"`, opens on-screen keypad).
- `screens/LoginScreen.tsx` — shell start screen (title + language choice); login tiles/PIN come later.
- `pwa/` — `sw-template.js` (precache shell, network-first navigation with cached index.html fallback, never
  caches `/api/`), `register.ts` (prod only). Manifest/icon in `public/`.
- `styles/tokens.css` — design tokens (CSS variables from the Figma design); `styles/shell.css` — shared classes.

## Conventions
- No literal text in JSX: every staff-facing string is a key in BOTH en.json and hi.json (lint + key diff fail CI).
  Symbols allowed: ✓ ✕ ⌫ · /.
- Plain words only: never 'Invoice', 'Submit KOT', 'Void line' in locale files (banned-word scan).
- No `enum` and no `'A' | 'B'` / `['A','B'] as const` of UPPER_CASE literals in apps — put them in packages/shared.
- Use the CSS variables from tokens.css, never raw hex. Targets ≥ 56px (`--target-min`).
- Test names cite a REQ id (e.g. `REQ-089: ...`).
- Do not commit `.eos/` (design input, read-only).
