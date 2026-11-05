import { PAYMENT_METHODS, type Order, type PaymentMethod } from '@dhaba/shared';

/**
 * Pure helpers for the admin reports, order history, day close and backup/restore sections.
 * The server computes every total (SUCCESS payments only, archives included); these functions
 * only read the response shapes tolerantly and never re-add money themselves, except the
 * payment-method fallback when the server sends no grand total.
 */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : []);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};
const str = (...vs: unknown[]): string => {
  for (const v of vs) if (typeof v === 'string' && v.trim()) return v;
  return '';
};

/** YYYY-MM-DD in local time. */
export function isoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * The business date of `now`: before the token reset time (default 04:00) the day still
 * belongs to yesterday (REQ-097). The server decides; this only picks the default range.
 */
export function businessDate(now: Date, resetTime = '04:00'): string {
  const [h, m] = /^\d{2}:\d{2}$/.test(resetTime) ? resetTime.split(':').map(Number) : [4, 0];
  const d = new Date(now);
  if (now.getHours() * 60 + now.getMinutes() < h * 60 + m) d.setDate(d.getDate() - 1);
  return isoDate(d);
}

export const REPORT_PERIODS = ['today', 'yesterday', 'range'] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export function periodRange(period: Exclude<ReportPeriod, 'range'>, today: string): { from: string; to: string } {
  if (period === 'today') return { from: today, to: today };
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 1);
  const y = isoDate(d);
  return { from: y, to: y };
}

/** A date range is valid when both dates are set and from ≤ to (the server answers 400 otherwise). */
export function rangeError(from: string, to: string): 'missing' | 'order' | null {
  if (!from || !to) return 'missing';
  return from > to ? 'order' : null;
}

export interface ReportRow { name: string; quantity: number; amount: number }
export interface SalesReport {
  from: string;
  to: string;
  total: number;
  billCount: number | null;
  byMethod: { method: PaymentMethod; amount: number }[];
  byCategory: ReportRow[];
  topItems: ReportRow[];
  cancelled: ReportRow[];
  exceptions: { type: string; reason: string; amount: number; label: string }[];
  discountTotal: number;
  includesArchive: boolean;
}

function rows(v: unknown, nameKeys: string[]): ReportRow[] {
  // Accept a list of rows or a {name: amount} map.
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v as Obj).map(([name, amount]) => ({ name, quantity: 0, amount: num(amount) }));
  }
  return arr(v).map((r) => ({
    name: str(...nameKeys.map((k) => r[k])),
    quantity: num(r.quantity ?? r.qty ?? r.count ?? r.sold),
    amount: num(r.amount ?? r.total ?? r.sales ?? r.line_total),
  }));
}

/** Reads GET /admin/reports/sales. Totals are the server's (SUCCESS payments, archive months included). */
export function normaliseReport(raw: unknown, from: string, to: string): SalesReport {
  const r = obj(raw);
  const m = r.by_method ?? r.by_payment_method ?? r.payment_methods ?? r.payments;
  const methodAmounts: Partial<Record<PaymentMethod, number>> = {};
  if (Array.isArray(m)) {
    for (const row of arr(m)) {
      const k = str(row.method).toUpperCase() as PaymentMethod;
      if ((PAYMENT_METHODS as readonly string[]).includes(k)) methodAmounts[k] = (methodAmounts[k] ?? 0) + num(row.amount ?? row.total);
    }
  } else {
    for (const [k, v] of Object.entries(obj(m))) {
      const key = k.toUpperCase() as PaymentMethod;
      if ((PAYMENT_METHODS as readonly string[]).includes(key)) methodAmounts[key] = num(v);
    }
  }
  const byMethod = PAYMENT_METHODS.map((method) => ({ method, amount: methodAmounts[method] ?? 0 }));
  const serverTotal = r.total_sales ?? r.total ?? r.total_collected ?? r.grand_total;
  const total = serverTotal !== undefined ? num(serverTotal) : byMethod.reduce((s, x) => s + x.amount, 0);
  const exc = arr(r.exceptions ?? r.discounts_and_exceptions).map((e) => {
    const type = str(e.exception_type, e.type);
    const reason = str(e.reason_code, e.reason);
    return { type, reason, amount: num(e.amount), label: str(e.bill_no, e.order_id, e.table_label_snapshot, e.token) };
  });
  const discounts = arr(r.discounts).map((d) => ({ type: 'DISCOUNT', reason: str(d.reason_code, d.reason, d.discount_reason), amount: num(d.amount ?? d.discount_amount), label: str(d.bill_no, d.order_id) }));
  const exceptions = [...discounts, ...exc];
  const discountTotal = r.discount_total !== undefined ? num(r.discount_total) : exceptions.filter((e) => e.type === 'DISCOUNT').reduce((s, e) => s + e.amount, 0);
  const bills = r.bill_count ?? r.paid_bills ?? r.order_count ?? r.orders;
  return {
    from: str(r.from) || from,
    to: str(r.to) || to,
    total,
    billCount: typeof bills === 'number' ? bills : null,
    byMethod,
    byCategory: rows(r.by_category ?? r.categories, ['category', 'category_name', 'name_en', 'name']),
    topItems: rows(r.top_items ?? r.items, ['item_name', 'item_name_snapshot', 'name_en', 'name']).sort((a, b) => b.quantity - a.quantity),
    cancelled: rows(r.cancelled_items ?? r.cancelled, ['item_name', 'item_name_snapshot', 'name_en', 'name']),
    exceptions,
    discountTotal,
    includesArchive: r.includes_archive === true || (Array.isArray(r.archives) && r.archives.length > 0),
  };
}

/** Bar width in percent of the largest method (the design's payment split). */
export function shareOf(amount: number, total: number): number {
  if (total <= 0 || amount <= 0) return 0;
  return Math.min(100, Math.round((amount / total) * 100));
}

/** A small CSV of the report for the owner's own records ("Download report"). */
export function reportCsv(r: SalesReport, labels: { method: string; category: string; item: string; cancelled: string; exception: string; total: string }): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const lines: string[] = [[q(labels.total), q(`${r.from}..${r.to}`), q(r.total.toFixed(2))].join(',')];
  for (const m of r.byMethod) lines.push([q(labels.method), q(m.method), q(m.amount.toFixed(2))].join(','));
  for (const c of r.byCategory) lines.push([q(labels.category), q(c.name), q(c.amount.toFixed(2))].join(','));
  for (const i of r.topItems) lines.push([q(labels.item), q(i.name), q(i.quantity)].join(','));
  for (const i of r.cancelled) lines.push([q(labels.cancelled), q(i.name), q(i.quantity)].join(','));
  for (const e of r.exceptions) lines.push([q(labels.exception), q(`${e.type} ${e.reason} ${e.label}`.trim()), q(e.amount.toFixed(2))].join(','));
  return lines.join('\n');
}

export interface HistoryQuery { date: string; bill_no: string; table: string; token: string }
export const EMPTY_HISTORY_QUERY: HistoryQuery = { date: '', bill_no: '', table: '', token: '' };

/** Only filled fields are sent; null when nothing is filled (nothing to search). */
export function historyQuery(q: HistoryQuery): Partial<HistoryQuery> | null {
  const out: Partial<HistoryQuery> = {};
  for (const k of Object.keys(q) as (keyof HistoryQuery)[]) {
    const v = q[k].trim();
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Search results: a list (possibly empty — an unknown bill number is not an error) or {items}. */
export function historyRows(raw: unknown): Order[] {
  if (Array.isArray(raw)) return raw as Order[];
  const o = obj(raw);
  for (const k of ['items', 'orders', 'results', 'data']) if (Array.isArray(o[k])) return o[k] as Order[];
  return [];
}

export interface DayCloseSummary {
  businessDate: string;
  cashTotal: number;
  unsettled: Order[];
  snapshots: string[];
}

/** GET /admin/day-close: OPEN/BILLED orders and the SUCCESS cash total (VOIDED never counted, by the server). */
export function normaliseDayClose(raw: unknown): DayCloseSummary {
  const r = obj(raw);
  const list = r.unsettled_orders ?? r.open_orders ?? r.orders ?? r.unsettled;
  const unsettled = (Array.isArray(list) ? (list as Order[]) : []).filter((o) => o.status === 'OPEN' || o.status === 'BILLED');
  return {
    businessDate: str(r.business_date),
    cashTotal: num(r.cash_total ?? r.cash_success_total ?? r.cash),
    unsettled,
    snapshots: snapshotNames(r.snapshots ?? r.backups),
  };
}

export function snapshotNames(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((s) => (typeof s === 'string' ? s : str(obj(s).name, obj(s).snapshot, obj(s).file))).filter(Boolean);
}

/** The snapshot name in the POST /admin/day-close reply, if the server sends one. */
export function closedSnapshot(raw: unknown): string | null {
  const r = obj(raw);
  return str(r.snapshot, r.snapshot_name, obj(r.snapshot).name, r.file) || null;
}

/** Adds a snapshot to the front of the list, without duplicates. */
export function addSnapshot(list: string[], name: string | null): string[] {
  if (!name) return list;
  return [name, ...list.filter((s) => s !== name)];
}

export interface RestorePreview { id: string; fileDate: string; orders: number; payments: number }

export function normaliseRestorePreview(raw: unknown): RestorePreview | null {
  const r = obj(raw);
  const id = str(r.restore_id, r.id);
  if (!id) return null;
  const counts = obj(r.counts);
  return {
    id,
    fileDate: str(r.file_date, r.saved_at, r.date, r.business_date),
    orders: num(r.order_count ?? r.orders ?? counts.orders),
    payments: num(r.payment_count ?? r.payments ?? counts.payments),
  };
}

/** The two restore PIN entries must be identical 4+ digit PINs; the server re-checks them. */
export function restorePinsError(pin: string, again: string): 'short' | 'mismatch' | null {
  if (!/^\d{4,}$/.test(pin)) return 'short';
  return pin === again ? null : 'mismatch';
}

/** Readable label of an order: bill number, then table or token. */
export function orderLabel(o: Order, tableWord: (n: string) => string): string {
  const where = o.table_label_snapshot ? tableWord(o.table_label_snapshot) : o.token ?? '';
  return [o.bill_no, where].filter(Boolean).join(' · ');
}
