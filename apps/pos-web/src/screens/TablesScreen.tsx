import { useEffect, useMemo, useState } from 'react';
import type { RealtimeEvent, TableStatus, TableView } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import type { ApiResult } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { TableGrid, type TableCardData } from '../components/TableGrid';
import { TableStatusLegend } from '../components/Status';
import { useLiveData } from '../realtime/realtime';
import { ALL_AREAS, activeTables, areasOf, inArea, tableStatus, toCard } from './tablesModel';

/** Every event that can change a table's status, amount or existence (REQ-116). */
export const TABLE_EVENTS: readonly RealtimeEvent[] = [
  'table.status_changed', 'order.updated', 'payment.recorded', 'kot.created', 'dashboard.updated',
];

/** Minutes-open figures tick on their own between events. */
const CLOCK_MS = 30_000;

interface Props {
  listTables: (query?: { area?: string; status?: string }) => Promise<ApiResult<TableView[]>>;
  /** Set when opened from a dashboard tile: only tables with this status are listed. */
  statusFilter?: TableStatus | null;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack: () => void;
  onOpenTable: (table: TableCardData) => void;
  onTakeaway: () => void;
}

/** Tables · Phone: area tabs, status legend and the live table grid (REQ-032, REQ-033, REQ-036). */
export function TablesScreen({ listTables, statusFilter, userName, onSwitchUser, onHome, onBack, onOpenTable, onTakeaway }: Props) {
  const { t, pair } = useI18n();
  const [area, setArea] = useState<string>(ALL_AREAS);
  const [now, setNow] = useState(() => Date.now());
  const { data, failed } = useLiveData(
    () => listTables(statusFilter ? { status: statusFilter } : undefined),
    TABLE_EVENTS,
  );

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);
  // Keep 'now' fresh whenever new data arrives so a just-opened table reads 0 min.
  useEffect(() => { setNow(Date.now()); }, [data]);

  const rows = useMemo(() => {
    const live = activeTables(data ?? []);
    return statusFilter ? live.filter((tb) => tableStatus(tb) === statusFilter) : live;
  }, [data, statusFilter]);
  const areas = useMemo(() => areasOf(rows), [rows]);
  const shownArea = area === ALL_AREAS || areas.includes(area) ? area : ALL_AREAS;
  const cards = inArea(rows, shownArea).map((tb) => toCard(tb, now));

  return (
    <ScreenFrame
      title={statusFilter ? t('tiles.activeTables') : t('tables.title')}
      intro={t('tables.intro')}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      onBack={onBack}
      onHome={onHome}
      className="screen--tables"
      primaryAction={
        statusFilter ? undefined : (
          <button type="button" className="btn btn--block tables__takeaway" onClick={onTakeaway}>
            {t('tables.toTakeaway', { label: pair('dashboard.takeaway') })}
          </button>
        )
      }
    >
      <span hidden data-testid="screen-tables" />
      {areas.length > 0 ? (
        <div className="choice-row area-tabs" role="group" aria-label={t('tables.areas')}>
          <button type="button" className="btn" aria-pressed={shownArea === ALL_AREAS} onClick={() => setArea(ALL_AREAS)}>
            {t('tables.all')}
          </button>
          {areas.map((a) => (
            <button key={a} type="button" className="btn" aria-pressed={shownArea === a} onClick={() => setArea(a)}>
              {a}
            </button>
          ))}
        </div>
      ) : null}
      <TableStatusLegend />
      {failed && data === null ? <p className="tables__message" role="alert">{t('tables.loadFailed')}</p> : null}
      {data !== null && cards.length === 0 ? <p className="tables__message">{t('tables.empty')}</p> : null}
      <TableGrid tables={cards} onOpen={onOpenTable} />
    </ScreenFrame>
  );
}
