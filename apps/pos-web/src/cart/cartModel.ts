import type { FoodType, MenuItemView, Variant } from '@dhaba/shared';
import { formatRupees } from './menuModel';

/**
 * The on-device cart (REQ-047, REQ-048, REQ-050). Unsent lines live only on
 * this device; the server prices every line again when the KOT is created.
 */
export const MAX_QTY = 99;
export const MAX_NOTE = 80;
/** Quick note chips, in the order shown (REQ-048). Keys under `food.chips.*`. */
export const NOTE_CHIPS = ['lessSpicy', 'extraSpicy', 'noOnion', 'parcel'] as const;

export interface CartLine {
  lineId: string;
  itemId: string;
  variantId: string;
  nameEn: string;
  nameHi: string;
  variantName: string;
  foodType: FoodType;
  unitPrice: string;
  quantity: number;
  note: string | null;
}

export interface SentLine extends CartLine {
  kotNumber: number;
}

export interface Cart {
  /** 'table:<id>' or 'order:<id>'. */
  key: string;
  /** The order the lines go to; null until a dine-in session is opened. */
  orderId: string | null;
  lines: CartLine[];
  sent: SentLine[];
  /** Idempotency-Key of the session-opening POST, kept until the server confirms. */
  openKey: string | null;
  /** Idempotency-Key of the pending Send, kept until the server answers (REQ-118). */
  sendKey: string | null;
}

export function emptyCart(key: string, orderId: string | null = null): Cart {
  return { key, orderId, lines: [], sent: [], openKey: null, sendKey: null };
}

export type CartError = 'qtyMax' | 'noteTooLong' | 'unavailable' | 'empty';
export type CartResult = { ok: true; cart: Cart } | { ok: false; error: CartError };

let seq = 0;
const newLineId = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** Adds one of a variant; the same variant without a note bumps the existing line. */
export function addVariant(cart: Cart, item: MenuItemView, variant: Variant): CartResult {
  if (!item.is_active || !item.available_today || !variant.is_active) return { ok: false, error: 'unavailable' };
  const same = cart.lines.find((l) => l.variantId === variant.id && !l.note);
  if (same) return changeQty(cart, same.lineId, 1);
  const line: CartLine = {
    lineId: newLineId(), itemId: item.id, variantId: variant.id, nameEn: item.name_en, nameHi: item.name_hi,
    variantName: variant.name, foodType: item.food_type, unitPrice: variant.price, quantity: 1, note: null,
  };
  return { ok: true, cart: { ...cart, lines: [...cart.lines, line], sendKey: null } };
}

/** +1 / −1. Above 99 is rejected; − on 1 removes the line. */
export function changeQty(cart: Cart, lineId: string, delta: number): CartResult {
  const line = cart.lines.find((l) => l.lineId === lineId);
  if (!line) return { ok: true, cart };
  const quantity = line.quantity + delta;
  if (quantity > MAX_QTY) return { ok: false, error: 'qtyMax' };
  const lines = quantity < 1
    ? cart.lines.filter((l) => l.lineId !== lineId)
    : cart.lines.map((l) => (l.lineId === lineId ? { ...l, quantity } : l));
  // Changing what will be sent means the next Send is a new request with a new key.
  return { ok: true, cart: { ...cart, lines, sendKey: null } };
}

/** Joins chosen chips and free text: 'No onion, Parcel, less oil'. */
export function composeNote(chips: string[], text: string): string {
  return [...chips, text.trim()].filter(Boolean).join(', ');
}

export function setNote(cart: Cart, lineId: string, note: string): CartResult {
  const clean = note.trim();
  if (clean.length > MAX_NOTE) return { ok: false, error: 'noteTooLong' };
  const lines = cart.lines.map((l) => (l.lineId === lineId ? { ...l, note: clean || null } : l));
  return { ok: true, cart: { ...cart, lines, sendKey: null } };
}

export function itemCount(lines: CartLine[]): number {
  return lines.reduce((n, l) => n + l.quantity, 0);
}

/** Display total in rupees (integer paise, so 0.1 + 0.2 never shows). The bill uses the server's figures. */
export function cartTotal(lines: CartLine[]): string {
  return formatRupees(lines.reduce((p, l) => p + Math.round(Number(l.unitPrice) * 100) * l.quantity, 0) / 100);
}

export function lineTotal(line: CartLine): string {
  return formatRupees((Math.round(Number(line.unitPrice) * 100) * line.quantity) / 100);
}

/** POST /orders/{id}/kots body: only the lines not yet sent (REQ-049). */
export function sendBody(cart: Cart) {
  return { lines: cart.lines.map((l) => ({ variant_id: l.variantId, quantity: l.quantity, note: l.note })) };
}

/** After the server confirms the KOT: the lines move under 'Sent to kitchen' and the cart is empty. */
export function markSent(cart: Cart, kotNumber: number): Cart {
  return { ...cart, sent: [...cart.sent, ...cart.lines.map((l) => ({ ...l, kotNumber }))], lines: [], sendKey: null };
}

/**
 * Variant ids named in an ITEM_UNAVAILABLE 422. Accepts `details` as an array
 * of ids or lines, or as `{lines | rejected | rejected_lines | items: [...]}`.
 */
export function rejectedVariantIds(details: unknown): string[] {
  const list = Array.isArray(details)
    ? details
    : details && typeof details === 'object'
      ? (['lines', 'rejected', 'rejected_lines', 'items'] as const)
          .map((k) => (details as Record<string, unknown>)[k])
          .find(Array.isArray) ?? []
      : [];
  return (list as unknown[])
    .map((x) => (typeof x === 'string' ? x : x && typeof x === 'object' ? (x as { variant_id?: unknown }).variant_id : undefined))
    .filter((x): x is string => typeof x === 'string');
}

/** Drops only the rejected lines; every other line stays in the cart (REQ-045). */
export function dropRejected(cart: Cart, variantIds: string[]): { cart: Cart; removed: CartLine[] } {
  const bad = new Set(variantIds);
  const removed = cart.lines.filter((l) => bad.has(l.variantId));
  return { cart: { ...cart, lines: cart.lines.filter((l) => !bad.has(l.variantId)), sendKey: null }, removed };
}

/**
 * Fits a stored cart to the table as it is now: a free table starts a new
 * session (unsent lines kept, old order and sent list dropped); an occupied
 * table adopts the server's order id.
 */
export function reconcile(cart: Cart, serverOrderId: string | null, tableFree: boolean): Cart {
  if (tableFree && cart.orderId && !cart.openKey) return { ...cart, orderId: null, sent: [], sendKey: null };
  if (serverOrderId && cart.orderId !== serverOrderId) return { ...cart, orderId: serverOrderId, sent: [], openKey: null };
  return cart;
}
