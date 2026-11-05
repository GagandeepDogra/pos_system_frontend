import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { KotStatus, Order, TakeawayView } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { createMemoryChannel, RealtimeProvider, type RealtimeChannel } from '../realtime/realtime';
import { TakeawayScreen, type TakeawayApi } from './TakeawayScreen';
import { activeTakeaways, isPaid, itemCount, kitchenStatus, takeawayBody } from '../takeaway/takeawayModel';
import { STAFF_FLOWS } from '../design/rules';
import css from '../styles/takeaway.css?raw';

const audit = { created_at: '2026-11-05T12:00:00+05:30', created_by: 'u', updated_at: '', updated_by: '', row_version: 1 };
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });

function tw(token: string, extra: Partial<TakeawayView> = {}): TakeawayView {
  return {
    id: `ord_${token}`, order_type: 'TAKEAWAY', business_date: '2026-11-05', token, status: 'OPEN', subtotal: '300.00',
    discount_amount: '0.00', tax_amount: '0.00', round_off: '0.00', grand_total: '300.00', paid_amount: '0.00', balance_due: '300.00',
    client_request_id: token, ...audit, item_count: 3, kot_status: 'NEW', ...extra,
  };
}

/**
 * A small fake pos-api with the server's takeaway rules: the next token per business day (T-001 after the
 * cut-off), unique per business_date, repeat key returns the same order, handover only when Ready and paid.
 */
function fakeServer(start: TakeawayView[] = [], businessDate = { value: '2026-11-05' }) {
  let rows = [...start];
  const counters = new Map<string, number>();
  const byKey = new Map<string, Order>();
  const bodies: Partial<Order>[] = [];
  const api = {
    listActiveTakeaways: vi.fn(async () => ok(rows.filter((r) => !r.handed_over_at) as Order[])),
    createTakeaway: vi.fn(async (key: string, body: Partial<Order>) => {
      const seen = byKey.get(key);
      if (seen) return ok(seen, 200);
      bodies.push(body);
      const n = (counters.get(businessDate.value) ?? 0) + 1;
      counters.set(businessDate.value, n);
      const token = `T-${String(n).padStart(3, '0')}`;
      if (rows.some((r) => r.token === token && r.business_date === businessDate.value)) return fail(409, 'CONFLICT');
      const o = tw(token, { id: `ord_${businessDate.value}_${token}`, business_date: businessDate.value, kot_status: null, item_count: 0, ...body });
      rows.push(o);
      byKey.set(key, o);
      return ok(o as Order, 201);
    }),
    handOverTakeaway: vi.fn(async (id: string) => {
      const o = rows.find((r) => r.id === id)!;
      if (o.kot_status !== 'READY' || !isPaid(o)) return fail(422, 'UNPROCESSABLE_ENTITY');
      rows = rows.map((r) => (r.id === id ? { ...r, handed_over_at: '2026-11-05T13:00:00+05:30' } : r));
      return ok({ ...o, handed_over_at: 'now' } as Order);
    }),
  } satisfies TakeawayApi;
  return {
    api, bodies,
    set: (id: string, patch: Partial<TakeawayView>) => { rows = rows.map((r) => (r.id === id ? { ...r, ...patch } : r)); },
  };
}

function renderScreen(server = fakeServer(), channel: RealtimeChannel | null = null) {
  const handlers = { onAddFood: vi.fn(), onCollect: vi.fn(), onViewPayments: vi.fn() };
  const view = render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <RealtimeProvider channel={channel}>
          <TakeawayScreen api={server.api} userName="Ramesh" onSwitchUser={() => {}} onHome={() => {}} onBack={() => {}} {...handlers} />
        </RealtimeProvider>
      </ConnectionProvider>
    </I18nProvider>,
  );
  return { ...server, ...handlers, view };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const card = (token: string) => screen.getAllByTestId('takeaway-card').find((c) => c.dataset.token === token);

async function newTakeaway(phone?: string, name?: string) {
  click('+ New takeaway');
  if (name) fireEvent.change(screen.getByLabelText('Customer name'), { target: { value: name } });
  if (phone) {
    fireEvent.click(screen.getByLabelText('Phone (last 4 digits are enough)'));
    const pad = screen.getByRole('dialog', { name: 'Enter amount' });
    phone.split('').forEach((d) => fireEvent.click(within(pad).getByRole('button', { name: d })));
    fireEvent.click(within(pad).getByRole('button', { name: 'Done' }));
  }
  click('Get token');
  return (await screen.findByTestId('new-token')).textContent;
}

describe('takeaway model', () => {
  it('REQ-039: no name or phone is fine; a 4-digit phone is accepted; bad phones are refused', () => {
    expect(takeawayBody('', '')).toEqual({ ok: true, body: { order_type: 'TAKEAWAY' } });
    expect(takeawayBody(' Asha ', '4321')).toEqual({ ok: true, body: { order_type: 'TAKEAWAY', customer_name: 'Asha', customer_phone: '4321' } });
    expect(takeawayBody('', '123')).toEqual({ ok: false, error: 'phoneDigits' });
    expect(takeawayBody('', '12345678901')).toEqual({ ok: false, error: 'phoneDigits' });
    expect(takeawayBody('x'.repeat(41), '')).toEqual({ ok: false, error: 'nameTooLong' });
  });

  it('REQ-040: kitchen status is the least advanced live KOT; item count adds active line quantities', () => {
    const k = (id: string, status: KotStatus) => ({ id, status }) as never;
    const base = tw('T-001', { kot_status: null, item_count: null });
    expect(kitchenStatus({ ...base, kots: [k('a', 'READY'), k('b', 'PREPARING'), k('c', 'CANCELLED')] })).toBe('PREPARING');
    expect(kitchenStatus({ ...base, kots: [] })).toBeNull();
    expect(itemCount({ ...base, items: [{ id: 'a', quantity: 2, status: 'ACTIVE' }, { id: 'b', quantity: 5, status: 'CANCELLED' }] as never })).toBe(2);
  });

  it('REQ-040/REQ-041: handed-over and closed takeaways leave the list; a Ready unpaid one stays; newest token first', () => {
    const rows = activeTakeaways([
      tw('T-001', { kot_status: 'READY' }), tw('T-002', { handed_over_at: 'x', status: 'PAID' }),
      tw('T-003', { status: 'CANCELLED' }), tw('T-004', { status: 'PAID', paid_amount: '300.00', balance_due: '0.00' }),
    ]);
    expect(rows.map((r) => [r.token, r.paid])).toEqual([['T-004', true], ['T-001', false]]);
  });
});

describe('takeaway screen', () => {
  it('REQ-040: lists token, item count, kitchen status and Paid/Unpaid as designed', async () => {
    renderScreen(fakeServer([tw('T-001', { kot_status: 'READY' }), tw('T-002', { status: 'PAID', kot_status: 'PREPARING', item_count: 4, grand_total: '420.00', paid_amount: '420.00', balance_due: '0.00' }), tw('T-003', { item_count: 2, grand_total: '260.00', balance_due: '260.00' })]));
    await screen.findByText('3 active orders · Today');
    expect(within(card('T-003')!).getByText('2 items · ₹260')).toBeTruthy();
    expect(within(card('T-003')!).getByText('Unpaid')).toBeTruthy();
    expect(within(card('T-003')!).getByText('New')).toBeTruthy();
    expect(within(card('T-002')!).getByText('Paid')).toBeTruthy();
    expect(within(card('T-002')!).getByText('Preparing')).toBeTruthy();
    expect(within(card('T-001')!).getByText('Ready')).toBeTruthy();
    expect(within(card('T-001')!).getByRole('button', { name: 'Collect ₹300 →' })).toBeTruthy();
    expect(screen.getByText('Ready is not paid. Collect payment before handing over.')).toBeTruthy();
    expect(document.querySelectorAll('.btn--primary')).toHaveLength(1);
  });

  it('REQ-038/REQ-039: a takeaway with no name or phone is created and its token shown big', async () => {
    const s = renderScreen();
    expect(await newTakeaway()).toBe('T-001');
    expect(s.bodies[0]).toEqual({ order_type: 'TAKEAWAY' });
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Token' })).getByRole('button', { name: 'Add food →' }));
    expect(s.onAddFood).toHaveBeenCalledWith('T-001', 'ord_2026-11-05_T-001');
  });

  it('REQ-039: a 4-digit phone value is accepted and sent', async () => {
    const s = renderScreen();
    await newTakeaway('4321', 'Asha');
    expect(s.bodies[0]).toEqual({ order_type: 'TAKEAWAY', customer_name: 'Asha', customer_phone: '4321' });
  });

  it('REQ-038: two takeaways (two taps, two keys) get different, consecutive tokens; a retry of one key does not', async () => {
    const s = renderScreen();
    expect(await newTakeaway()).toBe('T-001');
    click('Done');
    expect(await newTakeaway()).toBe('T-002');
    const keys = s.api.createTakeaway.mock.calls.map((c) => c[0]);
    expect(new Set(keys).size).toBe(2);
    // Same key again (a timeout retry) returns the same order, not a new token.
    const again = await s.api.createTakeaway(keys[0], {});
    expect(again.ok && again.data.token).toBe('T-001');
  });

  it('REQ-038: the first takeaway after the business-day cut-off shows T-001', async () => {
    const date = { value: '2026-11-05' };
    renderScreen(fakeServer([], date));
    expect(await newTakeaway()).toBe('T-001');
    click('Done');
    expect(await newTakeaway()).toBe('T-002');
    click('Done');
    date.value = '2026-11-06';
    expect(await newTakeaway()).toBe('T-001');
  });

  it('REQ-038: a token that already exists for the business date is rejected and no token is shown', async () => {
    const s = fakeServer([tw('T-001')]);
    renderScreen(s);
    click('+ New takeaway');
    click('Get token');
    expect(await screen.findByText('That token is already used today. Tap Get token again.')).toBeTruthy();
    expect(screen.queryByTestId('new-token')).toBeNull();
    // 409 is final: the next tap uses a new key.
    click('Get token');
    expect(await screen.findByTestId('new-token')).toBeTruthy();
    const [k1, k2] = s.api.createTakeaway.mock.calls.map((c) => c[0]);
    expect(k1).not.toBe(k2);
  });

  it('REQ-040: HANDED OVER on a Ready, Paid token removes it from the active list', async () => {
    const s = renderScreen(fakeServer([tw('T-001', { kot_status: 'READY', status: 'PAID', paid_amount: '300.00', balance_due: '0.00' }), tw('T-002')]));
    await screen.findByText('2 active orders · Today');
    fireEvent.click(within(card('T-001')!).getByRole('button', { name: 'Handed over' }));
    expect(await screen.findByText('T-001 handed over')).toBeTruthy();
    await waitFor(() => expect(card('T-001')).toBeUndefined());
    expect(s.api.handOverTakeaway).toHaveBeenCalledWith('ord_T-001', 1);
    expect(screen.getByText('1 active orders · Today')).toBeTruthy();
  });

  it('REQ-041: HANDED OVER on a Ready but unpaid token is rejected and the token stays', async () => {
    renderScreen(fakeServer([tw('T-001', { kot_status: 'READY' })]));
    await screen.findByText('1 active orders · Today');
    fireEvent.click(within(card('T-001')!).getByRole('button', { name: 'Handed over' }));
    expect(await screen.findByText('Not paid yet. The token stays in the list.')).toBeTruthy();
    expect(screen.getByText('Collect ₹300 first.')).toBeTruthy();
    expect(card('T-001')).toBeTruthy();
    expect(within(card('T-001')!).getByText('Unpaid')).toBeTruthy();
  });

  it('REQ-041: a takeaway paid while its KOT is NEW stays listed as Paid with the kitchen status New', async () => {
    renderScreen(fakeServer([tw('T-001', { status: 'PAID', paid_amount: '300.00', balance_due: '0.00', kot_status: 'NEW' })]));
    expect(await screen.findByText('Paid')).toBeTruthy();
    expect(within(card('T-001')!).getByText('New')).toBeTruthy();
    expect(within(card('T-001')!).queryByRole('button', { name: 'Handed over' })).toBeNull();
  });

  it('REQ-041: marking an unpaid takeaway Ready keeps the token listed as Unpaid with Collect', async () => {
    const s = fakeServer([tw('T-001', { kot_status: 'PREPARING' })]);
    const channel = createMemoryChannel();
    renderScreen(s, channel);
    await screen.findByText('Preparing');
    s.set('ord_T-001', { kot_status: 'READY' });
    // Any later refetch (a socket event in the app) shows it Ready, still Unpaid.
    await act(async () => { channel.emit('kot.status_changed'); await new Promise((r) => setTimeout(r, 200)); });
    await waitFor(() => expect(within(card('T-001')!).getByText('Ready')).toBeTruthy());
    expect(within(card('T-001')!).getByText('Unpaid')).toBeTruthy();
    fireEvent.click(within(card('T-001')!).getByRole('button', { name: 'Collect ₹300 →' }));
  });

  it('REQ-040: View payments and Collect open the payment screens; a token not yet sent offers Add food', async () => {
    const s = renderScreen(fakeServer([tw('T-001', { kot_status: 'READY' }), tw('T-002', { kot_status: null, item_count: 0 })]));
    await screen.findByText('2 active orders · Today');
    fireEvent.click(within(card('T-001')!).getByRole('button', { name: 'Collect ₹300 →' }));
    expect(s.onCollect).toHaveBeenCalledWith('ord_T-001');
    fireEvent.click(within(card('T-002')!).getByRole('button', { name: 'Add food →' }));
    expect(s.onAddFood).toHaveBeenCalledWith('T-002', 'ord_T-002');
    await act(async () => click('View payments'));
    expect(s.onViewPayments).toHaveBeenCalled();
  });

  it('REQ-088/REQ-092: the takeaway flow stays within three screens; styles use tokens only', () => {
    expect(STAFF_FLOWS.takeaway.length).toBeLessThanOrEqual(3);
    expect(css).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
