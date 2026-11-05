import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KitchenKotView, Kot, Setting } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import { RealtimeProvider, createMemoryChannel } from '../realtime/realtime';
import type { ApiResult } from '../api/client';
import { KitchenScreen, type KitchenApi } from './KitchenScreen';
import { KitchenNotices } from '../kitchen/KitchenNotices';
import { boardColumns, isLate, nextStatus, normaliseKot } from '../kitchen/kitchenModel';
import kitchenCss from '../styles/kitchen.css?raw';
import primitivesCss from '../styles/primitives.css?raw';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 3 };
const NOW = Date.parse('2026-11-05T08:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const kot = (id: string, n: number, status: Kot['status'], min: number, extra: Partial<KitchenKotView> = {}): KitchenKotView => ({
  id, kot_number: n, business_date: '2026-11-05', order_id: `o_${id}`, status, idempotency_key: id, sent_at: ago(min),
  table_label: String(n), order_type: 'DINE_IN',
  lines: [{ id: `${id}_l`, item_name: 'Dal Makhani', variant_name: 'Full', quantity: 1, note: null, cancelled: false }],
  ...audit, ...extra,
});
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });

function fakeApi(initial: KitchenKotView[]) {
  let kots = initial;
  const api: KitchenApi & { set: (k: KitchenKotView[]) => void } = {
    set: (k) => { kots = k; },
    listKitchenKots: vi.fn(async () => ok(kots)),
    updateKotStatus: vi.fn(async (id: string, _rv: number, to: Kot['status']) => {
      kots = kots.map((k) => (k.id === id ? { ...k, status: to, row_version: k.row_version + 1 } : k));
      return ok(kots.find((k) => k.id === id) as Kot);
    }),
    getSettings: vi.fn(async () => ok({ late_kot_minutes: 15 } as Setting)),
    getMenu: vi.fn(async () => ok({ items: [{ id: 'ite_dal', name_en: 'Dal Makhani', name_hi: 'दाल', is_active: true, available_today: true, category_id: 'c', short_code: 'DM', food_type: 'VEG', variants: [], ...audit }] } as never)),
    markItemOutOfStock: vi.fn(async () => ok({} as never)),
  };
  return api;
}

function renderBoard(api: KitchenApi, opts: { role?: 'KITCHEN' | 'CASHIER'; sound?: () => void } = {}) {
  const channel = createMemoryChannel();
  const sound = opts.sound ?? vi.fn();
  render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <RealtimeProvider channel={channel}>
          <KitchenScreen api={api} userName="Suresh" role={opts.role ?? 'KITCHEN'} deviceRole={opts.role === 'CASHIER' ? null : 'KITCHEN'}
            onSwitchUser={() => undefined} onHome={() => undefined} playSound={sound} />
        </RealtimeProvider>
      </ConnectionProvider>
    </I18nProvider>,
  );
  return { channel, sound };
}

const column = (name: RegExp) => screen.getByRole('region', { name });

afterEach(() => { vi.useRealTimers(); });

describe('Kitchen board model (REQ-051, REQ-052, REQ-054, REQ-055)', () => {
  it('REQ-051: the older of two NEW KOTs comes first', () => {
    const cols = boardColumns([kot('b', 2, 'NEW', 1), kot('a', 1, 'NEW', 5)], NOW);
    expect(cols.NEW.map((k) => k.id)).toEqual(['a', 'b']);
  });
  it('REQ-052: a card offers only the next legal step; never NEW → READY', () => {
    expect(nextStatus('NEW')).toBe('PREPARING');
    expect(nextStatus('PREPARING')).toBe('READY');
    expect(nextStatus('READY')).toBeNull();
    expect(nextStatus('SERVED')).toBeNull();
  });
  it('REQ-054: a Served KOT hides after hide_after; a Ready KOT without it stays after 30 min', () => {
    const served = kot('s', 1, 'SERVED', 40, { served_at: ago(10), hide_after: ago(0) });
    const servedRecent = kot('r', 2, 'SERVED', 20, { served_at: ago(2), hide_after: new Date(NOW + 8 * 60_000).toISOString() });
    const waiting = kot('w', 3, 'READY', 30, { hide_after: null });
    const ids = boardColumns([served, servedRecent, waiting], NOW).READY.map((k) => k.id);
    expect(ids).toEqual(['w', 'r']);
    expect(boardColumns([servedRecent], NOW + 10 * 60_000).READY).toHaveLength(0);
  });
  it('REQ-055: with the default limit 16 min is Late and 14 min is not', () => {
    expect(isLate(kot('a', 1, 'NEW', 16), NOW)).toBe(true);
    expect(isLate(kot('b', 2, 'PREPARING', 14), NOW)).toBe(false);
    expect(isLate(kot('c', 3, 'READY', 40), NOW)).toBe(false);
  });
  it('REQ-021: the kitchen projection keeps no price, even if a server sent one', () => {
    const raw = { ...kot('a', 1, 'NEW', 1), grand_total: '220.00', items: undefined, lines: [
      { id: 'l', item_name_snapshot: 'Butter Chicken', variant_name_snapshot: 'Half', quantity: 1, unit_price: '220.00', line_total: '220.00', status: 'ACTIVE' },
    ] };
    const json = JSON.stringify(normaliseKot(raw as unknown as Record<string, unknown>));
    expect(json).not.toContain('220');
    expect(json).toContain('Butter Chicken');
  });
});

describe('Kitchen board screen (REQ-051 – REQ-056, REQ-021)', () => {
  it('REQ-051: three columns, oldest first, with KOT number, table/token, items, notes and minutes', async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    const api = fakeApi([
      kot('k2', 38, 'NEW', 1, { table_label: null, token: 'T-003', order_type: 'TAKEAWAY' }),
      kot('k1', 37, 'NEW', 2, { lines: [{ id: 'x', item_name: 'Butter Chicken', variant_name: 'Half', quantity: 1, note: 'Less spicy', cancelled: false }] }),
    ]);
    renderBoard(api);
    const newCol = await waitFor(() => column(/new/i));
    await waitFor(() => expect(within(newCol).getAllByRole('article')).toHaveLength(2));
    const cards = within(newCol).getAllByRole('article');
    expect(cards[0]).toHaveTextContent('Table 37');
    expect(cards[0]).toHaveTextContent('KOT #037');
    expect(cards[0]).toHaveTextContent('2 min');
    expect(cards[0]).toHaveTextContent('1 × Butter Chicken — Half');
    expect(cards[0]).toHaveTextContent('Less spicy');
    expect(cards[1]).toHaveTextContent('T-003');
    expect(screen.getByRole('region', { name: /preparing/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /ready/i })).toBeInTheDocument();
  });

  it('REQ-051: a cancelled item on a NEW KOT is struck through and says Cancelled', async () => {
    const api = fakeApi([kot('k1', 1, 'NEW', 1, { lines: [
      { id: 'a', item_name: 'Dal Makhani', variant_name: 'Full', quantity: 1, cancelled: false },
      { id: 'b', item_name: 'Jeera Rice', variant_name: 'Half', quantity: 1, cancelled: true },
    ] })]);
    renderBoard(api);
    const line = await screen.findByText('1 × Jeera Rice — Half');
    expect(line.tagName).toBe('S');
    expect(line.closest('li')).toHaveTextContent('Cancelled');
    expect(kitchenCss).toMatch(/\.kot-line--cancelled \.kot-line__text \{[^}]*line-through/);
  });

  it('REQ-052: START PREPARING then MARK READY move the card one step at a time', async () => {
    const api = fakeApi([kot('k1', 1, 'NEW', 1)]);
    renderBoard(api);
    fireEvent.click(await screen.findByRole('button', { name: /start preparing/i }));
    await waitFor(() => expect(api.updateKotStatus).toHaveBeenCalledWith('k1', 3, 'PREPARING'));
    const ready = await within(column(/preparing/i)).findByRole('button', { name: /mark ready/i });
    fireEvent.click(ready);
    await waitFor(() => expect(api.updateKotStatus).toHaveBeenLastCalledWith('k1', 4, 'READY'));
    await waitFor(() => expect(within(column(/^ready/i)).getByText(/ready for pickup/i)).toBeInTheDocument());
    // No card ever asks to go straight from New to Ready.
    expect(api.updateKotStatus).not.toHaveBeenCalledWith('k1', 3, 'READY');
  });

  it('REQ-052: a rejected step shows a red bar and refreshes the board', async () => {
    const api = fakeApi([kot('k1', 1, 'NEW', 1)]);
    (api.updateKotStatus as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 422, error: { code: 'ILLEGAL_TRANSITION', message_en: 'x', message_hi: 'x', details: null },
    });
    renderBoard(api);
    fireEvent.click(await screen.findByRole('button', { name: /start preparing/i }));
    expect(await screen.findByText(/changed on another screen/i)).toBeInTheDocument();
    expect(api.listKitchenKots).toHaveBeenCalledTimes(2);
  });

  it('REQ-053: a new KOT plays the sound, appears in NEW within 3 s and stays highlighted until touched', async () => {
    const api = fakeApi([kot('k1', 1, 'NEW', 3)]);
    const { channel, sound } = renderBoard(api);
    await screen.findByTestId('kot-k1');
    expect(screen.getByTestId('kot-k1')).not.toHaveAttribute('data-fresh');
    api.set([kot('k1', 1, 'NEW', 3), kot('k2', 2, 'NEW', 0)]);
    const t0 = Date.now();
    act(() => channel.emit('kot.created', { id: 'k2' }));
    const card = await screen.findByTestId('kot-k2', undefined, { timeout: 3000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(within(column(/new/i)).getByTestId('kot-k2')).toBe(card);
    await waitFor(() => expect(card).toHaveAttribute('data-fresh', 'true'));
    expect(sound).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(card);
    expect(screen.getByTestId('kot-k2')).not.toHaveAttribute('data-fresh');
  });

  it('REQ-053: after a reconnect the board catches up with KOTs it missed', async () => {
    const api = fakeApi([]);
    const { channel, sound } = renderBoard(api);
    await waitFor(() => expect(screen.getAllByText('0 tickets')).toHaveLength(3));
    api.set([kot('k9', 9, 'NEW', 0)]);
    act(() => channel.reconnect());
    const card = await screen.findByTestId('kot-k9');
    await waitFor(() => expect(card).toHaveAttribute('data-fresh', 'true'));
    expect(sound).toHaveBeenCalled();
  });

  it('REQ-055: a card waiting 16 minutes shows Late, one at 14 does not', async () => {
    vi.useFakeTimers({ now: NOW, shouldAdvanceTime: true });
    renderBoard(fakeApi([kot('late', 1, 'PREPARING', 16), kot('ok', 2, 'PREPARING', 14)]));
    const late = await screen.findByTestId('kot-late');
    expect(late).toHaveTextContent('Late · 16 min');
    expect(screen.getByTestId('kot-ok')).not.toHaveTextContent(/late/i);
  });

  it('REQ-021: when a KOT arrives on the kitchen tablet no price is visible', async () => {
    renderBoard(fakeApi([kot('k1', 1, 'NEW', 1, { lines: [{ id: 'l', item_name: 'Butter Chicken', variant_name: 'Half', quantity: 1, cancelled: false }] })]));
    await screen.findByTestId('kot-k1');
    expect(document.body.textContent).not.toMatch(/₹|220/);
  });

  it('REQ-056: the kitchen marks one item out of stock', async () => {
    const api = fakeApi([]);
    renderBoard(api);
    fireEvent.click(await screen.findByRole('button', { name: 'Out of stock' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Dal Makhani' }));
    fireEvent.click(screen.getByRole('button', { name: 'YES' }));
    await waitFor(() => expect(api.markItemOutOfStock).toHaveBeenCalledWith('ite_dal'));
    expect(await screen.findByText(/out of stock for today/i)).toBeInTheDocument();
  });

  it('REQ-056: a cashier opening the board gets no out-of-stock button and no dark screen choice', async () => {
    renderBoard(fakeApi([]), { role: 'CASHIER' });
    await screen.findByTestId('screen-kitchen');
    expect(screen.queryByRole('button', { name: 'Out of stock' })).toBeNull();
    expect(screen.queryByRole('group', { name: /screen colour/i })).toBeNull();
  });

  it('REQ-092: the kitchen device offers the dark screen and applies it to the board', async () => {
    renderBoard(fakeApi([]));
    fireEvent.click(await screen.findByRole('button', { name: 'Dark screen' }));
    expect(document.querySelector('.kitchen-root')).toHaveClass('theme-kitchen-dark');
    localStorage.clear();
  });

  it('REQ-091: three side-by-side columns on a landscape tablet; no animation on the board', () => {
    expect(primitivesCss).toMatch(/@media \(min-width: 768px\) and \(orientation: landscape\), \(min-width: 1024px\) \{\s*\.status-columns \{ grid-template-columns: repeat\(3/);
    expect(kitchenCss).not.toMatch(/animation:|transition:/);
  });
});

describe('Cashier notices (REQ-052, REQ-056)', () => {
  it('REQ-052: marking Ready shows a food-ready chip; REQ-056: out of stock shows an alert', async () => {
    const channel = createMemoryChannel();
    render(
      <I18nProvider lang="en">
        <RealtimeProvider channel={channel}><KitchenNotices /></RealtimeProvider>
      </I18nProvider>,
    );
    act(() => channel.emit('kot.status_changed', { id: 'k1', status: 'READY', table_label: '5' }));
    expect(screen.getByTestId('notice-ready')).toHaveTextContent('Food ready · Table 5');
    act(() => channel.emit('kot.status_changed', { id: 'k1', status: 'PREPARING' }));
    expect(screen.getAllByTestId('notice-ready')).toHaveLength(1);
    act(() => channel.emit('menu.availability_changed', { id: 'ite_dal', name_en: 'Dal Makhani', available_today: false }));
    expect(screen.getByTestId('notice-out')).toHaveTextContent('Out of stock: Dal Makhani');
  });
});
