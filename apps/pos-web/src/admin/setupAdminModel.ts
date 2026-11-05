import type { DiningTable, Role, Setting, TableView, User } from '@dhaba/shared';

/**
 * Pure helpers for the admin tables, staff and settings screens (REQ-075, REQ-076, REQ-080, REQ-025).
 * Every check here mirrors one the server repeats; the server stays the judge.
 * Error results are i18n keys.
 */

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---------- tables ----------

export interface TableDraft { table_number: string; area: string; seats: string }

export const emptyTableDraft = (): TableDraft => ({ table_number: '', area: '', seats: '' });

export const tableDraftOf = (t: DiningTable): TableDraft =>
  ({ table_number: t.table_number, area: t.area ?? '', seats: t.seats == null ? '' : String(t.seats) });

/** Number required (≤ 10), unique among known tables (active or not), seats empty or a whole number 1–99. */
export function tableError(d: TableDraft, tables: DiningTable[], ownId?: string): string | null {
  const n = d.table_number.trim();
  if (!n) return 'adminSetup.errors.tableNumberRequired';
  if (n.length > 10) return 'adminSetup.errors.tableNumberLong';
  if (tables.some((t) => t.id !== ownId && same(t.table_number, n))) return 'adminSetup.errors.tableDuplicate';
  if (d.seats.trim() && !/^\d{1,2}$/.test(d.seats.trim())) return 'adminSetup.errors.seats';
  if (d.seats.trim() && Number(d.seats) < 1) return 'adminSetup.errors.seats';
  return null;
}

/** Body for create/update: empty area or seats are sent as null (area null = only under All). */
export function tableBody(d: TableDraft): Pick<DiningTable, 'table_number' | 'area' | 'seats'> {
  return {
    table_number: d.table_number.trim(),
    area: d.area.trim() || null,
    seats: d.seats.trim() ? Number(d.seats) : null,
  };
}

/** A table with an open (OPEN or BILLED) order cannot be deactivated; the server re-checks (409). */
export function tableHasOpenOrder(t: DiningTable | TableView): boolean {
  const v = t as Partial<TableView>;
  if (v.status) return v.status !== 'AVAILABLE';
  if (v.order_status) return v.order_status === 'OPEN' || v.order_status === 'BILLED';
  return Boolean(v.order_id);
}

// ---------- staff ----------

export interface StaffDraft { display_name: string; role: Role; pin: string }

export const emptyStaffDraft = (): StaffDraft => ({ display_name: '', role: 'CASHIER', pin: '' });

/** At least 4 digits, digits only (REQ-119). */
export function pinError(pin: string): string | null {
  return /^\d{4,}$/.test(pin) ? null : 'adminSetup.errors.pin';
}

/** Name required (≤ 40) and not used by another ACTIVE user (case-insensitive). */
export function staffNameError(name: string, users: User[], ownId?: string): string | null {
  const n = name.trim();
  if (!n) return 'adminSetup.errors.nameRequired';
  if (n.length > 40) return 'adminSetup.errors.nameLong';
  if (users.some((u) => u.id !== ownId && u.is_active && same(u.display_name, n))) return 'adminSetup.errors.nameDuplicate';
  return null;
}

export function staffError(d: StaffDraft, users: User[]): string | null {
  return staffNameError(d.display_name, users) ?? pinError(d.pin);
}

export function staffBody(d: StaffDraft): { display_name: string; role: Role; pin: string } {
  return { display_name: d.display_name.trim(), role: d.role, pin: d.pin };
}

/** Locked while locked_until is in the future (5 wrong PINs → 5 minutes, REQ-025). */
export function isLocked(u: Pick<User, 'locked_until'>, now: number = Date.now()): boolean {
  if (!u.locked_until) return false;
  const until = Date.parse(u.locked_until);
  return Number.isFinite(until) && until > now;
}

/** Minutes left on a lock, rounded up (at least 1 while locked). */
export function lockMinutesLeft(u: Pick<User, 'locked_until'>, now: number = Date.now()): number {
  if (!isLocked(u, now)) return 0;
  return Math.max(1, Math.ceil((Date.parse(u.locked_until as string) - now) / 60000));
}

/** The unlock PATCH: clearing locked_until; the server also resets failed_pin_count. */
export const UNLOCK_BODY: Partial<User> = { locked_until: null };

/** The only other active Admin cannot be demoted or deactivated (keeps one owner able to log in). */
export function isLastActiveAdmin(u: User, users: User[]): boolean {
  return u.role === 'ADMIN' && u.is_active && !users.some((o) => o.id !== u.id && o.role === 'ADMIN' && o.is_active);
}

// ---------- settings ----------

export interface SettingsDraft {
  dhaba_name: string; address: string; phone: string; gst_number: string; gst_rate_percent: string;
  receipt_footer: string; token_reset_time: string; late_kot_minutes: string;
}

export function settingsDraftOf(s: Setting): SettingsDraft {
  return {
    dhaba_name: s.dhaba_name ?? '', address: s.address ?? '', phone: s.phone ?? '',
    gst_number: s.gst_number ?? '', gst_rate_percent: s.gst_rate_percent ?? '',
    receipt_footer: s.receipt_footer ?? '', token_reset_time: s.token_reset_time ?? '04:00',
    late_kot_minutes: s.late_kot_minutes == null ? '15' : String(s.late_kot_minutes),
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Field → i18n error key. GST number and rate are optional (REQ-080). */
export function settingsErrors(d: SettingsDraft): Partial<Record<keyof SettingsDraft, string>> {
  const e: Partial<Record<keyof SettingsDraft, string>> = {};
  if (!d.dhaba_name.trim()) e.dhaba_name = 'adminSetup.errors.required';
  else if (d.dhaba_name.trim().length > 80) e.dhaba_name = 'adminSetup.errors.tooLong';
  if (d.address.trim().length > 200) e.address = 'adminSetup.errors.tooLong';
  if (d.phone.trim() && !/^[+\d][\d\s-]{3,14}$/.test(d.phone.trim())) e.phone = 'adminSetup.errors.phone';
  if (d.gst_number.trim().length > 15) e.gst_number = 'adminSetup.errors.gstNumber';
  if (d.gst_rate_percent.trim()) {
    const r = d.gst_rate_percent.trim();
    if (!/^\d{1,2}(\.\d{1,2})?$/.test(r) || Number(r) > 28) e.gst_rate_percent = 'adminSetup.errors.gstRate';
  }
  if (d.receipt_footer.length > 200) e.receipt_footer = 'adminSetup.errors.tooLong';
  if (!HHMM.test(d.token_reset_time.trim())) e.token_reset_time = 'adminSetup.errors.time';
  const m = d.late_kot_minutes.trim();
  if (!/^\d{1,3}$/.test(m) || Number(m) < 1) e.late_kot_minutes = 'adminSetup.errors.minutes';
  return e;
}

/**
 * The PUT body: the current row with the edited fields. An empty GST number or rate is sent as null
 * (not registered / tax off), never as ''.
 */
export function settingsBody(current: Setting, d: SettingsDraft): Partial<Setting> {
  return {
    dhaba_name: d.dhaba_name.trim(),
    address: d.address.trim(),
    phone: d.phone.trim(),
    gst_number: d.gst_number.trim() || null,
    gst_rate_percent: d.gst_rate_percent.trim() ? Number(d.gst_rate_percent).toFixed(2) : null,
    receipt_footer: d.receipt_footer.trim(),
    token_reset_time: d.token_reset_time.trim(),
    shift_end_time: current.shift_end_time ?? null,
    late_kot_minutes: Number(d.late_kot_minutes),
    discount_limit_amount: current.discount_limit_amount,
    kitchen_print_enabled: current.kitchen_print_enabled,
  };
}
