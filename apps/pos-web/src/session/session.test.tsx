import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { User } from '@dhaba/shared';
import { App } from '../App';
import { isExpired, loadSession, saveSession, sessionDeadline, SESSION_MAX_MS, type Session } from './session';
import { canOpen, homeScreen, setDeviceLock } from './deviceLock';
import { APPROVAL_TTL_MS, createApprovalHolder } from './approval';
import { createHealthMonitor, ConnectionProvider, HEALTH_INTERVAL_MS } from '../offline/connection';
import { PendingButton } from '../components/PendingButton';
import { I18nProvider } from '../i18n/I18nProvider';

const user = (id: string, display_name: string, role: User['role'], extra: Partial<User> = {}): User => ({
  id, display_name, role, language: 'en', is_active: true, failed_pin_count: 0, token_version: 1,
  created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1, ...extra,
});

const RAMESH = user('use_r', 'Ramesh', 'CASHIER');
const OWNER = user('use_o', 'Owner', 'ADMIN');
const COOK = user('use_k', 'Cook', 'KITCHEN');

type Handler = (init: RequestInit & { url: string }) => { status: number; body?: unknown };

function fakeServer(routes: Record<string, Handler>) {
  const calls: { url: string; method: string; headers: Record<string, string>; body?: unknown }[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const path = url.replace('/api/v1', '').split('?')[0];
    calls.push({ url: path, method, headers: (init.headers ?? {}) as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const h = routes[`${method} ${path}`];
    if (!h) return new Response(JSON.stringify({ code: 'NOT_FOUND' }), { status: 404 });
    const r = h({ ...init, url: path });
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const baseRoutes = (staff: User[] = [RAMESH, OWNER]): Record<string, Handler> => ({
  'GET /health': () => ({ status: 200, body: { status: 'green' } }),
  'GET /auth/staff': () => ({ status: 200, body: staff }),
  'GET /settings': () => ({ status: 200, body: { shift_end_time: null } }),
  'POST /auth/login': (init) => {
    const b = JSON.parse(String(init.body)) as { user_id: string; pin: string };
    if (b.pin !== '1234') return { status: 401, body: { code: 'UNAUTHORIZED', details: { remaining_tries: 3 } } };
    const u = [RAMESH, OWNER, COOK].find((x) => x.id === b.user_id)!;
    return { status: 200, body: { token: `tok-${u.id}`, user: u } };
  },
});

const typePin = (pin: string) => {
  for (const d of pin) fireEvent.click(screen.getByRole('button', { name: d }));
};

async function loginAs(name: string, pin = '1234') {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  typePin(pin);
}

describe('Login with staff tiles (REQ-024)', () => {
  it('REQ-024: only active staff get a tile; a deactivated member is gone on next load', async () => {
    const { fetchImpl } = fakeServer(baseRoutes([RAMESH, user('use_x', 'Gone', 'CASHIER', { is_active: false })]));
    render(<App fetchImpl={fetchImpl} />);
    expect(await screen.findByRole('button', { name: /Ramesh/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Gone/ })).toBeNull();
  });

  it('REQ-024: GET /auth/staff is called without a token', async () => {
    const { fetchImpl, calls } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    await screen.findByRole('button', { name: /Ramesh/ });
    const staffCall = calls.find((c) => c.url === '/auth/staff')!;
    expect(staffCall.headers.Authorization).toBeUndefined();
  });

  it('REQ-024: a wrong PIN shakes the keypad once and shows the remaining tries', async () => {
    const { fetchImpl } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Ramesh', '9999');
    expect(await screen.findByText('Wrong PIN. 3 tries left.')).toBeInTheDocument();
    expect(screen.getByTestId('pin-pad')).toHaveClass('pin-pad--shake');
    await waitFor(() => expect(screen.getByTestId('pin-pad')).not.toHaveClass('pin-pad--shake'), { timeout: 1000 });
  });

  it('REQ-024: a correct PIN stores the token and opens the dashboard', async () => {
    const { fetchImpl } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Ramesh');
    expect(await screen.findByRole('heading', { name: 'Hello, Ramesh' })).toBeInTheDocument();
    expect(loadSession()?.token).toBe('tok-use_r');
  });
});

describe('User switch (REQ-027)', () => {
  it('REQ-027: tapping the top-bar name opens the staff tiles from any screen and drops the token', async () => {
    const { fetchImpl } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Ramesh');
    fireEvent.click(await screen.findByRole('button', { name: /Dine-in/ }));
    expect(screen.getByTestId('screen-tables')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ramesh · Switch user' })[0]);
    expect(await screen.findByRole('heading', { name: 'Who is working?' })).toBeInTheDocument();
    expect(loadSession()).toBeNull();
    expect(JSON.stringify(localStorage)).not.toContain('tok-use_r');
  });
});

describe('Device role lock (REQ-022)', () => {
  it('REQ-022: a kitchen-locked tablet returns to the Kitchen screen after a reload without the staff tiles', async () => {
    setDeviceLock('KITCHEN');
    saveSession({ token: 'tok-use_k', user: COOK, loginAt: Date.now() - 20 * 3600_000, kitchenDevice: true, shiftEnd: '15:00' });
    const { fetchImpl } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    expect(screen.getByTestId('screen-kitchen')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Who is working?' })).toBeNull();
  });

  it('REQ-022: a kitchen-locked device cannot open cashier screens', () => {
    expect(homeScreen('KITCHEN')).toBe('kitchen');
    for (const s of ['dashboard', 'tables', 'takeaway', 'bills', 'chooseFood', 'order', 'payment', 'admin']) {
      expect(canOpen('KITCHEN', s)).toBe(false);
    }
    expect(canOpen(null, 'tables')).toBe(true);
  });

  it('REQ-022: a kitchen-locked device asks for a kitchen-device login', async () => {
    setDeviceLock('KITCHEN');
    const { fetchImpl, calls } = fakeServer(baseRoutes([COOK]));
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Cook');
    expect(await screen.findByTestId('screen-kitchen')).toBeInTheDocument();
    expect(calls.find((c) => c.url === '/auth/login')?.body).toMatchObject({ kitchen_device: true });
    expect(screen.queryByRole('button', { name: /Home/ })).toBeInTheDocument();
  });
});

describe('Admin approval (REQ-023, REQ-031)', () => {
  const routes = () => ({
    ...baseRoutes(),
    'POST /auth/approvals': (init: RequestInit) => {
      const b = JSON.parse(String(init.body)) as { pin: string };
      return b.pin === '4321'
        ? { status: 201, body: { approval_token: 'appr-1', admin_id: 'use_o' } }
        : { status: 403, body: { code: 'FORBIDDEN' } };
    },
  });

  it('REQ-031: a Cashier dashboard has no ADMIN button', async () => {
    const { fetchImpl } = fakeServer(routes());
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Ramesh');
    await screen.findByRole('heading', { name: 'Hello, Ramesh' });
    expect(screen.queryByRole('button', { name: 'ADMIN' })).toBeNull();
  });

  it('REQ-031: tapping ADMIN without the PIN keeps the admin area closed; the PIN opens it', async () => {
    const { fetchImpl, calls } = fakeServer(routes());
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Owner');
    fireEvent.click(await screen.findByRole('button', { name: 'ADMIN' }));
    expect(screen.getByRole('dialog', { name: 'Owner PIN' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'ADMIN' }));
    typePin('1111');
    expect(await screen.findByText("This is not the owner's PIN.")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin' })).toBeNull();
    typePin('4321');
    expect(await screen.findByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    const approvalCall = calls.find((c) => c.url === '/auth/approvals')!;
    expect(approvalCall.headers['Idempotency-Key']).toBeTruthy();
    expect(approvalCall.headers.Authorization).toBe('Bearer tok-use_o');
  });

  it('REQ-023: an approval token is used once and expires after 2 minutes', () => {
    let now = 0;
    const holder = createApprovalHolder(() => now);
    holder.put('appr-1', 'use_o');
    expect(holder.take()).toBe('appr-1');
    expect(holder.take()).toBeNull();
    holder.put('appr-2', 'use_o');
    now = APPROVAL_TTL_MS;
    expect(holder.take()).toBeNull();
  });
});

describe('Session expiry (REQ-026)', () => {
  const base: Session = { token: 't', user: RAMESH, loginAt: new Date(2026, 10, 5, 9, 0).getTime(), kitchenDevice: false, shiftEnd: null };

  it('REQ-026: a session ends after 12 hours', () => {
    expect(isExpired(base, base.loginAt + SESSION_MAX_MS - 1)).toBe(false);
    expect(isExpired(base, base.loginAt + SESSION_MAX_MS)).toBe(true);
  });

  it('REQ-026: a cashier session ends at the configured shift end', () => {
    const s = { ...base, shiftEnd: '15:00' };
    expect(sessionDeadline(s)).toBe(new Date(2026, 10, 5, 15, 0).getTime());
  });

  it('REQ-026: a kitchen device session does not end at shift end', () => {
    expect(sessionDeadline({ ...base, shiftEnd: '15:00', kitchenDevice: true })).toBeNull();
  });

  it('REQ-026: at shift end the cashier is logged out to the staff tiles', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date(2026, 10, 5, 14, 59, 30));
    saveSession({ ...base, loginAt: Date.now(), shiftEnd: '15:00' });
    const { fetchImpl } = fakeServer(baseRoutes());
    render(<App fetchImpl={fetchImpl} />);
    expect(screen.getByRole('heading', { name: 'Hello, Ramesh' })).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(90_000); });
    expect(await screen.findByRole('heading', { name: 'Who is working?' })).toBeInTheDocument();
    expect(loadSession()).toBeNull();
    vi.useRealTimers();
  });

  it('REQ-026: a 401 from the server (token older than 12 h) logs the device out', async () => {
    saveSession({ ...base, loginAt: Date.now() });
    const { fetchImpl } = fakeServer({ ...baseRoutes(), 'GET /tables': () => ({ status: 401, body: { code: 'UNAUTHORIZED' } }), 'PATCH /me/language': () => ({ status: 401 }) });
    render(<App fetchImpl={fetchImpl} />);
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(await screen.findByRole('heading', { name: /कौन काम|Who is working/ })).toBeInTheDocument();
    expect(loadSession()).toBeNull();
  });
});

describe('Offline banner (REQ-016)', () => {
  it('REQ-016: while offline the health check is retried every 3 seconds', async () => {
    vi.useFakeTimers();
    const check = vi.fn().mockResolvedValue(false);
    const onChange = vi.fn();
    const m = createHealthMonitor(check, onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledWith(false);
    await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(4);
    m.stop();
    vi.useRealTimers();
  });

  it('REQ-016: Send and Pay are disabled with a red banner offline, re-enabled on return, nothing sent on reconnect', async () => {
    vi.useFakeTimers();
    let up = false;
    const check = vi.fn(async () => up);
    const send = vi.fn();
    const cart = ['Dal Makhani × 2'];
    const { ConnectionLine } = await import('../offline/connection');
    render(
      <I18nProvider lang="en">
        <ConnectionProvider check={check}>
          <ConnectionLine />
          <p>{cart.join(', ')}</p>
          <PendingButton pending={false} onClick={send}>{'Send to Kitchen'}</PendingButton>
          <PendingButton pending={false} onClick={send}>{'Pay'}</PendingButton>
        </ConnectionProvider>
      </I18nProvider>,
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(screen.getByRole('alert')).toHaveTextContent('No connection');
    expect(screen.getByRole('button', { name: 'Send to Kitchen' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeDisabled();
    up = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(HEALTH_INTERVAL_MS); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send to Kitchen' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Pay' })).toBeEnabled();
    expect(screen.getByText('Dal Makhani × 2')).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});

describe('Language per user (REQ-008)', () => {
  it('REQ-008: switching to hi keeps the kitchen button as "रसोई / Kitchen" and leaves other users alone', async () => {
    const { fetchImpl } = fakeServer({
      ...baseRoutes(),
      'PATCH /me/language': () => ({ status: 200, body: { ...RAMESH, language: 'hi', row_version: 2 } }),
    });
    render(<App fetchImpl={fetchImpl} />);
    await loginAs('Ramesh');
    await screen.findByRole('heading', { name: 'Hello, Ramesh' });
    fireEvent.click(screen.getByRole('button', { name: 'हिन्दी' }));
    expect(await screen.findByRole('button', { name: 'रसोई / Kitchen' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Ramesh · यूज़र बदलें' })[0]);
    await loginAs('Owner');
    expect(await screen.findByRole('button', { name: 'Kitchen' })).toBeInTheDocument();
  });
});
