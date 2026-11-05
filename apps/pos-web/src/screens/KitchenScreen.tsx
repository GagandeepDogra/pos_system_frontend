import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Item, KitchenKotView, Kot, KotStatus, MenuItemView, MenuView, RealtimeEvent, Role, Setting } from '@dhaba/shared';
import { maybePrintKot } from '../payment/paymentModel';
import { useI18n } from '../i18n/I18nProvider';
import type { ApiResult } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { StatusColumns } from '../components/StatusColumns';
import { PendingButton } from '../components/PendingButton';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { ThemeChoice, getKitchenDarkTheme, kitchenThemeClass, setKitchenDarkTheme } from '../components/ThemeChoice';
import { useLiveData } from '../realtime/realtime';
import {
  BOARD_COLUMNS, DEFAULT_LATE_MINUTES, boardColumns, clockTime, isLate, kotNumberLabel, kotTarget, minutesWaiting,
  nextStatus, normaliseKot, playKotAlert,
} from '../kitchen/kitchenModel';
import { normaliseMenu } from '../cart/menuModel';

/** Every event that can add, move, hide or change a kitchen card (REQ-116, REQ-127). */
export const KITCHEN_EVENTS: readonly RealtimeEvent[] = ['kot.created', 'kot.status_changed', 'order.updated', 'payment.recorded'];

/** Minutes-waiting, Late and auto-hide re-evaluate on their own between events. */
const CLOCK_MS = 30_000;

export interface KitchenApi {
  listKitchenKots: () => Promise<ApiResult<KitchenKotView[]>>;
  updateKotStatus: (id: string, rowVersion: number, status: Kot['status']) => Promise<ApiResult<Kot>>;
  getSettings: () => Promise<ApiResult<Setting>>;
  getMenu: () => Promise<ApiResult<MenuView | MenuItemView[]>>;
  markItemOutOfStock: (id: string) => Promise<ApiResult<Item>>;
}

interface Props {
  api: KitchenApi;
  userName: string;
  /** The signed-in user's role: only Kitchen and Admin may mark an item out of stock (REQ-056). */
  role: Role;
  /** The device lock: the dark screen is offered on a kitchen device only (REQ-092). */
  deviceRole: Role | null;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack?: () => void;
  /** The new-KOT alert (tests pass a spy). */
  playSound?: () => void;
  /** Optional kitchen printer (REQ-057), used only when settings.kitchen_print_enabled; tests pass a fake. */
  printKot?: () => void;
}

/** Kitchen · Tablet: NEW / PREPARING / READY board, oldest first, no prices (REQ-051 – REQ-056, REQ-021). */
export function KitchenScreen({ api, userName, role, deviceRole, onSwitchUser, onHome, onBack, playSound = playKotAlert, printKot = () => window.print() }: Props) {
  const { t, lang } = useI18n();
  const { data, failed, refresh } = useLiveData(api.listKitchenKots, KITCHEN_EVENTS);
  const [now, setNow] = useState(() => Date.now());
  const [lateLimit, setLateLimit] = useState(DEFAULT_LATE_MINUTES);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const [dark, setDark] = useState(getKitchenDarkTheme);
  const [stockOpen, setStockOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const sound = useRef(playSound);
  sound.current = playSound;
  const kotPrinter = useRef(printKot);
  kotPrinter.current = printKot;
  const kitchenPrint = useRef<Pick<Setting, 'kitchen_print_enabled'> | null>(null);

  useEffect(() => {
    let live = true;
    void api.getSettings().then((res) => {
      if (live && res.ok && res.data) kitchenPrint.current = { kitchen_print_enabled: res.data.kitchen_print_enabled === true };
      if (live && res.ok && typeof res.data?.late_kot_minutes === 'number') setLateLimit(res.data.late_kot_minutes);
    });
    return () => { live = false; };
  }, [api]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const kots = useMemo(() => (Array.isArray(data) ? data.map((k) => normaliseKot(k as unknown as Record<string, unknown>)) : []), [data]);

  // A KOT that was not on the board before is new: highlight it and play the sound once (REQ-053).
  // The first load (and a reconnect catch-up on that load) only records what is already there.
  useEffect(() => {
    if (!data) return;
    setNow(Date.now());
    const ids = new Set(kots.map((k) => k.id));
    if (seen.current) {
      const arrived = kots.filter((k) => k.status === 'NEW' && !seen.current!.has(k.id)).map((k) => k.id);
      if (arrived.length > 0) {
        setFresh((prev) => new Set([...prev, ...arrived]));
        sound.current();
        // Off by default: the on-screen card is the KOT. A printer failure never blocks or hides it.
        maybePrintKot(kitchenPrint.current, kotPrinter.current);
      }
    }
    seen.current = ids;
  }, [data, kots]);

  const touch = useCallback((id: string) => {
    setFresh((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  const advance = async (kot: KitchenKotView) => {
    const to = nextStatus(kot.status);
    if (!to || pending) return;
    touch(kot.id);
    setPending(kot.id);
    const res = await api.updateKotStatus(kot.id, kot.row_version, to);
    setPending(null);
    if (res.ok) {
      setMessage({ kind: 'success', text: t(to === 'READY' ? 'kitchen.markedReady' : 'kitchen.started', { number: kotNumberLabel(kot.kot_number) }) });
    } else {
      setMessage({
        kind: 'error',
        text: res.status === 409 || res.status === 422 ? t('kitchen.errors.moved') : (lang === 'hi' && res.error.message_hi) || res.error.message_en,
        nextStep: t('kitchen.errors.next'),
      });
    }
    void refresh();
  };

  const cols = boardColumns(kots, now);
  const canMarkOut = role === 'KITCHEN' || role === 'ADMIN';
  const themeCls = kitchenThemeClass(deviceRole, dark);

  return (
    <div className={`kitchen-root${themeCls ? ` ${themeCls}` : ''}`}>
      <ScreenFrame
        title={t('kitchen.title')}
        intro={t('kitchen.intro')}
        status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
        onBack={onBack}
        onHome={onHome}
        className="screen--kitchen"
      >
        <span hidden data-testid="screen-kitchen" />
        <ResultBar message={message} onDismiss={() => setMessage(null)} />
        {failed && !data ? <p className="kitchen__error" role="alert">{t('kitchen.loadFailed')}</p> : null}
        <StatusColumns
          columns={BOARD_COLUMNS.map((status) => ({
            status,
            count: cols[status].length,
            children: cols[status].map((k) => (
              <KotCard
                key={k.id}
                kot={k}
                now={now}
                lateLimit={lateLimit}
                fresh={fresh.has(k.id)}
                pending={pending === k.id}
                onTouch={() => touch(k.id)}
                onAdvance={() => void advance(k)}
              />
            )),
          }))}
        />
        <div className="kitchen__footer">
          <p className="muted">{t('kitchen.footer')}</p>
          <div className="kitchen__tools">
            {canMarkOut ? (
              <button type="button" className="btn" onClick={() => setStockOpen(true)}>{t('kitchen.outOfStock')}</button>
            ) : null}
            <ThemeChoice deviceRole={deviceRole} dark={dark} onChange={(d) => { setDark(d); setKitchenDarkTheme(d); }} />
          </div>
        </div>
      </ScreenFrame>
      {stockOpen ? (
        <OutOfStockSheet
          api={api}
          onClose={() => setStockOpen(false)}
          onDone={(m) => { setStockOpen(false); setMessage(m); }}
        />
      ) : null}
    </div>
  );
}

function KotCard({ kot, now, lateLimit, fresh, pending, onTouch, onAdvance }: {
  kot: KitchenKotView; now: number; lateLimit: number; fresh: boolean; pending: boolean;
  onTouch: () => void; onAdvance: () => void;
}) {
  const { t, lang } = useI18n();
  const target = kotTarget(kot);
  const mins = minutesWaiting(kot, now);
  const late = isLate(kot, now, lateLimit);
  const to = nextStatus(kot.status);
  const number = kotNumberLabel(kot.kot_number);
  const shown: KotStatus = kot.status;
  const meta = shown === 'READY'
    ? t('kitchen.metaReady', { number, time: clockTime(kot.ready_at ?? kot.updated_at) })
    : shown === 'SERVED'
      ? t('kitchen.metaServed', { number, time: clockTime(kot.served_at) })
      : t('kitchen.meta', { number, time: clockTime(kot.sent_at), minutes: mins });
  return (
    <article
      className={`kot-card${fresh ? ' kot-card--fresh' : ''}${late ? ' kot-card--late' : ''}`}
      data-testid={`kot-${kot.id}`}
      data-fresh={fresh || undefined}
      aria-label={t(target.kind === 'table' ? 'context.table' : 'context.token', target.kind === 'table' ? { number: target.label } : { token: target.label })}
      onPointerDown={onTouch}
      onClick={onTouch}
    >
      {fresh ? <span className="kot-card__new">{t('kitchen.newTicket')}</span> : null}
      <h3 className="kot-card__target">
        {target.kind === 'table' ? t('kitchen.table', { number: target.label }) : target.label}
      </h3>
      <p className={`kot-card__meta${late ? ' kot-card__meta--late' : ''}`}>{meta}</p>
      <ul className="kot-card__lines">
        {kot.lines.map((l) => {
          const name = (lang === 'hi' && l.item_name_hi) || l.item_name;
          const text = l.variant_name ? t('kitchen.lineVariant', { qty: l.quantity, name, variant: l.variant_name }) : t('kitchen.line', { qty: l.quantity, name });
          return (
            <li key={l.id || text} className={`kot-line${l.cancelled ? ' kot-line--cancelled' : ''}`} data-cancelled={l.cancelled || undefined}>
              {l.cancelled ? <s className="kot-line__text">{text}</s> : <span className="kot-line__text">{text}</span>}
              {l.cancelled ? <span className="kot-line__cancelled">{t('kitchen.cancelled')}</span> : null}
              {l.note && !l.cancelled ? <span className="kitchen-note">{l.note}</span> : null}
            </li>
          );
        })}
      </ul>
      {late ? <p className="kitchen-note" role="status">{t('kitchen.late', { minutes: mins })}</p> : null}
      {to ? (
        <PendingButton pending={pending} variant="secondary" className="kot-card__action" onClick={onAdvance}>
          {t(to === 'PREPARING' ? 'kitchen.startPreparing' : 'kitchen.markReady')}
        </PendingButton>
      ) : (
        <p className="kot-card__done">
          {t(shown === 'SERVED' ? 'kitchen.served' : 'kitchen.readyForPickup')}
        </p>
      )}
    </article>
  );
}

/** Kitchen picks one item and marks it out of stock for today (REQ-056). */
function OutOfStockSheet({ api, onClose, onDone }: {
  api: KitchenApi; onClose: () => void; onDone: (m: ResultMessage) => void;
}) {
  const { t, lang } = useI18n();
  const [items, setItems] = useState<MenuItemView[] | null>(null);
  const [chosen, setChosen] = useState<MenuItemView | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api.getMenu().then((res) => {
      if (!live) return;
      setItems(res.ok ? normaliseMenu(res.data).items.filter((i) => i.is_active && i.available_today) : []);
    });
    return () => { live = false; };
  }, [api]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !chosen) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [chosen, onClose]);

  const nameOf = (i: MenuItemView) => (lang === 'hi' && i.name_hi) || i.name_en;
  const confirm = async () => {
    if (!chosen || busy) return;
    setBusy(true);
    const res = await api.markItemOutOfStock(chosen.id);
    setBusy(false);
    onDone(res.ok
      ? { kind: 'success', text: t('kitchen.markedOut', { name: nameOf(chosen) }) }
      : { kind: 'error', text: t('kitchen.errors.outFailed'), nextStep: t('kitchen.errors.next') });
  };

  if (chosen) {
    return (
      <ConfirmSheet open title={t('kitchen.outConfirm', { name: nameOf(chosen) })} onYes={() => void confirm()} onNo={() => setChosen(null)} />
    );
  }
  return (
    <div className="sheet-scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="oos-title">
        <h2 className="sheet__title" id="oos-title">{t('kitchen.outTitle')}</h2>
        {items === null ? <p className="muted">{t('status.working')}</p> : null}
        {items && items.length === 0 ? <p className="muted">{t('food.none')}</p> : null}
        <div className="oos-list">
          {(items ?? []).map((i) => (
            <button key={i.id} type="button" className="btn oos-list__item" onClick={() => setChosen(i)}>{nameOf(i)}</button>
          ))}
        </div>
        <button type="button" className="btn btn--block" onClick={onClose}>{t('kitchen.close')}</button>
      </div>
    </div>
  );
}
