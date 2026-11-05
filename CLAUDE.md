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
- Design-system primitives (build every staff screen from these):
  - `ScreenFrame` (+ `NavBar`): sticky header with status slot, ← BACK / HOME in fixed slots (omit `onBack` on the
    dashboard; the slot stays), the `context` pill, body, and ONE `primaryAction` pinned at the bottom (64 px,
    full width on phone). Never put a second `btn--primary` in the body.
  - `ContextPill` ('Table 5' / 'Token T-012'), lives in the sticky header so it never scrolls away.
  - `Status.tsx`: `TableStatusLabel`, `KotStatusLabel`, `TableStatusLegend` — icon + word + colour, never colour alone.
  - `TableGrid`/`TableCard` (2 cols <768, 4 at 768, 6 at 1024; number 40 px bold, price 24 px bold).
  - `ConfirmSheet`: NO left, YES right; only for actions where `needsConfirm(action)` is true.
  - `StatusColumns`: kitchen NEW/PREPARING/READY columns (side by side ≥768 landscape or ≥1024).
  - `ThemeChoice` + `kitchenThemeClass`: dark theme only when the device role is KITCHEN.
- `design/rules.ts` — breakpoints, `needsConfirm`, `darkThemeAllowed`, `STAFF_SCREENS` (depth ≤ 2) and `STAFF_FLOWS`
  (≤ 3 screens): add every new staff screen/flow there; tests enforce the limits. `contrastRatio` for token tests.
- `styles/primitives.css` — classes for the primitives; type scale classes `.text-item`, `.text-price`,
  `.text-table-number`; `.choice-row` for segmented tabs. `.theme-kitchen-dark` (tokens.css) overrides the colours.
- `screens/DesignPreview.tsx` — dev-only gallery at `#/design` (used for screenshots).
- `App.tsx` — the app router (state, no URL routes): session → LoginScreen; screens 'dashboard' | 'admin' |
  'tables' | 'takeaway' | 'kitchen' | 'bills' (others render `PlaceholderScreen` until their tickets replace it —
  swap the branch in App for the real screen). `open(screen)` checks `canOpen(deviceLock, screen)`. Every API
  401 logs the device out. `App` takes an optional `fetchImpl` prop (tests use a fake server).
- `session/session.ts` — the ONE stored session `{token,user,loginAt,kitchenDevice,shiftEnd}` (localStorage
  `dhaba.session`); `sessionDeadline` = min(12 h, next shift end, JWT exp), null on a kitchen device.
- `session/deviceLock.ts` — device role lock (`dhaba.deviceRole`), `canOpen`, `homeScreen` (KITCHEN → 'kitchen').
  Set from the admin area (`screens/AdminAreaScreen.tsx`). Add new screen names to `LOCKED_SCREENS`.
- `session/approval.ts` — `createApprovalHolder`: single-use Admin approval token, dropped after 2 min.
- `components/PinPad.tsx` (4-digit large keypad, `shakeKey` shakes once), `components/AdminPinSheet.tsx`
  (Admin PIN override → `createApproval`; use it for every Admin-only action on a cashier phone and pass the token
  as `approvalToken`), `components/TopBar.tsx` (name, user button = switch user, clock, connection line). Put
  `<TopBar userName onSwitchUser/>` in `ScreenFrame`'s `status` slot on every staff screen.
- `offline/connection.tsx` — `ConnectionProvider` polls /health every 3 s; `useOnline()`; `ConnectionLine`
  (green line / red banner). `PendingButton` is disabled while offline (`needsConnection={false}` to opt out):
  use it for Send/Pay. Never auto-submit on reconnect.
- `screens/LoginScreen.tsx` — staff tiles (active only) + PIN pad, language choice; also the user-switch screen.
- `screens/DashboardScreen.tsx` — Home shell: greeting, 4 `pair()` buttons, ADMIN (Admins, needs PIN), language,
  switch-user bar. The "Right now" live counts are added by the dashboard ticket.
- `styles/session.css` — classes for the above. Icons in `public/icons/` (from the design assets).
- `pwa/` — `sw-template.js` (precache shell, network-first navigation with cached index.html fallback, never
  caches `/api/`), `register.ts` (prod only). Manifest/icon in `public/`.
- `styles/tokens.css` — design tokens (CSS variables from the Figma design); `styles/shell.css` — shared classes.

## Conventions
- Exception to the animation rule: the PIN pad shakes once (400 ms) on a wrong PIN (ticket requirement); it is off
  under reduced motion like everything else.
- Login response assumed `{token, user}`; 401 body `details.remaining_tries` gives the tries left.
- No literal text in JSX: every staff-facing string is a key in BOTH en.json and hi.json (lint + key diff fail CI).
  Symbols allowed: ✓ ✕ ⌫ · /.
- Plain words only: never 'Invoice', 'Submit KOT', 'Void line' in locale files (banned-word scan).
- No `enum` and no `'A' | 'B'` / `['A','B'] as const` of UPPER_CASE literals in apps — put them in packages/shared.
- Use the CSS variables from tokens.css, never raw hex. Targets ≥ 56px (`--target-min`).
- Tests may read stylesheets with `import css from '../styles/x.css?raw'` (pos-web vitest has `css: true`); there
  are no Node types in the app tsconfig, so do not import `node:fs` in app tests.
- Only animation allowed: 150 ms press (`--motion-press`) and sheet slide-in (`--motion-sheet`), both off under
  reduced motion.
- Test names cite a REQ id (e.g. `REQ-089: ...`).
- Do not commit `.eos/` (design input, read-only).
