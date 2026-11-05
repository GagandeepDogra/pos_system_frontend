import type { Role } from '@dhaba/shared';

/** Design-system rules that screens consult instead of deciding on their own. */

export const BREAKPOINTS = { base: 360, tablet: 768, desktop: 1024 } as const;
export const PRESS_MS = 150;
export const SHEET_MS = 150;

/** Table grid columns for a viewport width (mirrors `.table-grid` in primitives.css). */
export function tableGridColumns(width: number): number {
  if (width >= BREAKPOINTS.desktop) return 6;
  if (width >= BREAKPOINTS.tablet) return 4;
  return 2;
}

/**
 * Staff actions that may ask for confirmation (REQ-090): only irreversible or money actions.
 * Everything else (adding an item, changing a quantity, switching a tab) happens at once.
 */
const CONFIRMED_ACTIONS = new Set(['sendToKitchen', 'pay', 'cancelItem', 'cancelOrder', 'closeWithBalance', 'voidPayment']);

export function needsConfirm(action: string): boolean {
  return CONFIRMED_ACTIONS.has(action);
}

/** The dark theme is offered only on a device locked to the kitchen role (REQ-092). */
export function darkThemeAllowed(deviceRole: Role | null): boolean {
  return deviceRole === 'KITCHEN';
}

/**
 * Staff screens by depth (REQ-088): dashboard is level 0, a list/grid level 1, its detail level 2.
 * New staff screens must be added here; the tests fail on a third level.
 */
export const STAFF_SCREENS: Record<string, { depth: 0 | 1 | 2 }> = {
  dashboard: { depth: 0 },
  tables: { depth: 1 },
  takeaway: { depth: 1 },
  kitchen: { depth: 1 },
  bills: { depth: 1 },
  chooseFood: { depth: 2 },
  order: { depth: 2 },
  payment: { depth: 2 },
};

/** Screens a workflow passes through before its green confirmation (at most three). */
export const STAFF_FLOWS: Record<string, string[]> = {
  dineInToKitchen: ['tables', 'chooseFood'],
  billAndPay: ['bills', 'payment'],
  takeaway: ['takeaway', 'chooseFood'],
  kitchenStatus: ['kitchen'],
  cancelItem: ['tables', 'order'],
};

export const MAX_DEPTH = 2;
export const MAX_FLOW_SCREENS = 3;

/** WCAG relative-luminance contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = hex.replace('#', '');
    const [r, g, bl] = [0, 2, 4].map((i) => {
      const c = parseInt(n.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
