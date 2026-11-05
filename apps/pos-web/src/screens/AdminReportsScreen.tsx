import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { CLOSE_REASON_CODES, type CloseReasonCode, type Order } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey } from '../api/client';
import type { endpoints } from '../api/endpoints';
import type { ResultMessage } from '../components/ResultBar';
import { PinPad } from '../components/PinPad';
import { formatRupees } from '../cart/menuModel';
import { closeExceptionBody } from '../payment/paymentModel';
import { TextField, useFailText } from './AdminMenuScreen';
import {
  EMPTY_HISTORY_QUERY, REPORT_PERIODS, businessDate, closedSnapshot, historyQuery, historyRows, normaliseDayClose,
  normaliseReport, normaliseRestorePreview, orderLabel, periodRange, rangeError, reportCsv, restorePinsError, shareOf,
  type DayCloseSummary, type HistoryQuery, type ReportPeriod, type RestorePreview, type SalesReport,
} from '../admin/reportsAdminModel';

type Ep = ReturnType<typeof endpoints>;
export type AdminReportsApi = Pick<Ep,
  'getSalesReport' | 'searchOrders' | 'getDayCloseSummary' | 'closeDay' | 'closeWithException' | 'downloadBackup' | 'previewRestore' | 'confirmRestore' | 'getSettings'>;

interface SectionProps { api: AdminReportsApi; onResult: (m: ResultMessage | null) => void }

/** Saves a Blob as a file through a temporary link (no command line needed, REQ-079). */
export function saveBlob(blob: Blob, name: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function useMoney() {
  const { t } = useI18n();
  return useCallback((v: number | string) => t('money.rupees', { amount: formatRupees(v) }), [t]);
}

/** Reports (REQ-077, Figma 3:30): Today / Yesterday / Date range, totals by method and category, top items, cancellations, exceptions. */
export function AdminReportsSection({ api, onResult, now = () => new Date() }: SectionProps & { now?: () => Date }) {
  const { t } = useI18n();
  const money = useMoney();
  const fail = useFailText();
  const [today, setToday] = useState(() => businessDate(now()));
  const [period, setPeriod] = useState<ReportPeriod>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const seq = useRef(0);

  const load = useCallback(async (f: string, tt: string) => {
    const n = ++seq.current;
    setLoading(true);
    setError('');
    const res = await api.getSalesReport(f, tt);
    if (n !== seq.current) return;
    setLoading(false);
    if (res.ok) setReport(normaliseReport(res.data, f, tt));
    else { setReport(null); setError(fail(res)); }
  }, [api, fail]);

  useEffect(() => {
    let live = true;
    void api.getSettings().then((res) => {
      if (live && res.ok && res.data?.token_reset_time) setToday(businessDate(now(), res.data.token_reset_time));
    });
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    if (period === 'range') return;
    const r = periodRange(period, today);
    void load(r.from, r.to);
  }, [period, today, load]);

  const rangeErr = period === 'range' ? rangeError(from, to) : null;
  function showRange(e: FormEvent) {
    e.preventDefault();
    if (!rangeError(from, to)) void load(from, to);
  }

  function download() {
    if (!report) return;
    const csv = reportCsv(report, {
      total: t('reports.totalCollected'), method: t('reports.paymentSplit'), category: t('reports.byCategory'),
      item: t('reports.topItems'), cancelled: t('reports.cancelled'), exception: t('reports.exceptions'),
    });
    saveBlob(new Blob([csv], { type: 'text/csv' }), `report-${report.from}-${report.to}.csv`);
    onResult({ kind: 'success', text: t('reports.downloaded') });
  }

  const max = report ? Math.max(report.total, ...report.byMethod.map((m) => m.amount)) : 0;
  const heading = period === 'today' ? t('reports.todayTitle') : period === 'yesterday' ? t('reports.yesterdayTitle') : t('reports.rangeTitle');

  return (
    <section className="admin-reports" aria-labelledby="reports-title">
      <div className="admin-reports__head">
        <div>
          <h2 id="reports-title" className="admin-reports__title">{heading}</h2>
          {report && <p className="muted admin-help">{report.from === report.to ? report.from : t('reports.rangeOf', { from: report.from, to: report.to })}
            {report.includesArchive ? ` · ${t('reports.archiveIncluded')}` : ''}</p>}
        </div>
        <button type="button" className="btn btn--dark admin-reports__download" disabled={!report} onClick={download}>{t('reports.download')}</button>
      </div>
      <div className="choice-row" role="group" aria-label={t('reports.period')}>
        {REPORT_PERIODS.map((p) => (
          <button key={p} type="button" className="btn" aria-pressed={period === p} onClick={() => { setPeriod(p); if (p === 'range') setReport(null); }}>
            {t(`reports.periods.${p}`)}
          </button>
        ))}
      </div>
      {period === 'range' && (
        <form className="admin-card admin-range" onSubmit={showRange} noValidate>
          <DateField label={t('reports.from')} value={from} onChange={setFrom} />
          <DateField label={t('reports.to')} value={to} onChange={setTo} invalid={rangeErr === 'order'} />
          <button type="submit" className="btn" disabled={!!rangeErr || loading}>{t('reports.show')}</button>
          {rangeErr === 'order' && <p className="field-error" role="alert">{t('reports.rangeOrder')}</p>}
        </form>
      )}
      {loading && <p className="muted" role="status">{t('reports.loading')}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
      {report && (
        <>
          <div className="admin-metrics">
            <Metric label={t('reports.totalSales')} value={money(report.total)} sub={report.billCount !== null ? t('reports.paidBills', { count: report.billCount }) : ''} />
            <Metric label={t('reports.discounts')} value={money(report.discountTotal)} sub={t('reports.exceptionCount', { count: report.exceptions.length })} />
            <Metric label={t('reports.cancelled')} value={String(report.cancelled.reduce((s, c) => s + (c.quantity || 1), 0))} sub={t('reports.cancelledSub')} />
          </div>
          <div className="admin-report-grid">
            <div className="admin-card">
              <h3 className="admin-card__title">{t('reports.paymentSplit')}</h3>
              {report.byMethod.map((m) => (
                <div key={m.method} className="admin-split">
                  <div className="admin-line"><span>{t(`reports.methods.${m.method}`)}</span><strong>{money(m.amount)}</strong></div>
                  <div className="admin-bar" aria-hidden="true"><span style={{ width: `${shareOf(m.amount, max)}%` }} /></div>
                </div>
              ))}
              <div className="admin-line admin-line--total"><span>{t('reports.totalCollected')}</span><strong data-testid="report-total">{money(report.total)}</strong></div>
            </div>
            <ListCard title={t('reports.topItems')} empty={t('reports.none')} rows={report.topItems.slice(0, 10).map((i) => [i.name, t('reports.sold', { count: i.quantity })])}
              foot={t('reports.rankedBy')} />
            <ListCard title={t('reports.byCategory')} empty={t('reports.none')} rows={report.byCategory.map((c) => [c.name, money(c.amount)])} />
            <ListCard title={t('reports.cancelled')} empty={t('reports.none')} rows={report.cancelled.map((c) => [c.name, t('reports.qty', { count: c.quantity })])} />
          </div>
          <ListCard title={t('reports.exceptions')} empty={t('reports.none')}
            rows={report.exceptions.map((e) => [[t(`reports.exceptionTypes.${e.type}`, { type: e.type }), e.reason, e.label].filter(Boolean).join(' · '), money(e.amount)])} />
        </>
      )}
    </section>
  );
}

function DateField({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input type="date" className="field__input" value={value} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="admin-card admin-metric">
      <span className="admin-metric__label">{label}</span>
      <strong className="admin-metric__value">{value}</strong>
      {sub && <span className="muted">{sub}</span>}
    </div>
  );
}

function ListCard({ title, rows, empty, foot }: { title: string; rows: [string, string][]; empty: string; foot?: string }) {
  return (
    <div className="admin-card">
      <h3 className="admin-card__title">{title}</h3>
      {rows.length === 0 ? <p className="muted admin-help">{empty}</p> : (
        <ul className="admin-lines">
          {rows.map(([a, b], i) => <li key={i} className="admin-line"><span>{a}</span><strong>{b}</strong></li>)}
        </ul>
      )}
      {foot && rows.length > 0 && <p className="muted admin-help">{foot}</p>}
    </div>
  );
}

/** Order history search by date, bill number, table or token (REQ-078). An empty result is not an error. */
export function AdminHistorySection({ api }: SectionProps) {
  const { t } = useI18n();
  const money = useMoney();
  const fail = useFailText();
  const [q, setQ] = useState<HistoryQuery>(EMPTY_HISTORY_QUERY);
  const [rows, setRows] = useState<Order[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const query = historyQuery(q);
  const set = (k: keyof HistoryQuery) => (v: string) => setQ((p) => ({ ...p, [k]: v }));

  async function search(e: FormEvent) {
    e.preventDefault();
    if (!query) return;
    setBusy(true);
    setError('');
    const res = await api.searchOrders(query);
    setBusy(false);
    if (res.ok) setRows(historyRows(res.data));
    else { setRows(null); setError(fail(res)); }
  }

  return (
    <section className="admin-history" aria-labelledby="history-title">
      <h2 id="history-title" className="visually-hidden">{t('history.title')}</h2>
      <form className="admin-card admin-search" onSubmit={search} noValidate>
        <DateField label={t('history.date')} value={q.date} onChange={set('date')} />
        <TextField label={t('history.billNo')} value={q.bill_no} onChange={set('bill_no')} maxLength={16} />
        <TextField label={t('history.table')} value={q.table} onChange={set('table')} maxLength={10} />
        <TextField label={t('history.token')} value={q.token} onChange={set('token')} maxLength={5} />
        <button type="submit" className="btn btn--dark" disabled={!query || busy}>{t('history.search')}</button>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      {rows && (
        <div className="admin-card" aria-live="polite">
          {rows.length === 0 ? <p className="admin-help">{t('history.noResults')}</p> : (
            <table className="admin-table">
              <thead><tr><th>{t('history.order')}</th><th>{t('history.date')}</th><th>{t('history.status')}</th><th>{t('history.total')}</th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td data-label={t('history.order')}>{orderLabel(o, (n) => t('history.tableN', { n })) || o.id}</td>
                    <td data-label={t('history.date')}>{o.business_date}</td>
                    <td data-label={t('history.status')}>{t(`history.statuses.${o.status}`, { status: o.status })}</td>
                    <td data-label={t('history.total')}><strong>{money(o.grand_total)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  );
}

/** Day close (REQ-096): unsettled OPEN/BILLED orders in red, the cash total for the drawer, then close. */
export function AdminDayCloseSection({ api, onResult, onCollect, onSnapshot }: SectionProps & { onCollect?: (orderId: string) => void; onSnapshot: (name: string | null, all?: string[]) => void }) {
  const { t } = useI18n();
  const money = useMoney();
  const fail = useFailText();
  const [summary, setSummary] = useState<DayCloseSummary | null>(null);
  const [error, setError] = useState('');
  const [closing, setClosing] = useState<Order | null>(null);
  const [code, setCode] = useState<CloseReasonCode | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  const load = useCallback(async () => {
    const res = await api.getDayCloseSummary();
    if (res.ok) {
      const s = normaliseDayClose(res.data);
      setSummary(s);
      setError('');
      if (s.snapshots.length) onSnapshot(null, s.snapshots);
    } else setError(fail(res));
  }, [api, fail, onSnapshot]);
  useEffect(() => { void load(); }, [load]);

  async function closeOrder() {
    if (!closing) return;
    const b = closeExceptionBody(code, '', closing.balance_due);
    if (!b.ok) return;
    setBusy(true);
    const res = await api.closeWithException(closing.id, closing.row_version, b.body);
    setBusy(false);
    if (res.ok) { onResult({ kind: 'success', text: t('dayClose.orderClosed') }); setClosing(null); setCode(null); }
    else onResult({ kind: 'error', text: fail(res), nextStep: t('dayClose.tryAgain') });
    void load();
  }

  async function closeDay() {
    key.current ??= newIdempotencyKey();
    setBusy(true);
    const res = await api.closeDay(key.current);
    setBusy(false);
    if (res.ok) {
      key.current = null;
      onSnapshot(closedSnapshot(res.data) ?? t('dayClose.snapshotOf', { date: summary?.businessDate ?? '' }));
      onResult({ kind: 'success', text: t('dayClose.done') });
    } else {
      if (res.status > 0 && res.status < 500) key.current = null;
      onResult({ kind: 'error', text: res.status === 409 ? t('dayClose.stillOpen') : fail(res), nextStep: t('dayClose.tryAgain') });
    }
    void load();
  }

  if (!summary) return error ? <p className="field-error" role="alert">{error}</p> : <p className="muted" role="status">{t('reports.loading')}</p>;
  const blocked = summary.unsettled.length > 0;
  return (
    <section className="admin-dayclose" aria-labelledby="dayclose-title">
      <h2 id="dayclose-title" className="visually-hidden">{t('dayClose.title')}</h2>
      <div className="admin-card">
        <div className="admin-line admin-line--total">
          <span>{t('dayClose.cashTotal')}</span><strong data-testid="cash-total">{money(summary.cashTotal)}</strong>
        </div>
        <p className="muted admin-help">{t('dayClose.cashHelp')}</p>
      </div>
      <div className="admin-card">
        <div className="admin-line admin-line--total">
          <span>{t('dayClose.toSettle')}</span><strong>{t('dayClose.openCount', { count: summary.unsettled.length })}</strong>
        </div>
        {summary.unsettled.map((o) => (
          <div key={o.id} className="admin-unsettled" data-testid="unsettled">
            <span className="admin-unsettled__label"><span aria-hidden="true">✕ </span>
              {[o.table_label_snapshot ? t('history.tableN', { n: o.table_label_snapshot }) : o.token, t(`history.statuses.${o.status}`, { status: o.status })].filter(Boolean).join(' · ')}
            </span>
            <strong>{t('dayClose.due', { amount: money(o.balance_due) })}</strong>
            <span className="admin-unsettled__actions">
              {onCollect && <button type="button" className="btn" onClick={() => onCollect(o.id)}>{t('dayClose.collect')}</button>}
              <button type="button" className="btn" onClick={() => { setClosing(o); setCode(null); }}>{t('dayClose.closeException')}</button>
            </span>
          </div>
        ))}
        {blocked ? <p className="admin-warning" role="alert">{t('dayClose.settleFirst')}</p> : <p className="admin-help">{t('dayClose.allSettled')}</p>}
      </div>
      {closing && (
        <div className="admin-card" role="group" aria-label={t('dayClose.closeException')}>
          <p className="admin-help"><strong>{t('pay.closeTitle', { amount: money(closing.balance_due) })}</strong></p>
          <div className="choice-row price-reasons" role="group" aria-label={t('dayClose.reason')}>
            {CLOSE_REASON_CODES.map((c) => (
              <button key={c} type="button" className="btn" aria-pressed={code === c} onClick={() => setCode(c)}>{t(`pay.closeReason.${c}`)}</button>
            ))}
          </div>
          <div className="admin-sheet-actions">
            <button type="button" className="btn" onClick={() => setClosing(null)}>{t('confirm.no')}</button>
            <button type="button" className="btn btn--dark" disabled={!code || code === 'OTHER' || busy} onClick={() => void closeOrder()}>{t('pay.closeYes')}</button>
          </div>
        </div>
      )}
      <button type="button" className="btn btn--dark admin-big" disabled={blocked || busy} onClick={() => void closeDay()}>{t('dayClose.closeDay')}</button>
    </section>
  );
}

type RestoreStep = 'pick' | 'pin1' | 'pin2' | 'done';

/** Backup download and restore (REQ-079, REQ-131): file → preview → PIN twice → swap → every device reloads. */
export function AdminBackupSection({ api, onResult, snapshots, reload = () => window.location.reload() }: SectionProps & { snapshots: string[]; reload?: () => void }) {
  const { t } = useI18n();
  const fail = useFailText();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestorePreview | null>(null);
  const [step, setStep] = useState<RestoreStep>('pick');
  const [pin1, setPin1] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const key = useRef<string | null>(null);

  async function download(snapshot?: string) {
    setBusy(true);
    const res = await api.downloadBackup(snapshot);
    setBusy(false);
    if (res.ok) {
      saveBlob(res.data, snapshot ? (snapshot.endsWith('.xlsx') ? snapshot : `${snapshot}.xlsx`) : 'dhaba-pos-backup.xlsx');
      onResult({ kind: 'success', text: t('backup.downloaded') });
    } else onResult({ kind: 'error', text: fail(res), nextStep: t('dayClose.tryAgain') });
  }

  async function check() {
    if (!file) return;
    key.current ??= newIdempotencyKey();
    const form = new FormData();
    form.append('file', file);
    setBusy(true);
    const res = await api.previewRestore(key.current, form);
    setBusy(false);
    if (res.ok) {
      const p = normaliseRestorePreview(res.data);
      key.current = null;
      setPreview(p);
      setStep(p ? 'pin1' : 'pick');
      if (!p) onResult({ kind: 'error', text: t('backup.rejected'), nextStep: t('backup.pickOther') });
    } else {
      if (res.status > 0 && res.status < 500) key.current = null;
      onResult({ kind: 'error', text: res.status === 422 ? t('backup.rejected') : fail(res), nextStep: t('backup.pickOther') });
    }
  }

  function cancel() {
    setPreview(null); setStep('pick'); setPin1(''); setMessage(null); setFile(null);
  }

  async function secondPin(pin2: string) {
    const err = restorePinsError(pin1, pin2);
    if (err || !preview) {
      // Mismatched entries are refused before anything is sent (REQ-079).
      setMessage(t(`backup.pin.${err ?? 'mismatch'}`)); setShake((n) => n + 1); setPin1(''); setStep('pin1');
      return;
    }
    setBusy(true);
    const res = await api.confirmRestore(preview.id, { pin: pin1, pin_confirm: pin2 });
    setBusy(false);
    if (res.ok) {
      setStep('done');
      onResult({ kind: 'success', text: t('backup.restored') });
      setTimeout(reload, 1500);
      return;
    }
    setPin1('');
    setShake((n) => n + 1);
    if (res.status === 404) { cancel(); onResult({ kind: 'error', text: t('backup.expired'), nextStep: t('backup.pickOther') }); return; }
    setStep('pin1');
    setMessage(res.status === 403 ? t('backup.pin.refused') : fail(res));
  }

  return (
    <section className="admin-backup" aria-labelledby="backup-title">
      <h2 id="backup-title" className="visually-hidden">{t('backup.title')}</h2>
      <div className="admin-card">
        <div className="admin-line">
          <span><span aria-hidden="true">✓ </span>{t('backup.live')}</span>
          <button type="button" className="btn btn--dark" disabled={busy} onClick={() => void download()}>{t('backup.download')}</button>
        </div>
        <p className="muted admin-help">{t('backup.auto')}</p>
        <h3 className="admin-card__title">{t('backup.snapshots')}</h3>
        {snapshots.length === 0 ? <p className="muted admin-help">{t('backup.noSnapshots')}</p> : (
          <ul className="admin-lines" aria-label={t('backup.snapshots')}>
            {snapshots.map((s) => (
              <li key={s} className="admin-line"><span>{s}</span>
                <button type="button" className="btn" disabled={busy} onClick={() => void download(s)}>{t('backup.downloadOne')}</button></li>
            ))}
          </ul>
        )}
      </div>
      <div className="admin-card">
        <h3 className="admin-card__title">{t('backup.restoreTitle')}</h3>
        {step === 'pick' && (
          <>
            <p className="muted admin-help">{t('backup.restoreHelp')}</p>
            <label className="field">
              <span className="field__label">{t('backup.file')}</span>
              <input type="file" className="field__input" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => { setFile(e.target.files?.[0] ?? null); key.current = null; }} />
            </label>
            <button type="button" className="btn btn--dark" disabled={!file || busy} onClick={() => void check()}>{t('backup.check')}</button>
          </>
        )}
        {preview && step !== 'pick' && (
          <dl className="admin-preview" data-testid="restore-preview">
            <div><dt>{t('backup.fileDate')}</dt><dd>{preview.fileDate || '—'}</dd></div>
            <div><dt>{t('backup.orders')}</dt><dd>{preview.orders}</dd></div>
            <div><dt>{t('backup.payments')}</dt><dd>{preview.payments}</dd></div>
          </dl>
        )}
        {(step === 'pin1' || step === 'pin2') && (
          <>
            <p className="admin-warning">{t('backup.warning')}</p>
            <PinPad key={step} label={step === 'pin1' ? t('backup.pin.first') : t('backup.pin.again')} shakeKey={shake} message={message} disabled={busy}
              onComplete={(p) => { if (step === 'pin1') { setPin1(p); setMessage(null); setStep('pin2'); } else void secondPin(p); }} />
            <button type="button" className="btn" onClick={cancel}>{t('backup.cancel')}</button>
          </>
        )}
        {step === 'done' && <p className="admin-help" role="status"><strong>{t('backup.reloading')}</strong></p>}
      </div>
    </section>
  );
}

