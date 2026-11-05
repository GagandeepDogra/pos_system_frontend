import type { KotStatus, TableStatus } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';

/** Each status has an icon and a word as well as a colour (REQ-086). */
const TABLE_STATUS_UI: Record<TableStatus, { icon: string; key: string; cls: string }> = {
  AVAILABLE: { icon: '✓', key: 'tableStatus.available', cls: 'available' },
  OCCUPIED: { icon: '●', key: 'tableStatus.occupied', cls: 'occupied' },
  READY_TO_CLOSE: { icon: '₹', key: 'tableStatus.readyToClose', cls: 'ready-to-close' },
};

const KOT_STATUS_UI: Partial<Record<KotStatus, { icon: string; key: string; cls: string }>> = {
  NEW: { icon: '!', key: 'kotStatus.new', cls: 'new' },
  PREPARING: { icon: '◔', key: 'kotStatus.preparing', cls: 'preparing' },
  READY: { icon: '✓', key: 'kotStatus.ready', cls: 'ready' },
};

export function tableStatusClass(status: TableStatus): string {
  return TABLE_STATUS_UI[status].cls;
}

export function kotStatusClass(status: KotStatus): string {
  return KOT_STATUS_UI[status]?.cls ?? 'new';
}

export function TableStatusLabel({ status }: { status: TableStatus }) {
  const { t } = useI18n();
  const ui = TABLE_STATUS_UI[status];
  return (
    <span className={`status-label status--${ui.cls}`} data-status={status}>
      <span className="status-label__icon" aria-hidden="true">{ui.icon}</span>
      <span>{t(ui.key)}</span>
    </span>
  );
}

export function KotStatusLabel({ status }: { status: KotStatus }) {
  const { t } = useI18n();
  const ui = KOT_STATUS_UI[status];
  if (!ui) return null;
  return (
    <span className={`status-label status--${ui.cls}`} data-status={status}>
      <span className="status-label__icon" aria-hidden="true">{ui.icon}</span>
      <span>{t(ui.key)}</span>
    </span>
  );
}

/** The legend above the table grid: icon + word for every table status. */
export function TableStatusLegend() {
  const { t } = useI18n();
  return (
    <ul className="status-legend" aria-label={t('tableStatus.legend')}>
      {(Object.keys(TABLE_STATUS_UI) as TableStatus[]).map((s) => (
        <li key={s}><TableStatusLabel status={s} /></li>
      ))}
    </ul>
  );
}
