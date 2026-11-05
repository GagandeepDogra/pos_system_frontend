import type { User } from '@dhaba/shared';

/**
 * The signed-in user on this device (REQ-024, REQ-026, REQ-027).
 * Only ONE session is kept: switching user replaces it, so the previous
 * user's token is gone from the device.
 */
export interface Session {
  token: string;
  user: User;
  /** ms epoch of the login. */
  loginAt: number;
  /** Kitchen-locked device: the session does not end at shift end or after 12 h. */
  kitchenDevice: boolean;
  /** 'HH:mm' shift end from settings; null = only the 12 h limit applies. */
  shiftEnd: string | null;
}

const KEY = 'dhaba.session';
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;

export function loadSession(storage: Storage = localStorage): Session | null {
  try {
    const s = JSON.parse(storage.getItem(KEY) ?? 'null') as Session | null;
    return s && typeof s.token === 'string' && s.user ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session, storage: Storage = localStorage): void {
  storage.setItem(KEY, JSON.stringify(s));
}

export function clearSession(storage: Storage = localStorage): void {
  storage.removeItem(KEY);
}

/** Reads `exp` (seconds) from a JWT without verifying it; the server verifies. */
export function jwtExpiry(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** The first time after `from` that the clock shows `hhmm` (local time). */
export function nextShiftEnd(from: number, hhmm: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return null;
  const d = new Date(from);
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (d.getTime() <= from) d.setDate(d.getDate() + 1);
  return d.getTime();
}

/**
 * When the session must end: min(login + 12 h, next shift end, JWT exp).
 * A kitchen device stays logged in (null = no deadline).
 */
export function sessionDeadline(s: Session): number | null {
  if (s.kitchenDevice) return null;
  const limits = [s.loginAt + SESSION_MAX_MS];
  const shift = s.shiftEnd ? nextShiftEnd(s.loginAt, s.shiftEnd) : null;
  if (shift !== null) limits.push(shift);
  const exp = jwtExpiry(s.token);
  if (exp !== null) limits.push(exp);
  return Math.min(...limits);
}

export function isExpired(s: Session, now: number = Date.now()): boolean {
  const deadline = sessionDeadline(s);
  return deadline !== null && now >= deadline;
}
