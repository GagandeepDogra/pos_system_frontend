import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { deriveTableStatus, type DashboardTiles, type TableView, type User } from '@dhaba/shared';
import { App } from '../App';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import { createMemoryChannel, RealtimeProvider } from '../realtime/realtime';
import type { ApiResult } from '../api/client';
import { DashboardScreen } from './DashboardScreen';
import { TablesScreen } from './TablesScreen';
import { toCard } from './tablesModel';
import sessionCss from '../styles/session.css?raw';
import primitivesCss from '../styles/primitives.css?raw';

const user = (id: string, display_name: string, role: User['role']): User => ({
  id, display_name, role, language: 'en', is_active: true, failed_pin_count: 0, token_version: 1,
  created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1,
});
const RAMESH = user('use_r', 'Ramesh', 'CASHIER');
const OWNER = user('use_o', 'Owner', 'ADMIN');
const COOK = user('use_k', 'Cook', 'KITCHEN');

const table = (n: string, extra: Partial<TableView> = {}): TableView => ({
  id: `din_${n}`, table_number: n, area: 'Hall', seats: 4, is_active: true,
  created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1, status: 'AVAILABLE', ...extra,
});
const occupied = (n: string, extra: Partial<TableView> = {}) =>
  table(n, { status: 'OCCUPIED', running_amount: '460', minutes_open: 18, order_id: `ord_${n}`, ...extra });

/** A mutable fake pos-api: tests change `state` and then emit realtime events. */
function fakeApi(initial: { tables?: TableView[]; dashboard?: Partial<DashboardTiles> & Record<string, unknown> } = {}) {
  const state = {
    tables: initial.tables ?? [],
    dashboard: { active_tables: 0, pending_kots: 0, ready_orders: 0, ...initial.dashboard } as DashboardTiles & Record<string, unknown>,
  };
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    const [path, qs] = url.replace('/api/v1', '').split('?');
    calls.push(`${method} ${path}${qs ? `?${qs}` : ''}`);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    if (path === '/health') return json(200, { status: 'green' });
    if (path === '/auth/staff') return json(200, [RAMESH, OWNER, COOK]);
    if (path === '/settings') return json(200, { shift_end_time: null });
    if (path === '/auth/login') {
      const b = JSON.parse(String(init.body)) as { user_id: string };
      const u = [RAMESH, OWNER, COOK].find((x) => x.id === b.user_id)!;
      return json(200, { token: `tok-${u.id}`, user: u });
    }
    if (path === '/dashboard') {
      const role = String((init.headers as Record<string, string>).Authorization ?? '').includes('use_o') ? 'ADMIN' : 'OTHER';
      const { todays_sales, ...rest } = state.dashboard;
      return json(200, role === 'ADMIN' ? { ...rest, todays_sales } : rest);
    }
    if (path === '/tables') {
      const status = new URLSearchParams(qs).get('status');
      return json(200, status ? state.tables.filter((t) => t.status === status) : state.tables);
    }
    return json(404, { code: 'NOT_FOUND' });
  }) as unknown as typeof fetch;
  return { state, calls, fetchImpl };
}

async function loginAs(name: string) {
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(name) }));
  for (const d of '1234') fireEvent.click(screen.getByRole('button', { name: d }));
  await screen.findByRole('heading', { name: `Hello, ${name}` });
}

function renderApp(api: ReturnType<typeof fakeApi>) {
  const channel = createMemoryChannel();
  render(<App fetchImpl={api.fetchImpl} realtime={() => channel} />);
  return channel;
}

function wrap(node: React.ReactNode, channel = createMemoryChannel()) {
  return (
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <RealtimeProvider channel={channel}>{node}</RealtimeProvider>
      </ConnectionProvider>
    </I18nProvider>
  );
}

const ok = <T,>(data: T): ApiResult<T> => ({ ok: true, status: 200, data } as ApiResult<T>);

function renderTables(tables: () => TableView[], channel = createMemoryChannel()) {
  const listTables = vi.fn(async () => ok(tables()));
  render(wrap(
    <TablesScreen listTables={listTables} userName="Ramesh" onSwitchUser={() => {}} onHome={() => {}} onBack={() => {}} onOpenTable={() => {}} onTakeaway={() => {}} />,
    channel,
  ));
  return { channel, listTables };
}

const cardFor = (n: string) => screen.getByRole('button', { name: new RegExp(`^Table ${n}(?!\\w)`) });

describe('Dashboard primary buttons by role (REQ-028)', () => {
  it('REQ-028: a primary button is at least 45% of a 360 px screen', () => {
    // .dashboard .workspace side padding and the quick-actions gap are both 12 px (--space-3 / --gap-tap).
    expect(sessionCss).toMatch(/\.dashboard \.workspace \{ padding-left: var\(--space-3\); padding-right: var\(--space-3\); \}/);
    expect(sessionCss).toMatch(/\.quick-actions \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); gap: var\(--gap-tap\)/);
    const viewport = 360; const pad = 12; const gap = 12;
    const button = (viewport - 2 * pad - gap) / 2;
    expect(button / viewport).toBeGreaterThanOrEqual(0.45);
  });

  it('REQ-028: a Kitchen user gets the dashboard without the PAYMENT button', async () => {
    renderApp(fakeApi());
    await loginAs('Cook');
    const actions = screen.getByTestId('quick-actions');
    expect(within(actions).queryByRole('button', { name: /Payment/ })).toBeNull();
    expect(within(actions).getByRole('button', { name: /Kitchen/ })).toBeInTheDocument();
  });

  it('REQ-028: a Cashier sees all four buttons in a 2×2 grid', async () => {
    renderApp(fakeApi());
    await loginAs('Ramesh');
    expect(within(screen.getByTestId('quick-actions')).getAllByRole('button')).toHaveLength(4);
  });
});

describe('Dashboard live tiles (REQ-029, REQ-030)', () => {
  it("REQ-029: a Cashier's dashboard has no Today's sales tile; an Admin's has it", async () => {
    const api = fakeApi({ dashboard: { active_tables: 3, pending_kots: 4, ready_orders: 2, todays_sales: '12340' } });
    renderApp(api);
    await loginAs('Ramesh');
    expect(await screen.findByRole('button', { name: /Active tables/ })).toBeInTheDocument();
    expect(screen.queryByText("Today's sales")).toBeNull();
  });

  it("REQ-029: an Admin sees Today's sales", async () => {
    renderApp(fakeApi({ dashboard: { todays_sales: '12340' } }));
    await loginAs('Owner');
    expect(await screen.findByText("Today's sales")).toBeInTheDocument();
    expect(screen.getByText('₹12340')).toBeInTheDocument();
  });

  it('REQ-029: tapping Active tables with 3 Occupied tables lists exactly those 3', async () => {
    const api = fakeApi({
      dashboard: { active_tables: 3 },
      tables: [occupied('1'), table('2'), occupied('3'), table('4', { status: 'READY_TO_CLOSE', running_amount: '620' }), occupied('5')],
    });
    renderApp(api);
    await loginAs('Ramesh');
    fireEvent.click(await screen.findByRole('button', { name: /3\s*Active tables/ }));
    await waitFor(() => expect(within(screen.getByTestId('table-grid')).getAllByRole('button')).toHaveLength(3));
    const labels = within(screen.getByTestId('table-grid')).getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([expect.stringMatching(/^Table 1(?!\w).*Occupied/), expect.stringMatching(/^Table 3(?!\w).*Occupied/), expect.stringMatching(/^Table 5(?!\w).*Occupied/)]);
    expect(api.calls).toContain('GET /tables?status=OCCUPIED');
  });

  it('REQ-030: after a KOT is sent the pending-KOT tile updates within 3 seconds', async () => {
    const api = fakeApi({ dashboard: { pending_kots: 4 } });
    const channel = renderApp(api);
    await loginAs('Ramesh');
    expect(await screen.findByRole('button', { name: /4\s*Kitchen pending/ })).toBeInTheDocument();
    api.state.dashboard.pending_kots = 5;
    const sent = Date.now();
    act(() => channel.emit('kot.created', { id: 'kot_1', order_id: 'ord_1' }));
    await screen.findByRole('button', { name: /5\s*Kitchen pending/ }, { timeout: 3000 });
    expect(Date.now() - sent).toBeLessThan(3000);
  });

  it('REQ-116: a device that missed 2 KOTs while disconnected shows them within 3 s of reconnecting', async () => {
    const api = fakeApi({ dashboard: { pending_kots: 1 } });
    const channel = renderApp(api);
    await loginAs('Ramesh');
    await screen.findByRole('button', { name: /1\s*Kitchen pending/ });
    api.state.dashboard.pending_kots = 3; // two KOTs sent while this device was offline: no events arrived
    const back = Date.now();
    act(() => channel.reconnect());
    await screen.findByRole('button', { name: /3\s*Kitchen pending/ }, { timeout: 3000 });
    expect(Date.now() - back).toBeLessThan(3000);
  });

  it('REQ-028: the Kitchen dashboard shows only kitchen counts', async () => {
    const getDashboard = vi.fn(async () => ok<DashboardTiles>({ active_tables: 2, pending_kots: 1, ready_orders: 0, todays_sales: '1' }));
    render(wrap(
      <DashboardScreen user={COOK} getDashboard={getDashboard} onOpenActiveTables={() => {}} onOpen={() => {}} onSwitchUser={() => {}} onLanguage={() => {}}
        createApproval={vi.fn()} onAdminApproved={() => {}} />,
    ));
    await screen.findByRole('button', { name: /Kitchen pending/ });
    expect(screen.queryByRole('button', { name: /Active tables/ })).toBeNull();
    expect(screen.queryByText("Today's sales")).toBeNull();
  });
});

describe('Table grid with live status (REQ-032, REQ-033)', () => {
  it('REQ-032: deactivating a table removes its card', async () => {
    let rows = [table('1'), table('2')];
    const { channel } = renderTables(() => rows);
    await waitFor(() => expect(cardFor('2')).toBeInTheDocument());
    rows = [table('1'), table('2', { is_active: false })];
    act(() => channel.emit('table.status_changed', { table_id: 'din_2' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Table 2(?!\w)/ })).toBeNull());
    expect(cardFor('1')).toBeInTheDocument();
  });

  it('REQ-013: the grid shows 6 cards per row at desktop width', () => {
    expect(primitivesCss).toMatch(/@media \(min-width: 1024px\) \{\s*\.table-grid \{ grid-template-columns: repeat\(6, minmax\(0, 1fr\)\); \}/);
  });

  it('REQ-032: paying the balance to zero removes the running total and minutes open', async () => {
    let rows = [occupied('2')];
    const { channel } = renderTables(() => rows);
    await waitFor(() => expect(within(cardFor('2')).getByText('₹460')).toBeInTheDocument());
    expect(within(cardFor('2')).getByText('18 min open')).toBeInTheDocument();
    rows = [table('2')];
    act(() => channel.emit('payment.recorded', { order_id: 'ord_2' }));
    await waitFor(() => expect(within(cardFor('2')).queryByText('₹460')).toBeNull());
    expect(within(cardFor('2')).queryByText(/min open/)).toBeNull();
    expect(within(cardFor('2')).getByText('Tap to start')).toBeInTheDocument();
  });

  it('REQ-033: settling the only BILLED order turns Ready to Close into Available', async () => {
    let rows = [table('3', { status: undefined, order_status: 'BILLED', running_amount: '620', minutes_open: 32 })];
    const { channel } = renderTables(() => rows);
    await waitFor(() => expect(cardFor('3')).toHaveAccessibleName(/^Table 3(?!\w).*Ready to close/));
    rows = [table('3', { status: undefined, order_status: null })];
    act(() => channel.emit('table.status_changed', { table_id: 'din_3', status: 'AVAILABLE' }));
    await waitFor(() => expect(cardFor('3')).toHaveAccessibleName(/^Table 3(?!\w).*Available/));
    expect(cardFor('3')).toHaveClass('table-card--available');
  });

  it('REQ-033: opening a session turns an Available card Occupied on every phone', async () => {
    let rows = [table('1')];
    const phoneA = createMemoryChannel();
    const phoneB = createMemoryChannel();
    renderTables(() => rows, phoneA);
    renderTables(() => rows, phoneB);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Table 1(?!\w).*Available/ })).toHaveLength(2));
    rows = [occupied('1', { running_amount: '0', minutes_open: 0 })];
    act(() => { phoneA.emit('table.status_changed', { table_id: 'din_1' }); phoneB.emit('table.status_changed', { table_id: 'din_1' }); });
    await waitFor(() => expect(screen.getAllByRole('button', { name: /^Table 1(?!\w).*Occupied/ })).toHaveLength(2));
  });

  it('REQ-033: sending new items to a billed table turns it from orange back to red within 3 s', async () => {
    let rows = [table('3', { status: 'READY_TO_CLOSE', running_amount: '620' })];
    const { channel } = renderTables(() => rows);
    await waitFor(() => expect(cardFor('3')).toHaveClass('table-card--ready-to-close'));
    rows = [occupied('3', { running_amount: '700' })];
    const sent = Date.now();
    act(() => channel.emit('kot.created', { order_id: 'ord_3' }));
    await waitFor(() => expect(cardFor('3')).toHaveClass('table-card--occupied'), { timeout: 3000 });
    expect(Date.now() - sent).toBeLessThan(3000);
  });

  it('REQ-116: a phone that missed the payment shows the table Available within 3 s of reconnecting', async () => {
    let rows = [occupied('5')];
    const { channel } = renderTables(() => rows);
    await waitFor(() => expect(cardFor('5')).toHaveAccessibleName(/^Table 5(?!\w).*Occupied/));
    rows = [table('5')]; // paid while this phone was offline
    const back = Date.now();
    act(() => channel.reconnect());
    await waitFor(() => expect(cardFor('5')).toHaveAccessibleName(/^Table 5(?!\w).*Available/), { timeout: 3000 });
    expect(Date.now() - back).toBeLessThan(3000);
  });

  it('REQ-116: with no event (a write rejected with 409 emits none) the grid stays as it was', async () => {
    const rows = [occupied('2')];
    const { listTables } = renderTables(() => rows);
    await waitFor(() => expect(cardFor('2')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 300));
    expect(listTables).toHaveBeenCalledTimes(1);
  });

  it('REQ-033: status derives from the order: OPEN → Occupied, BILLED → Ready to Close, none → Available', () => {
    expect(deriveTableStatus('OPEN')).toBe('OCCUPIED');
    expect(deriveTableStatus('BILLED')).toBe('READY_TO_CLOSE');
    expect(deriveTableStatus('PAID')).toBe('AVAILABLE');
    expect(deriveTableStatus(null)).toBe('AVAILABLE');
    expect(toCard(table('1', { status: 'AVAILABLE', running_amount: '5', minutes_open: 3 }), 0)).toMatchObject({ amount: null, minutesOpen: null });
    expect(toCard(occupied('1', { minutes_open: null, opened_at: '2026-11-05T10:00:00Z' }), Date.parse('2026-11-05T10:18:30Z')).minutesOpen).toBe(18);
  });
});

describe('Table area tabs (REQ-036)', () => {
  const rows = [table('1', { area: 'Hall' }), table('2', { area: 'Family' }), table('3', { area: 'Outside' }), table('4', { area: null })];

  it('REQ-036: selecting an area tab shows only that area’s tables', async () => {
    renderTables(() => rows);
    const tabs = await screen.findByRole('group', { name: 'Areas' });
    fireEvent.click(within(tabs).getByRole('button', { name: 'Family' }));
    expect(within(tabs).getByRole('button', { name: 'Family' })).toHaveAttribute('aria-pressed', 'true');
    const cards = within(screen.getByTestId('table-grid')).getAllByRole('button');
    expect(cards.map((c) => c.textContent)).toEqual([expect.stringMatching(/^Table 2(?!\w).*Available/)]);
  });

  it('REQ-036: a table with no area is listed under All only', async () => {
    renderTables(() => rows);
    const tabs = await screen.findByRole('group', { name: 'Areas' });
    expect(within(tabs).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Hall', 'Family', 'Outside']);
    expect(cardFor('4')).toBeInTheDocument();
    for (const a of ['Hall', 'Family', 'Outside']) {
      fireEvent.click(within(tabs).getByRole('button', { name: a }));
      expect(screen.queryByRole('button', { name: /^Table 4(?!\w)/ })).toBeNull();
    }
    fireEvent.click(within(tabs).getByRole('button', { name: 'All' }));
    expect(cardFor('4')).toBeInTheDocument();
  });
});
