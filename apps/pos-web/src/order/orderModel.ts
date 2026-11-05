import type { Kot, OrderDetailView, OrderException, OrderItem, TableView } from '@dhaba/shared';
import { deriveTableStatus } from '@dhaba/shared';

/** One KOT of the order view with its sent lines (REQ-035). */
export interface KotGroup {
  kot: Kot;
  lines: OrderItem[];
}

/** Groups every sent line under its own KOT number, oldest KOT first. */
export function kotGroups(order: OrderDetailView): KotGroup[] {
  const flat = [...(order.items ?? []), ...(order.order_items ?? [])];
  const groups = (order.kots ?? []).map((k) => {
    const nested = [...(k.lines ?? []), ...(k.items ?? [])];
    const kot: Kot = { ...k };
    delete (kot as { lines?: unknown }).lines;
    delete (kot as { items?: unknown }).items;
    return { kot, lines: nested.length ? nested : flat.filter((l) => l.kot_id === k.id) };
  });
  return groups.sort((a, b) => a.kot.kot_number - b.kot.kot_number);
}

/** Lines on the bill: every non-cancelled line of every KOT, at the price captured when ordered (REQ-058). */
export function billLines(groups: KotGroup[]): OrderItem[] {
  return groups.flatMap((g) => g.lines.filter((l) => l.status !== 'CANCELLED'));
}

/** A line on a KOT the kitchen has started needs the Admin PIN to cancel (REQ-083). */
export function cancelNeedsPin(kot: Kot): boolean {
  return kot.status !== 'NEW';
}

/** Lines that can still be cancelled: active, and on a KOT that is not served or cancelled. */
export function canCancel(kot: Kot, line: OrderItem): boolean {
  return line.status === 'ACTIVE' && (kot.status === 'NEW' || kot.status === 'PREPARING' || kot.status === 'READY');
}

export type ReasonError = 'reasonMissing';
export function checkReason(reason: string): ReasonError | null {
  return reason.trim() ? null : 'reasonMissing';
}

export type DiscountMode = 'amount' | 'percent';
export type DiscountError = 'reasonMissing' | 'amountMissing' | 'tooBig' | 'percentTooBig';
export interface DiscountInput {
  mode: DiscountMode;
  value: string;
  reason: string;
}

/** Rupee amount of a discount (percent of the subtotal, 2 dp). The server recomputes it. */
export function discountAmount(input: Pick<DiscountInput, 'mode' | 'value'>, subtotal: string): number {
  const v = Number(input.value);
  if (!Number.isFinite(v)) return NaN;
  const paise = input.mode === 'percent' ? Math.round(Number(subtotal) * v) : Math.round(v * 100);
  return paise / 100;
}

/**
 * Checks a discount before it is sent (REQ-061): a reason, an amount above 0 and not above the subtotal.
 * The body never carries totals; the server recomputes the bill.
 */
export function discountBody(input: DiscountInput, subtotal: string):
  | { ok: true; body: Partial<OrderException> }
  | { ok: false; error: DiscountError } {
  if (input.mode === 'percent' && Number(input.value) > 100) return { ok: false, error: 'percentTooBig' };
  const amount = discountAmount(input, subtotal);
  if (!(amount > 0)) return { ok: false, error: 'amountMissing' };
  if (amount > Number(subtotal)) return { ok: false, error: 'tooBig' };
  if (checkReason(input.reason)) return { ok: false, error: 'reasonMissing' };
  return {
    ok: true,
    body: { exception_type: 'DISCOUNT', reason_code: 'OTHER', reason_text: input.reason.trim(), amount: amount.toFixed(2) },
  };
}

/** A Cashier discount above the configured limit needs an Admin approval (REQ-061). */
export function discountNeedsPin(amount: number, limit: string | null | undefined, isAdmin: boolean): boolean {
  if (isAdmin || limit === null || limit === undefined || limit === '') return false;
  return amount > Number(limit);
}

function statusOf(t: TableView) {
  return t.status ?? deriveTableStatus(t.order_status ?? null);
}

/** Tables an order can move to: free ones only (REQ-037). */
export function moveTargets(tables: TableView[], currentTableId: string | null | undefined): TableView[] {
  return tables.filter((t) => t.id !== currentTableId && statusOf(t) === 'AVAILABLE');
}

/** Tables whose open session can be merged into this one (REQ-037). */
export function mergeSources(tables: TableView[], currentOrderId: string): TableView[] {
  return tables.filter((t) => statusOf(t) !== 'AVAILABLE' && !!t.order_id && t.order_id !== currentOrderId);
}
