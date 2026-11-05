import type { KotStatus, Order, TakeawayView } from '@dhaba/shared';

/** Kitchen progress order; the takeaway shows its least advanced live KOT. */
const PROGRESS: KotStatus[] = ['NEW', 'PREPARING', 'READY', 'SERVED'];

export interface TakeawayRow {
  id: string;
  token: string;
  rowVersion: number;
  itemCount: number;
  /** null = nothing sent to the kitchen yet. */
  kitchen: KotStatus | null;
  paid: boolean;
  grandTotal: string;
  balanceDue: string;
  customer: string | null;
  createdAt: string;
}

/** Food is Ready (or already Served at the counter) — the handover step can be offered. */
export function isFoodReady(row: TakeawayRow): boolean {
  return row.kitchen === 'READY' || row.kitchen === 'SERVED';
}

/** Paid = the server settled the order (PAID) or nothing is left to pay on a non-empty bill. */
export function isPaid(o: Pick<Order, 'status' | 'balance_due' | 'grand_total'>): boolean {
  if (o.status === 'PAID') return true;
  return Number(o.grand_total) > 0 && Number(o.balance_due) <= 0;
}

/** Least advanced status of the live (non-cancelled) KOTs. */
export function kitchenStatus(o: TakeawayView): KotStatus | null {
  const direct = o.kot_status ?? o.kitchen_status;
  if (direct) return direct;
  const live = (o.kots ?? []).map((k) => k.status).filter((s) => PROGRESS.includes(s));
  if (live.length === 0) return null;
  return PROGRESS[Math.min(...live.map((s) => PROGRESS.indexOf(s)))];
}

/** Item count: the server's figure, else the quantities of the active lines. */
export function itemCount(o: TakeawayView): number {
  if (typeof o.item_count === 'number') return o.item_count;
  const lines = [...(o.items ?? o.order_items ?? []), ...(o.kots ?? []).flatMap((k) => k.lines ?? [])];
  const seen = new Set<string>();
  let n = 0;
  for (const l of lines) {
    if (seen.has(l.id) || l.status === 'CANCELLED') continue;
    seen.add(l.id);
    n += l.quantity;
  }
  return n;
}

/**
 * Active takeaways (REQ-040/REQ-041): not handed over and not exception-closed or cancelled. A Ready but unpaid
 * token stays. Newest token first, as in the design.
 */
export function activeTakeaways(rows: readonly TakeawayView[]): TakeawayRow[] {
  return rows
    .filter((o) => (o.order_type ?? 'TAKEAWAY') === 'TAKEAWAY' && !o.handed_over_at
      && o.status !== 'CANCELLED' && o.status !== 'CLOSED_EXCEPTION')
    .map((o) => ({
      id: o.id,
      token: o.token ?? '',
      rowVersion: o.row_version,
      itemCount: itemCount(o),
      kitchen: kitchenStatus(o),
      paid: isPaid(o),
      grandTotal: o.grand_total,
      balanceDue: o.balance_due,
      customer: [o.customer_name, o.customer_phone].filter(Boolean).join(' · ') || null,
      createdAt: o.created_at,
    }))
    .sort((a, b) => b.token.localeCompare(a.token) || b.createdAt.localeCompare(a.createdAt));
}

export type CustomerError = 'nameTooLong' | 'phoneDigits';

/**
 * Body for POST /orders/takeaway (REQ-039): name and phone are optional; a phone, when given, is 4 to 10 digits
 * (the last 4 digits are enough). Empty fields are left out.
 */
export function takeawayBody(name: string, phone: string):
  { ok: true; body: Partial<Order> } | { ok: false; error: CustomerError } {
  const n = name.trim();
  const p = phone.replace(/\s/g, '');
  if (n.length > 40) return { ok: false, error: 'nameTooLong' };
  if (p && !/^\d{4,10}$/.test(p)) return { ok: false, error: 'phoneDigits' };
  const body: Partial<Order> = { order_type: 'TAKEAWAY' };
  if (n) body.customer_name = n;
  if (p) body.customer_phone = p;
  return { ok: true, body };
}
