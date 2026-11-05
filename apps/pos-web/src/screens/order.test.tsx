import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Kot, OrderDetailView, OrderItem, Role, Setting, TableView } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { OrderScreen, type OrderApi } from './OrderScreen';
import { App } from '../App';
import { billLines, discountBody, discountNeedsPin, kotGroups, mergeSources, moveTargets } from '../order/orderModel';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 3 };
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });

const kot = (id: string, n: number, status: Kot['status'] = 'NEW'): Kot =>
  ({ id, kot_number: n, business_date: '2026-11-05', order_id: 'ord_1', status, idempotency_key: id, sent_at: '', ...audit });
const line = (id: string, kotId: string, name: string, variant: string, price: string, qty: number, status: OrderItem['status'] = 'ACTIVE'): OrderItem => ({
  id, order_id: 'ord_1', kot_id: kotId, variant_id: `v_${id}`, item_name_snapshot: name, item_name_hi_snapshot: `${name}-hi`,
  variant_name_snapshot: variant, food_type_snapshot: 'VEG', unit_price: price, quantity: qty,
  line_total: (Number(price) * qty).toFixed(2), status, ...audit,
});

function order(extra: Partial<OrderDetailView> = {}): OrderDetailView {
  return {
    id: 'ord_1', order_type: 'DINE_IN', business_date: '2026-11-05', table_id: 't5', status: 'OPEN', bill_no: null,
    subtotal: '540.60', discount_amount: '0.00', tax_amount: '0.00', round_off: '0.40', grand_total: '541.00',
    paid_amount: '0.00', balance_due: '541.00', client_request_id: 'k', ...audit,
    kots: [kot('k11', 11, 'PREPARING'), kot('k14', 14)],
    items: [
      line('l1', 'k11', 'Butter Chicken', 'Half', '220.00', 1),
      line('l2', 'k11', 'Lassi', 'Salted', '50.00', 2, 'CANCELLED'),
      line('l3', 'k14', 'Dal Makhani', 'Full', '240.00', 1),
      line('l4', 'k14', 'Tandoori Roti', 'Butter', '20.30', 4),
    ],
    ...extra,
  };
}
const tableRow = (id: string, n: string, status: TableView['status'], order_id: string | null = null): TableView =>
  ({ id, table_number: n, is_active: true, area: null, seats: 4, status, order_id, ...audit } as TableView);
const SETTINGS = { gst_rate_percent: null, discount_limit_amount: '100.00' } as unknown as Setting;

function setup(role: Role = 'CASHIER', o: OrderDetailView = order()) {
  let current = o;
  const api = {
    getOrder: vi.fn(async () => ok(current)),
    getSettings: vi.fn(async () => ok(SETTINGS)),
    listTables: vi.fn(async () => ok([
      tableRow('t5', '5', 'OCCUPIED', 'ord_1'), tableRow('t6', '6', 'AVAILABLE'),
      tableRow('t7', '7', 'OCCUPIED', 'ord_7'), tableRow('t8', '8', 'READY_TO_CLOSE', 'ord_8'),
    ])),
    cancelOrderItem: vi.fn(async () => ok(current)),
    moveOrder: vi.fn(async () => ok(current)),
    mergeOrders: vi.fn(async () => ok(current)),
    printBill: vi.fn(async () => ok(current)),
    applyDiscount: vi.fn(async () => ok(current)),
    updateKotStatus: vi.fn(async (id: string) => ok(kot(id, 1, 'SERVED'))),
    createApproval: vi.fn(async () => ok({ approval_token: 'appr_1', admin_id: 'adm' }, 201)),
  } satisfies OrderApi;
  const onAddFood = vi.fn();
  const setOrder = (n: OrderDetailView) => { current = n; };
  render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <OrderScreen orderId="ord_1" table="5" tableId="t5" role={role} api={api} userName="Ramesh"
          onSwitchUser={() => {}} onHome={() => {}} onBack={() => {}} onAddFood={onAddFood} />
      </ConnectionProvider>
    </I18nProvider>,
  );
  return { api, onAddFood, setOrder };
}

const enterPin = () => ['1', '2', '3', '4'].forEach((d) => fireEvent.click(screen.getByRole('button', { name: d })));

describe('order model', () => {
  it('REQ-035: lines are grouped under their own KOT, oldest first, nested or flat', () => {
    const g = kotGroups(order());
    expect(g.map((x) => x.kot.kot_number)).toEqual([11, 14]);
    expect(g[1].lines.map((l) => l.id)).toEqual(['l3', 'l4']);
    const nested = kotGroups(order({ items: [], kots: [{ ...kot('k2', 2), lines: [line('x', 'k2', 'Chai', 'Cup', '20', 1)] }] }));
    expect(nested[0].lines[0].item_name_snapshot).toBe('Chai');
  });

  it('REQ-058: a cancelled line is left off the bill; lines keep the price captured when ordered', () => {
    const lines = billLines(kotGroups(order()));
    expect(lines.map((l) => l.id)).toEqual(['l1', 'l3', 'l4']);
    expect(lines.find((l) => l.id === 'l1')?.unit_price).toBe('220.00');
  });

  it('REQ-061: a discount needs a reason, a positive amount and cannot exceed the subtotal', () => {
    expect(discountBody({ mode: 'amount', value: '50', reason: ' ' }, '500')).toEqual({ ok: false, error: 'reasonMissing' });
    expect(discountBody({ mode: 'amount', value: '600', reason: 'Regular' }, '500')).toEqual({ ok: false, error: 'tooBig' });
    expect(discountBody({ mode: 'amount', value: '', reason: 'Regular' }, '500')).toEqual({ ok: false, error: 'amountMissing' });
    const pct = discountBody({ mode: 'percent', value: '10', reason: 'Regular' }, '540.60');
    expect(pct).toEqual({ ok: true, body: { exception_type: 'DISCOUNT', reason_code: 'OTHER', reason_text: 'Regular', amount: '54.06' } });
  });

  it('REQ-059: the discount body never carries totals (the server recomputes grand_total)', () => {
    const r = discountBody({ mode: 'amount', value: '20', reason: 'Regular' }, '500');
    expect(r.ok && Object.keys(r.body)).not.toContain('grand_total');
  });

  it('REQ-061: only a non-Admin above the limit needs the Admin PIN', () => {
    expect(discountNeedsPin(150, '100', false)).toBe(true);
    expect(discountNeedsPin(100, '100', false)).toBe(false);
    expect(discountNeedsPin(150, '100', true)).toBe(false);
  });

  it('REQ-037: move offers free tables only; merge offers other open tables', () => {
    const tables = [tableRow('t5', '5', 'OCCUPIED', 'ord_1'), tableRow('t6', '6', 'AVAILABLE'), tableRow('t7', '7', 'READY_TO_CLOSE', 'ord_7')];
    expect(moveTargets(tables, 't5').map((t) => t.id)).toEqual(['t6']);
    expect(mergeSources(tables, 'ord_1').map((t) => t.id)).toEqual(['t7']);
  });
});

describe('order view', () => {
  it('REQ-035: KOT 11 and KOT 14 each list their own sent items, with ADD MORE FOOD', async () => {
    const { onAddFood } = setup();
    const kots = await screen.findAllByTestId('order-kot');
    expect(within(kots[0]).getByText('KOT 11')).toBeInTheDocument();
    expect(within(kots[0]).getByText('1 × Butter Chicken')).toBeInTheDocument();
    expect(within(kots[1]).getByText('KOT 14')).toBeInTheDocument();
    expect(within(kots[1]).getByText('1 × Dal Makhani')).toBeInTheDocument();
    expect(within(kots[1]).queryByText('1 × Butter Chicken')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'ADD MORE FOOD' }));
    expect(onAddFood).toHaveBeenCalledWith(expect.objectContaining({ id: 'ord_1' }), '5');
  });

  it('REQ-059: the bill shows the server breakdown; ₹540.60 with no tax is ₹541 and tax says not configured', async () => {
    setup();
    const bill = await screen.findByTestId('bill-card');
    expect(within(bill).queryByText('Lassi')).toBeNull();
    expect(within(bill).getByText('₹540.60')).toBeInTheDocument();
    expect(within(bill).getByText('Tax · Not configured')).toBeInTheDocument();
    expect(within(screen.getByTestId('grand-total')).getByText('₹541')).toBeInTheDocument();
  });

  it('REQ-060: PRINT BILL sends the row version and shows the bill number and Ready to close', async () => {
    const { api, setOrder } = setup();
    await screen.findByTestId('bill-card');
    setOrder(order({ status: 'BILLED', bill_no: 'B-20261105-001' }));
    api.printBill.mockResolvedValueOnce(ok(order({ status: 'BILLED', bill_no: 'B-20261105-001' })));
    fireEvent.click(screen.getByRole('button', { name: 'PRINT BILL' }));
    expect(await screen.findByText('Bill B-20261105-001')).toBeInTheDocument();
    expect(api.printBill).toHaveBeenCalledWith('ord_1', 3);
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Table 5 · Ready to close');
  });

  it('REQ-083: a cancel without a reason is not sent', async () => {
    const { api } = setup();
    const kots = await screen.findAllByTestId('order-kot');
    fireEvent.click(within(kots[1]).getAllByRole('button', { name: 'Cancel' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'YES, cancel' }));
    expect(await screen.findByText('Write a reason.')).toBeInTheDocument();
    expect(api.cancelOrderItem).not.toHaveBeenCalled();
  });

  it('REQ-083: a line on a NEW KOT is cancelled at once with its reason', async () => {
    const { api } = setup();
    const kots = await screen.findAllByTestId('order-kot');
    fireEvent.click(within(kots[1]).getAllByRole('button', { name: 'Cancel' })[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Wrong item' }));
    fireEvent.click(screen.getByRole('button', { name: 'YES, cancel' }));
    await waitFor(() => expect(api.cancelOrderItem).toHaveBeenCalledWith('l3', 3, 'Wrong item', undefined));
    expect(screen.queryByTestId('pin-pad')).toBeNull();
  });

  it('REQ-083: a Cashier cancelling on a PREPARING KOT gets the Admin PIN pad and sends the approval', async () => {
    const { api } = setup('CASHIER');
    const kots = await screen.findAllByTestId('order-kot');
    fireEvent.click(within(kots[0]).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('The kitchen has started. Owner PIN is needed.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Too late' }));
    fireEvent.click(screen.getByRole('button', { name: 'YES, cancel' }));
    expect(await screen.findByTestId('pin-pad')).toBeInTheDocument();
    expect(api.cancelOrderItem).not.toHaveBeenCalled();
    enterPin();
    await waitFor(() => expect(api.cancelOrderItem).toHaveBeenCalledWith('l1', 3, 'Too late', 'appr_1'));
  });

  it('REQ-061: a Cashier discount above the limit asks for the Admin PIN first', async () => {
    const { api } = setup('CASHIER');
    await screen.findByTestId('bill-card');
    fireEvent.click(screen.getByRole('button', { name: 'Discount' }));
    fireEvent.change(screen.getByLabelText('Discount in ₹'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Regular guest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save discount' }));
    expect(await screen.findByTestId('pin-pad')).toBeInTheDocument();
    expect(api.applyDiscount).not.toHaveBeenCalled();
    enterPin();
    await waitFor(() => expect(api.applyDiscount).toHaveBeenCalledWith('ord_1', 3,
      { exception_type: 'DISCOUNT', reason_code: 'OTHER', reason_text: 'Regular guest', amount: '150.00' }, 'appr_1'));
  });

  it('REQ-061: a discount larger than the subtotal or without a reason is not sent', async () => {
    const { api } = setup('ADMIN');
    await screen.findByTestId('bill-card');
    fireEvent.click(screen.getByRole('button', { name: 'Discount' }));
    fireEvent.change(screen.getByLabelText('Discount in ₹'), { target: { value: '900' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save discount' }));
    expect(await screen.findByText('Discount is more than the bill.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Discount in ₹'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save discount' }));
    expect(await screen.findByText('Write a reason.')).toBeInTheDocument();
    expect(api.applyDiscount).not.toHaveBeenCalled();
  });

  it('REQ-037: move lists free tables only; a server rejection (occupied) shows a red bar', async () => {
    const { api } = setup();
    await screen.findByTestId('bill-card');
    fireEvent.click(screen.getByRole('button', { name: 'Move table' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move to which free table?' });
    expect(within(dialog).queryByRole('button', { name: 'Table 7' })).toBeNull();
    api.moveOrder.mockResolvedValueOnce(fail(409, 'CONFLICT'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table 6' }));
    expect(await screen.findByText('CONFLICT message')).toBeInTheDocument();
    expect(api.moveOrder).toHaveBeenCalledWith('ord_1', 3, 't6');
  });

  it('REQ-037: after a merge the bill includes the items of both tables', async () => {
    const { api, setOrder } = setup();
    await screen.findByTestId('bill-card');
    fireEvent.click(screen.getByRole('button', { name: 'Join table' }));
    const dialog = await screen.findByRole('dialog', { name: 'Join which table into this bill?' });
    const merged = order({ kots: [...order().kots!, kot('k15', 15)], items: [...order().items!, line('l9', 'k15', 'Masala Chai', 'Cup', '20.00', 2)] });
    setOrder(merged);
    api.mergeOrders.mockResolvedValueOnce(ok(merged));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Table 7' }));
    await waitFor(() => expect(api.mergeOrders).toHaveBeenCalledWith('ord_1', 3, 'ord_7'));
    const bill = screen.getByTestId('bill-card');
    expect(await within(bill).findByText('Masala Chai')).toBeInTheDocument();
    expect(within(bill).getByText('Butter Chicken')).toBeInTheDocument();
  });

  it('REQ-052: a Ready KOT can be marked served from the order view', async () => {
    setup('CASHIER', order({ kots: [kot('k11', 11, 'READY')], items: [line('l1', 'k11', 'Butter Chicken', 'Half', '220.00', 1)] }));
    const btn = await screen.findByRole('button', { name: 'Mark served' });
    fireEvent.click(btn);
    expect(await screen.findByText('KOT 11 served')).toBeInTheDocument();
  });
});

describe('order view in the app', () => {
  it('REQ-035: tapping a Ready to Close table opens the order view', async () => {
    const ramesh = { id: 'use_r', display_name: 'Ramesh', role: 'CASHIER', language: 'en', is_active: true, failed_pin_count: 0, token_version: 1, ...audit };
    const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/v1', '').split('?')[0];
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
      if (path === '/health') return json(200, { status: 'green' });
      if (path === '/auth/staff') return json(200, [ramesh]);
      if (path === '/auth/login' && init.method === 'POST') return json(200, { token: 'tok', user: ramesh });
      if (path === '/settings') return json(200, { shift_end_time: null, gst_rate_percent: null });
      if (path === '/dashboard') return json(200, { active_tables: 1, pending_kots: 0, ready_orders: 0 });
      if (path === '/tables') return json(200, [tableRow('t8', '8', 'READY_TO_CLOSE', 'ord_8')]);
      if (path === '/orders/ord_8') return json(200, order({ id: 'ord_8', status: 'BILLED', bill_no: 'B-20261105-002' }));
      return json(404, { code: 'NOT_FOUND' });
    }) as unknown as typeof fetch;
    localStorage.clear();
    render(<App fetchImpl={fetchImpl} realtime={null} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ramesh/ }));
    enterPin();
    fireEvent.click(await screen.findByRole('button', { name: /Dine-in/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Table 8, Ready to close' }));
    expect(await screen.findByText('Bill B-20261105-002')).toBeInTheDocument();
    expect(screen.getAllByTestId('order-kot')).toHaveLength(2);
  });
});
