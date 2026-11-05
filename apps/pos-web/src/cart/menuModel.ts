import type { Category, FoodType, MenuItemView, MenuView, Variant } from '@dhaba/shared';

/** Diet filter: null = ALL, otherwise the food type to keep (REQ-042). */
export type DietFilter = FoodType | null;
export const ALL = null;

export interface MenuData {
  categories: Category[];
  items: MenuItemView[];
}

/** Accepts the GET /menu body as `{categories, items}` or as a bare item array. */
export function normaliseMenu(raw: MenuView | MenuItemView[] | null | undefined): MenuData {
  if (!raw) return { categories: [], items: [] };
  if (Array.isArray(raw)) return { categories: [], items: raw };
  return { categories: raw.categories ?? [], items: raw.items ?? [] };
}

export function activeCategories(menu: MenuData): Category[] {
  return menu.categories.filter((c) => c.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

/** Orderable variants in menu order; an item with none cannot be ordered. */
export function activeVariants(item: MenuItemView): Variant[] {
  return (item.variants ?? []).filter((v) => v.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

/** Lowest active variant price, e.g. Half ₹140 / Full ₹240 → '140'. */
export function startingPrice(item: MenuItemView): string | null {
  const prices = activeVariants(item).map((v) => Number(v.price)).filter((n) => Number.isFinite(n));
  if (prices.length === 0) return null;
  return formatRupees(Math.min(...prices));
}

/** 140 → '140', 22.5 → '22.50'. */
export function formatRupees(amount: number | string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  const paise = Math.round(n * 100);
  const digits = paise % 100 === 0 ? 0 : 2;
  // Indian digit grouping as in the design: 18,450 · 1,25,000.
  return (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: digits, maximumFractionDigits: digits, useGrouping: true });
}

/** Unavailable today, inactive, or without an active variant: greyed and never added (REQ-045). */
export function canOrder(item: MenuItemView): boolean {
  return item.is_active && item.available_today && activeVariants(item).length > 0;
}

/**
 * Items shown for a category and diet filter. Items of an inactive or unknown
 * category are hidden when the menu lists categories.
 */
export function visibleItems(menu: MenuData, categoryId: string | null, diet: DietFilter): MenuItemView[] {
  const live = new Set(activeCategories(menu).map((c) => c.id));
  return menu.items.filter(
    (i) =>
      i.is_active &&
      (menu.categories.length === 0 || live.has(i.category_id)) &&
      (categoryId === null || i.category_id === categoryId) &&
      (diet === null || i.food_type === diet),
  );
}

/** Search starts at two typed letters (REQ-046). */
export const MIN_SEARCH = 2;
export function shouldSearch(q: string): boolean {
  return q.trim().length >= MIN_SEARCH;
}
