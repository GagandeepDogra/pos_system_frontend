import { ROLES, type Role } from '@dhaba/shared';

/**
 * Device role lock (REQ-022), set once per device by an Admin and kept in
 * local storage. A locked device opens straight to its role's screen and
 * cannot open other roles' screens. The server still checks the role on
 * every call.
 */
const KEY = 'dhaba.deviceRole';

export function getDeviceLock(storage: Storage = localStorage): Role | null {
  const v = storage.getItem(KEY);
  return (ROLES as readonly string[]).includes(v ?? '') ? (v as Role) : null;
}

export function setDeviceLock(role: Role | null, storage: Storage = localStorage): void {
  if (role) storage.setItem(KEY, role);
  else storage.removeItem(KEY);
}

/** Screens a device locked to each role may open. */
const LOCKED_SCREENS: Record<Role, readonly string[]> = {
  KITCHEN: ['kitchen'],
  CASHIER: ['dashboard', 'tables', 'takeaway', 'kitchen', 'bills', 'chooseFood', 'order', 'payment'],
  ADMIN: ['dashboard', 'tables', 'takeaway', 'kitchen', 'bills', 'chooseFood', 'order', 'payment', 'admin'],
};

export function canOpen(lock: Role | null, screen: string): boolean {
  return lock === null || LOCKED_SCREENS[lock].includes(screen);
}

/** The screen a device opens to after login or reload. */
export function homeScreen(lock: Role | null): string {
  return lock === 'KITCHEN' ? 'kitchen' : 'dashboard';
}
