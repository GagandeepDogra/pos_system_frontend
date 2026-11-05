import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Order } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { createApiClient, type ApiResult } from '../api/client';
import { endpoints } from '../api/endpoints';
import { AdminBackupSection, AdminDayCloseSection, AdminHistorySection, AdminReportsSection, type AdminReportsApi } from './AdminReportsScreen';
import { ADMIN_SECTIONS } from './AdminAreaScreen';
import {
  addSnapshot, businessDate, historyQuery, historyRows, normaliseDayClose, normaliseReport, normaliseRestorePreview, periodRange,
  rangeError, restorePinsError, EMPTY_HISTORY_QUERY,
} from '../admin/reportsAdminModel';

const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });
const order = (id: string, extra: Partial<Order> = {}): Order => ({
  id, order_type: 'DINE_IN', business_date: '2026-11-05', status: 'PAID', subtotal: '300.00', discount_amount: '0.00', tax_amount: '0.00',
  round_off: '0.00', grand_total: '300.00', paid_amount: '300.00', balance_due: '0.00', client_request_id: 'k', created_at: '', created_by: '',
  updated_at: '', updated_by: '', row_version: 2, table_label_snapshot: '5', bill_no: 'B-20261105-001', ...extra,
});

/** A server double: payments by business date, archive months included, voids excluded (as the contract says). */
const PAYMENTS = [
  { date: '2026-10-31', method: 'CASH', amount: 500, status: 'SUCCESS' }, // archived month
  { date: '2026-11-04', method: 'UPI', amount: 200, status: 'SUCCESS' },
  { date: '2026-11-05', method: 'CASH', amount: 300, status: 'SUCCESS' },
  { date: '2026-11-05', method: 'CASH', amount: 100, status: 'VOIDED' },
  { date: '2026-11-05', method: 'CARD', amount: 150, status: 'SUCCESS' },
];
function salesReport(from: string, to: string) {
  const inRange = PAYMENTS.filter((p) => p.status === 'SUCCESS' && p.date >= from && p.date <= to);
  const by: Record<string, number> = {};
  for (const p of inRange) by[p.method] = (by[p.method] ?? 0) + p.amount;
  return {
    from, to, total_sales: inRange.reduce((s, p) => s + p.amount, 0).toFixed(2), bill_count: inRange.length,
    by_method: Object.entries(by).map(([method, amount]) => ({ method, amount: amount.toFixed(2) })),
    by_category: [{ category: 'Breads', amount: '120.00' }], top_items: [{ item_name: 'Dal Makhani', quantity: 3 }, { item_name: 'Tandoori Roti', quantity: 12 }],
    cancelled_items: [{ item_name: 'Lassi', quantity: 1 }], exceptions: [{ exception_type: 'DISCOUNT', reason_code: 'OTHER', amount: '20.00' }],
    includes_archive: from < '2026-11-01',
  };
}

function fakeApi(over: Partial<AdminReportsApi> = {}): AdminReportsApi {
  return {
    getSettings: vi.fn(async () => fail(500, 'X')),
    getSalesReport: vi.fn(async (f: string, t: string) => ok(salesReport(f, t) as Record<string, unknown>)),
    searchOrders: vi.fn(async (q) => ok(q.bill_no === 'B-20261105-001' ? [order('o1')] : [])),
    getDayCloseSummary: vi.fn(async () => ok({ business_date: '2026-11-05', cash_total: '300.00', unsettled_orders: [] } as Record<string, unknown>)),
    closeDay: vi.fn(async () => ok({ snapshot: 'dayclose-2026-11-05.xlsx' } as Record<string, unknown>, 201)),
    closeWithException: vi.fn(async (id: string) => ok(order(id, { status: 'CLOSED_EXCEPTION' }))),
    downloadBackup: vi.fn(async () => ok(new Blob(['x']))),
    previewRestore: vi.fn(async () => ok({ restore_id: 'r1', file_date: '2026-10-06', order_count: 840, payment_count: 910 } as Record<string, unknown>, 201)),
    confirmRestore: vi.fn(async () => ok({} as Record<string, unknown>)),
    ...over,
  } as AdminReportsApi;
}
const wrap = (node: React.ReactNode) => render(<I18nProvider lang="en">{node}</I18nProvider>);
const NOW = () => new Date('2026-11-05T13:30:00');

describe('admin reports model', () => {
  it('REQ-077: today/yesterday ranges follow the business date cut-off', () => {
    expect(businessDate(new Date('2026-11-05T03:59:00'))).toBe('2026-11-04');
    expect(businessDate(new Date('2026-11-05T04:01:00'))).toBe('2026-11-05');
    expect(periodRange('yesterday', '2026-11-01')).toEqual({ from: '2026-10-31', to: '2026-10-31' });
    expect(rangeError('2026-11-05', '2026-11-01')).toBe('order');
    expect(rangeError('', '2026-11-01')).toBe('missing');
  });

  it('REQ-077: the report shows the server totals, by method and ranked items', () => {
    const r = normaliseReport(salesReport('2026-11-05', '2026-11-05'), '2026-11-05', '2026-11-05');
    expect(r.total).toBe(450);
    expect(r.byMethod).toEqual([{ method: 'CASH', amount: 300 }, { method: 'UPI', amount: 0 }, { method: 'CARD', amount: 150 }]);
    expect(r.topItems[0].name).toBe('Tandoori Roti');
    expect(r.discountTotal).toBe(20);
    expect(normaliseReport({ by_method: { CASH: '10', UPI: '5' } }, 'a', 'b').total).toBe(15);
  });

  it('REQ-078: history sends only filled fields; an empty list is a normal result', () => {
    expect(historyQuery(EMPTY_HISTORY_QUERY)).toBeNull();
    expect(historyQuery({ ...EMPTY_HISTORY_QUERY, bill_no: ' B-1 ' })).toEqual({ bill_no: 'B-1' });
    expect(historyRows([])).toEqual([]);
    expect(historyRows({ items: [order('o1')] })).toHaveLength(1);
  });

  it('REQ-096: day close keeps only OPEN/BILLED orders; snapshots are added once', () => {
    const s = normaliseDayClose({ cash_total: '300.00', unsettled_orders: [order('a', { status: 'OPEN' }), order('b', { status: 'PAID' })] });
    expect(s.unsettled.map((o) => o.id)).toEqual(['a']);
    expect(s.cashTotal).toBe(300);
    expect(addSnapshot(['x', 'y'], 'y')).toEqual(['y', 'x']);
  });

  it('REQ-079: restore preview and the double PIN check', () => {
    expect(normaliseRestorePreview({ restore_id: 'r1', file_date: 'd', counts: { orders: 2, payments: 3 } })).toEqual({ id: 'r1', fileDate: 'd', orders: 2, payments: 3 });
    expect(normaliseRestorePreview({})).toBeNull();
    expect(restorePinsError('1234', '1234')).toBeNull();
    expect(restorePinsError('1234', '4321')).toBe('mismatch');
    expect(restorePinsError('12', '12')).toBe('short');
  });

  it('REQ-007: the admin area lists reports, history, day close and backup', () => {
    expect(ADMIN_SECTIONS).toEqual(expect.arrayContaining(['reports', 'history', 'dayClose', 'backup']));
  });
});

describe('AdminReportsSection', () => {
  it('REQ-077: today total equals the SUCCESS payments of the day (voids excluded)', async () => {
    const api = fakeApi();
    wrap(<AdminReportsSection api={api} onResult={vi.fn()} now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('report-total').textContent).toBe('₹450'));
    expect(api.getSalesReport).toHaveBeenCalledWith('2026-11-05', '2026-11-05');
  });

  it('REQ-077: a voided ₹300 payment lowers the day total by ₹300 after refresh', async () => {
    let voided = false;
    const api = fakeApi({
      getSalesReport: vi.fn(async (f: string, t: string) => {
        const r = salesReport(f, t);
        return ok({ ...r, total_sales: (Number(r.total_sales) - (voided ? 300 : 0)).toFixed(2) } as Record<string, unknown>);
      }),
    });
    wrap(<AdminReportsSection api={api} onResult={vi.fn()} now={NOW} />);
    await waitFor(() => expect(screen.getByTestId('report-total').textContent).toBe('₹450'));
    voided = true;
    fireEvent.click(screen.getByRole('button', { name: 'Yesterday' }));
    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    await waitFor(() => expect(screen.getByTestId('report-total').textContent).toBe('₹150'));
  });

  it('REQ-077: a date range over an archived month includes it, and returns only that range', async () => {
    const api = fakeApi();
    const { container } = wrap(<AdminReportsSection api={api} onResult={vi.fn()} now={NOW} />);
    await screen.findByTestId('report-total');
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]'));
    fireEvent.change(from, { target: { value: '2026-10-31' } });
    fireEvent.change(to, { target: { value: '2026-11-04' } });
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.getByTestId('report-total').textContent).toBe('₹700'));
    expect(screen.getByText(/includes past months/)).toBeTruthy();
    expect(api.getSalesReport).toHaveBeenLastCalledWith('2026-10-31', '2026-11-04');
  });

  it('REQ-077: a reversed range cannot be sent', async () => {
    const { container } = wrap(<AdminReportsSection api={fakeApi()} onResult={vi.fn()} now={NOW} />);
    fireEvent.click(screen.getByRole('button', { name: 'Date range' }));
    const [from, to] = Array.from(container.querySelectorAll('input[type="date"]'));
    fireEvent.change(from, { target: { value: '2026-11-05' } });
    fireEvent.change(to, { target: { value: '2026-11-01' } });
    expect((screen.getByRole('button', { name: 'Show' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toMatch(/before/);
  });
});

describe('AdminHistorySection', () => {
  it('REQ-078: an existing bill number returns that order; an unknown one shows an empty result, not an error', async () => {
    wrap(<AdminHistorySection api={fakeApi()} onResult={vi.fn()} />);
    const bill = screen.getByLabelText('Bill number');
    fireEvent.change(bill, { target: { value: 'B-20261105-001' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('B-20261105-001 · Table 5')).toBeTruthy();
    fireEvent.change(bill, { target: { value: 'B-NOPE' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No orders found.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('AdminDayCloseSection', () => {
  it('REQ-096: shows the cash total and lists OPEN/BILLED orders in red; close is blocked until settled', async () => {
    const api = fakeApi({
      getDayCloseSummary: vi.fn(async () => ok({ cash_total: '300.00', unsettled_orders: [order('o7', { status: 'BILLED', balance_due: '620.00' })] } as Record<string, unknown>)),
    });
    const onCollect = vi.fn();
    wrap(<AdminDayCloseSection api={api} onResult={vi.fn()} onCollect={onCollect} onSnapshot={vi.fn()} />);
    expect((await screen.findByTestId('cash-total')).textContent).toBe('₹300');
    expect(screen.getByTestId('unsettled').textContent).toContain('₹620 due');
    expect((screen.getByRole('button', { name: 'Close the day' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Collect' }));
    expect(onCollect).toHaveBeenCalledWith('o7');
    fireEvent.click(screen.getByRole('button', { name: 'Close with balance' }));
    fireEvent.click(screen.getByRole('button', { name: 'Customer left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Yes, close' }));
    await waitFor(() => expect(api.closeWithException).toHaveBeenCalledWith('o7', 2, expect.objectContaining({ exception_type: 'CLOSE_WITH_BALANCE', reason_code: 'CUSTOMER_LEFT', amount: '620.00' })));
  });

  it('REQ-096: completing day close adds the snapshot to the backup list', async () => {
    const api = fakeApi();
    const onSnapshot = vi.fn();
    const onResult = vi.fn();
    wrap(<AdminDayCloseSection api={api} onResult={onResult} onSnapshot={onSnapshot} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Close the day' }));
    await waitFor(() => expect(onSnapshot).toHaveBeenCalledWith('dayclose-2026-11-05.xlsx'));
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'success' }));
    expect(vi.mocked(api.closeDay).mock.calls[0][0]).toMatch(/.+/);
  });
});

function typePin(pin: string) {
  for (const d of pin) fireEvent.click(screen.getAllByRole('button', { name: d })[0]);
}

describe('AdminBackupSection', () => {
  async function toPreview(api: AdminReportsApi, reload = vi.fn()) {
    const onResult = vi.fn();
    const { container } = wrap(<AdminBackupSection api={api} onResult={onResult} snapshots={['dayclose-2026-11-05.xlsx']} reload={reload} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(['x'], 'backup.xlsx')] } });
    fireEvent.click(screen.getByRole('button', { name: 'Check file' }));
    return { onResult };
  }

  it('REQ-079: the backup list and workbook download need no command line', async () => {
    const api = fakeApi();
    wrap(<AdminBackupSection api={api} onResult={vi.fn()} snapshots={['dayclose-2026-11-05.xlsx']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Download backup' }));
    await waitFor(() => expect(api.downloadBackup).toHaveBeenCalledWith(undefined));
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(api.downloadBackup).toHaveBeenCalledWith('dayclose-2026-11-05.xlsx'));
  });

  it('REQ-131: preview shows file date and counts; PIN twice confirms and reloads', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const api = fakeApi();
    const reload = vi.fn();
    await toPreview(api, reload);
    expect((await screen.findByTestId('restore-preview')).textContent).toContain('840');
    expect(screen.getByTestId('restore-preview').textContent).toContain('2026-10-06');
    expect(vi.mocked(api.previewRestore).mock.calls[0][1]).toBeInstanceOf(FormData);
    typePin('1234');
    expect(screen.getByRole('group', { name: 'Owner PIN again' })).toBeTruthy();
    typePin('1234');
    await waitFor(() => expect(api.confirmRestore).toHaveBeenCalledWith('r1', { pin: '1234', pin_confirm: '1234' }));
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('REQ-079: mismatched PIN entries are refused without calling the server', async () => {
    const api = fakeApi();
    await toPreview(api);
    await screen.findByTestId('restore-preview');
    typePin('1234');
    typePin('4321');
    expect(await screen.findByText('The two PINs do not match. Start again.')).toBeTruthy();
    expect(api.confirmRestore).not.toHaveBeenCalled();
  });

  it('REQ-110: a file with a wrong schema is rejected before any swap', async () => {
    const api = fakeApi({ previewRestore: vi.fn(async () => fail(422, 'VALIDATION')) });
    const { onResult } = await toPreview(api);
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error', text: 'This file cannot be used: it is not a valid backup.' })));
    expect(screen.queryByTestId('restore-preview')).toBeNull();
    expect(api.confirmRestore).not.toHaveBeenCalled();
  });
});

describe('api client uploads and downloads', () => {
  it('REQ-079: an upload is sent as multipart and a download comes back as a Blob', async () => {
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      calls.push(init!);
      return new Response(init?.method === 'POST' ? JSON.stringify({ restore_id: 'r1' }) : 'xlsx-bytes', { status: init?.method === 'POST' ? 201 : 200 });
    });
    const ep = endpoints(createApiClient({ fetchImpl: fetchImpl as typeof fetch, getToken: () => 't' }));
    const form = new FormData();
    form.append('file', new Blob(['x']), 'b.xlsx');
    await ep.previewRestore('k1', form);
    expect(calls[0].body).toBe(form);
    expect((calls[0].headers as Record<string, string>)['Content-Type']).toBeUndefined();
    const res = await ep.downloadBackup('snap');
    expect(res.ok && typeof (res.data as Blob).arrayBuffer === 'function' && (res.data as Blob).size).toBe(10);
    expect(String(fetchImpl.mock.calls[1][0])).toContain('snapshot=snap');
  });
});
