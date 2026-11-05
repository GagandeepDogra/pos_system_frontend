import { useEffect, useId, useRef, useState } from 'react';
import {
  CLOSE_REASON_CODES, PAYMENT_METHODS,
  type CloseReasonCode, type Order, type OrderDetailView, type OrderException, type OrderItem, type Payment, type PaymentMethod,
  type RealtimeEvent, type Role, type Setting,
} from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey, type ApiResult } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { ContextPill, type OrderContext } from '../components/ContextPill';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { AdminPinSheet } from '../components/AdminPinSheet';
import { PendingButton } from '../components/PendingButton';
import { KeypadField } from '../components/KeypadField';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { TableStatusLabel } from '../components/Status';
import { useLiveData } from '../realtime/realtime';
import { useOnline } from '../offline/connection';
import { formatRupees } from '../cart/menuModel';
import { billLines, kotGroups } from '../order/orderModel';
import {
  changeDue, closeExceptionBody, needsAdminPin, openBills, paymentBody, quickCash, readyToClose, receiptText, tryPrint, voidReason,
} from '../payment/paymentModel';
import '../styles/payment.css';

type Res<T> = Promise<ApiResult<T>>;
export interface PaymentApi {
  listOpenBills: () => Res<Order[]>;
  getOrder: (id: string) => Res<Order>;
  getSettings: () => Res<Setting>;
  printBill: (id: string, rowVersion: number) => Res<Order>;
  recordPayment: (orderId: string, key: string, body: Pick<Payment, 'method' | 'amount'> & Partial<Payment>) => Res<Payment>;
  voidPayment: (id: string, rowVersion: number, reason: string, approvalToken?: string) => Res<Payment>;
  closeWithException: (id: string, rowVersion: number, body: Partial<OrderException>, approvalToken?: string) => Res<Order>;
  recordReceiptPrint: (orderId: string, key: string) => Res<Order>;
  createApproval: (key: string, body: { pin: string }) => Res<{ approval_token: string; admin_id: string }>;
}

const BILL_EVENTS: readonly RealtimeEvent[] = ['payment.recorded', 'order.updated', 'table.status_changed', 'kot.created'];

/** 'Table 5' or 'Token T-012' for a bill row and the header pill. */
export function billContext(o: Pick<Order, 'token' | 'table_label_snapshot'>, detail?: string): OrderContext {
  return o.token ? { kind: 'token', token: o.token, detail } : { kind: 'table', table: o.table_label_snapshot ?? '', detail };
}

interface FrameProps {
  role: Role;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack: () => void;
}

/** Open bills list (REQ-062): every OPEN/BILLED order with a balance, by table or token, with a Ready to Close badge. */
export function BillsScreen({ api, onOpenBill, userName, onSwitchUser, onHome, onBack }: Omit<FrameProps, 'role'> & {
  api: Pick<PaymentApi, 'listOpenBills'>;
  onOpenBill: (o: Order) => void;
}) {
  const { t } = useI18n();
  const { data, failed } = useLiveData(() => api.listOpenBills(), BILL_EVENTS);
  const rows = openBills(Array.isArray(data) ? data : []);
  const money = (v: string | number) => t('money.rupees', { amount: formatRupees(v) });
  return (
    <ScreenFrame title={t('pay.billsTitle')} status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      onBack={onBack} onHome={onHome} className="screen--bills">
      {data === null && !failed ? <p className="order-empty">{t('pay.loading')}</p> : null}
      {failed ? <p className="order-empty">{t('pay.loadFailed')}</p> : null}
      {data !== null && rows.length === 0 ? <p className="order-empty">{t('pay.noBills')}</p> : null}
      <ul className="bill-list">
        {rows.map((o) => {
          const ctx = billContext(o);
          return (
            <li key={o.id}>
              <button type="button" className="bill-list__row" data-testid="open-bill" onClick={() => onOpenBill(o)}>
                <span className="bill-list__who">
                  {ctx.kind === 'table' ? t('context.table', { number: ctx.table }) : t('context.token', { token: ctx.token })}
                </span>
                {readyToClose(o) ? <TableStatusLabel status="READY_TO_CLOSE" /> : null}
                <span className="bill-list__due">{t('pay.dueAmount', { amount: money(o.balance_due) })}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </ScreenFrame>
  );
}

type Sheet = { kind: 'upi' } | { kind: 'void'; payment: Payment } | { kind: 'close' } | null;
interface Paid { amount: string; methods: PaymentMethod[] }

/**
 * Bill & payment (REQ-063..069): the server bill first, then Cash / UPI / Card. Cash shows cash given and change
 * with quick amounts; parts may be split until the balance is zero; at zero a full-screen green PAID shows with
 * Print / Share / Done. Void and close-with-balance are Admin actions (PIN on a cashier phone).
 */
export function PaymentScreen({ orderId, api, role, userName, onSwitchUser, onHome, onBack, onDone, print }: FrameProps & {
  orderId: string;
  api: PaymentApi;
  onDone: () => void;
  /** Browser print; tests pass a fake. */
  print?: () => void;
}) {
  const { t, lang } = useI18n();
  const online = useOnline();
  const { data, failed, refresh } = useLiveData(() => api.getOrder(orderId) as Res<OrderDetailView>, BILL_EVENTS);
  const [order, setOrder] = useState<OrderDetailView | null>(null);
  useEffect(() => { if (data) setOrder(data); }, [data]);
  const [settings, setSettings] = useState<Setting | null>(null);
  useEffect(() => {
    let live = true;
    void api.getSettings().then((r) => { if (live && r.ok) setSettings(r.data); });
    return () => { live = false; };
  }, [api]);

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [amount, setAmount] = useState('');
  const [tendered, setTendered] = useState('');
  const [upiRef, setUpiRef] = useState('');
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [reason, setReason] = useState('');
  const [code, setCode] = useState<CloseReasonCode | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [pinFor, setPinFor] = useState<{ run: (token: string) => void } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const methodsUsed = useRef<PaymentMethod[]>([]);
  /** One key per payment tap, kept until the server answers (a retry reuses it, REQ-065). */
  const payKey = useRef<string | null>(null);

  const money = (v: string | number) => t('money.rupees', { amount: formatRupees(v) });
  const failText = (r: { error: { message_en: string; message_hi: string } }) => (lang === 'hi' ? r.error.message_hi : r.error.message_en);
  const doPrint = print ?? (() => window.print());

  if (!order) {
    return (
      <ScreenFrame title={t('pay.title')} status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />} onBack={onBack} onHome={onHome}>
        <p className="order-empty">{failed ? t('pay.loadFailed') : t('pay.loading')}</p>
      </ScreenFrame>
    );
  }

  const lines = billLines(kotGroups(order));
  const due = order.balance_due;
  const payAmount = amount || due;
  const change = method === 'CASH' ? changeDue(payAmount, tendered || null) : null;
  const name = (l: OrderItem) => (lang === 'hi' && l.item_name_hi_snapshot ? l.item_name_hi_snapshot : l.item_name_snapshot);
  const isAdmin = !needsAdminPin(role);
  const statusWord = readyToClose(order) ? t('tableStatus.readyToClose') : undefined;
  const closeSheet = () => { setSheet(null); setReason(''); setCode(null); setFieldError(null); };
  const editAmount = (fn: () => void) => { payKey.current = null; fn(); };

  const pay = async (m: PaymentMethod) => {
    if (busy) return;
    const r = paymentBody({ method: m, amount: payAmount, tendered, upiRef }, due);
    if (!r.ok) { setMessage({ kind: 'error', text: t(`pay.errors.${r.error}`), nextStep: t('pay.checkAmount') }); return; }
    payKey.current ??= newIdempotencyKey();
    setBusy('pay');
    const res = await api.recordPayment(order.id, payKey.current, r.body);
    setBusy(null);
    if (!res.ok) {
      // A 4xx is final (new key next tap); a timeout or 5xx keeps the key so a retry cannot pay twice.
      if (res.status >= 400 && res.status < 500) payKey.current = null;
      setMessage({ kind: 'error', text: failText(res), nextStep: t('pay.checkAmount') });
      void refresh();
      return;
    }
    payKey.current = null;
    methodsUsed.current = [...methodsUsed.current, m];
    closeSheet();
    setAmount(''); setTendered(''); setUpiRef('');
    const fresh = await api.getOrder(order.id);
    const next = fresh.ok ? (fresh.data as OrderDetailView) : order;
    if (fresh.ok) setOrder(next);
    if (next.status === 'PAID' || Number(next.balance_due) <= 0) {
      setPaid({ amount: next.grand_total, methods: [...new Set(methodsUsed.current)] });
    } else {
      setMethod(null);
      setMessage({ kind: 'success', text: t('pay.partSaved', { method: t(`pay.method.${m}`), amount: money(r.body.amount) }) });
    }
  };

  /** Logs the print (cashier reprints are audited, REQ-067) and prints; a failure never undoes the payment. */
  const printReceipt = async (bill = false) => {
    setBusy('print');
    const logged = bill ? await api.printBill(order.id, order.row_version) : await api.recordReceiptPrint(order.id, newIdempotencyKey());
    setBusy(null);
    if (logged.ok && logged.data && bill) setOrder({ ...order, ...logged.data });
    const out = tryPrint(doPrint);
    if (!out.ok) setMessage({ kind: 'error', text: t('pay.printerError'), nextStep: t('pay.printerNext') });
    else if (!logged.ok) setMessage({ kind: 'error', text: failText(logged), nextStep: t('pay.checkAmount') });
    else setMessage({ kind: 'success', text: t('pay.printed') });
  };

  const share = async () => {
    const text = receiptText(order, lines, settings, { bill: t('pay.billWord'), total: t('order.grandTotal'), paid: t('pay.paidWord'), money });
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    if (nav.share) { try { await nav.share({ text }); } catch { /* closed */ } return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };

  /** Admin writes: a cashier phone asks for the Admin PIN first, the server re-checks (403). */
  const adminWrite = <T,>(run: (tk?: string) => Res<T>, okText: string, after?: () => void) => {
    const go = async (tk?: string) => {
      setBusy('admin');
      const res = await run(tk);
      setBusy(null);
      if (res.ok) { closeSheet(); setMessage({ kind: 'success', text: okText }); after?.(); void refresh(); }
      else if (res.status === 403 && !tk) setPinFor({ run: (k) => void go(k) });
      else setMessage({ kind: 'error', text: failText(res), nextStep: t('pay.checkAmount') });
    };
    if (isAdmin) void go();
    else setPinFor({ run: (k) => void go(k) });
  };

  const askVoid = () => {
    if (sheet?.kind !== 'void') return;
    const r = voidReason(reason);
    if (!r.ok) { setFieldError(t('pay.errors.reasonMissing')); return; }
    const p = sheet.payment;
    adminWrite((tk) => api.voidPayment(p.id, p.row_version, r.reason, tk), t('pay.voided', { amount: money(p.amount) }));
  };
  const askClose = () => {
    const r = closeExceptionBody(code, reason, due);
    if (!r.ok) { setFieldError(t('pay.errors.reasonMissing')); return; }
    adminWrite((tk) => api.closeWithException(order.id, order.row_version, r.body, tk), t('pay.closed'), onDone);
  };

  const receipt = (
    <section className="receipt" aria-hidden="true" data-testid="receipt">
      {settings?.dhaba_name ? <p className="receipt__head">{settings.dhaba_name}</p> : null}
      {settings?.address ? <p>{settings.address}</p> : null}
      {settings?.phone ? <p>{settings.phone}</p> : null}
      {settings?.gst_number ? <p>{t('pay.gstNo', { gst: settings.gst_number })}</p> : null}
      {order.bill_no ? <p>{t('order.billNo', { bill: order.bill_no })}</p> : null}
      <ul>
        {lines.map((l) => (
          <li key={l.id} data-testid="receipt-line">
            <span>{t('order.qtyName', { qty: l.quantity, name: name(l) })}</span>
            <span>{money(l.line_total)}</span>
          </li>
        ))}
      </ul>
      <p>{t('order.subtotal')} {money(order.subtotal)}</p>
      {Number(order.discount_amount) ? <p>{t('order.discount')} {money(order.discount_amount)}</p> : null}
      {Number(order.tax_amount) ? <p>{t('order.tax')} {money(order.tax_amount)}</p> : null}
      <p className="receipt__head">{t('order.grandTotal')} {money(order.grand_total)}</p>
      <p>{t('pay.paidWord')} {money(order.paid_amount)}</p>
      {settings?.receipt_footer ? <p>{settings.receipt_footer}</p> : null}
    </section>
  );

  if (paid) {
    return (
      <div className="paid-screen" role="status" data-testid="paid-screen">
        <p className="paid-screen__tick" aria-hidden="true">✓</p>
        <h1 className="paid-screen__title">{t('pay.paidTitle')}</h1>
        <p className="paid-screen__amount">{money(paid.amount)}</p>
        <p className="paid-screen__method">{paid.methods.map((m) => t(`pay.method.${m}`)).join(' + ')}</p>
        <ResultBar message={message} onDismiss={() => setMessage(null)} />
        <div className="paid-screen__actions">
          <PendingButton variant="secondary" pending={busy === 'print'} needsConnection={false} onClick={() => void printReceipt()}>
            {t('pay.print')}
          </PendingButton>
          <button type="button" className="btn" onClick={() => void share()}>{t('pay.share')}</button>
          <button type="button" className="btn btn--primary" onClick={onDone}>{t('pay.done')}</button>
        </div>
        {receipt}
      </div>
    );
  }

  const primary = method === 'UPI'
    ? <PendingButton pending={false} needsConnection={false} onClick={() => setSheet({ kind: 'upi' })}>{t('pay.showQr')}</PendingButton>
    : method ? (
      <PendingButton pending={busy === 'pay'} onClick={() => void pay(method)}>
        {t(method === 'CASH' ? 'pay.confirmCash' : 'pay.confirmCard', { amount: money(payAmount) })}
      </PendingButton>
    ) : undefined;

  return (
    <ScreenFrame
      title={t('pay.title')}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      context={<ContextPill context={{ ...billContext(order, statusWord), readyToClose: statusWord !== undefined }} />}
      onBack={onBack}
      onHome={onHome}
      className="screen--payment"
      actionSummary={
        <>
          <ResultBar message={message} onDismiss={() => setMessage(null)} />
          {method === 'CASH' ? <p className="pay-hint">{t('pay.checkCash')}</p> : null}
        </>
      }
      primaryAction={primary}
    >
      {order.bill_no ? <p className="pay-billno">{t('order.billNo', { bill: order.bill_no })}</p> : null}
      <section className="bill-card" aria-label={t('order.bill')} data-testid="bill-card">
        <ul className="bill-lines">
          {lines.map((l) => (
            <li key={l.id} className="bill-line" data-testid="bill-line">
              <div className="bill-row"><span>{name(l)}</span><span className="bill-row__amount">{money(l.line_total)}</span></div>
              <span className="bill-line__meta">{t('order.lineMeta', { qty: l.quantity, variant: l.variant_name_snapshot, price: money(l.unit_price) })}</span>
            </li>
          ))}
        </ul>
        <Row left={t('order.subtotal')} right={money(order.subtotal)} />
        <Row left={t('order.discount')} right={money(order.discount_amount)} />
        <Row left={settings && !settings.gst_rate_percent ? t('order.taxOff') : t('order.tax')} right={money(order.tax_amount)} />
        <Row left={t('order.roundOff')} right={money(order.round_off)} />
        <Row left={t('order.grandTotal')} right={money(order.grand_total)} total />
      </section>
      <PendingButton variant="secondary" pending={busy === 'print'} disabled={lines.length === 0} onClick={() => void printReceipt(true)}>
        {t('pay.printBill')}
      </PendingButton>

      {(order.payments ?? []).map((p) => (
        <div key={p.id} className={`pay-part${p.status === 'VOIDED' ? ' pay-part--voided' : ''}`} data-testid="payment-row">
          <span>
            {p.status === 'VOIDED'
              ? t('pay.voidedRow', { method: t(`pay.method.${p.method}`), amount: money(p.amount) })
              : t('pay.receivedRow', { method: t(`pay.method.${p.method}`), amount: money(p.amount) })}
          </span>
          {p.status === 'SUCCESS' ? (
            <button type="button" className="btn pay-part__void" disabled={!online}
              onClick={() => { setReason(''); setFieldError(null); setSheet({ kind: 'void', payment: p }); }}>
              {t('pay.void')}
            </button>
          ) : null}
        </div>
      ))}

      <div className="bill-row bill-row--total" data-testid="balance-due">
        <span>{t('pay.balanceDue')}</span><span className="bill-row__amount">{money(due)}</span>
      </div>

      {Number(due) > 0 ? (
        <>
          <div className="pay-methods" role="group" aria-label={t('pay.methodLabel')}>
            {PAYMENT_METHODS.map((m) => (
              <button key={m} type="button" className={`btn pay-method${method === m ? ' pay-method--on' : ''}`} aria-pressed={method === m}
                onClick={() => { setMethod(m); if (m === 'UPI') setSheet({ kind: 'upi' }); }}>
                {t(`pay.method.${m}`)}
              </button>
            ))}
          </div>
          {method ? (
            <KeypadField label={t('pay.partAmount')} value={amount} onChange={(v) => editAmount(() => setAmount(v))} />
          ) : null}
          {method === 'CASH' ? (
            <section className="cash-card" aria-label={t('payment.cashTendered')}>
              <div className="bill-row bill-row--total">
                <span>{t('pay.cashGiven')}</span><span className="bill-row__amount" data-testid="cash-given">{tendered ? money(tendered) : '—'}</span>
              </div>
              <div className="cash-card__quick">
                <button type="button" className={`btn${tendered === payAmount ? ' btn--selected' : ''}`} onClick={() => editAmount(() => setTendered(payAmount))}>
                  {t('pay.exact')}
                </button>
                {quickCash(payAmount).map((q) => (
                  <button key={q} type="button" className={`btn${Number(tendered) === q ? ' btn--selected' : ''}`}
                    onClick={() => editAmount(() => setTendered(String(q)))}>
                    {money(q)}
                  </button>
                ))}
              </div>
              <KeypadField label={t('pay.cashOther')} value={tendered} onChange={(v) => editAmount(() => setTendered(v))} />
              <div className="bill-row bill-row--total">
                <span>{t('pay.changeDue')}</span><span className="bill-row__amount" data-testid="change-due">{change === null ? '—' : money(change)}</span>
              </div>
            </section>
          ) : null}
          <button type="button" className="btn pay-close" disabled={!online}
            onClick={() => { setReason(''); setCode(null); setFieldError(null); setSheet({ kind: 'close' }); }}>
            {t('pay.closeWithBalance')}
          </button>
        </>
      ) : null}

      {sheet?.kind === 'upi' ? (
        <div className="sheet-scrim">
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t('pay.upiTitle')}>
            <h2 className="sheet__title">{t('pay.upiTitle')}</h2>
            <img className="upi-qr" src="/upi-qr.svg" alt={t('pay.upiQrAlt')} />
            <p className="bill-row bill-row--total"><span>{t('pay.amountNow')}</span><span className="bill-row__amount">{money(payAmount)}</span></p>
            <UpiRef value={upiRef} onChange={setUpiRef} />
            <div className="sheet__actions">
              <button type="button" className="btn" onClick={() => setSheet(null)}>{t('order.close')}</button>
              <PendingButton pending={busy === 'pay'} onClick={() => void pay('UPI')}>{t('pay.received')}</PendingButton>
            </div>
          </div>
        </div>
      ) : null}

      <ConfirmSheet open={sheet?.kind === 'void'} title={sheet?.kind === 'void' ? t('pay.voidTitle', { amount: money(sheet.payment.amount) }) : ''}
        yesLabel={t('pay.void')} noLabel={t('order.keep')} onYes={askVoid} onNo={closeSheet}>
        {!isAdmin ? <p className="sheet__hint">{t('pay.adminOnly')}</p> : null}
        <Reason value={reason} onChange={setReason} error={fieldError} />
      </ConfirmSheet>

      <ConfirmSheet open={sheet?.kind === 'close'} title={t('pay.closeTitle', { amount: money(due) })}
        yesLabel={t('pay.closeYes')} noLabel={t('order.keep')} onYes={askClose} onNo={closeSheet}>
        {!isAdmin ? <p className="sheet__hint">{t('pay.adminOnly')}</p> : null}
        <div className="choice-row reason-chips" role="group" aria-label={t('order.reason')}>
          {CLOSE_REASON_CODES.map((c) => (
            <button key={c} type="button" className={`btn${code === c ? ' btn--selected' : ''}`} aria-pressed={code === c} onClick={() => setCode(c)}>
              {t(`pay.closeReason.${c}`)}
            </button>
          ))}
        </div>
        <Reason value={reason} onChange={setReason} error={fieldError} />
      </ConfirmSheet>

      {pinFor ? (
        <AdminPinSheet title={t('pay.pinTitle')} createApproval={api.createApproval}
          onApproved={(token) => { const p = pinFor; setPinFor(null); p.run(token); }} onCancel={() => setPinFor(null)} />
      ) : null}
      {receipt}
    </ScreenFrame>
  );
}

function Row({ left, right, total = false }: { left: string; right: string; total?: boolean }) {
  return <div className={`bill-row${total ? ' bill-row--total' : ''}`}><span>{left}</span><span className="bill-row__amount">{right}</span></div>;
}

function UpiRef({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{t('pay.upiRef')}</label>
      <input id={id} className="field__input" maxLength={30} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function Reason({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
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
