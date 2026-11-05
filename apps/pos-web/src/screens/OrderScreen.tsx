import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type {
  Kot, Order, OrderDetailView, OrderException, OrderItem, RealtimeEvent, Role, Setting, TableView,
} from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import type { ApiResult } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { ContextPill } from '../components/ContextPill';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { AdminPinSheet } from '../components/AdminPinSheet';
import { PendingButton } from '../components/PendingButton';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { KotStatusLabel } from '../components/Status';
import { useLiveData } from '../realtime/realtime';
import { useOnline } from '../offline/connection';
import { formatRupees } from '../cart/menuModel';
import {
  billLines, canCancel, cancelNeedsPin, checkReason, discountAmount, discountBody, discountNeedsPin, kotGroups,
  mergeSources, moveTargets, type DiscountError, type DiscountMode,
} from '../order/orderModel';

type Res<T> = Promise<ApiResult<T>>;
export interface OrderApi {
  getOrder: (id: string) => Res<Order>;
  getSettings: () => Res<Setting>;
  listTables: (query?: { area?: string; status?: string }) => Res<TableView[]>;
  cancelOrderItem: (id: string, rowVersion: number, reason: string, approvalToken?: string) => Res<Order>;
  moveOrder: (id: string, rowVersion: number, tableId: string) => Res<Order>;
  mergeOrders: (id: string, rowVersion: number, sourceOrderId: string) => Res<Order>;
  printBill: (id: string, rowVersion: number) => Res<Order>;
  applyDiscount: (id: string, rowVersion: number, body: Partial<OrderException>, approvalToken?: string) => Res<Order>;
  updateKotStatus: (id: string, rowVersion: number, status: Kot['status']) => Res<Kot>;
  createApproval: (key: string, body: { pin: string }) => Res<{ approval_token: string; admin_id: string }>;
}

const ORDER_EVENTS: readonly RealtimeEvent[] = ['order.updated', 'kot.created', 'kot.status_changed', 'payment.recorded', 'table.status_changed'];
const CANCEL_CHIPS = ['Customer changed mind', 'Wrong item', 'Too late'] as const;

type Sheet =
  | { kind: 'cancel'; kot: Kot; line: OrderItem }
  | { kind: 'discount' }
  | { kind: 'move'; tables: TableView[] }
  | { kind: 'merge'; tables: TableView[] }
  | null;

interface Props {
  orderId: string;
  table: string;
  tableId?: string | null;
  role: Role;
  api: OrderApi;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack: () => void;
  /** ADD MORE FOOD: food selection for this order (a send after PRINT BILL reopens it, REQ-060). */
  onAddFood: (order: Order, table: string) => void;
  /** After a move the session lives on another table. */
  onMoved?: (order: Order, table: TableView) => void;
}

/**
 * Order view of an Occupied or Ready to Close table (REQ-035): sent food grouped by KOT, served marking,
 * cancel with reason (Admin PIN once the kitchen started, REQ-083), the bill breakdown from the server
 * (REQ-058/059), PRINT BILL (REQ-060), discount (REQ-061) and move/merge (REQ-037).
 */
export function OrderScreen({ orderId, table, tableId, role, api, userName, onSwitchUser, onHome, onBack, onAddFood, onMoved }: Props) {
  const { t, lang } = useI18n();
  const online = useOnline();
  const [id, setId] = useState(orderId);
  const [label, setLabel] = useState(table);
  const { data, failed, refresh } = useLiveData(() => api.getOrder(id) as Res<OrderDetailView>, ORDER_EVENTS);
  const [order, setOrder] = useState<OrderDetailView | null>(null);
  useEffect(() => { if (data) setOrder(data); }, [data]);
  const [settings, setSettings] = useState<Setting | null>(null);
  useEffect(() => {
    let live = true;
    void api.getSettings().then((r) => { if (live && r.ok) setSettings(r.data); });
    return () => { live = false; };
  }, [api]);

  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pinFor, setPinFor] = useState<{ run: (token: string) => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const busyRef = useRef(false);
  const [reason, setReason] = useState('');
  const [mode, setMode] = useState<DiscountMode>('amount');
  const [value, setValue] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const money = (v: string | number) => t('money.rupees', { amount: formatRupees(v) });
  const failText = (r: { error: { message_en: string; message_hi: string } }) => (lang === 'hi' ? r.error.message_hi : r.error.message_en);

  /** Runs one write; a 403 without a token asks for the Admin PIN and repeats it once with the approval. */
  const write = async <T,>(name: string, run: (token?: string) => Res<T>, okText: string, after?: (d: T) => void, token?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(name);
    const res = await run(token);
    busyRef.current = false;
    setBusy(null);
    if (res.ok) {
      closeSheet();
      setMessage({ kind: 'success', text: okText });
      after?.(res.data);
      void refresh();
    } else if (res.status === 403 && !token && (name === 'cancel' || name === 'discount')) {
      setPinFor({ run: (tk) => void write(name, run, okText, after, tk) });
    } else {
      setMessage({ kind: 'error', text: failText(res), nextStep: t('order.checkAgain') });
      if (res.status === 409) void refresh();
    }
  };

  const closeSheet = () => { setSheet(null); setReason(''); setValue(''); setFieldError(null); };

  if (!order) {
    return (
      <ScreenFrame title={t('order.title')} status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
        context={<ContextPill context={{ kind: 'table', table: label }} />} onBack={onBack} onHome={onHome}>
        <p className="order-empty">{failed ? t('order.loadFailed') : t('order.loading')}</p>
      </ScreenFrame>
    );
  }

  const groups = kotGroups(order);
  const lines = billLines(groups);
  const billed = order.status === 'BILLED';
  const isAdmin = role === 'ADMIN';
  const statusWord = billed ? t('tableStatus.readyToClose') : t('tableStatus.occupied');
  const taxLabel = settings && !settings.gst_rate_percent ? t('order.taxOff') : t('order.tax');
  const name = (l: OrderItem) => (lang === 'hi' && l.item_name_hi_snapshot ? l.item_name_hi_snapshot : l.item_name_snapshot);

  const askCancel = () => {
    if (sheet?.kind !== 'cancel') return;
    const err = checkReason(reason);
    if (err) { setFieldError(t(`order.errors.${err}`)); return; }
    const { kot, line } = sheet;
    const go = (tk?: string) => api.cancelOrderItem(line.id, line.row_version, reason.trim(), tk);
    const ok = t('order.cancelled', { item: name(line) });
    if (cancelNeedsPin(kot) && !isAdmin) setPinFor({ run: (tk) => void write('cancel', go, ok, undefined, tk) });
    else void write('cancel', go, ok);
  };

  const askDiscount = () => {
    const r = discountBody({ mode, value, reason }, order.subtotal);
    if (!r.ok) { setFieldError(t(`order.errors.${r.error as DiscountError}`)); return; }
    const go = (tk?: string) => api.applyDiscount(order.id, order.row_version, r.body, tk);
    const ok = t('order.discountSaved');
    if (discountNeedsPin(Number(r.body.amount), settings?.discount_limit_amount, isAdmin)) {
      setPinFor({ run: (tk) => void write('discount', go, ok, undefined, tk) });
    } else void write('discount', go, ok);
  };

  const openTables = async (kind: 'move' | 'merge') => {
    const res = await api.listTables();
    if (!res.ok) { setMessage({ kind: 'error', text: failText(res), nextStep: t('order.checkAgain') }); return; }
    const list = kind === 'move' ? moveTargets(res.data, tableId) : mergeSources(res.data, order.id);
    setSheet({ kind, tables: list });
  };

  const move = (target: TableView) => void write('move', () => api.moveOrder(order.id, order.row_version, target.id),
    t('order.moved', { table: target.table_number }), (o) => { setLabel(target.table_number); onMoved?.(o, target); });
  const merge = (source: TableView) => void write('merge', () => api.mergeOrders(order.id, order.row_version, source.order_id as string),
    t('order.merged', { table: source.table_number }), (o) => setId(o.id || order.id));
  const printBill = () => void write('bill', () => api.printBill(order.id, order.row_version), t('order.billPrinted'), (o) => {
    setOrder({ ...order, ...o });
    // The bill card is the only thing the print stylesheet shows.
    if (import.meta.env.MODE !== 'test') setTimeout(() => window.print(), 0);
  });
  const serve = (kot: Kot) => void write('serve', () => api.updateKotStatus(kot.id, kot.row_version, 'SERVED'), t('order.served', { kot: kot.kot_number }));

  const row = (left: ReactNode, right: ReactNode, cls = '') => (
    <div className={`bill-row ${cls}`}><span>{left}</span><span className="bill-row__amount">{right}</span></div>
  );

  return (
    <ScreenFrame
      title={t('order.title')}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      context={<ContextPill context={{ kind: 'table', table: label, detail: statusWord }} />}
      onBack={onBack}
      onHome={onHome}
      className="screen--order"
      actionSummary={<ResultBar message={message} onDismiss={() => setMessage(null)} />}
      primaryAction={
        <PendingButton pending={false} needsConnection={false} onClick={() => onAddFood(order, label)}>
          {t('order.addMore')}
        </PendingButton>
      }
    >
      <section className="order-sent" aria-labelledby="order-sent-title">
        <h2 id="order-sent-title" className="order-section-title">{t('order.sentToKitchen')}</h2>
        {groups.length === 0 ? <p className="order-empty">{t('order.nothingSent')}</p> : null}
        {groups.map(({ kot, lines: kl }) => (
          <div key={kot.id} className="order-kot" data-testid="order-kot">
            <div className="order-kot__head">
              <h3 className="order-kot__number">{t('order.kotNumber', { number: kot.kot_number })}</h3>
              {kot.status === 'SERVED' ? <span className="order-kot__served">{t('order.servedLabel')}</span>
                : kot.status === 'CANCELLED' ? <span className="order-kot__served">{t('order.cancelledLabel')}</span>
                  : <KotStatusLabel status={kot.status} />}
            </div>
            <ul className="order-lines">
              {kl.map((l) => (
                <li key={l.id} className={`order-line${l.status === 'CANCELLED' ? ' order-line--cancelled' : ''}`} data-testid="order-line">
                  <div className="order-line__text">
                    <span className="order-line__name">{t('order.qtyName', { qty: l.quantity, name: name(l) })}</span>
                    <span className="order-line__meta">
                      {l.status === 'CANCELLED' ? t('order.lineCancelled') : t('order.variantPrice', { variant: l.variant_name_snapshot, price: money(l.unit_price) })}
                    </span>
                    {l.note ? <span className="note-label">{l.note}</span> : null}
                  </div>
                  {canCancel(kot, l) ? (
                    <button type="button" className="btn order-line__cancel" disabled={!online}
                      onClick={() => { setFieldError(null); setReason(''); setSheet({ kind: 'cancel', kot, line: l }); }}>
                      {t('order.cancelItem')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
            {kot.status === 'READY' ? (
              <PendingButton variant="secondary" pending={busy === 'serve'} className="btn--block" onClick={() => serve(kot)}>
                {t('order.markServed')}
              </PendingButton>
            ) : null}
          </div>
        ))}
      </section>

      <section className="bill-card" aria-labelledby="bill-title" data-testid="bill-card">
        <h2 id="bill-title" className="order-section-title">
          {order.bill_no ? t('order.billNo', { bill: order.bill_no }) : t('order.bill')}
        </h2>
        <ul className="bill-lines">
          {lines.map((l) => (
            <li key={l.id} className="bill-line" data-testid="bill-line">
              {row(name(l), money(l.line_total))}
              <span className="bill-line__meta">{t('order.lineMeta', { qty: l.quantity, variant: l.variant_name_snapshot, price: money(l.unit_price) })}</span>
            </li>
          ))}
        </ul>
        {row(t('order.subtotal'), money(order.subtotal))}
        {row(order.discount_reason ? `${t('order.discount')} · ${order.discount_reason}` : t('order.discount'), money(order.discount_amount))}
        {row(taxLabel, money(order.tax_amount))}
        {row(t('order.roundOff'), money(order.round_off))}
        <div data-testid="grand-total">{row(t('order.grandTotal'), money(order.grand_total), 'bill-row--total')}</div>
      </section>

      <div className="order-actions">
        <PendingButton variant="secondary" pending={busy === 'bill'} onClick={printBill} disabled={lines.length === 0}>
          {billed ? t('order.printAgain') : t('order.printBill')}
        </PendingButton>
        <button type="button" className="btn" disabled={!online || lines.length === 0}
          onClick={() => { setFieldError(null); setSheet({ kind: 'discount' }); }}>{t('order.discountButton')}</button>
        <button type="button" className="btn" disabled={!online} onClick={() => void openTables('move')}>{t('order.move')}</button>
        <button type="button" className="btn" disabled={!online} onClick={() => void openTables('merge')}>{t('order.merge')}</button>
      </div>

      <ConfirmSheet open={sheet?.kind === 'cancel'} title={sheet?.kind === 'cancel' ? t('order.cancelTitle', { item: name(sheet.line) }) : ''}
        yesLabel={t('order.cancelYes')} noLabel={t('order.keep')} onYes={askCancel} onNo={closeSheet}>
        {sheet?.kind === 'cancel' && cancelNeedsPin(sheet.kot) && !isAdmin ? <p className="sheet__hint">{t('order.needsPin')}</p> : null}
        <div className="choice-row reason-chips">
          {CANCEL_CHIPS.map((c) => (
            <button key={c} type="button" className="btn" aria-pressed={reason === c} onClick={() => setReason(c)}>
              {t(`order.reasons.${CANCEL_CHIPS.indexOf(c)}`)}
            </button>
          ))}
        </div>
        <ReasonField value={reason} onChange={setReason} error={fieldError} />
      </ConfirmSheet>

      {sheet?.kind === 'discount' ? (
        <SheetBox title={t('order.discountTitle')} onClose={closeSheet} onSave={askDiscount} saveLabel={t('order.discountSave')} pending={busy === 'discount'}>
          <div className="choice-row" role="group" aria-label={t('order.discountKind')}>
            {(['amount', 'percent'] as const).map((m) => (
              <button key={m} type="button" className={`btn${mode === m ? ' btn--selected' : ''}`} aria-pressed={mode === m} onClick={() => setMode(m)}>
                {t(`order.discountMode.${m}`)}
              </button>
            ))}
          </div>
          <label className="field">
            <span className="field__label">{mode === 'amount' ? t('order.discountRupees') : t('order.discountPercent')}</span>
            <input className="field__input" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value.replace(/[^0-9.]/g, ''))} />
          </label>
          {mode === 'percent' && Number(value) > 0 ? (
            <p className="sheet__hint">{money(discountAmount({ mode, value }, order.subtotal) || 0)}</p>
          ) : null}
          <ReasonField value={reason} onChange={setReason} error={fieldError} />
        </SheetBox>
      ) : null}

      {sheet?.kind === 'move' || sheet?.kind === 'merge' ? (
        <SheetBox title={sheet.kind === 'move' ? t('order.moveTitle') : t('order.mergeTitle')} onClose={closeSheet}>
          {sheet.tables.length === 0 ? <p className="sheet__hint">{sheet.kind === 'move' ? t('order.noFreeTables') : t('order.noOpenTables')}</p> : null}
          <div className="table-pick">
            {sheet.tables.map((tb) => (
              <button key={tb.id} type="button" className="btn table-pick__btn" disabled={!!busy}
                onClick={() => (sheet.kind === 'move' ? move(tb) : merge(tb))}>
                {t('context.table', { number: tb.table_number })}
              </button>
            ))}
          </div>
        </SheetBox>
      ) : null}

      {pinFor ? (
        <AdminPinSheet
          title={t('order.pinTitle')}
          createApproval={api.createApproval}
          onApproved={(token) => { const p = pinFor; setPinFor(null); p.run(token); }}
          onCancel={() => setPinFor(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

function ReasonField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{t('order.reason')}</label>
      <input id={id} className="field__input" maxLength={80} value={value} aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined} onChange={(e) => onChange(e.target.value)} />
      {error ? <span id={`${id}-error`} className="field-error" role="alert">{error}</span> : null}
    </div>
  );
}

function SheetBox({ title, children, onClose, onSave, saveLabel, pending = false }: {
  title: string; children: ReactNode; onClose: () => void; onSave?: () => void; saveLabel?: string; pending?: boolean;
}) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="sheet__title">{title}</h2>
        {children}
        <div className="sheet__actions">
          <button type="button" className="btn" onClick={onClose}>{t('order.close')}</button>
          {onSave ? <PendingButton pending={pending} onClick={onSave}>{saveLabel}</PendingButton> : null}
        </div>
      </div>
    </div>
  );
}
