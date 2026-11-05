import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FoodType, Kot, MenuItemView, MenuView, Order, OrderItem, RealtimeEvent, Variant } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey, type ApiResult, type RequestOptions } from '../api/client';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { ContextPill, type OrderContext } from '../components/ContextPill';
import { PendingButton } from '../components/PendingButton';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { useLiveData } from '../realtime/realtime';
import type { CartStore } from '../cart/cartStore';
import {
  activeCategories, activeVariants, canOrder, formatRupees, normaliseMenu, shouldSearch, startingPrice, visibleItems,
  type DietFilter,
} from '../cart/menuModel';
import {
  addVariant, cartTotal, changeQty, composeNote, dropRejected, emptyCart, itemCount, lineTotal, markSent, MAX_QTY,
  NOTE_CHIPS, reconcile, rejectedVariantIds, sendBody, setNote, type Cart, type CartError, type CartLine, type CartResult,
} from '../cart/cartModel';

/** Whose order the food goes to (REQ-093). */
export type FoodTarget =
  | { kind: 'table'; tableId: string; table: string; detail?: string; orderId?: string | null; free: boolean }
  | { kind: 'token'; token: string; orderId: string; detail?: string };

export function cartKeyOf(target: FoodTarget): string {
  return target.kind === 'table' ? `table:${target.tableId}` : `order:${target.orderId}`;
}

type Extra = Pick<RequestOptions, 'onPhase'>;
export interface FoodApi {
  getMenu: (q?: string) => Promise<ApiResult<MenuView | MenuItemView[]>>;
  openTableSession: (key: string, body: Partial<Order>, x?: Extra) => Promise<ApiResult<Order>>;
  sendToKitchen: (
    orderId: string, key: string, body: { lines: Pick<OrderItem, 'variant_id' | 'quantity' | 'note'>[] }, x?: Extra,
  ) => Promise<ApiResult<Kot>>;
}

const MENU_EVENTS: readonly RealtimeEvent[] = ['menu.availability_changed'];
const SEARCH_DEBOUNCE_MS = 250;

interface Props {
  target: FoodTarget;
  api: FoodApi;
  store: CartStore;
  userName: string;
  onSwitchUser: () => void;
  onHome: () => void;
  onBack: () => void;
}

/** Choose food · Phone: categories, veg filter, search, item cards, cart and Send to Kitchen. */
export function ChooseFoodScreen({ target, api, store, userName, onSwitchUser, onHome, onBack }: Props) {
  const { t, en, lang } = useI18n();
  const key = cartKeyOf(target);
  const { data: menuRaw, failed } = useLiveData(() => api.getMenu(), MENU_EVENTS);
  const menu = useMemo(() => normaliseMenu(menuRaw), [menuRaw]);

  const [cart, setCart] = useState<Cart | null>(null);
  const cartRef = useRef<Cart | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [diet, setDiet] = useState<DietFilter>(null);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<MenuItemView[] | null>(null);
  const [variantItem, setVariantItem] = useState<MenuItemView | null>(null);
  const [noteLine, setNoteLine] = useState<CartLine | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<ResultMessage | null>(null);
  const sending = useRef(false);

  // Load the device cart of THIS table/token; nothing can be added until it is the current one (REQ-093).
  const tableOrder = target.kind === 'table' ? target.orderId ?? null : target.orderId;
  const tableFree = target.kind === 'table' && target.free;
  useEffect(() => {
    let live = true;
    void store.load(key).then((stored) => {
      if (!live) return;
      const c = reconcile(stored ?? emptyCart(key, tableOrder), tableOrder, tableFree);
      cartRef.current = c;
      setCart(c);
    });
    return () => { live = false; };
  }, [key, store, tableOrder, tableFree]);
  const ready = cart?.key === key;

  const persist = useCallback((next: Cart) => {
    cartRef.current = next;
    setCart(next);
    void store.save(next);
  }, [store]);

  const errorText = (e: CartError) => t(`food.errors.${e}`);
  const apply = (r: CartResult) => {
    if (r.ok) persist(r.cart);
    else setMessage({ kind: 'error', text: errorText(r.error) });
    return r.ok;
  };

  // Server search from two letters (REQ-046); one letter never searches.
  useEffect(() => {
    if (!shouldSearch(query)) { setFound(null); return; }
    let live = true;
    const id = setTimeout(() => {
      void api.getMenu(query.trim()).then((res) => {
        if (live) setFound(res.ok ? normaliseMenu(res.data).items : []);
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => { live = false; clearTimeout(id); };
  }, [query, api]);

  const categories = activeCategories(menu);
  const shownCategory = category && categories.some((c) => c.id === category) ? category : null;
  const items = found
    ? visibleItems({ categories: menu.categories, items: found }, null, diet)
    : visibleItems(menu, shownCategory, diet);

  const choose = (item: MenuItemView) => {
    if (!ready || !cart || !canOrder(item)) return;
    const variants = activeVariants(item);
    if (variants.length === 1) apply(addVariant(cart, item, variants[0]));
    else setVariantItem(item);
  };
  const pickVariant = (v: Variant) => {
    if (variantItem && cartRef.current) apply(addVariant(cartRef.current, variantItem, v));
    setVariantItem(null);
  };

  const failMessage = (res: { error: { message_en: string; message_hi: string } }): ResultMessage => ({
    kind: 'error', text: lang === 'hi' ? res.error.message_hi : res.error.message_en, nextStep: t('food.tryAgain'),
  });

  const send = async () => {
    if (sending.current || !cartRef.current) return;
    let c = cartRef.current;
    if (c.lines.length === 0) { setMessage({ kind: 'error', text: errorText('empty') }); return; }
    sending.current = true;
    setPending(true);
    setChecking(false);
    const onPhase = (p: string) => setChecking(p === 'checking');
    try {
      if (!c.orderId) {
        if (target.kind !== 'table') return;
        const openKey = c.openKey ?? newIdempotencyKey();
        c = { ...c, openKey };
        persist(c);
        const res = await api.openTableSession(openKey, { table_id: target.tableId, order_type: 'DINE_IN' }, { onPhase });
        // 409 TABLE_BUSY returns the table's open order: the food goes there.
        const order = res.ok ? res.data : (res.current as Order | undefined);
        if (!order?.id) {
          if (!res.ok) {
            setMessage(failMessage(res));
            if (res.status >= 400 && res.status < 500) persist({ ...c, openKey: null });
          }
          return;
        }
        c = { ...c, orderId: order.id, openKey: null };
        persist(c);
      }
      // One key per Send, reused by every retry until the server answers (REQ-118).
      const sendKey = c.sendKey ?? newIdempotencyKey();
      c = { ...c, sendKey };
      persist(c);
      const res = await api.sendToKitchen(c.orderId!, sendKey, sendBody(c), { onPhase });
      if (res.ok) {
        // The cart empties only now, after the server confirmed the KOT (REQ-050).
        persist(markSent(c, res.data.kot_number));
        setExpanded(false);
        setMessage({ kind: 'success', text: t('food.sentOk', { number: res.data.kot_number }) });
        return;
      }
      const rejected = res.status === 422 ? rejectedVariantIds(res.error.details) : [];
      if (rejected.length > 0) {
        const { cart: kept, removed } = dropRejected(c, rejected);
        persist(kept);
        const names = removed.map((l) => (lang === 'hi' ? l.nameHi : l.nameEn)).join(', ');
        setMessage({ kind: 'error', text: t('food.rejected', { names }), nextStep: t('food.rejectedNext') });
        return;
      }
      // A definite answer (4xx) ends that key; a timeout / no answer keeps it for the retry.
      if (res.status >= 400 && res.status < 500) persist({ ...c, sendKey: null });
      setMessage(failMessage(res));
    } finally {
      sending.current = false;
      setPending(false);
      setChecking(false);
    }
  };

  const context: OrderContext = target.kind === 'table'
    ? { kind: 'table', table: target.table, detail: target.detail }
    : { kind: 'token', token: target.token, detail: target.detail };
  const lines = ready && cart ? cart.lines : [];
  const sent = ready && cart ? cart.sent : [];
  const count = itemCount(lines);
  const editable = ready && !pending;

  return (
    <ScreenFrame
      title={t('food.title')}
      status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />}
      context={<ContextPill context={context} />}
      onBack={onBack}
      onHome={onHome}
      className="screen--food"
      actionSummary={
        <>
          <ResultBar message={message} onDismiss={() => setMessage(null)} />
          {expanded ? (
            <section id="cart-summary" className="cart-summary" aria-label={t('food.cart')}>
              {lines.length === 0 ? <p className="cart-summary__empty">{t('food.cartEmpty')}</p> : null}
              <ul className="cart-lines">
                {lines.map((l) => (
                  <li key={l.lineId} className="cart-line" data-testid="cart-line">
                    <div className="cart-line__text">
                      <span className="text-item">{lang === 'hi' ? l.nameHi : l.nameEn}</span>
                      <span className="cart-line__meta">
                        {t('food.lineMeta', { variant: l.variantName, qty: l.quantity, price: formatRupees(l.unitPrice) })}
                      </span>
                      {l.note ? <span className="note-label">{l.note}</span> : null}
                    </div>
                    <span className="cart-line__total">{t('money.rupees', { amount: lineTotal(l) })}</span>
                    <div className="cart-line__actions">
                      <button type="button" className="btn qty-btn" disabled={!editable}
                        aria-label={t('food.less', { name: l.nameEn })} onClick={() => apply(changeQty(cartRef.current!, l.lineId, -1))}>
                        {t('food.minus')}
                      </button>
                      <span className="qty" aria-label={t('food.qty')}>{l.quantity}</span>
                      <button type="button" className="btn qty-btn" disabled={!editable || l.quantity >= MAX_QTY}
                        aria-label={t('food.more', { name: l.nameEn })} onClick={() => apply(changeQty(cartRef.current!, l.lineId, 1))}>
                        {t('food.plus')}
                      </button>
                      <button type="button" className="btn cart-line__note" disabled={!editable} onClick={() => setNoteLine(l)}>
                        {t('food.note')}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
              {sent.length > 0 ? (
                <div className="cart-sent">
                  <h2 className="cart-sent__title">{t('food.sentTitle')}</h2>
                  <ul className="cart-lines">
                    {sent.map((l) => (
                      <li key={`${l.kotNumber}-${l.lineId}`} className="cart-line cart-line--sent" data-testid="sent-line">
                        <span>{t('food.sentLine', { qty: l.quantity, name: lang === 'hi' ? l.nameHi : l.nameEn, variant: l.variantName })}</span>
                        <span>{t('food.kot', { number: l.kotNumber })}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}
          <div className="cart-bar">
            <span data-testid="cart-bar">{t('food.cartCount', { count, amount: cartTotal(lines) })}</span>
            <button type="button" className="btn btn--ghost cart-bar__toggle" aria-expanded={expanded}
              aria-controls="cart-summary" onClick={() => setExpanded((x) => !x)}>
              {expanded ? t('food.hideCart') : t('food.viewCart')}
            </button>
          </div>
        </>
      }
      primaryAction={
        <PendingButton pending={pending} checking={checking} disabled={!ready || lines.length === 0} onClick={() => void send()}>
          {t('food.send')}
        </PendingButton>
      }
    >
      <span hidden data-testid="screen-chooseFood" />
      <input
        type="search" className="food-search" value={query} onChange={(e) => setQuery(e.target.value)}
        placeholder={t('food.search')} aria-label={t('food.search')} autoComplete="off"
      />
      {found === null && categories.length > 0 ? (
        <div className="food-tabs" role="group" aria-label={t('food.categories')}>
          <button type="button" className="btn" aria-pressed={shownCategory === null} onClick={() => setCategory(null)}>
            {t('food.all')}
          </button>
          {categories.map((c) => (
            <button key={c.id} type="button" className="btn" aria-pressed={shownCategory === c.id} onClick={() => setCategory(c.id)}>
              {lang === 'hi' ? c.name_hi : c.name_en}
            </button>
          ))}
        </div>
      ) : null}
      <div className="food-tabs food-tabs--diet" role="group" aria-label={t('food.diet')}>
        <button type="button" className="btn" aria-pressed={diet === null} onClick={() => setDiet(null)}>{t('food.all')}</button>
        <button type="button" className="btn" aria-pressed={diet === 'VEG'} onClick={() => setDiet('VEG')}>
          <DietDot type="VEG" />{t('food.veg')}
        </button>
        <button type="button" className="btn" aria-pressed={diet === 'NON_VEG'} onClick={() => setDiet('NON_VEG')}>
          <DietDot type="NON_VEG" />{t('food.nonVeg')}
        </button>
      </div>
      {failed && menuRaw === null ? <p className="tables__message" role="alert">{t('food.loadFailed')}</p> : null}
      {(menuRaw !== null || found) && items.length === 0 ? <p className="tables__message">{t('food.none')}</p> : null}
      <ul className="food-grid" aria-label={t('food.items')}>
        {items.map((item) => (
          <li key={item.id}>
            <FoodCard item={item} disabled={!ready} onChoose={choose} />
          </li>
        ))}
      </ul>

      {variantItem ? (
        <div className="sheet-scrim">
          <div className="sheet" role="dialog" aria-modal="true" aria-label={t('food.chooseSize', { name: variantItem.name_en })}>
            <h2 className="sheet__title">{t('food.chooseSize', { name: lang === 'hi' ? variantItem.name_hi : variantItem.name_en })}</h2>
            <div className="variant-list">
              {activeVariants(variantItem).map((v) => (
                <button key={v.id} type="button" className="btn variant-btn" onClick={() => pickVariant(v)}>
                  <span>{v.name}</span>
                  <span className="text-price">{t('money.rupees', { amount: formatRupees(v.price) })}</span>
                </button>
              ))}
            </div>
            <button type="button" className="btn" onClick={() => setVariantItem(null)}>{t('actions.close')}</button>
          </div>
        </div>
      ) : null}
      {noteLine ? (
        <NoteSheet
          line={noteLine}
          chipLabel={(c) => en(`food.chips.${c}`)}
          onCancel={() => setNoteLine(null)}
          onSave={(note) => {
            // The sheet shows its own error under the field; no red bar for it.
            const r = setNote(cartRef.current!, noteLine.lineId, note);
            if (r.ok) { persist(r.cart); setNoteLine(null); }
            return r.ok;
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

function DietDot({ type }: { type: FoodType }) {
  return <span className={`diet-dot diet-dot--${type === 'VEG' ? 'veg' : 'non-veg'}`} aria-hidden="true" />;
}

function FoodCard({ item, disabled, onChoose }: { item: MenuItemView; disabled: boolean; onChoose: (i: MenuItemView) => void }) {
  const { t, lang } = useI18n();
  const orderable = canOrder(item);
  const variants = activeVariants(item);
  const price = startingPrice(item);
  const veg = item.food_type === 'VEG';
  const [main, other] = lang === 'hi' ? [item.name_hi, item.name_en] : [item.name_en, item.name_hi];
  return (
    <article className={`food-card${orderable ? '' : ' food-card--off'}`} data-testid="food-card" aria-label={item.name_en}>
      {item.photo_url ? <img className="food-card__photo" src={item.photo_url} alt="" loading="lazy" /> : null}
      <span className={`food-card__diet ${veg ? 'food-card__diet--veg' : 'food-card__diet--non-veg'}`}>
        <DietDot type={item.food_type} />{veg ? t('food.veg') : t('food.nonVeg')}
      </span>
      <span className="food-card__name">{main}</span>
      {other && other !== main ? <span className="food-card__sub">{other}</span> : null}
      {variants.length > 1 ? <span className="food-card__sub">{variants.map((v) => v.name).join(' / ')}</span> : null}
      {price !== null ? <span className="text-price" data-testid="start-price">{t('food.from', { amount: price })}</span> : null}
      {orderable ? (
        <button type="button" className="btn food-card__add" disabled={disabled} onClick={() => onChoose(item)}>
          {variants.length > 1 ? t('food.choose') : t('food.add')}
        </button>
      ) : (
        <span className="food-card__off" data-testid="unavailable">{t('food.unavailable')}</span>
      )}
    </article>
  );
}

function NoteSheet({ line, chipLabel, onCancel, onSave }: {
  line: CartLine; chipLabel: (c: string) => string; onCancel: () => void; onSave: (note: string) => boolean;
}) {
  const { t } = useI18n();
  const labels = NOTE_CHIPS.map(chipLabel);
  const parts = (line.note ?? '').split(', ').filter(Boolean);
  const [chips, setChips] = useState<string[]>(parts.filter((p) => labels.includes(p)));
  const [text, setText] = useState(parts.filter((p) => !labels.includes(p)).join(', '));
  const [error, setError] = useState(false);
  const toggle = (c: string) => setChips((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));
  return (
    <div className="sheet-scrim">
      <div className="sheet" role="dialog" aria-modal="true" aria-label={t('food.noteTitle', { name: line.nameEn })}>
        <h2 className="sheet__title">{t('food.noteTitle', { name: line.nameEn })}</h2>
        <div className="note-chips" role="group" aria-label={t('food.note')}>
          {NOTE_CHIPS.map((c, i) => (
            <button key={c} type="button" className="btn" aria-pressed={chips.includes(labels[i])} onClick={() => toggle(labels[i])}>
              {t(`food.chips.${c}`)}
            </button>
          ))}
        </div>
        <label className="note-field">
          <span>{t('food.noteText')}</span>
          <input type="text" value={text} onChange={(e) => { setText(e.target.value); setError(false); }}
            aria-invalid={error || undefined} aria-describedby={error ? 'note-error' : undefined} />
        </label>
        {error ? <p id="note-error" className="field-error" role="alert">{t('food.errors.noteTooLong')}</p> : null}
        <div className="sheet__actions">
          <button type="button" className="btn" onClick={onCancel}>{t('food.cancel')}</button>
          <button type="button" className="btn btn--primary" onClick={() => { if (!onSave(composeNote(chips, text))) setError(true); }}>
            {t('food.saveNote')}
          </button>
        </div>
      </div>
    </div>
  );
}
