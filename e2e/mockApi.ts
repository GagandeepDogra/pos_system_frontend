import type { Page } from '@playwright/test';

/** A small in-browser pos-api double (contract shapes) for the end-to-end flows. */
const audit = { created_at: '2026-11-05T12:00:00+05:30', created_by: 'u1', updated_at: '2026-11-05T12:00:00+05:30', updated_by: 'u1', row_version: 1 };

export const CASHIER = {
  id: 'u2', display_name: 'Ramesh', role: 'CASHIER', language: 'en', is_active: true,
  failed_pin_count: 0, locked_until: null, token_version: 1, ...audit,
};

const variant = (id: string, itemId: string, name: string, price: string) =>
  ({ id, item_id: itemId, name, price, sort_order: 1, is_active: true, ...audit });
const item = (id: string, en: string, hi: string, code: string, food: string, price: string) => ({
  id, category_id: 'c1', name_en: en, name_hi: hi, short_code: code, food_type: food, photo_url: null, kitchen_station: null,
  is_active: true, available_today: true, ...audit, variants: [variant(`v-${id}`, id, 'Regular', price)],
});

export const MENU = {
  categories: [{ id: 'c1', name_en: 'Main', name_hi: 'मुख्य', sort_order: 1, is_active: true, ...audit }],
  items: [
    item('i1', 'Dal Makhani', 'दाल मखनी', 'DM', 'VEG', '140.00'),
    item('i2', 'Tandoori Roti', 'तंदूरी रोटी', 'TR', 'VEG', '20.00'),
    item('i3', 'Sweet Lassi', 'मीठी लस्सी', 'SL', 'VEG', '60.00'),
  ],
};

export const TABLES = Array.from({ length: 12 }, (_, i) => ({
  id: `t${i + 1}`, table_number: String(i + 1).padStart(2, '0'), area: 'Hall', seats: 4, is_active: true,
  status: 'AVAILABLE', running_amount: null, ...audit,
}));

export interface ApiLog { kots: unknown[] }

/** Answers every /api/v1 call the dine-in flow makes. `delayMs` simulates a busy LAN. */
export async function mockApi(page: Page, opts: { delayMs?: number } = {}): Promise<ApiLog> {
  const log: ApiLog = { kots: [] };
  const order = { id: 'ORD-20261105-0001', order_type: 'DINE_IN', business_date: '2026-11-05', table_id: 't1', table_label_snapshot: '01',
    status: 'OPEN', subtotal: '0.00', discount_amount: '0.00', tax_amount: '0.00', round_off: '0.00', grand_total: '0.00',
    paid_amount: '0.00', balance_due: '0.00', client_request_id: 'k', ...audit };
  // Realtime is not part of these flows: accept the socket and stay silent.
  await page.routeWebSocket(/socket\.io/, () => undefined);
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v1', '');
    if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/health') return json({ status: 'green' });
    if (path === '/auth/staff') return json([CASHIER]);
    if (path === '/auth/login') return json({ token: 'e2e-token', user: CASHIER });
    if (path === '/dashboard') return json({ active_tables: 0, open_kots: 0, pending_bills: 0, takeaways: 0 });
    if (path === '/tables') return json(TABLES);
    if (path === '/menu') return json(MENU);
    if (path === '/settings') return json({ id: 's1', dhaba_name: 'Dhaba', late_kot_minutes: 15, discount_limit_amount: '100.00', token_reset_time: '04:00', kitchen_print_enabled: false, ...audit });
    if (path === '/orders/dine-in') return json(order, 201);
    if (/^\/orders\/[^/]+\/kots$/.test(path)) {
      log.kots.push(req.postDataJSON());
      return json({ id: 'kot1', kot_number: 1, business_date: '2026-11-05', order_id: order.id, status: 'NEW', idempotency_key: 'k', sent_at: audit.created_at, ...audit }, 201);
    }
    if (/^\/orders\/[^/]+$/.test(path)) return json({ ...order, kots: [] });
    return json({ code: 'NOT_FOUND', message_en: 'Not found', message_hi: 'नहीं मिला', details: null }, 404);
  });
  return log;
}

/** Logs in as the cashier: staff tile, then the 4-digit PIN. */
export async function login(page: Page) {
  await page.getByRole('button', { name: /Ramesh/ }).click();
  for (const d of '1234') await page.getByRole('button', { name: d, exact: true }).click();
}
