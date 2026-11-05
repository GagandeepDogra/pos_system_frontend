import type { DashboardTiles, FoodType, TableView, User } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import { DashboardScreen } from './DashboardScreen';
import { TablesScreen } from './TablesScreen';
import { ChooseFoodScreen } from './ChooseFoodScreen';
import { KitchenScreen } from './KitchenScreen';
import type { KitchenKotView, Kot, Order, OrderDetailView, Payment, OrderItemStatus, Setting } from '@dhaba/shared';
import { OrderScreen } from './OrderScreen';
import { BillsScreen, PaymentScreen } from './PaymentScreen';
import { TakeawayScreen } from './TakeawayScreen';
import { memoryCartStore } from '../cart/cartStore';
import { ADMIN_SECTIONS, AdminAreaScreen, type AdminSection } from './AdminAreaScreen';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1 };
const variant = (id: string, name: string, price: string, sort_order = 1) => ({ id, item_id: '', name, price, sort_order, is_active: true, ...audit });
const food = (id: string, name_en: string, name_hi: string, category_id: string, food_type: FoodType, variants: ReturnType<typeof variant>[], available_today = true) => ({
  id, category_id, name_en, name_hi, short_code: id.slice(0, 4).toUpperCase(), food_type, is_active: true, available_today, photo_url: null, variants, ...audit,
});
const SAMPLE_MENU = {
  categories: [
    { id: 'c_bread', name_en: 'Breads', name_hi: 'रोटी', sort_order: 1, is_active: true, ...audit },
    { id: 'c_dal', name_en: 'Lentils', name_hi: 'दाल', sort_order: 2, is_active: true, ...audit },
    { id: 'c_main', name_en: 'Mains', name_hi: 'मुख्य', sort_order: 3, is_active: true, ...audit },
  ],
  items: [
    food('dal', 'Dal Makhani', 'दाल मखनी', 'c_dal', 'VEG', [variant('v1', 'Half', '140.00'), variant('v2', 'Full', '240.00', 2)]),
    food('chk', 'Butter Chicken', 'बटर चिकन', 'c_main', 'NON_VEG', [variant('v3', 'Half', '220.00'), variant('v4', 'Full', '380.00', 2)]),
    food('roti', 'Tandoori Roti', 'तंदूरी रोटी', 'c_bread', 'VEG', [variant('v5', 'One', '15.00')]),
    food('pan', 'Shahi Paneer', 'शाही पनीर', 'c_main', 'VEG', [variant('v6', 'Half', '170.00'), variant('v7', 'Full', '290.00', 2)]),
    food('rice', 'Jeera Rice', 'जीरा राइस', 'c_main', 'VEG', [variant('v8', 'Plate', '90.00')], false),
    food('lassi', 'Lassi', 'लस्सी', 'c_main', 'VEG', [variant('v9', 'Sweet', '50.00'), variant('v10', 'Salted', '50.00', 2)]),
  ],
};

const RAMESH: User = {
  id: 'use_r', display_name: 'Ramesh', role: 'CASHIER', language: 'en', is_active: true, failed_pin_count: 0,
  token_version: 1, created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1,
};

const row = (n: string, area: string | null, extra: Partial<TableView> = {}): TableView => ({
  id: `din_${n}`, table_number: n, area, seats: 4, is_active: true, status: 'AVAILABLE',
  created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1, ...extra,
});

const SAMPLE_ROWS: TableView[] = [
  row('01', 'Hall'),
  row('02', 'Hall', { status: 'OCCUPIED', running_amount: '460', minutes_open: 18 }),
  row('03', 'Hall', { status: 'READY_TO_CLOSE', running_amount: '620', minutes_open: 32 }),
  row('04', 'Family'),
  row('05', 'Family', { status: 'OCCUPIED', running_amount: '580', minutes_open: 28 }),
  row('06', 'Outside'),
  row('07', null),
];

const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ln = (id: string, quantity: number, item_name: string, variant_name: string | null, note: string | null = null, cancelled = false) =>
  ({ id, item_name, variant_name, quantity, note, cancelled });
const kk = (id: string, n: number, status: KitchenKotView['status'], min: number, who: { table_label?: string; token?: string }, lines: KitchenKotView['lines']): KitchenKotView => ({
  id, kot_number: n, business_date: '', order_id: `o_${id}`, status, idempotency_key: id, sent_at: ago(min), ready_at: status === 'READY' ? ago(min - 10) : null,
  order_type: who.token ? 'TAKEAWAY' : 'DINE_IN', ...who, lines, ...audit,
});
const SAMPLE_KOTS: KitchenKotView[] = [
  kk('k37', 37, 'NEW', 2, { table_label: '5' }, [ln('a', 1, 'Butter Chicken', 'Half', 'Less spicy'), ln('b', 1, 'Dal Makhani', 'Full'), ln('c', 6, 'Tandoori Roti', 'Butter')]),
  kk('k38', 38, 'NEW', 1, { token: 'T-003' }, [ln('d', 1, 'Shahi Paneer', 'Half'), ln('e', 1, 'Jeera Rice', 'Half', null, true)]),
  kk('k34', 34, 'PREPARING', 18, { table_label: '2' }, [ln('f', 2, 'Dal Tadka', 'Full'), ln('g', 4, 'Lachha Paratha', null)]),
  kk('k36', 36, 'PREPARING', 6, { token: 'T-002' }, [ln('h', 1, 'Shahi Paneer', 'Full'), ln('i', 2, 'Tandoori Roti', 'Plain'), ln('j', 2, 'Lassi', 'Salted')]),
  kk('k32', 32, 'READY', 13, { table_label: '3' }, [ln('k', 1, 'Dal Makhani', 'Full'), ln('l', 4, 'Tandoori Roti', 'Butter')]),
  kk('k33', 33, 'READY', 11, { token: 'T-001' }, [ln('m', 1, 'Shahi Paneer', 'Half'), ln('n', 1, 'Jeera Rice', 'Half'), ln('o', 2, 'Tandoori Roti', 'Butter')]),
];

const ok = <T,>(data: T) => Promise.resolve({ ok: true, status: 200, data } as ApiResult<T>);
const noop = () => undefined;

/**
 * Development-only previews (`#/design/dashboard`, `#/design/tables`) of the
 * real screens with sample data, for screenshots before pos-api exists.
 */
export function ScreenPreview({ name }: { name: string }) {
  if (name.startsWith('admin-')) {
    const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1 };
    const cat = (id: string, en: string, hi: string, s: number) => ({ id, name_en: en, name_hi: hi, sort_order: s, is_active: true, ...audit });
    const v = (id: string, itemId: string, n: string, price: string, s: number) => ({ id, item_id: itemId, name: n, price, sort_order: s, is_active: true, ...audit });
    const it = (id: string, en: string, hi: string, code: string, food: FoodType, variants: ReturnType<typeof v>[], avail = true) =>
      ({ id, category_id: 'c1', name_en: en, name_hi: hi, short_code: code, food_type: food, is_active: true, available_today: avail, kitchen_station: null, ...audit, variants });
    const menu = {
      categories: [cat('c1', 'Curries', 'करी', 1), cat('c2', 'Breads', 'रोटी', 2), cat('c3', 'Drinks', 'पेय', 3)],
      items: [
        it('i1', 'Dal Makhani', 'दाल मखनी', 'DM', 'VEG', [v('v1', 'i1', 'Half', '140.00', 1), v('v2', 'i1', 'Full', '240.00', 2)]),
        it('i2', 'Butter Chicken', 'बटर चिकन', 'BC', 'NON_VEG', [v('v3', 'i2', 'Half', '220.00', 1), v('v4', 'i2', 'Full', '380.00', 2)], false),
      ],
    };
    const echo = <T,>(_a: unknown, _b: unknown, body?: T) => ok({ ...(body as object), ...audit } as never);
    const api = {
      getMenu: () => ok(menu), createCategory: echo, updateCategory: echo, createItem: echo, updateItem: echo,
      createVariant: echo, updateVariant: echo, changeVariantPrice: echo, setItemAvailability: echo,
      listTables: () => ok([
        { id: 't1', table_number: '1', area: 'Hall', seats: 4, is_active: true, status: 'AVAILABLE', ...audit },
        { id: 't2', table_number: '2', area: 'Hall', seats: 4, is_active: true, status: 'OCCUPIED', order_id: 'o1', ...audit },
        { id: 't3', table_number: 'G1', area: 'Garden', seats: 6, is_active: true, status: 'AVAILABLE', ...audit },
        { id: 't4', table_number: '9', area: null, seats: null, is_active: true, status: 'AVAILABLE', ...audit },
      ]),
      createTable: echo, updateTable: echo, createUser: echo, updateUser: echo, resetUserPin: echo, updateSettings: echo,
      listLoginStaff: () => ok([
        { id: 'u1', display_name: 'Gagandeep', role: 'ADMIN', language: 'hi', is_active: true, failed_pin_count: 0, locked_until: null, token_version: 1, ...audit },
        { id: 'u2', display_name: 'Ravi', role: 'CASHIER', language: 'hi', is_active: true, failed_pin_count: 5,
          locked_until: new Date(Date.now() + 4 * 60000).toISOString(), token_version: 1, ...audit },
        { id: 'u3', display_name: 'Sunita', role: 'KITCHEN', language: 'hi', is_active: true, failed_pin_count: 0, locked_until: null, token_version: 1, ...audit },
      ]),
      getSettings: () => ok({
        id: 's1', dhaba_name: 'Sher-e-Punjab Dhaba', address: 'NH 44, Murthal', phone: '9876543210', gst_number: null, gst_rate_percent: null,
        receipt_footer: 'Thank you! Come again.', token_reset_time: '04:00', shift_end_time: null, late_kot_minutes: 15,
        discount_limit_amount: '100.00', kitchen_print_enabled: false, ...audit,
      }),
      getSalesReport: (from: string, to: string) => ok({
        from, to, total_sales: '18450.00', bill_count: 42,
        by_method: [{ method: 'CASH', amount: '8250.00' }, { method: 'UPI', amount: '9000.00' }, { method: 'CARD', amount: '1200.00' }],
        by_category: [{ category: 'Breads', amount: '4440.00' }, { category: 'Dal and curry', amount: '9800.00' }],
        top_items: [{ item_name: 'Tandoori Roti', quantity: 148 }, { item_name: 'Dal Makhani', quantity: 32 }, { item_name: 'Lassi', quantity: 28 }, { item_name: 'Butter Chicken', quantity: 24 }],
        cancelled_items: [{ item_name: 'Lassi', quantity: 1 }],
        exceptions: [{ exception_type: 'DISCOUNT', reason_code: 'OTHER', amount: '50.00', bill_no: 'B-20261105-007' }],
      }),
      searchOrders: () => ok([{ id: 'o1', bill_no: 'B-20261105-001', table_label_snapshot: '3', business_date: '2026-11-05', status: 'PAID', grand_total: '620.00', ...audit }]),
      getDayCloseSummary: () => ok({
        business_date: '2026-11-05', cash_total: '8250.00', snapshots: ['dayclose-2026-11-04.xlsx'],
        unsettled_orders: [
          { id: 'o3', table_label_snapshot: '3', status: 'BILLED', balance_due: '620.00', ...audit },
          { id: 'o9', token: 'T-001', status: 'OPEN', balance_due: '300.00', ...audit },
        ],
      }),
      closeDay: () => ok({ snapshot: 'dayclose-2026-11-05.xlsx' }), closeWithException: echo,
      downloadBackup: () => ok(new Blob(['x'])), confirmRestore: () => ok({}),
      previewRestore: () => ok({ restore_id: 'r1', file_date: '2026-10-06 22:15', order_count: 840, payment_count: 910 }),
    } as unknown as Parameters<typeof AdminAreaScreen>[0]['api'];
    const section = name.slice('admin-'.length);
    const initial = (ADMIN_SECTIONS as readonly string[]).includes(section) ? section as AdminSection : 'menu';
    return <AdminAreaScreen initialSection={initial} api={api} userName="Gagandeep" deviceLock={null} onDeviceLock={() => {}} onHome={() => {}} onSwitchUser={() => {}} />;
  }
  if (name === 'tables') {
    return (
      <TablesScreen listTables={() => ok(SAMPLE_ROWS)} userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop}
        onBack={noop} onOpenTable={noop} onTakeaway={noop} />
    );
  }
  if (name === 'kitchen' || name === 'kitchen-dark') {
    if (name === 'kitchen-dark') localStorage.setItem('dhaba.kitchenDarkTheme', '1');
    else localStorage.removeItem('dhaba.kitchenDarkTheme');
    return (
      <KitchenScreen userName="Suresh" role="KITCHEN" deviceRole="KITCHEN" onSwitchUser={noop} onHome={noop} playSound={noop}
        api={{
          listKitchenKots: () => ok(SAMPLE_KOTS), updateKotStatus: () => new Promise(noop),
          getSettings: () => ok({ late_kot_minutes: 15 } as Setting), getMenu: () => ok(SAMPLE_MENU), markItemOutOfStock: () => new Promise(noop),
        }} />
    );
  }
  if (name === 'bills') {
    const b = (id: string, table: string | null, token: string | null, status: string, due: string) =>
      ({ id, table_label_snapshot: table, token, status, balance_due: due, created_at: id } as unknown as Order);
    return (
      <BillsScreen userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop} onBack={noop} onOpenBill={noop}
        api={{ listOpenBills: () => ok([b('1', '5', null, 'BILLED', '300.00'), b('2', '2', null, 'OPEN', '540.00'), b('3', null, 'T-012', 'OPEN', '180.00')]) }} />
    );
  }
  if (name === 'order' || name === 'payment') {
    const base = { order_id: 'ord_5', food_type_snapshot: 'VEG' as const, created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1 };
    const li = (id: string, kot_id: string, n: string, v: string, price: number, quantity: number, status: OrderItemStatus = 'ACTIVE') => ({
      ...base, id, kot_id, variant_id: id, item_name_snapshot: n, item_name_hi_snapshot: n, variant_name_snapshot: v,
      unit_price: price.toFixed(2), quantity, line_total: (price * quantity).toFixed(2), status,
    });
    const kt = (id: string, kot_number: number, status: Kot['status']) =>
      ({ ...base, id, kot_number, status, business_date: '2026-11-05', idempotency_key: id, sent_at: '' });
    const order = {
      ...base, id: 'ord_5', order_type: 'DINE_IN', business_date: '2026-11-05', table_id: 'din_05', status: 'OPEN', bill_no: null,
      subtotal: '800.00', discount_amount: '0.00', tax_amount: '0.00', round_off: '0.00', grand_total: '800.00', paid_amount: '0.00',
      balance_due: '800.00', client_request_id: 'k', kots: [kt('k11', 11, 'READY'), kt('k14', 14, 'PREPARING')],
      items: [li('a', 'k11', 'Butter Chicken', 'Half', 220, 1), li('b', 'k11', 'Dal Makhani', 'Full', 240, 1), li('c', 'k11', 'Lassi', 'Sweet', 60, 1, 'CANCELLED'),
        li('d', 'k14', 'Tandoori Roti', 'Butter', 20, 6), li('e', 'k14', 'Lassi', 'Salted', 50, 2), li('f', 'k14', 'Masala Chai', 'Cup', 20, 6)],
    } as unknown as OrderDetailView;
    const never = () => new Promise<never>(noop);
    if (name === 'payment') {
      const upi = { ...base, id: 'p1', business_date: '2026-11-05', method: 'UPI', amount: '500.00', status: 'SUCCESS', idempotency_key: 'p1' } as Payment;
      const billed = { ...order, items: order.items?.filter((l) => l.id !== 'c'), table_label_snapshot: '5', status: 'BILLED', bill_no: 'B-20261105-006', paid_amount: '500.00', balance_due: '300.00', payments: [upi] } as OrderDetailView;
      return (
        <PaymentScreen orderId="ord_5" role="CASHIER" userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop} onBack={noop} onDone={noop}
          api={{ getOrder: () => ok(billed), getSettings: () => ok({ dhaba_name: 'Dhaba', gst_rate_percent: null } as Setting), listOpenBills: () => ok([]),
            printBill: never, recordPayment: never, voidPayment: never, closeWithException: never, recordReceiptPrint: never, createApproval: never }} />
      );
    }
    return (
      <OrderScreen orderId="ord_5" table="5" tableId="din_05" role="CASHIER" userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop}
        onBack={noop} onAddFood={noop}
        api={{ getOrder: () => ok(order), getSettings: () => ok({ gst_rate_percent: null, discount_limit_amount: '100' } as Setting),
          listTables: () => ok(SAMPLE_ROWS), cancelOrderItem: never, moveOrder: never, mergeOrders: never, printBill: never,
          applyDiscount: never, updateKotStatus: never, createApproval: never }} />
    );
  }
  if (name === 'takeaway') {
    const tw = (token: string, status: Order['status'], kot: Kot['status'], count: number, total: string, paid: boolean) => ({
      id: `ord_${token}`, order_type: 'TAKEAWAY', business_date: '2026-11-05', token, status, subtotal: total, discount_amount: '0',
      tax_amount: '0', round_off: '0', grand_total: total, paid_amount: paid ? total : '0', balance_due: paid ? '0' : total,
      client_request_id: token, created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1,
      item_count: count, kot_status: kot,
    });
    const rows = [tw('T-001', 'OPEN', 'READY', 3, '300', false), tw('T-002', 'PAID', 'PREPARING', 4, '420', true), tw('T-003', 'OPEN', 'NEW', 2, '260', false)];
    return (
      <TakeawayScreen userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop} onBack={noop} onAddFood={noop} onCollect={noop}
        onViewPayments={noop}
        api={{ listActiveTakeaways: () => ok(rows as Order[]), handOverTakeaway: () => new Promise<never>(noop),
          createTakeaway: () => ok({ ...rows[0], id: 'ord_T-004', token: 'T-004' } as Order) }} />
    );
  }
  if (name === 'choose-food') {
    return (
      <ChooseFoodScreen target={{ kind: 'table', tableId: 'din_05', table: '5', detail: 'Hall', free: true }}
        api={{ getMenu: () => ok(SAMPLE_MENU), openTableSession: () => new Promise(noop), sendToKitchen: () => new Promise(noop) }}
        store={memoryCartStore()} userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop} onBack={noop} />
    );
  }
  const role = name === 'dashboard-admin' ? 'ADMIN' : name === 'dashboard-kitchen' ? 'KITCHEN' : 'CASHIER';
  const tiles: DashboardTiles = { active_tables: 5, pending_kots: 4, ready_orders: 2, open_takeaways: 3, todays_sales: '12340' };
  return (
    <DashboardScreen user={{ ...RAMESH, role }} getDashboard={() => ok(tiles)} onOpenActiveTables={noop} onOpen={noop}
      onSwitchUser={noop} onLanguage={noop} createApproval={() => ok({ approval_token: '', admin_id: '' })} onAdminApproved={noop} />
  );
}
