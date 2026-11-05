import { deriveTableStatus, type TableStatus, type TableView } from '@dhaba/shared';
import type { TableCardData } from '../components/TableGrid';

/** The 'All' area tab; tables with no area are listed only here (REQ-036). */
export const ALL_AREAS = '';

/** Minutes since the session opened: the server's figure, else computed from `opened_at`. */
export function minutesOpen(t: TableView, now: number): number | null {
  if (t.minutes_open != null) return t.minutes_open;
  if (!t.opened_at) return null;
  const ms = now - Date.parse(t.opened_at);
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 60_000)) : null;
}

export function tableStatus(t: TableView): TableStatus {
  return t.status ?? deriveTableStatus(t.order_status);
}

/**
 * Card data for one table. An Available table never shows a running amount or
 * minutes open, even if a stale field is still present (REQ-032).
 */
export function toCard(t: TableView, now: number): TableCardData {
  const status = tableStatus(t);
  const free = status === 'AVAILABLE';
  return {
    id: t.id,
    number: t.table_number,
    status,
    seats: t.seats ?? null,
    amount: free ? null : t.running_amount ?? null,
    minutesOpen: free ? null : minutesOpen(t, now),
    orderId: t.order_id ?? null,
    area: t.area ?? null,
  };
}

/** Active tables only (deactivated tables lose their card, REQ-032). */
export function activeTables(rows: readonly TableView[]): TableView[] {
  return rows.filter((t) => t.is_active !== false);
}

/** Distinct areas in first-seen order; null/blank areas get no tab of their own. */
export function areasOf(rows: readonly TableView[]): string[] {
  const seen: string[] = [];
  for (const t of rows) {
    const a = t.area?.trim();
    if (a && !seen.includes(a)) seen.push(a);
  }
  return seen;
}

export function inArea(rows: readonly TableView[], area: string): TableView[] {
  return area === ALL_AREAS ? [...rows] : rows.filter((t) => t.area?.trim() === area);
}
