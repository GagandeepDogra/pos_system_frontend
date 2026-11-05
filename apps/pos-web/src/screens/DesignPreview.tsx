import { useCallback, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { ScreenFrame } from '../components/ScreenFrame';
import { ContextPill, type OrderContext } from '../components/ContextPill';
import { TableGrid, type TableCardData } from '../components/TableGrid';
import { TableStatusLegend } from '../components/Status';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { StatusColumns } from '../components/StatusColumns';
import { ThemeChoice, kitchenThemeClass } from '../components/ThemeChoice';
import { ResultBar, type ResultMessage } from '../components/ResultBar';

const SAMPLE_TABLES: TableCardData[] = [
  { id: 't1', number: '01', status: 'AVAILABLE', seats: 4 },
  { id: 't2', number: '02', status: 'OCCUPIED', amount: '460', minutesOpen: 18 },
  { id: 't3', number: '03', status: 'READY_TO_CLOSE', amount: '620', minutesOpen: 32 },
  { id: 't4', number: '04', status: 'AVAILABLE', seats: 4 },
  { id: 't5', number: '05', status: 'OCCUPIED', amount: '580', minutesOpen: 28 },
  { id: 't6', number: '06', status: 'AVAILABLE', seats: 4 },
];
const CONTEXTS: OrderContext[] = [{ kind: 'table', table: '5' }, { kind: 'token', token: 'T-012' }];

/** Development-only page (`#/design`) showing the shared primitives together. */
export function DesignPreview() {
  const { t } = useI18n();
  const [ctx, setCtx] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [dark, setDark] = useState(false);
  const [msg, setMsg] = useState<ResultMessage | null>(null);
  const dismiss = useCallback(() => setMsg(null), []);
  const noop = () => undefined;

  return (
    <ScreenFrame
      className={kitchenThemeClass('KITCHEN', dark)}
      title={t('dashboard.dineIn')}
      context={<ContextPill context={CONTEXTS[ctx]} />}
      onBack={() => setCtx((c) => (c + 1) % CONTEXTS.length)}
      onHome={noop}
      primaryAction={
        <button type="button" className="btn btn--primary" onClick={() => setSheet(true)}>{t('actions.sendToKitchen')}</button>
      }
    >
      <ResultBar message={msg} onDismiss={dismiss} />
      <TableStatusLegend />
      <TableGrid tables={SAMPLE_TABLES} onOpen={noop} />
      <StatusColumns columns={[{ status: 'NEW', count: 2 }, { status: 'PREPARING', count: 2 }, { status: 'READY', count: 2 }]} />
      <ThemeChoice deviceRole="KITCHEN" dark={dark} onChange={setDark} />
      <ConfirmSheet
        open={sheet}
        title={t('actions.sendToKitchen')}
        onNo={() => setSheet(false)}
        onYes={() => {
          setSheet(false);
          setMsg({ kind: 'success', text: t('status.saved') });
        }}
      />
    </ScreenFrame>
  );
}
