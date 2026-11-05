# Dhaba POS — web app

The point-of-sale app for a dhaba: staff use it on phones, tablets and the counter PC to take dine-in and
takeaway orders, run the kitchen board and take payments. It is a Progressive Web App: open its URL in a
browser, or install it to the home screen, where it opens full-screen and starts even when the network is off
(it then waits for the counter computer). All labels are in English and Hindi, chosen per staff member.

What is in place today:
- the installable app shell (web manifest, service worker that caches the app for offline launch);
- login: active staff appear as large name tiles; tap your name and type your 4-digit PIN (a wrong PIN shakes
  the pad and shows the tries left). Tap your name in the top bar on any screen to switch user;
- sessions end after 12 hours or at the shift end set in settings; a kitchen tablet stays logged in;
- the home screen with the buttons each role may use (Dine-in, Takeaway, Kitchen, Payment; kitchen staff
  see only Kitchen) and live "Right now" tiles: today's sales (owner only), active tables, kitchen pending,
  ready to serve and open takeaways. Tiles refresh by themselves within seconds of any change; tapping a tile
  opens its list (Active tables lists the occupied tables);
- the Dine-in tables screen: every active table as a card with its number and status (green Available, red
  Occupied, orange Ready to close); occupied tables show the running bill and minutes open. Large area tabs
  (All plus each area, e.g. Hall, Family, Outside) filter the grid; tables with no area are listed under All.
  The grid updates live on every phone, and catches up after a lost connection;
- food selection (tap an Available table): the table pill stays in the header; category buttons, a
  All / Veg / Non-veg filter with the green and red dot marks, and search from 2 letters (English, Hindi or
  short code). Cards show both names, an optional photo and the starting price. One-size items are added in one
  tap; items with sizes (Half / Full) open a size sheet. Finished items are greyed "Khatam / Not available";
- the cart bar (item count and total) opens a summary with large − / + buttons and a kitchen note per line
  (Less spicy, Extra spicy, No onion, Parcel, plus free text, up to 80 letters). The cart is kept on the phone,
  so it survives a reload or a lost connection. Send to Kitchen makes one kitchen ticket of the new lines only
  and shows its number in green; sent lines are listed in grey under "Sent to kitchen". A slow or lost answer
  is retried safely, so a ticket is never made twice; if some food has just finished, only those lines are
  dropped and the rest stay in the cart;
- the Kitchen board (built for a tablet in landscape): New, Preparing and Ready columns side by side, oldest
  ticket first. Each card shows the table or token, KOT number, time sent and minutes waiting, every item with
  its size and quantity, and kitchen notes in a red box; items cancelled after sending are struck through.
  One large button moves a ticket a single step (Start preparing, then Mark ready). A new ticket beeps and
  stays outlined in blue until someone touches it; tickets waiting longer than the late limit in settings
  (15 minutes by default) show a red "Late" label. Served tickets disappear 10 minutes after serving or
  payment. No prices are shown in the kitchen. Kitchen staff can mark a food out of stock for today, and the
  kitchen tablet offers a dark screen. Cashier phones get a "Food ready · Table 5" chip and an out-of-stock
  alert;
- for the owner an ADMIN button that
  asks for the owner's PIN first. In the admin area a device can be locked to a role, e.g. the kitchen tablet
  then always opens straight to the Kitchen screen;
- the owner PIN pad for owner-only actions on a cashier's phone;
- a red "No connection" banner when the counter computer cannot be reached (checked every 3 seconds); sending
  orders and payments is blocked until it is back, and nothing is sent automatically;
- English / Hindi switch, saved per staff member;
- the typed client for the dhaba's backend API (`/api/v1`), with safe retries for orders and payments;
- shared building blocks: result bars, busy buttons and the on-screen number keypad;
- checks that keep all text in the translation files and in plain words.

## Stack
TypeScript, React 19, Vite 6, Vitest, ESLint. npm workspaces: `apps/pos-web` (the app) and `packages/shared`
(types shared with the backend).

## Requirements
- Node.js 20 and npm 10.
- The backend API (served by the counter computer) for live data. During development, the dev server forwards
  `/api` and the live-update channel (`/socket.io`, Socket.IO) to `POS_API_URL` (default
  `http://localhost:3000`). The app shell runs without it. Without a backend, sample screens can be viewed in
  development at `http://localhost:5173/#/design/dashboard`, `http://localhost:5173/#/design/tables` and
  `http://localhost:5173/#/design/kitchen` (`#/design/kitchen-dark` for the dark kitchen screen).

Configuration (optional, see `.env.example`):

| variable | default | meaning |
|---|---|---|
| `POS_API_URL` | `http://localhost:3000` | backend address the dev server forwards `/api` to |

## Install

```bash
npm install
```

## Run locally

```bash
npm run dev
```

Open http://localhost:5173.

While developing, http://localhost:5173/#/design shows the shared screen parts together (table cards,
status labels, order pill, confirm sheet, kitchen columns, dark kitchen screen). This page is not part of the
built app.

To try the built app (with the service worker):

```bash
npm run build
npm run preview
```

Open http://localhost:4173.

## Test

```bash
npm test
```

All checks that CI should run (lint, translation key match, banned words, shared types, tests with coverage, build):

```bash
npm run ci
```

## Build

```bash
npm run build
```

The output in `apps/pos-web/dist` is one static bundle for every device; the backend serves it at its root URL.
