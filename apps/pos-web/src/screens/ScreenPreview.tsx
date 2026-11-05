import type { DashboardTiles, TableView, User } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import { DashboardScreen } from './DashboardScreen';
import { TablesScreen } from './TablesScreen';

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
  const role = name === 'dashboard-admin' ? 'ADMIN' : name === 'dashboard-kitchen' ? 'KITCHEN' : 'CASHIER';
  const tiles: DashboardTiles = { active_tables: 5, pending_kots: 4, ready_orders: 2, open_takeaways: 3, todays_sales: '12340' };
  return (
    <DashboardScreen user={{ ...RAMESH, role }} getDashboard={() => ok(tiles)} onOpenActiveTables={noop} onOpen={noop}
      onSwitchUser={noop} onLanguage={noop} createApproval={() => ok({ approval_token: '', admin_id: '' })} onAdminApproved={noop} />
  );
}
