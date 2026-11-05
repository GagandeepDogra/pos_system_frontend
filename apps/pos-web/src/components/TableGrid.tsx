import type { TableStatus } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { TableStatusLabel, tableStatusClass } from './Status';

export interface TableCardData {
  id: string;
  number: string;
  status: TableStatus;
  seats?: number | null;
  /** Running bill, already formatted by the server's decimal (e.g. '460'). */
  amount?: string | null;
  minutesOpen?: number | null;
}

/** One table: 40 px bold number, status icon + word, seats or running amount (REQ-085, REQ-086). */
export function TableCard({ table, onOpen }: { table: TableCardData; onOpen: (t: TableCardData) => void }) {
  const { t } = useI18n();
  const free = table.status === 'AVAILABLE';
  return (
    <button
      type="button"
      className={`table-card table-card--${tableStatusClass(table.status)}`}
      aria-label={t('table.cardLabel', { number: table.number, status: t(`tableStatus.${statusKey(table.status)}`) })}
      onClick={() => onOpen(table)}
    >
      <span className="text-table-number">{table.number}</span>
      <TableStatusLabel status={table.status} />
      {free ? (
        table.seats != null ? <span className="text-price">{t('table.seats', { count: table.seats })}</span> : null
      ) : table.amount != null ? (
        <span className="text-price">{t('money.rupees', { amount: table.amount })}</span>
      ) : null}
      <span className="table-card__note">
        {free ? t('table.tapToStart') : t('table.minutesOpen', { count: table.minutesOpen ?? 0 })}
      </span>
    </button>
  );
}

function statusKey(s: TableStatus): string {
  return s === 'AVAILABLE' ? 'available' : s === 'OCCUPIED' ? 'occupied' : 'readyToClose';
}

/** 2 columns at 360 px, 4 from 768 px, 6 from 1024 px (REQ-013). */
export function TableGrid({ tables, onOpen }: { tables: TableCardData[]; onOpen: (t: TableCardData) => void }) {
  return (
    <div className="table-grid" data-testid="table-grid">
      {tables.map((tb) => <TableCard key={tb.id} table={tb} onOpen={onOpen} />)}
    </div>
  );
}
