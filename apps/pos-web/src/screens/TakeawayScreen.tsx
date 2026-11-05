import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { KotStatus, Order, RealtimeEvent, TakeawayView } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey, type ApiResult } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { PendingButton } from '../components/PendingButton';
import { KeypadField } from '../components/KeypadField';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { useLiveData } from '../realtime/realtime';
import { formatRupees } from '../cart/menuModel';
import { activeTakeaways, isFoodReady, takeawayBody, type TakeawayRow } from '../takeaway/takeawayModel';
import '../styles/takeaway.css';

/** Events that can change a takeaway's items, kitchen status or paid state (REQ-116). */
export const TAKEAWAY_EVENTS: readonly RealtimeEvent[] = [
  'kot.created', 'kot.status_changed', 'order.updated', 'payment.recorded', 'dashboard.updated',
];

export interface TakeawayApi {
  listActiveTakeaways: () => Promise<ApiResult<Order[]>>;
  createTakeaway: (key: string, body: Partial<Order>) => Promise<ApiResult<Order>>;
  handOverTakeaway: (id: string, rowVersion: number) => Promise<ApiResult<Order>>;
}

/** Icon + word for the kitchen state (never colour alone, REQ-086). */
const KITCHEN_UI: Partial<Record<KotStatus, { icon: string; key: string; cls: string }>> = {
  NEW: { icon: '◷', key: 'kotStatus.new', cls: 'new' },
  PREPARING: { icon: '◷', key: 'kotStatus.preparing', cls: 'preparing' },
  READY: { icon: '✓', key: 'kotStatus.ready', cls: 'ready' },
  SERVED: { icon: '✓', key: 'kotStatus.ready', cls: 'ready' },
};

interface Props {
  api: TakeawayApi;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack: () => void;
  /** Open food selection for this token's order. */
  onAddFood: (token: string, orderId: string) => void;
  /** Open the payment screen for this token's order. */
  onCollect: (orderId: string) => void;
  /** Open the list of bills to pay. */
  onViewPayments: () => void;
}

/**
 * Takeaway · Phone (REQ-038..041): the active list with token, items, kitchen status and Paid/Unpaid, the
 * NEW TAKEAWAY sheet (optional name/phone, then the big token) and HANDED OVER for Ready tokens. The server
 * decides the token and whether a handover is allowed; this screen only shows its answers.
 */
export function TakeawayScreen({ api, userName, onSwitchUser, onHome, onBack, onAddFood, onCollect, onViewPayments }: Props) {
  const { t, lang } = useI18n();
  const { data, failed, refresh } = useLiveData(() => api.listActiveTakeaways() as Promise<ApiResult<TakeawayView[]>>, TAKEAWAY_EVENTS);
  /** Tokens handed over here, hidden at once while the list refetches. */
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const rows = activeTakeaways(Array.isArray(data) ? data : []).filter((r) => !gone.has(r.id));
  const money = (v: string | number) => t('money.rupees', { amount: formatRupees(v) });
  const failText = (r: { error: { message_en: string; message_hi: string } }) => (lang === 'hi' ? r.error.message_hi : r.error.message_en);
  const dismiss = useCallback(() => setResult(null), []);

  const handOver = async (row: TakeawayRow) => {
    setBusy(row.id);
    const res = await api.handOverTakeaway(row.id, row.rowVersion);
    setBusy(null);
    if (res.ok) {
      setGone((s) => new Set(s).add(row.id));
      setResult({ kind: 'success', text: t('takeaway.handedOverDone', { token: row.token }) });
    } else if (res.status === 422) {
      // The server refused: not paid or not ready. The token stays in the list (REQ-040/REQ-041).
      setResult(row.paid
        ? { kind: 'error', text: t('takeaway.errors.notReady'), nextStep: t('takeaway.errors.waitKitchen') }
        : { kind: 'error', text: t('takeaway.errors.notPaid'), nextStep: t('takeaway.errors.collectFirst', { amount: money(row.balanceDue) }) });
    } else if (res.status === 409) {
      setResult({ kind: 'error', text: t('takeaway.errors.changed'), nextStep: t('takeaway.errors.tryAgain') });
    } else {
      setResult({ kind: 'error', text: failText(res), nextStep: t('takeaway.errors.tryAgain') });
    }
    void refresh();
  };

  const readyUnpaid = rows.some((r) => isFoodReady(r) && !r.paid);

  return (
    <ScreenFrame
      title={t('takeaway.title')}
      intro={t('takeaway.activeCount', { count: rows.length })}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      onBack={onBack}
      onHome={onHome}
      className="screen--takeaway"
      primaryAction={
        <button type="button" className="btn btn--block takeaway__payments" onClick={onViewPayments}>
          {t('takeaway.viewPayments')}
        </button>
      }
    >
      <span hidden data-testid="screen-takeaway" />
      <ResultBar message={result} onDismiss={dismiss} />
      <button type="button" className="btn btn--primary btn--block takeaway__new" onClick={() => setSheetOpen(true)}>
        {t('takeaway.new')}
      </button>
      {failed && data === null ? <p className="takeaway__message" role="alert">{t('takeaway.loadFailed')}</p> : null}
      {data !== null && rows.length === 0 ? <p className="takeaway__message">{t('takeaway.empty')}</p> : null}
      <ul className="takeaway-list" aria-label={t('takeaway.listLabel')}>
        {rows.map((row) => {
          const ui = row.kitchen ? KITCHEN_UI[row.kitchen] : undefined;
          const ready = isFoodReady(row);
          return (
            <li key={row.id} className="takeaway-card" data-testid="takeaway-card" data-token={row.token}>
              <div className="takeaway-card__head">
                <span className="takeaway-card__token">{row.token}</span>
                <span className={`takeaway-card__paid${row.paid ? ' is-paid' : ''}`}>
                  {row.paid ? t('takeaway.paid') : t('takeaway.unpaid')}
                </span>
              </div>
              <p className="takeaway-card__summary">
                {t('takeaway.summary', { count: row.itemCount, amount: money(row.grandTotal) })}
              </p>
              {row.customer ? <p className="takeaway-card__customer">{row.customer}</p> : null}
              {ui ? (
                <p className={`takeaway-kitchen takeaway-kitchen--${ui.cls}`} data-kitchen={row.kitchen ?? ''}>
                  <span aria-hidden="true">{ui.icon}</span>
                  <span>{t(ui.key)}</span>
                </p>
              ) : (
                <p className="takeaway-kitchen takeaway-kitchen--none" data-kitchen="">{t('takeaway.notSent')}</p>
              )}
              {!row.kitchen ? (
                <button type="button" className="btn btn--dark btn--block" onClick={() => onAddFood(row.token, row.id)}>
                  {t('takeaway.addFood')}
                </button>
              ) : null}
              {ready && !row.paid ? (
                <button type="button" className="btn btn--dark btn--block" onClick={() => onCollect(row.id)}>
                  {t('takeaway.collect', { amount: money(row.balanceDue) })}
                </button>
              ) : null}
              {ready ? (
                <PendingButton pending={busy === row.id} variant="secondary"
                  className={`btn--block${row.paid ? ' btn--dark' : ''}`} data-testid="hand-over" onClick={() => void handOver(row)}>
                  {t('takeaway.handOver')}
                </PendingButton>
              ) : null}
            </li>
          );
        })}
      </ul>
      {readyUnpaid ? <p className="takeaway__note">{t('takeaway.readyUnpaidNote')}</p> : null}
      {sheetOpen ? (
        <NewTakeawaySheet api={api} onClose={() => setSheetOpen(false)} onCreated={() => void refresh()}
          onAddFood={(o) => { setSheetOpen(false); onAddFood(o.token ?? '', o.id); }} />
      ) : null}
    </ScreenFrame>
  );
}

/**
 * NEW TAKEAWAY (REQ-038/REQ-039): optional name and phone, then Create token. The server assigns T-NNN for the
 * business day; it is shown big so the cashier can call it out. One Idempotency-Key per sheet, kept on a timeout.
 */
function NewTakeawaySheet({ api, onClose, onCreated, onAddFood }: {
  api: Pick<TakeawayApi, 'createTakeaway'>;
  onClose: () => void;
  onCreated: (o: Order) => void;
  onAddFood: (o: Order) => void;
}) {
  const { t, lang } = useI18n();
  const titleId = useId();
  const nameId = useId();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<Order | null>(null);
  const key = useRef<string | null>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async () => {
    const built = takeawayBody(name, phone);
    if (!built.ok) {
      setError(t(`takeaway.errors.${built.error}`));
      return;
    }
    setError(null);
    key.current ??= newIdempotencyKey();
    setPending(true);
    const res = await api.createTakeaway(key.current, built.body);
    setPending(false);
    if (res.ok) {
      key.current = null;
      setCreated(res.data);
      onCreated(res.data);
      return;
    }
    // A timeout or 5xx keeps the key so the retry cannot make a second token; a 4xx is final.
    if (res.status > 0 && res.status < 500) key.current = null;
    setError(res.status === 409 ? t('takeaway.errors.tokenTaken') : (lang === 'hi' ? res.error.message_hi : res.error.message_en));
  };

  return (
    <div className="sheet-scrim">
      <div className="sheet takeaway-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {created ? (
          <>
            <h2 className="sheet__title" id={titleId}>{t('takeaway.createdTitle')}</h2>
            <p className="takeaway-sheet__token" data-testid="new-token" aria-live="polite">{created.token}</p>
            <p className="takeaway-sheet__hint">{t('takeaway.tellCustomer')}</p>
            <div className="sheet__actions">
              <button type="button" className="btn" onClick={onClose}>{t('takeaway.done')}</button>
              <button type="button" className="btn btn--dark" onClick={() => onAddFood(created)}>{t('takeaway.addFood')}</button>
            </div>
          </>
        ) : (
          <>
            <h2 className="sheet__title" id={titleId}>{t('takeaway.newTitle')}</h2>
            <p className="takeaway-sheet__hint">{t('takeaway.optional')}</p>
            <label className="field takeaway-sheet__field" htmlFor={nameId}>
              <span>{t('takeaway.name')}</span>
              <input ref={firstRef} id={nameId} className="field__input" value={name} maxLength={40} autoComplete="off"
                onChange={(e) => setName(e.target.value)} />
            </label>
            <KeypadField label={t('takeaway.phone')} value={phone} onChange={setPhone} decimal={false} maxLength={10} />
            <p className="takeaway-sheet__hint">{t('takeaway.phoneHint')}</p>
            {error ? <p className="takeaway-sheet__error" role="alert">{error}</p> : null}
            <div className="sheet__actions">
              <button type="button" className="btn" onClick={onClose}>{t('takeaway.cancel')}</button>
              <PendingButton pending={pending} variant="secondary" className="btn--dark" onClick={() => void create()}>{t('takeaway.create')}</PendingButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
