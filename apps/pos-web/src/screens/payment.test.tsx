import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Order, OrderDetailView, OrderItem, Payment, Role, Setting } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { BillsScreen, PaymentScreen, type PaymentApi } from './PaymentScreen';
import {
  balanceAfter, changeDue, closeExceptionBody, maybePrintKot, openBills, paymentBody, quickCash, receiptText, tryPrint, voidReason,
} from '../payment/paymentModel';
import css from '../styles/payment.css?raw';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 2 };
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });
const line = (id: string, name: string, price: number, qty: number): OrderItem => ({
  id, order_id: 'ord_1', kot_id: 'k1', variant_id: id, item_name_snapshot: name, item_name_hi_snapshot: name, variant_name_snapshot: 'Full',
  food_type_snapshot: 'VEG', unit_price: price.toFixed(2), quantity: qty, line_total: (price * qty).toFixed(2), status: 'ACTIVE', ...audit,
});
const pay = (id: string, method: Payment['method'], amount: string, status: Payment['status'] = 'SUCCESS'): Payment =>
  ({ id, order_id: 'ord_1', business_date: '2026-11-05', method, amount, status, idempotency_key: id, ...audit });

function order(extra: Partial<OrderDetailView> = {}): OrderDetailView {
  return {
    id: 'ord_1', order_type: 'DINE_IN', business_date: '2026-11-05', table_id: 't5', table_label_snapshot: '5', status: 'BILLED',
    bill_no: 'B-20261105-006', subtotal: '800.00', discount_amount: '0.00', tax_amount: '0.00', round_off: '0.00', grand_total: '800.00',
    paid_amount: '0.00', balance_due: '800.00', client_request_id: 'k', ...audit,
    kots: [{ id: 'k1', kot_number: 1, business_date: '2026-11-05', order_id: 'ord_1', status: 'SERVED', idempotency_key: 'k1', sent_at: '', ...audit }],
    items: [line('a', 'Butter Chicken', 220, 1), line('b', 'Dal Makhani', 240, 1), line('c', 'Masala Chai', 20, 17)],
    payments: [], ...extra,
  };
}

/** A tiny fake pos-api: payments reduce the balance; at zero the order becomes PAID (the server's rule). */
function fakeServer(start: OrderDetailView) {
  let current = start;
  const recorded: Payment[] = [];
  const api = {
    listOpenBills: vi.fn(async () => ok([current] as Order[])),
    getOrder: vi.fn(async () => ok(current as Order)),
    getSettings: vi.fn(async () => ok({ dhaba_name: 'Dhaba', receipt_footer: 'Thank you', gst_rate_percent: null } as unknown as Setting)),
    printBill: vi.fn(async () => ok(current as Order)),
    recordPayment: vi.fn(async (_id: string, key: string, body: Pick<Payment, 'method' | 'amount'> & Partial<Payment>) => {
      if (Number(body.amount) > Number(current.balance_due)) return fail(422, 'OVERPAYMENT');
      const p = pay(`p${recorded.length + 1}`, body.method, body.amount);
      recorded.push({ ...p, idempotency_key: key });
      const balance = (Number(current.balance_due) - Number(body.amount)).toFixed(2);
      current = { ...current, balance_due: balance, paid_amount: (Number(current.grand_total) - Number(balance)).toFixed(2),
        status: Number(balance) === 0 ? 'PAID' : current.status, payments: [...(current.payments ?? []), p] };
      return ok(p, 201);
    }),
    voidPayment: vi.fn(async (id: string, _rv: number, _reason: string, token?: string) => {
      if (!token) return fail(403, 'FORBIDDEN');
      const p = (current.payments ?? []).find((x) => x.id === id)!;
      current = { ...current, balance_due: (Number(current.balance_due) + Number(p.amount)).toFixed(2),
        payments: (current.payments ?? []).map((x) => (x.id === id ? { ...x, status: 'VOIDED' as const } : x)) };
      return ok({ ...p, status: 'VOIDED' as const });
    }),
    closeWithException: vi.fn(async (_id: string, _rv: number, _body: unknown, token?: string) =>
      (token ? ok({ ...current, status: 'CLOSED_EXCEPTION' } as Order) : fail(403, 'FORBIDDEN'))),
    recordReceiptPrint: vi.fn(async () => ok(current as Order, 201)),
    createApproval: vi.fn(async () => ok({ approval_token: 'appr_1', admin_id: 'adm' }, 201)),
  } satisfies PaymentApi;
  return { api, recorded, get: () => current };
}

function renderPay(role: Role = 'CASHIER', o = order(), print: () => void = () => {}) {
  const server = fakeServer(o);
  const onDone = vi.fn();
  render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <PaymentScreen orderId="ord_1" role={role} api={server.api} userName="Ramesh" onSwitchUser={() => {}} onHome={() => {}}
          onBack={() => {}} onDone={onDone} print={print} />
      </ConnectionProvider>
    </I18nProvider>,
  );
  return { ...server, onDone };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const enterPin = () => ['1', '2', '3', '4'].forEach((d) => click(d));

describe('payment model', () => {
  it('REQ-063: ₹500 tendered against ₹300 gives ₹200 change; quick amounts cover the amount', () => {
    expect(changeDue('300', '500')).toBe(200);
    expect(changeDue('300', '200')).toBeNull();
    expect(changeDue('300', '')).toBeNull();
    expect(quickCash('300')).toEqual([500, 2000]);
  });

  it('REQ-063/REQ-011: a payment body never overpays; UPI without a UTR is fine; cash needs enough tendered', () => {
    expect(paymentBody({ method: 'CASH', amount: '900', tendered: '1000' }, '800')).toEqual({ ok: false, error: 'overBalance' });
    expect(paymentBody({ method: 'UPI', amount: '500' }, '800')).toEqual({ ok: true, body: { method: 'UPI', amount: '500.00' } });
    expect(paymentBody({ method: 'UPI', amount: '500', upiRef: ' 123 ' }, '800')).toEqual({ ok: true, body: { method: 'UPI', amount: '500.00', upi_ref: '123' } });
    expect(paymentBody({ method: 'CASH', amount: '300', tendered: '200' }, '300')).toEqual({ ok: false, error: 'cashShort' });
    expect(paymentBody({ method: 'CASH', amount: '300', tendered: '500' }, '300')).toEqual({ ok: true, body: { method: 'CASH', amount: '300.00', tendered_amount: '500.00' } });
    expect(paymentBody({ method: 'CARD', amount: '0' }, '300')).toEqual({ ok: false, error: 'amountMissing' });
    expect(balanceAfter('800', '500')).toBe(300);
  });

  it('REQ-062: open bills drop settled and zero-balance orders and list oldest first', () => {
    const rows = [
      { id: 'b', status: 'OPEN', balance_due: '100', created_at: '2' }, { id: 'a', status: 'BILLED', balance_due: '50', created_at: '1' },
      { id: 'c', status: 'PAID', balance_due: '0', created_at: '0' }, { id: 'd', status: 'OPEN', balance_due: '0.00', created_at: '0' },
    ] as Order[];
    expect(openBills(rows).map((o) => o.id)).toEqual(['a', 'b']);
  });

  it('REQ-068/REQ-069: void and close need a reason; close records the balance as CLOSE_WITH_BALANCE', () => {
    expect(voidReason('  ')).toEqual({ ok: false, error: 'reasonMissing' });
    expect(voidReason(' wrong ')).toEqual({ ok: true, reason: 'wrong' });
    expect(closeExceptionBody(null, '', '300')).toEqual({ ok: false, error: 'reasonMissing' });
    expect(closeExceptionBody('OTHER', ' ', '300')).toEqual({ ok: false, error: 'reasonMissing' });
    expect(closeExceptionBody('CUSTOMER_LEFT', '', '300')).toEqual({ ok: true,
      body: { exception_type: 'CLOSE_WITH_BALANCE', reason_code: 'CUSTOMER_LEFT', reason_text: null, amount: '300.00' } });
  });

  it('REQ-017: a print that throws is reported as no printer and never throws further', () => {
    expect(tryPrint(() => { throw new Error('no printer'); })).toEqual({ ok: false, reason: 'noPrinter' });
    expect(tryPrint(() => {})).toEqual({ ok: true });
  });

  it('REQ-057: kitchen printing off queues no print job; a printer failure is swallowed', () => {
    const print = vi.fn();
    expect(maybePrintKot({ kitchen_print_enabled: false }, print)).toBe(false);
    expect(maybePrintKot(null, print)).toBe(false);
    expect(print).not.toHaveBeenCalled();
    expect(maybePrintKot({ kitchen_print_enabled: true }, print)).toBe(true);
    expect(maybePrintKot({ kitchen_print_enabled: true }, () => { throw new Error('jam'); })).toBe(false);
  });

  it('REQ-067: the WhatsApp text lists lines, total, paid and footer', () => {
    const text = receiptText(order({ paid_amount: '800.00' }), [line('a', 'Butter Chicken', 220, 1)], { dhaba_name: 'Dhaba', receipt_footer: 'Thank you' },
      { bill: 'Bill', total: 'Total', paid: 'Paid', money: (v) => `₹${Number(v)}` });
    expect(text.split('\n')).toEqual(['Dhaba', 'Bill B-20261105-006', '1 × Butter Chicken (Full) ₹220', 'Total: ₹800', 'Paid: ₹800', 'Thank you']);
  });

  it('REQ-017: the receipt prints at 48 mm content width and wraps long words (58 mm paper)', () => {
    expect(css).toMatch(/width:\s*48mm/);
    expect(css).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('open bills list', () => {
  it('REQ-062: rows show table or token, the amount due and Ready to Close; a row opens the bill', async () => {
    const onOpen = vi.fn();
    const rows = [order(), order({ id: 'ord_2', token: 'T-012', table_label_snapshot: null, status: 'OPEN', balance_due: '180.00' }),
      order({ id: 'ord_3', status: 'PAID', balance_due: '0.00' })];
    render(
      <I18nProvider lang="en">
        <BillsScreen api={{ listOpenBills: async () => ok(rows as Order[]) }} userName="R" onSwitchUser={() => {}} onHome={() => {}} onBack={() => {}} onOpenBill={onOpen} />
      </I18nProvider>,
    );
    const items = await screen.findAllByTestId('open-bill');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Table 5');
    expect(items[0]).toHaveTextContent('Ready to close');
    expect(items[0]).toHaveTextContent('₹800');
    expect(items[1]).toHaveTextContent('T-012');
    fireEvent.click(items[1]);
    expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 'ord_2' }));
  });
});

describe('payment screen', () => {
  it('REQ-062: the bill shows before the Cash / UPI / Card buttons', async () => {
    renderPay();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
    await screen.findByTestId('bill-card');
    expect(screen.getAllByTestId('bill-line')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Cash' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'UPI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Card' })).toBeInTheDocument();
  });

  it('REQ-063: tendering ₹500 against ₹300 due shows ₹200 change', async () => {
    renderPay('CASHIER', order({ balance_due: '300.00', paid_amount: '500.00' }));
    await screen.findByTestId('bill-card');
    click('Cash');
    click('₹500');
    expect(screen.getByTestId('change-due')).toHaveTextContent('₹200');
    expect(screen.getByRole('button', { name: 'Confirm ₹300 cash →' })).toBeInTheDocument();
  });

  it('REQ-064/REQ-066: ₹500 UPI then ₹300 Cash on ₹800 shows ₹300 due between, two payments, then PAID', async () => {
    const s = renderPay();
    await screen.findByTestId('bill-card');
    click('UPI');
    click('Close');
    fireEvent.click(screen.getByLabelText('Pay part only (empty = full balance)'));
    ['5', '0', '0'].forEach((d) => click(d));
    click('Done');
    click('Show UPI QR →');
    click('Received');
    await waitFor(() => expect(screen.getByTestId('balance-due')).toHaveTextContent('₹300'));
    expect(screen.queryByTestId('paid-screen')).toBeNull();
    click('Cash');
    click('Exact');
    click('Confirm ₹300 cash →');
    await screen.findByTestId('paid-screen');
    expect(s.recorded.map((p) => [p.method, p.amount])).toEqual([['UPI', '500.00'], ['CASH', '300.00']]);
    expect(new Set(s.recorded.map((p) => p.idempotency_key)).size).toBe(2);
    expect(s.get().status).toBe('PAID');
    expect(screen.getByTestId('paid-screen')).toHaveTextContent('₹800');
    expect(screen.getByTestId('paid-screen')).toHaveTextContent('UPI + Cash');
  });

  it('REQ-011: Received on the UPI screen records UPI for the amount due with no UTR; closing it records nothing', async () => {
    const s = renderPay('CASHIER', order({ balance_due: '300.00' }));
    await screen.findByTestId('bill-card');
    click('UPI');
    expect(screen.getByRole('img', { name: 'Dhaba UPI QR code' })).toBeInTheDocument();
    click('Close');
    expect(s.api.recordPayment).not.toHaveBeenCalled();
    expect(s.get().balance_due).toBe('300.00');
    click('Show UPI QR →');
    click('Received');
    await screen.findByTestId('paid-screen');
    expect(s.api.recordPayment).toHaveBeenCalledWith('ord_1', expect.any(String), { method: 'UPI', amount: '300.00' });
  });

  it('REQ-063: a payment above the balance is rejected (422 OVERPAYMENT) and the balance stays', async () => {
    const s = renderPay('CASHIER', order({ balance_due: '300.00' }));
    await screen.findByTestId('bill-card');
    const res = await s.api.recordPayment('ord_1', 'k', { method: 'CASH', amount: '500.00' });
    expect(res.ok === false && res.status === 422 && res.error.code).toBe('OVERPAYMENT');
    expect(s.get().balance_due).toBe('300.00');
  });

  it('REQ-069: a Cashier cannot close with a balance without the Admin PIN; the reason is required', async () => {
    const s = renderPay('CASHIER', order({ balance_due: '300.00' }));
    await screen.findByTestId('bill-card');
    click('Close with balance (owner)');
    click('Yes, close');
    expect(screen.getByRole('alert')).toHaveTextContent('Choose or write a reason.');
    expect(s.api.closeWithException).not.toHaveBeenCalled();
    click('Customer left');
    click('Yes, close');
    expect(s.api.closeWithException).not.toHaveBeenCalled();
    enterPin();
    await waitFor(() => expect(s.api.closeWithException).toHaveBeenCalledWith('ord_1', 2,
      { exception_type: 'CLOSE_WITH_BALANCE', reason_code: 'CUSTOMER_LEFT', reason_text: null, amount: '300.00' }, 'appr_1'));
    await waitFor(() => expect(s.onDone).toHaveBeenCalled());
  });

  it('REQ-068: void needs a reason and the Admin PIN on a cashier phone; the balance goes back up', async () => {
    const s = renderPay('CASHIER', order({ balance_due: '300.00', paid_amount: '500.00', payments: [pay('p9', 'UPI', '500.00')] }));
    await screen.findByTestId('bill-card');
    expect(screen.getByTestId('payment-row')).toHaveTextContent('✓ UPI received · ₹500');
    click('Void payment');
    fireEvent.click(screen.getAllByRole('button', { name: 'Void payment' }).at(-1)!);
    expect(screen.getByRole('alert')).toHaveTextContent('Choose or write a reason.');
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Wrong table' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Void payment' }).at(-1)!);
    enterPin();
    await waitFor(() => expect(s.api.voidPayment).toHaveBeenCalledWith('p9', 2, 'Wrong table', 'appr_1'));
    await waitFor(() => expect(screen.getByTestId('balance-due')).toHaveTextContent('₹800'));
    expect(screen.getByTestId('payment-row')).toHaveTextContent('Voided');
  });

  it('REQ-067/REQ-017: Print logs the reprint, and a printer failure keeps the payment and shows a printer error', async () => {
    const s = renderPay('CASHIER', order({ balance_due: '300.00' }), () => { throw new Error('no printer'); });
    await screen.findByTestId('bill-card');
    click('Cash');
    click('Exact');
    click('Confirm ₹300 cash →');
    await screen.findByTestId('paid-screen');
    click('Print');
    await waitFor(() => expect(s.api.recordReceiptPrint).toHaveBeenCalledWith('ord_1', expect.any(String)));
    expect(await screen.findByText('Printer not found. The bill and payment are saved.')).toBeInTheDocument();
    expect(s.get().status).toBe('PAID');
    expect(s.recorded).toHaveLength(1);
  });

  it('REQ-017: a 20-line receipt renders every line inside the receipt block', async () => {
    const many = Array.from({ length: 20 }, (_, i) => line(`l${i}`, `Very long item name number ${i} with extra words`, 10, 1));
    renderPay('CASHIER', order({ items: many }));
    await screen.findByTestId('bill-card');
    expect(screen.getAllByTestId('receipt-line')).toHaveLength(20);
  });
});
