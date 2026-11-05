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
  swap the branch in App for the real screen; 'dashboard', 'tables', 'takeaway', 'chooseFood', 'order', 'kitchen', 'bills' and 'payment' are real). `open(screen, tableFilter?)`
  checks `canOpen(deviceLock, screen)`. Every API
  401 logs the device out. `App` takes an optional `fetchImpl` prop (tests use a fake server).
- `session/session.ts` — the ONE stored session `{token,user,loginAt,kitchenDevice,shiftEnd}` (localStorage
  `dhaba.session`); `sessionDeadline` = min(12 h, next shift end, JWT exp), null on a kitchen device.
- `session/deviceLock.ts` — device role lock (`dhaba.deviceRole`), `canOpen`, `homeScreen` (KITCHEN → 'kitchen').
  Set from the admin area (`screens/AdminAreaScreen.tsx`). Add new screen names to `LOCKED_SCREENS`.
- `screens/AdminAreaScreen.tsx` — admin area (App screen 'admin', Figma 3:30): 'Manage restaurant' nav (240 px side
  column ≥1024, scrolling tab row below) + one section. Sections are `ADMIN_SECTIONS` ('menu', 'prices', 'tables',
  'staff', 'settings', 'device'); later admin work adds its own (reports, history, backup) to that list and to
  `renderSection`, and widens the `api` prop. One `ResultBar` for all sections (`onResult`).
- `screens/AdminMenuScreen.tsx` + `admin/menuAdminModel.ts` — `AdminMenuSection` (categories → items of the selected
  category → sizes of the selected item), `AdminPricesSection` and `PriceEditor` (Old ₹ / New ₹ side by side,
  reason radio chips from `PRICE_CHANGE_REASONS`, Confirm disabled until valid; one Idempotency-Key per open sheet,
  renewed on a 4xx; 409 stores `current` and asks again). Data comes from GET /menu (the contract has no admin
  list), merged with rows changed on this device (`mergeRows`) so deactivated rows stay visible to reactivate.
  Client checks mirror the server (duplicate names, short code 2–5, price > 0, reason enum); `variantUpdateBody`
  never sends `price`; the availability switch calls only setItemAvailability. Admin lists use `.admin-table`
  (styles/admin.css): a table on desktop, one card per row < 768 px via `td[data-label]`. `#/design/admin-menu`
  previews it.
- `screens/AdminSetupScreen.tsx` + `admin/setupAdminModel.ts` — admin sections 'tables', 'staff', 'settings'
  (`ADMIN_SECTIONS` is now menu, prices, tables, staff, settings, device; WI-030 adds reports/history/backup).
  `AdminSetupApi` (listTables, create/updateTable, listLoginStaff, createUser, updateUser, resetUserPin,
  getSettings, updateSettings); `AdminAreaScreen`'s `api` is `AdminMenuApi & AdminSetupApi` (+ optional
  `initialSection`). Lists come from GET /tables and GET /auth/staff (active only) merged with rows changed on this
  device (`mergeRows`) so turned-off rows can be turned back on. Client checks mirror the server: duplicate table
  number, display name unique among ACTIVE users, PIN ≥ 4 digits, `tableHasOpenOrder` disables Turn off,
  `isLastActiveAdmin` protects the only Admin. Admin-PIN clash is server-only (409 shown in the sheet). Unlock =
  PATCH `{locked_until: null}` (`UNLOCK_BODY`); `isLocked`/`lockMinutesLeft` read `locked_until`. Settings:
  `settingsErrors` (HH:mm, minutes 1–999, GST rate 0–28), `settingsBody` sends empty GST number/rate as null and
  keeps discount_limit/kitchen_print/shift_end from the current row; 409 reloads `current`. Reuses `EditSheet`,
  `TextField`, `useFailText` exported from AdminMenuScreen. Login shows `login.locked` on 423.
  Previews: `#/design/admin-tables`, `#/design/admin-staff`, `#/design/admin-settings`.
- `session/approval.ts` — `createApprovalHolder`: single-use Admin approval token, dropped after 2 min.
- `components/PinPad.tsx` (4-digit large keypad, `shakeKey` shakes once), `components/AdminPinSheet.tsx`
  (Admin PIN override → `createApproval`; use it for every Admin-only action on a cashier phone and pass the token
  as `approvalToken`), `components/TopBar.tsx` (name, user button = switch user, clock, connection line). Put
  `<TopBar userName onSwitchUser/>` in `ScreenFrame`'s `status` slot on every staff screen.
- `offline/connection.tsx` — `ConnectionProvider` polls /health every 3 s; `useOnline()`; `ConnectionLine`
  (green line / red banner). `PendingButton` is disabled while offline (`needsConnection={false}` to opt out):
  use it for Send/Pay. Never auto-submit on reconnect.
- `screens/LoginScreen.tsx` — staff tiles (active only) + PIN pad, language choice; also the user-switch screen.
- `screens/DashboardScreen.tsx` — Home: greeting, `pair()` buttons filtered by `ROLE_ACTIONS` (KITCHEN → kitchen
  only), live "Right now" tiles from GET /dashboard (`DashboardTiles` in shared; `todays_sales` shown to ADMIN
  only), ADMIN (needs PIN), language, switch-user bar. `.dashboard .workspace` uses 12 px side padding so each
  primary button is ≥ 45% of a 360 px screen (test enforces it).
- `screens/TablesScreen.tsx` + `screens/tablesModel.ts` — table grid: area tabs (All + distinct areas; null area
  only under All), legend, live `TableGrid`, pinned "Takeaway →". `statusFilter` ('OCCUPIED' from the Active
  tables tile) lists only those tables. GET /tables rows are `TableView` (shared): `status` (or `order_status`
  → `deriveTableStatus`), `running_amount`, `minutes_open`/`opened_at`, `order_id`. Tapping a card calls App's
  `onOpenTable` → 'chooseFood' (Available) or 'order' (otherwise); the tapped card is kept in App state
  (`setSelectedTable`) for those screens.
- `realtime/realtime.tsx` — `RealtimeChannel` (Socket.IO at `/socket.io`, `auth.token`), `RealtimeProvider`,
  `createMemoryChannel()` for tests (`emit`, `reconnect`), and `useLiveData(load, events)`: loads a GET, refetches
  (150 ms debounce) on the given events, on socket reconnect and when /health comes back. Use it for every live
  screen; never patch state from an event payload alone. App creates the channel per session token; `App`
  takes `realtime` (factory) — null under unit tests by default. Event names: `REALTIME_EVENTS` in shared.
- `screens/ScreenPreview.tsx` — dev-only real screens with sample data at `#/design/dashboard`,
  `#/design/dashboard-admin`, `#/design/dashboard-kitchen`, `#/design/tables`.
- `screens/ChooseFoodScreen.tsx` — food selection + cart + Send (screen 'chooseFood'). Takes a `FoodTarget`
  (`{kind:'table', tableId, table, detail, orderId, free}` from the tables grid, or `{kind:'token', token, orderId}` —
  the takeaway screen sets this via App's `setFoodTarget` and `open('chooseFood')`), a `FoodApi` (getMenu,
  openTableSession, sendToKitchen) and a `CartStore`. A dine-in session is opened lazily on the first Send
  (409 TABLE_BUSY → uses the returned order). Variant sheet, note sheet (chips stored in English so the kitchen
  shows 'No onion'), expandable cart summary inside the pinned action area, 'Sent to kitchen' list (local).
  `#/design/choose-food` previews it.
- `cart/menuModel.ts` (GET /menu normalised: `MenuView {categories, items[].variants}` in shared, or a bare item array;
  `startingPrice`, `canOrder`, `visibleItems`, search from 2 letters), `cart/cartModel.ts` (pure cart ops: max 99,
  − on 1 removes, note ≤ 80, `sendBody`, `markSent`, `rejectedVariantIds` for 422 ITEM_UNAVAILABLE details,
  `reconcile` a stored cart with the table's current order). Any cart edit clears `sendKey`; a timeout keeps it
  (retry with same key); a 4xx clears it.
- `cart/cartStore.ts` — `CartStore` (IndexedDB `dhaba-pos`/`carts`, localStorage fallback, `memoryCartStore` for
  tests); key `table:<id>` or `order:<id>`. App takes an optional `cartStore` prop.
- `screens/KitchenScreen.tsx` + `kitchen/kitchenModel.ts` — kitchen board (screen 'kitchen'). GET /kitchen/kots rows
  are `KitchenKotView` (shared: `lines[]` with `item_name`, `variant_name`, `quantity`, `note`, `cancelled`, plus
  `table_label`/`token`, `minutes_waiting`, `is_late`, `ready_at`); `normaliseKot` also accepts order-item shaped
  lines and copies NO money field. `boardColumns` (oldest first; SERVED stays in READY until `hide_after`; CANCELLED
  hidden), `isLate` (> `late_kot_minutes` from GET /settings, default 15), `nextStatus` (one step only). New KOT ids
  after the first load -> `playKotAlert` (Web Audio beep) + blue highlight until pointerdown/click. Out-of-stock
  sheet (KITCHEN/ADMIN role only) lists GET /menu items. `#/design/kitchen` / `#/design/kitchen-dark` preview it.
- `screens/OrderScreen.tsx` + `order/orderModel.ts` — order view (screen 'order', opened from an Occupied / Ready to
  Close card; App keeps the tapped card in `selectedTable`). GET /orders/{id} is `OrderDetailView` (shared): `kots[]`
  with nested `lines`/`items`, or flat `items`/`order_items` matched by `kot_id` -> `kotGroups`. Bill lines =
  `billLines` (non-cancelled, captured `unit_price`); ALL totals are shown from the server, never computed here.
  A 403 on cancel/discount opens `AdminPinSheet` and repeats once with the approval token; the PIN is asked up
  front when `cancelNeedsPin(kot)` (past NEW) or `discountNeedsPin(amount, discount_limit_amount)` for non-Admins.
  `discountBody` sends `{exception_type:'DISCOUNT', reason_code:'OTHER', reason_text, amount}`. Move/merge sheets
  list `moveTargets` (AVAILABLE) / `mergeSources` (other open orders) from GET /tables. PRINT BILL calls printBill
  then `window.print()`; `@media print` in `styles/order.css` shows only `.bill-card` (the receipt page belongs to
  the payment work). ADD MORE FOOD -> App sets a non-free table `FoodTarget` with the order id, opens 'chooseFood'.
  `#/design/order` previews it.
- `screens/PaymentScreen.tsx` + `payment/paymentModel.ts` — `BillsScreen` (screen 'bills': GET /bills/open via
  `openBills`, rows by table/token with amount due + Ready to Close badge; tap -> App `setBillOrderId`, 'payment') and
  `PaymentScreen` (screen 'payment'): server bill first, then Cash/UPI/Card. Cash card: quick amounts (`quickCash`,
  Exact), `changeDue`; 'Pay part only' keypad for splits (empty = full balance). UPI opens a sheet with
  `public/upi-qr.svg` (placeholder, owner replaces) + Received (no UTR needed); closing it records nothing.
  `paymentBody` never overpays; one Idempotency-Key per tap, kept on timeout/5xx. At zero balance -> full-screen
  green PAID (Print / Share / Done). Void / close-with-balance (`closeExceptionBody`, CLOSE_REASON_CODES chips) ask
  the Admin PIN up front for non-Admins. Print: recordReceiptPrint (or printBill) then `tryPrint` — a throw shows a
  printer error, never undoes a payment. `.receipt` (styles/payment.css) is print-only at 48 mm with
  `overflow-wrap:anywhere` (58 and 80 mm rolls). `maybePrintKot` (KitchenScreen `printKot` prop) prints a new KOT
  only when settings.kitchen_print_enabled. `#/design/payment`, `#/design/bills` preview them.
- `screens/TakeawayScreen.tsx` + `takeaway/takeawayModel.ts` — screen 'takeaway' (Figma node 3:18). GET /takeaways rows
  are `TakeawayView` (shared: Order + optional `item_count`, `kot_status`/`kitchen_status`, or nested `kots`/`items`);
  `activeTakeaways` drops handed-over/cancelled/closed rows, newest token first; `isPaid` (PAID or balance 0 on a
  non-empty bill); `takeawayBody` (name ≤ 40, phone empty or 4–10 digits). NEW TAKEAWAY sheet: one Idempotency-Key per
  sheet (kept on timeout/5xx), 409 = token clash message, then the big token (`--text-token`) with Add food →
  App sets a `{kind:'token'}` FoodTarget. HANDED OVER shows on Ready cards; the server decides (422 → red bar, token
  stays). Collect opens 'payment' with App `payReturn='takeaway'` (Back/Done return there). `.btn--dark` (takeaway.css)
  is a dark filled button that is NOT the screen's primary action. `#/design/takeaway` previews it.
- `kitchen/KitchenNotices.tsx` — chips on non-kitchen sessions (rendered by App) for `kot.status_changed` -> READY and
  `menu.availability_changed` -> unavailable. Alert only; screens still refetch.
- `styles/kitchen.css` — `.kot-card*`, `.kot-line--cancelled`, `.kitchen-note`, `.kitchen-notice*` (no animation).
- `styles/food.css` — food screen classes (`.food-card`, `.food-tabs`, `.cart-*`, `.note-label` boxed red note).
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
