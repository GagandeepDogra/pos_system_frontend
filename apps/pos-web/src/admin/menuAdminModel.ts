import { PRICE_CHANGE_REASONS, type Category, type FoodType, type Item, type MenuItemView, type PriceChangeReason, type Variant } from '@dhaba/shared';

/**
 * Admin menu rules checked on the device before a request (REQ-070..074, REQ-094).
 * The server re-checks every one of them; these only save a round trip and show the
 * reason next to the field. Each function returns an i18n key or null.
 */

const norm = (s: string) => s.trim().toLowerCase();

export function categoryError(nameEn: string, all: Category[], selfId?: string): string | null {
  if (!nameEn.trim()) return 'adminMenu.errors.nameRequired';
  if (nameEn.trim().length > 40) return 'adminMenu.errors.nameTooLong';
  if (all.some((c) => c.id !== selfId && norm(c.name_en) === norm(nameEn))) return 'adminMenu.errors.duplicateCategory';
  return null;
}

export const SHORT_CODE_MIN = 2;
export const SHORT_CODE_MAX = 5;

export interface ItemDraft {
  category_id: string;
  name_en: string;
  name_hi: string;
  short_code: string;
  food_type: FoodType;
  photo_url: string;
  kitchen_station: string;
}

export function emptyItemDraft(categoryId: string): ItemDraft {
  return { category_id: categoryId, name_en: '', name_hi: '', short_code: '', food_type: 'VEG', photo_url: '', kitchen_station: '' };
}

export function itemDraftOf(item: Item): ItemDraft {
  return {
    category_id: item.category_id, name_en: item.name_en, name_hi: item.name_hi, short_code: item.short_code,
    food_type: item.food_type, photo_url: item.photo_url ?? '', kitchen_station: item.kitchen_station ?? '',
  };
}

export function itemError(d: ItemDraft, all: Item[], selfId?: string): string | null {
  if (!d.name_en.trim() || !d.name_hi.trim()) return 'adminMenu.errors.nameRequired';
  const code = d.short_code.trim();
  if (code.length < SHORT_CODE_MIN || code.length > SHORT_CODE_MAX) return 'adminMenu.errors.shortCode';
  const others = all.filter((i) => i.id !== selfId);
  if (others.some((i) => i.category_id === d.category_id && norm(i.name_en) === norm(d.name_en))) return 'adminMenu.errors.duplicateItem';
  if (others.some((i) => norm(i.short_code) === norm(code))) return 'adminMenu.errors.duplicateCode';
  return null;
}

/** Body for createItem / updateItem: never carries is_active or available_today (separate actions). */
export function itemBody(d: ItemDraft): Partial<Item> {
  return {
    category_id: d.category_id, name_en: d.name_en.trim(), name_hi: d.name_hi.trim(), short_code: d.short_code.trim().toUpperCase(),
    food_type: d.food_type, photo_url: d.photo_url.trim() || null, kitchen_station: d.kitchen_station.trim() || null,
  };
}

/** A price typed by the Admin: > 0 with at most 2 decimals, returned as a 2 dp string; else null. */
export function parsePrice(raw: string): string | null {
  const s = raw.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? n.toFixed(2) : null;
}

export function variantError(name: string, price: string | null, siblings: Variant[], selfId?: string): string | null {
  if (!name.trim()) return 'adminMenu.errors.nameRequired';
  if (siblings.some((v) => v.id !== selfId && norm(v.name) === norm(name))) return 'adminMenu.errors.duplicateVariant';
  if (price !== null && parsePrice(price) === null) return 'adminMenu.errors.price';
  return null;
}

/**
 * Body for updateVariant (rename / reorder / deactivate). The price is never sent: it changes
 * only through a price change with a reason (REQ-073).
 */
export function variantUpdateBody(p: { name?: string; sort_order?: number; is_active?: boolean }): Partial<Variant> {
  const body: Partial<Variant> = {};
  if (p.name !== undefined) body.name = p.name.trim();
  if (p.sort_order !== undefined) body.sort_order = p.sort_order;
  if (p.is_active !== undefined) body.is_active = p.is_active;
  return body;
}

export function isPriceReason(v: unknown): v is PriceChangeReason {
  return (PRICE_CHANGE_REASONS as readonly unknown[]).includes(v);
}

/** Price change check (REQ-094): new price > 0, different from old, and a reason from the list. */
export function priceChangeError(oldPrice: string, newRaw: string, reason: unknown): string | null {
  const next = parsePrice(newRaw);
  if (next === null) return 'adminPrices.errors.price';
  if (Number(next) === Number(oldPrice)) return 'adminPrices.errors.same';
  if (!isPriceReason(reason)) return 'adminPrices.errors.reason';
  return null;
}

export function priceChangeBody(newRaw: string, reason: PriceChangeReason): { new_price: string; reason: PriceChangeReason } {
  return { new_price: parsePrice(newRaw) as string, reason };
}

export function bySort<T extends { sort_order: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * New sort orders after moving one row up (-1) or down (+1): the two swapped rows only.
 * Returns [] when the row is already at that end.
 */
export function reorder<T extends { id: string; sort_order: number }>(rows: T[], id: string, dir: -1 | 1): { row: T; sort_order: number }[] {
  const list = bySort(rows);
  const i = list.findIndex((r) => r.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return [];
  const a = list[i];
  const b = list[j];
  const sa = a.sort_order === b.sort_order ? j : b.sort_order;
  const sb = a.sort_order === b.sort_order ? i : a.sort_order;
  return [{ row: a, sort_order: sa }, { row: b, sort_order: sb }];
}

export function nextSortOrder(rows: { sort_order: number }[]): number {
  return rows.reduce((m, r) => Math.max(m, r.sort_order), 0) + 1;
}

/** Replace a row by id (or add it), keeping rows the GET did not return, e.g. deactivated ones. */
export function upsert<T extends { id: string }>(rows: T[], row: T): T[] {
  return rows.some((r) => r.id === row.id) ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row];
}

/** Merge a fresh GET /menu with rows known on this device that the GET leaves out (inactive ones). */
export function mergeRows<T extends { id: string }>(known: T[], fresh: T[]): T[] {
  const ids = new Set(fresh.map((r) => r.id));
  return [...fresh, ...known.filter((r) => !ids.has(r.id))];
}

/** Items of one category with their variants split out. */
export function splitMenu(items: MenuItemView[]): { items: Item[]; variants: Variant[] } {
  const variants: Variant[] = [];
  const plain: Item[] = items.map(({ variants: vs, ...item }) => {
    for (const v of vs ?? []) variants.push({ ...v, item_id: v.item_id ?? item.id });
    return item;
  });
  return { items: plain, variants };
}
