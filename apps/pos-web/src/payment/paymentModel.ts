import type { CloseReasonCode, Order, OrderException, OrderItem, Payment, PaymentMethod, Setting } from '@dhaba/shared';

/**
 * Payment screen rules that the client checks before it asks the server (REQ-063/064/068/069).
 * The server re-checks all of them (OVERPAYMENT, reason missing, Admin only); totals always come from it.
 */

/** Quick cash buttons (REQ-063). 'Exact' is the balance itself. */
export const QUICK_CASH = [100, 200, 500, 2000] as const;

const paise = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const rupees = (p: number) => (p / 100).toFixed(2);

/** Change due for cash: tendered − amount, never negative; null while nothing is tendered (REQ-063). */
export function changeDue(amount: string | number, tendered: string | number | null | undefined): number | null {
  if (tendered === null || tendered === undefined || tendered === '') return null;
  const c = paise(tendered) - paise(amount);
  return c < 0 ? null : c / 100;
}

/** Quick-cash amounts that cover the amount being paid. */
export function quickCash(amount: string | number): number[] {
  return QUICK_CASH.filter((q) => q * 100 >= paise(amount));
}

export type PayError = 'amountMissing' | 'overBalance' | 'cashShort';
export interface PayInput {
  method: PaymentMethod;
  amount: string;
  tendered?: string;
  upiRef?: string;
}

/**
 * The body for POST /orders/{id}/payments. The amount may be less than the balance (split, REQ-064) but never
 * more (the server answers 422 OVERPAYMENT anyway). Cash needs tendered ≥ amount; UPI reference is optional.
 */
export function paymentBody(input: PayInput, balanceDue: string):
  | { ok: true; body: Pick<Payment, 'method' | 'amount'> & Partial<Payment> }
  | { ok: false; error: PayError } {
  const amount = paise(input.amount);
  if (!(amount > 0) || !Number.isFinite(amount)) return { ok: false, error: 'amountMissing' };
  if (amount > paise(balanceDue)) return { ok: false, error: 'overBalance' };
  const body: Pick<Payment, 'method' | 'amount'> & Partial<Payment> = { method: input.method, amount: rupees(amount) };
  if (input.method === 'CASH') {
    const tendered = input.tendered ? paise(input.tendered) : amount;
    if (tendered < amount) return { ok: false, error: 'cashShort' };
    body.tendered_amount = rupees(tendered);
  }
  if (input.method === 'UPI' && input.upiRef?.trim()) body.upi_ref = input.upiRef.trim();
  return { ok: true, body };
}

/** Balance after a part is paid (what the screen shows until the refetch lands). */
export function balanceAfter(balanceDue: string, amount: string): number {
  return Math.max(0, paise(balanceDue) - paise(amount)) / 100;
}

/** Settled orders leave the open bills list (REQ-066). */
export function isSettled(order: Pick<Order, 'status' | 'balance_due'>): boolean {
  return order.status === 'PAID' || order.status === 'CLOSED_EXCEPTION' || order.status === 'CANCELLED';
}

/** Open bills to show: OPEN/BILLED with a balance, oldest first (REQ-062). */
export function openBills<T extends Pick<Order, 'status' | 'balance_due' | 'created_at'>>(rows: T[]): T[] {
  return rows
    .filter((o) => !isSettled(o) && paise(o.balance_due) > 0)
    .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''));
}

/** Ready to Close badge: the bill was printed (REQ-062). */
export function readyToClose(order: Pick<Order, 'status'>): boolean {
  return order.status === 'BILLED';
}

/** Payments still counted (SUCCESS); voided rows stay on screen marked Voided (REQ-068). */
export function successPayments(payments: Payment[] | undefined): Payment[] {
  return (payments ?? []).filter((p) => p.status === 'SUCCESS');
}

export type ReasonError = 'reasonMissing';
/** Void needs a reason (REQ-068). */
export function voidReason(reason: string): { ok: true; reason: string } | { ok: false; error: ReasonError } {
  const r = reason.trim();
  return r ? { ok: true, reason: r } : { ok: false, error: 'reasonMissing' };
}

/** Body of a close with balance (REQ-069): a reason code is required; the balance is what is written off. */
export function closeExceptionBody(code: CloseReasonCode | null, text: string, balanceDue: string):
  | { ok: true; body: Partial<OrderException> }
  | { ok: false; error: ReasonError } {
  if (!code) return { ok: false, error: 'reasonMissing' };
  if (code === 'OTHER' && !text.trim()) return { ok: false, error: 'reasonMissing' };
  return {
    ok: true,
    body: { exception_type: 'CLOSE_WITH_BALANCE', reason_code: code, reason_text: text.trim() || null, amount: rupees(paise(balanceDue)) },
  };
}

/** Only an Admin can void or close with a balance; a Cashier needs the Admin PIN first (REQ-068/069). */
export function needsAdminPin(role: string): boolean {
  return role !== 'ADMIN';
}

/** Plain-text receipt for WhatsApp sharing (REQ-067). Labels come from the caller's translator. */
export function receiptText(
  order: Pick<Order, 'bill_no' | 'grand_total' | 'paid_amount' | 'balance_due'>,
  lines: OrderItem[],
  settings: Pick<Setting, 'dhaba_name' | 'receipt_footer'> | null,
  label: { bill: string; total: string; paid: string; money: (v: string) => string },
): string {
  const out: string[] = [];
  if (settings?.dhaba_name) out.push(settings.dhaba_name);
  if (order.bill_no) out.push(`${label.bill} ${order.bill_no}`);
  for (const l of lines) out.push(`${l.quantity} × ${l.item_name_snapshot} (${l.variant_name_snapshot}) ${label.money(l.line_total)}`);
  out.push(`${label.total}: ${label.money(order.grand_total)}`);
  out.push(`${label.paid}: ${label.money(order.paid_amount)}`);
  if (settings?.receipt_footer) out.push(settings.receipt_footer);
  return out.join('\n');
}

export type PrintOutcome = { ok: true } | { ok: false; reason: 'noPrinter' };

/**
 * Browser print (REQ-017). window.print() cannot report a missing printer; when the call itself throws
 * (no print support / no printer) the caller shows a printer error. Never touches the payment (AC 13/15).
 */
export function tryPrint(print: () => void = () => window.print()): PrintOutcome {
  try {
    print();
    return { ok: true };
  } catch {
    return { ok: false, reason: 'noPrinter' };
  }
}

/**
 * Optional kitchen KOT print (REQ-057): only when the setting is on; a printer failure never blocks the KOT,
 * which is already saved and on the kitchen board. Returns whether a print job was started.
 */
export function maybePrintKot(settings: Pick<Setting, 'kitchen_print_enabled'> | null, print: () => void): boolean {
  if (!settings?.kitchen_print_enabled) return false;
  return tryPrint(print).ok;
}
