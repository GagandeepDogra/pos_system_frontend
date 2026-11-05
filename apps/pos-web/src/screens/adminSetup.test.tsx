import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DiningTable, Setting, TableView, User } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { AdminSettingsSection, AdminStaffSection, AdminTablesSection, type AdminSetupApi } from './AdminSetupScreen';
import { LoginScreen } from './LoginScreen';
import {
  emptyTableDraft, isLastActiveAdmin, isLocked, lockMinutesLeft, pinError, settingsBody, settingsDraftOf, settingsErrors,
  staffNameError, tableBody, tableError, tableHasOpenOrder,
} from '../admin/setupAdminModel';
import { receiptText } from '../payment/paymentModel';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 3 };
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });

const table = (id: string, n: string, extra: Partial<TableView> = {}): TableView =>
  ({ id, table_number: n, area: 'Hall', seats: 4, is_active: true, status: 'AVAILABLE', ...audit, ...extra });
const user = (id: string, name: string, role: User['role'], extra: Partial<User> = {}): User =>
  ({ id, display_name: name, role, language: 'en', is_active: true, failed_pin_count: 0, locked_until: null, token_version: 1, ...audit, ...extra });
const SETTINGS: Setting = {
  id: 's1', dhaba_name: 'Sher-e-Punjab', address: 'NH 44', phone: '9876543210', gst_number: '07AAAAA0000A1Z5', gst_rate_percent: '5.00',
  receipt_footer: 'Thank you', token_reset_time: '04:00', shift_end_time: null, late_kot_minutes: 15, discount_limit_amount: '100.00',
  kitchen_print_enabled: false, ...audit,
};
const NOW = Date.parse('2026-11-05T12:00:00Z');

/** Like the server, the GETs list active rows only. */
function fakeApi(over: Partial<AdminSetupApi> = {}): AdminSetupApi {
  let tables = [table('t1', '1'), table('t5', '5', { status: 'OCCUPIED', order_id: 'o1' })];
  let users = [
    user('u1', 'Gagan', 'ADMIN'),
    user('u2', 'Ravi', 'CASHIER', { failed_pin_count: 5, locked_until: '2026-11-05T12:04:00Z' }),
  ];
  return {
    listTables: vi.fn(async () => ok(tables.filter((r) => r.is_active))),
    createTable: vi.fn(async (_k, b) => ok({ ...table('t9', ''), ...b } as DiningTable, 201)),
    updateTable: vi.fn(async (id, _rv, b) => {
      tables = tables.map((r) => (r.id === id ? { ...r, ...b } : r));
      return ok(tables.find((r) => r.id === id)! as DiningTable);
    }),
    listLoginStaff: vi.fn(async () => ok(users.filter((u) => u.is_active))),
    createUser: vi.fn(async (_k, b) => ok({ ...user('u9', '', 'CASHIER'), ...b } as User, 201)),
    updateUser: vi.fn(async (id, _rv, b) => {
      users = users.map((u) => (u.id === id ? { ...u, ...b } : u));
      return ok(users.find((u) => u.id === id)!);
    }),
    resetUserPin: vi.fn(async (id) => ok(user(id, 'Ravi', 'CASHIER'))),
    getSettings: vi.fn(async () => ok(SETTINGS)),
    updateSettings: vi.fn(async (_rv, b) => ok({ ...SETTINGS, ...b, row_version: 4 } as Setting)),
    ...over,
  };
}

const onResult = vi.fn();
function wrap(node: React.ReactNode) {
  return render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>{node}</ConnectionProvider>
    </I18nProvider>,
  );
}

describe('admin tables, staff and settings model', () => {
  it('REQ-075: a duplicate table number is rejected (case-insensitive, inactive tables too); its own number is not', () => {
    const rows = [table('t1', 'A1'), table('t2', '7', { is_active: false })];
    expect(tableError({ ...emptyTableDraft(), table_number: 'a1' }, rows)).toBe('adminSetup.errors.tableDuplicate');
    expect(tableError({ ...emptyTableDraft(), table_number: '7' }, rows)).toBe('adminSetup.errors.tableDuplicate');
    expect(tableError({ ...emptyTableDraft(), table_number: 'A1' }, rows, 't1')).toBeNull();
    expect(tableError({ table_number: '9', area: '', seats: '0' }, rows)).toBe('adminSetup.errors.seats');
    expect(tableBody({ table_number: ' 9 ', area: '', seats: '' })).toEqual({ table_number: '9', area: null, seats: null });
  });

  it('REQ-075: a table with an OPEN or BILLED order counts as having an open order', () => {
    expect(tableHasOpenOrder(table('t', '1'))).toBe(false);
    expect(tableHasOpenOrder(table('t', '1', { status: 'READY_TO_CLOSE' }))).toBe(true);
    expect(tableHasOpenOrder(table('t', '1', { status: undefined, order_status: 'OPEN' }))).toBe(true);
    expect(tableHasOpenOrder(table('t', '1', { status: undefined, order_status: 'PAID' }))).toBe(false);
  });

  it('REQ-076: a display name used by an ACTIVE user is rejected; an inactive one may be reused; PIN needs 4+ digits', () => {
    const rows = [user('u1', 'Ravi', 'CASHIER'), user('u2', 'Asha', 'CASHIER', { is_active: false })];
    expect(staffNameError('ravi ', rows)).toBe('adminSetup.errors.nameDuplicate');
    expect(staffNameError('Asha', rows)).toBeNull();
    expect(pinError('123')).toBe('adminSetup.errors.pin');
    expect(pinError('12a4')).toBe('adminSetup.errors.pin');
    expect(pinError('1234')).toBeNull();
  });

  it('REQ-025: locked while locked_until is in the future, with minutes left rounded up', () => {
    expect(isLocked({ locked_until: '2026-11-05T12:04:00Z' }, NOW)).toBe(true);
    expect(lockMinutesLeft({ locked_until: '2026-11-05T12:04:00Z' }, NOW)).toBe(4);
    expect(isLocked({ locked_until: '2026-11-05T11:59:00Z' }, NOW)).toBe(false);
    expect(isLocked({ locked_until: null }, NOW)).toBe(false);
  });

  it('REQ-076: the only active Admin cannot be turned off or demoted from this screen', () => {
    const a = user('u1', 'Gagan', 'ADMIN');
    expect(isLastActiveAdmin(a, [a, user('u2', 'Ravi', 'CASHIER')])).toBe(true);
    expect(isLastActiveAdmin(a, [a, user('u3', 'Meena', 'ADMIN')])).toBe(false);
  });

  it('REQ-080: settings without a GST number or rate are valid and send null; bad time and minutes are caught', () => {
    const d = { ...settingsDraftOf(SETTINGS), gst_number: '', gst_rate_percent: '' };
    expect(settingsErrors(d)).toEqual({});
    const body = settingsBody(SETTINGS, d);
    expect(body.gst_number).toBeNull();
    expect(body.gst_rate_percent).toBeNull();
    expect(body.discount_limit_amount).toBe('100.00');
    expect(settingsErrors({ ...d, token_reset_time: '4am', late_kot_minutes: '0', gst_rate_percent: '40' }))
      .toEqual({ token_reset_time: 'adminSetup.errors.time', late_kot_minutes: 'adminSetup.errors.minutes', gst_rate_percent: 'adminSetup.errors.gstRate' });
  });

  it('REQ-080: the receipt prints the footer from the settings it is given (the next receipt reads GET /settings)', () => {
    const order = { bill_no: 'B-1', grand_total: '100.00', paid_amount: '100.00', balance_due: '0.00' } as never;
    const text = receiptText(order, [], { dhaba_name: 'D', receipt_footer: 'Come again soon' },
      { bill: 'Bill', total: 'Total', paid: 'Paid', money: (v: string) => v });
    expect(text).toContain('Come again soon');
  });
});

describe('admin tables screen', () => {
  it('REQ-075: a duplicate table number is blocked in the sheet; a server 409 shows its message; a new one is added', async () => {
    const api = fakeApi();
    wrap(<AdminTablesSection api={api} onResult={onResult} />);
    await screen.findByText('5');
    fireEvent.click(screen.getByRole('button', { name: 'Add table' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Table number'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already used');
    expect(api.createTable).not.toHaveBeenCalled();

    (api.createTable as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail(409, 'DUPLICATE'));
    fireEvent.change(within(dialog).getByLabelText('Table number'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('DUPLICATE message');

    fireEvent.change(within(dialog).getByLabelText('Seats (optional)'), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createTable).toHaveBeenLastCalledWith(expect.any(String),
      { table_number: '12', area: null, seats: 6, is_active: true }));
    const keys = (api.createTable as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]);
    expect(keys[0]).not.toBe(keys[1]); // a 4xx renews the key
  });

  it('REQ-075: rename sends only number/area/seats (past orders keep their own label snapshot)', async () => {
    const api = fakeApi();
    wrap(<AdminTablesSection api={api} onResult={onResult} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit table 1' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Table number'), { target: { value: 'G1' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateTable).toHaveBeenCalledWith('t1', 3, { table_number: 'G1', area: 'Hall', seats: 4 }));
  });

  it('REQ-075: a table with an open order cannot be turned off; a free one asks first, then stays listed to turn back on', async () => {
    const api = fakeApi();
    wrap(<AdminTablesSection api={api} onResult={onResult} />);
    expect(await screen.findByRole('button', { name: 'Turn off 5' })).toBeDisabled();
    expect(screen.getByText('Has an open order')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Turn off 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.updateTable).toHaveBeenCalledWith('t1', 3, { is_active: false }));
    fireEvent.click(await screen.findByRole('button', { name: 'Turn 1 back on' }));
    await waitFor(() => expect(api.updateTable).toHaveBeenLastCalledWith('t1', 3, { is_active: true }));
  });

  it('REQ-075: the server refusing to turn off a table with an OPEN order shows a red bar', async () => {
    onResult.mockClear();
    const api = fakeApi({ updateTable: vi.fn(async () => fail(409, 'TABLE_HAS_OPEN_ORDER')) });
    wrap(<AdminTablesSection api={api} onResult={onResult} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off 1' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', text: 'TABLE_HAS_OPEN_ORDER message' })));
  });
});

describe('admin staff screen', () => {
  it('REQ-076: adding staff blocks a name used by an active user and a short PIN; an Admin PIN clash (409) is shown', async () => {
    const api = fakeApi({ createUser: vi.fn(async () => fail(409, 'ADMIN_PIN_TAKEN')) });
    wrap(<AdminStaffSection api={api} onResult={onResult} now={() => NOW} />);
    await screen.findByText('Ravi');
    fireEvent.click(screen.getByRole('button', { name: 'Add staff' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'ravi' } });
    fireEvent.change(within(dialog).getByLabelText('PIN (4 or more digits)'), { target: { value: '4321' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already used');
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Meena' } });
    fireEvent.change(within(dialog).getByLabelText('PIN (4 or more digits)'), { target: { value: '12' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('4 or more digits');
    expect(api.createUser).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Owner' }));
    fireEvent.change(within(dialog).getByLabelText('PIN (4 or more digits)'), { target: { value: '1111' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createUser).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ display_name: 'Meena', role: 'ADMIN', pin: '1111', is_active: true })));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('ADMIN_PIN_TAKEN message');
  });

  it('REQ-025: a locked user shows the lock and Unlock clears it on the server', async () => {
    const api = fakeApi();
    wrap(<AdminStaffSection api={api} onResult={onResult} now={() => NOW} />);
    expect(await screen.findByText(/Locked for 4 min/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unlock Ravi' }));
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith('u2', 3, { locked_until: null }));
    await waitFor(() => expect(screen.queryByText(/Locked for/)).not.toBeInTheDocument());
  });

  it('REQ-076: change role, reset PIN and deactivate (after a confirm) call the right operations; the only Admin is protected', async () => {
    const api = fakeApi();
    wrap(<AdminStaffSection api={api} onResult={onResult} now={() => NOW} />);
    await screen.findByText('Ravi');
    expect(screen.getByRole('button', { name: 'Turn off Gagan' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Change role of Gagan' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Change role of Ravi' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kitchen' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateUser).toHaveBeenCalledWith('u2', 3, { role: 'KITCHEN' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Reset PIN of Ravi' }));
    dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('New PIN (4 or more digits)'), { target: { value: '9876' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Reset PIN' }));
    await waitFor(() => expect(api.resetUserPin).toHaveBeenCalledWith('u2', 3, '9876'));

    fireEvent.click(await screen.findByRole('button', { name: 'Turn off Ravi' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(api.updateUser).toHaveBeenLastCalledWith('u2', 3, { is_active: false }));
    expect(await screen.findByRole('button', { name: 'Turn Ravi back on' })).toBeInTheDocument();
  });
});

describe('admin settings screen', () => {
  it('REQ-080: saving with the GST number emptied succeeds and sends null', async () => {
    onResult.mockClear();
    const api = fakeApi();
    wrap(<AdminSettingsSection api={api} onResult={onResult} />);
    const gst = await screen.findByLabelText('GST number (optional)');
    fireEvent.change(gst, { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Receipt footer'), { target: { value: 'Come again soon' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalledWith(3,
      expect.objectContaining({ gst_number: null, receipt_footer: 'Come again soon', late_kot_minutes: 15 })));
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' })));
  });

  it('REQ-080: a bad time shows the error on the field and nothing is sent; a 409 loads the current values', async () => {
    onResult.mockClear();
    const api = fakeApi({ updateSettings: vi.fn(async () => ({ ...fail(409, 'STALE'), current: { ...SETTINGS, dhaba_name: 'New name', row_version: 9 } }) as never) });
    wrap(<AdminSettingsSection api={api} onResult={onResult} />);
    const time = await screen.findByLabelText('Token reset time');
    fireEvent.change(time, { target: { value: '25:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    expect(await screen.findByText('Enter the time as HH:MM, like 04:00.')).toBeInTheDocument();
    expect(time).toHaveAttribute('aria-invalid', 'true');
    expect(api.updateSettings).not.toHaveBeenCalled();
    fireEvent.change(time, { target: { value: '05:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(screen.getByLabelText('Dhaba name')).toHaveValue('New name'));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', text: 'Someone else changed the settings.' }));
  });
});

describe('login lockout', () => {
  it('REQ-025: a 423 (locked, even with the right PIN) tells the user to wait or ask the owner', async () => {
    const api = {
      listLoginStaff: vi.fn(async () => ok([user('u2', 'Ravi', 'CASHIER')])),
      login: vi.fn(async () => fail(423, 'USER_LOCKED')),
    };
    wrap(<LoginScreen api={api as never} kitchenDevice={false} onLanguage={() => {}} onLoggedIn={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ravi/ }));
    for (const d of ['1', '2', '3', '4']) fireEvent.click(screen.getByRole('button', { name: d }));
    expect(await screen.findByText(/Locked for 5 minutes/)).toBeInTheDocument();
  });
});
