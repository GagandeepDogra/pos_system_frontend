import type { DashboardTiles, FoodType, TableView, User } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import { DashboardScreen } from './DashboardScreen';
import { TablesScreen } from './TablesScreen';
import { ChooseFoodScreen } from './ChooseFoodScreen';
import { memoryCartStore } from '../cart/cartStore';

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

const ok = <T,>(data: T) => Promise.resolve({ ok: true, status: 200, data } as ApiResult<T>);
const noop = () => undefined;

/**
 * Development-only previews (`#/design/dashboard`, `#/design/tables`) of the
 * real screens with sample data, for screenshots before pos-api exists.
 */
export function ScreenPreview({ name }: { name: string }) {
  if (name === 'tables') {
    return (
      <TablesScreen listTables={() => ok(SAMPLE_ROWS)} userName={RAMESH.display_name} onSwitchUser={noop} onHome={noop}
        onBack={noop} onOpenTable={noop} onTakeaway={noop} />
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
