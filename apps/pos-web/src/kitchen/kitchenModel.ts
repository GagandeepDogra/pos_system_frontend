import type { KitchenKotLine, KitchenKotView, KotStatus } from '@dhaba/shared';

/** Default late limit when the settings cannot be read (REQ-055). */
export const DEFAULT_LATE_MINUTES = 15;

/** The three board columns, in order (REQ-051). SERVED KOTs stay in Ready until their hide time. */
export const BOARD_COLUMNS: readonly KotStatus[] = ['NEW', 'PREPARING', 'READY'];

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * Copies only the fields the kitchen card needs. Lines may come as kitchen lines
 * (`item_name`, `cancelled`) or as order items (`item_name_snapshot`, `status`).
 * No price, amount or total is ever copied (REQ-021).
 */
export function normaliseLine(raw: Raw): KitchenKotLine {
  return {
    id: String(raw.id ?? ''),
    item_id: str(raw.item_id),
    item_name: str(raw.item_name) ?? str(raw.item_name_snapshot) ?? '',
    item_name_hi: str(raw.item_name_hi) ?? str(raw.item_name_hi_snapshot),
    variant_name: str(raw.variant_name) ?? str(raw.variant_name_snapshot),
    quantity: num(raw.quantity) ?? num(raw.qty) ?? 1,
    note: str(raw.note),
    cancelled: raw.cancelled === true || raw.status === 'CANCELLED',
  };
}

export function normaliseKot(raw: Raw): KitchenKotView {
  const lines = (Array.isArray(raw.lines) ? raw.lines : Array.isArray(raw.items) ? raw.items : []) as Raw[];
  return {
    id: String(raw.id ?? ''),
    kot_number: num(raw.kot_number) ?? 0,
    business_date: String(raw.business_date ?? ''),
    order_id: String(raw.order_id ?? ''),
    status: (str(raw.status) ?? 'NEW') as KotStatus,
    idempotency_key: String(raw.idempotency_key ?? ''),
    sent_at: String(raw.sent_at ?? ''),
    served_at: str(raw.served_at),
    hide_after: str(raw.hide_after),
    ready_at: str(raw.ready_at),
    order_type: raw.order_type === 'TAKEAWAY' || raw.order_type === 'DINE_IN' ? raw.order_type : null,
    table_label: str(raw.table_label) ?? str(raw.table_label_snapshot) ?? str(raw.table_number),
    token: str(raw.token),
    minutes_waiting: num(raw.minutes_waiting),
    is_late: typeof raw.is_late === 'boolean' ? raw.is_late : null,
    lines: lines.map(normaliseLine),
    created_at: String(raw.created_at ?? ''),
    created_by: String(raw.created_by ?? ''),
    updated_at: String(raw.updated_at ?? ''),
    updated_by: String(raw.updated_by ?? ''),
    row_version: num(raw.row_version) ?? 0,
  };
}

/** Whole minutes since the KOT was sent; the server's figure when the time is unreadable. */
export function minutesWaiting(kot: KitchenKotView, now: number): number {
  const sent = Date.parse(kot.sent_at);
  if (Number.isNaN(sent)) return kot.minutes_waiting ?? 0;
  return Math.max(0, Math.floor((now - sent) / 60_000));
}

/** Late = still New/Preparing and waiting longer than the limit (16 min with 15 is late, 14 is not). */
export function isLate(kot: KitchenKotView, now: number, limit: number = DEFAULT_LATE_MINUTES): boolean {
  if (kot.status !== 'NEW' && kot.status !== 'PREPARING') return false;
  return kot.is_late === true || minutesWaiting(kot, now) > limit;
}

/** The one legal next step a kitchen card offers (REQ-052). Ready → Served is the waiter's, on the phone. */
export function nextStatus(status: KotStatus): KotStatus | null {
  if (status === 'NEW') return 'PREPARING';
  if (status === 'PREPARING') return 'READY';
  return null;
}

/** Hidden: cancelled, or past `hide_after` (10 min after Served or payment, REQ-054). */
export function isVisible(kot: KitchenKotView, now: number): boolean {
  if (kot.status === 'CANCELLED') return false;
  if (!kot.hide_after) return true;
  const hide = Date.parse(kot.hide_after);
  return Number.isNaN(hide) || now < hide;
}

export function columnOf(status: KotStatus): KotStatus {
  return status === 'SERVED' ? 'READY' : status;
}

/** Oldest first (REQ-051); KOT number breaks ties. */
export function oldestFirst(a: KitchenKotView, b: KitchenKotView): number {
  const d = (Date.parse(a.sent_at) || 0) - (Date.parse(b.sent_at) || 0);
  return d !== 0 ? d : a.kot_number - b.kot_number;
}

/** Visible KOTs split into the NEW, PREPARING and READY columns, each oldest first. */
export function boardColumns(kots: readonly KitchenKotView[], now: number): Record<string, KitchenKotView[]> {
  const cols: Record<string, KitchenKotView[]> = { NEW: [], PREPARING: [], READY: [] };
  for (const k of [...kots].sort(oldestFirst)) {
    if (!isVisible(k, now)) continue;
    cols[columnOf(k.status)]?.push(k);
  }
  return cols;
}

/** 'Table 5' or 'T-003': who the KOT is for. */
export function kotTarget(kot: KitchenKotView): { kind: 'table' | 'token'; label: string } {
  if (kot.token && kot.order_type !== 'DINE_IN') return { kind: 'token', label: kot.token };
  return { kind: 'table', label: kot.table_label ?? '' };
}

/** 'HH:mm' in the device's local time. */
export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** KOT #037 */
export function kotNumberLabel(n: number): string {
  return String(n).padStart(3, '0');
}

/** A short two-tone beep through Web Audio (no audio file to load). Silent where audio is unavailable. */
export function playKotAlert(): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.gain.value = 0.25;
    gain.connect(ctx.destination);
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.frequency.value = freq;
      osc.connect(gain);
      osc.start(ctx.currentTime + i * 0.18);
      osc.stop(ctx.currentTime + i * 0.18 + 0.15);
    });
    setTimeout(() => void ctx.close(), 600);
  } catch {
    /* audio blocked until the first touch; the card highlight still shows */
  }
}
