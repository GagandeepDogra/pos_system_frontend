import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Category, Kot, MenuItemView, Order, Variant } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { memoryCartStore, localCartStore } from '../cart/cartStore';
import {
  addVariant, changeQty, composeNote, emptyCart, reconcile, rejectedVariantIds, setNote,
} from '../cart/cartModel';
import { normaliseMenu, startingPrice, visibleItems } from '../cart/menuModel';
import { ChooseFoodScreen, type FoodApi, type FoodTarget } from './ChooseFoodScreen';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 1 };
const cat = (id: string, name: string, is_active = true, sort_order = 1): Category =>
  ({ id, name_en: name, name_hi: `${name}-hi`, sort_order, is_active, ...audit });
const v = (id: string, name: string, price: string, is_active = true, sort_order = 1): Variant =>
  ({ id, item_id: '', name, price, sort_order, is_active, ...audit });
const item = (id: string, name: string, extra: Partial<MenuItemView>): MenuItemView => ({
  id, category_id: 'cat_main', name_en: name, name_hi: `${name}-hi`, short_code: id.toUpperCase().slice(0, 4),
  food_type: 'VEG', is_active: true, available_today: true, photo_url: null, variants: [], ...audit, ...extra,
});

const MENU = {
  categories: [cat('cat_main', 'Main'), cat('cat_bread', 'Breads', true, 2), cat('cat_old', 'Old', false, 3)],
  items: [
    item('dal', 'Dal Makhani', { short_code: 'DM', variants: [v('v_dal_f', 'Full', '240.00', true, 2), v('v_dal_h', 'Half', '140.00')] }),
    item('chk', 'Butter Chicken', { food_type: 'NON_VEG', variants: [v('v_chk', 'Full', '220.00')] }),
    item('roti', 'Tandoori Roti', { category_id: 'cat_bread', short_code: 'TR', variants: [v('v_roti', 'One', '15.00')] }),
    item('gone', 'Kheer', { available_today: false, variants: [v('v_gone', 'Bowl', '60.00')] }),
    item('novar', 'Raita', { variants: [v('v_raita', 'Bowl', '40.00', false)] }),
    item('old', 'Old Dish', { category_id: 'cat_old', variants: [v('v_old', 'One', '10.00')] }),
  ],
};

const ok = <T,>(data: T, status = 201): ApiResult<T> => ({ ok: true, status, data });
const kot = (n: number, key: string): Kot =>
  ({ id: `kot_${n}`, kot_number: n, business_date: '', order_id: 'ord_1', status: 'NEW', idempotency_key: key, sent_at: '', ...audit });

function fakeApi() {
  const kots: { orderId: string; key: string; lines: unknown[] }[] = [];
  const keysSeen = new Set<string>();
  const menuQueries: (string | undefined)[] = [];
  let nextSend: ((key: string) => Promise<ApiResult<Kot>>) | null = null;
  const api: FoodApi & { kots: typeof kots; menuQueries: typeof menuQueries } = {
    kots,
    menuQueries,
    getMenu: vi.fn(async (q?: string) => {
      menuQueries.push(q);
      if (!q) return ok(MENU, 200);
      const s = q.toLowerCase();
      return ok({ ...MENU, items: MENU.items.filter((i) => [i.name_en, i.name_hi, i.short_code].some((x) => x.toLowerCase().includes(s))) }, 200);
    }),
    openTableSession: vi.fn(async (key: string) => ok({ id: 'ord_1', client_request_id: key, status: 'OPEN' } as Order)),
    sendToKitchen: vi.fn(async (orderId: string, key: string, body: { lines: unknown[] }) => {
      if (nextSend) { const f = nextSend; nextSend = null; return f(key); }
      // The server de-duplicates by key: a repeat returns the original KOT.
      const seen = kots.findIndex((k) => k.key === key);
      if (seen >= 0) return ok(kot(seen + 1, key), 200);
      if (body.lines.length === 0) {
        return { ok: false as const, status: 400, error: { code: 'BAD_REQUEST', message_en: 'Empty', message_hi: 'खाली' } };
      }
      keysSeen.add(key);
      kots.push({ orderId, key, lines: body.lines });
      return ok(kot(kots.length, key));
    }),
  };
  return { api, setNextSend: (f: (key: string) => Promise<ApiResult<Kot>>) => { nextSend = f; } };
}

const TABLE5: FoodTarget = { kind: 'table', tableId: 'din_5', table: '5', detail: 'Hall', free: true };
const T012: FoodTarget = { kind: 'token', token: 'T-012', orderId: 'ord_t12' };

function renderScreen(opts: { api?: FoodApi; store?: ReturnType<typeof memoryCartStore>; target?: FoodTarget; check?: () => Promise<boolean> } = {}) {
  const api = opts.api ?? fakeApi().api;
  const store = opts.store ?? memoryCartStore();
  const check = opts.check ?? (async () => true);
  const ui = (target: FoodTarget) => (
    <I18nProvider lang="en">
      <ConnectionProvider check={check}>
        <ChooseFoodScreen target={target} api={api} store={store} userName="Ramesh" onSwitchUser={vi.fn()} onHome={vi.fn()} onBack={vi.fn()} />
      </ConnectionProvider>
    </I18nProvider>
  );
  const r = render(ui(opts.target ?? TABLE5));
  return { ...r, api, store, rerenderTarget: (t: FoodTarget) => r.rerender(ui(t)) };
}

const card = (name: string) => screen.getByRole('article', { name });
const addBtn = (name: string) => within(card(name)).getByRole('button');
const sendBtn = () => screen.getByRole('button', { name: /Send to Kitchen/ });
async function ready() {
  await screen.findByRole('article', { name: 'Dal Makhani' });
  await waitFor(() => expect(addBtn('Butter Chicken')).toBeEnabled());
}

describe('menu and cart model', () => {
  it('REQ-043: an item with Half ₹140 and Full ₹240 starts at ₹140', () => {
    expect(startingPrice(MENU.items[0])).toBe('140');
  });
  it('REQ-042: VEG hides non-veg items and an inactive category hides its items', () => {
    const menu = normaliseMenu(MENU);
    const veg = visibleItems(menu, null, 'VEG').map((i) => i.id);
    expect(veg).not.toContain('chk');
    expect(visibleItems(menu, null, null).map((i) => i.id)).not.toContain('old');
    expect(normaliseMenu(MENU.items).items).toHaveLength(MENU.items.length);
  });
  it('REQ-047: quantity above 99 is rejected and − on 1 removes the line', () => {
    let c = addVariant(emptyCart('k'), MENU.items[1], MENU.items[1].variants![0]);
    if (!c.ok) throw new Error();
    const id = c.cart.lines[0].lineId;
    let cart = c.cart;
    for (let i = 0; i < 98; i++) { const r = changeQty(cart, id, 1); if (r.ok) cart = r.cart; }
    expect(cart.lines[0].quantity).toBe(99);
    expect(changeQty(cart, id, 1)).toEqual({ ok: false, error: 'qtyMax' });
    c = changeQty({ ...cart, lines: [{ ...cart.lines[0], quantity: 1 }] }, id, -1);
    expect(c.ok && c.cart.lines).toEqual([]);
  });
  it('REQ-045: an unavailable item cannot be added', () => {
    expect(addVariant(emptyCart('k'), MENU.items[3], MENU.items[3].variants![0])).toEqual({ ok: false, error: 'unavailable' });
  });
  it('REQ-048: a note over 80 characters is rejected; chips and text are joined', () => {
    const r = addVariant(emptyCart('k'), MENU.items[1], MENU.items[1].variants![0]);
    if (!r.ok) throw new Error();
    expect(setNote(r.cart, r.cart.lines[0].lineId, 'x'.repeat(81))).toEqual({ ok: false, error: 'noteTooLong' });
    expect(composeNote(['No onion', 'Parcel'], ' less oil ')).toBe('No onion, Parcel, less oil');
  });
  it('REQ-045: the rejected lines are read from the 422 details', () => {
    expect(rejectedVariantIds({ lines: [{ variant_id: 'a' }, 'b'] })).toEqual(['a', 'b']);
    expect(rejectedVariantIds(['c'])).toEqual(['c']);
    expect(rejectedVariantIds(null)).toEqual([]);
  });
  it('REQ-049: a freed table starts a new session; an occupied one adopts its order', () => {
    const old = { ...emptyCart('table:1', 'ord_old'), sent: [] };
    expect(reconcile(old, null, true).orderId).toBeNull();
    expect(reconcile(emptyCart('table:1'), 'ord_9', false).orderId).toBe('ord_9');
  });
  it('REQ-050: the localStorage store keeps a cart across loads', async () => {
    const s = localCartStore();
    await s.save(emptyCart('table:9', 'ord_9'));
    expect((await s.load('table:9'))?.orderId).toBe('ord_9');
    expect(await s.load('nothing')).toBeNull();
  });
});

describe('Choose food screen', () => {
  it('REQ-042 / REQ-043: categories, veg filter and cards with name, Hindi name and starting price, no photo needed', async () => {
    renderScreen();
    await ready();
    expect(screen.getByRole('button', { name: 'Breads' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Old' })).toBeNull();
    expect(screen.queryByRole('article', { name: 'Old Dish' })).toBeNull();
    expect(within(card('Dal Makhani')).getByTestId('start-price')).toHaveTextContent('₹140+');
    expect(within(card('Tandoori Roti')).getByText('Tandoori Roti-hi')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Veg' }));
    expect(screen.queryByRole('article', { name: 'Butter Chicken' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Breads' }));
    expect(screen.getAllByTestId('food-card').map((c) => c.getAttribute('aria-label'))).toEqual(['Tandoori Roti']);
  });

  it('REQ-044 / REQ-045: one variant adds in one tap; several open the sheet; unavailable adds nothing', async () => {
    renderScreen();
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('1 items · ₹220');
    fireEvent.click(addBtn('Dal Makhani'));
    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('button', { name: /Half.*₹140/ })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: /Full.*₹240/ }));
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('2 items · ₹460');
    expect(within(card('Kheer')).getByTestId('unavailable')).toHaveTextContent('Khatam / Not available');
    expect(within(card('Kheer')).queryByRole('button')).toBeNull();
    expect(within(card('Raita')).queryByRole('button')).toBeNull();
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('2 items');
  });

  it('REQ-046: one letter does not search; a short code finds its item', async () => {
    const { api } = renderScreen();
    await ready();
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'd' } });
    await new Promise((r) => setTimeout(r, 300));
    expect((api as ReturnType<typeof fakeApi>['api']).menuQueries).toEqual([undefined]);
    fireEvent.change(box, { target: { value: 'TR' } });
    await waitFor(() => expect(screen.getAllByTestId('food-card').map((c) => c.getAttribute('aria-label'))).toEqual(['Tandoori Roti']));
    expect((api as ReturnType<typeof fakeApi>['api']).menuQueries).toEqual([undefined, 'TR']);
  });

  it('REQ-047 / REQ-048 / REQ-093: summary with +/−, note chips, 80-letter limit, pill stays in the header', async () => {
    renderScreen();
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(screen.getByRole('button', { name: 'View cart ↑' }));
    const summary = screen.getByRole('region', { name: 'Cart' });
    expect(screen.getByTestId('context-pill').closest('header')).toBeInTheDocument();
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Table 5');
    expect(within(summary).getByText('Full · 1 × ₹220')).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'One more Butter Chicken' }));
    expect(within(summary).getByText('₹440')).toBeInTheDocument();
    fireEvent.click(within(summary).getByRole('button', { name: 'Note' }));
    const sheet = screen.getByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: 'No onion' }));
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: 'y'.repeat(80) } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    expect(within(screen.getByRole('dialog')).getByText(/Note is too long/)).toBeInTheDocument();
    fireEvent.change(within(sheet).getByRole('textbox'), { target: { value: '' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Save note' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(summary).getByText('No onion')).toHaveClass('note-label');
    fireEvent.click(within(summary).getByRole('button', { name: 'One less Butter Chicken' }));
    fireEvent.click(within(summary).getByRole('button', { name: 'One less Butter Chicken' }));
    expect(screen.queryAllByTestId('cart-line')).toHaveLength(0);
  });

  it('REQ-049: first send opens the session and makes one KOT; sent lines go grey and are not resent', async () => {
    const fake = fakeApi();
    renderScreen({ api: fake.api });
    await ready();
    expect(sendBtn()).toBeDisabled();
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(addBtn('Tandoori Roti'));
    fireEvent.click(addBtn('Dal Makhani'));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Half/ }));
    // Five fast taps write exactly one KOT.
    for (let i = 0; i < 5; i++) fireEvent.click(sendBtn());
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to kitchen. KOT 1');
    expect(fake.api.openTableSession).toHaveBeenCalledTimes(1);
    expect(fake.api.kots).toHaveLength(1);
    expect(fake.api.kots[0].lines).toHaveLength(3);
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('0 items');
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(addBtn('Tandoori Roti'));
    fireEvent.click(sendBtn());
    await waitFor(() => expect(fake.api.kots).toHaveLength(2));
    expect(fake.api.kots[1]).toMatchObject({ orderId: 'ord_1', lines: [{ variant_id: 'v_chk', quantity: 1 }, { variant_id: 'v_roti', quantity: 1 }] });
    expect(fake.api.kots[0].key).not.toBe(fake.api.kots[1].key);
    fireEvent.click(screen.getByRole('button', { name: 'View cart ↑' }));
    expect(screen.getByText('Sent to kitchen')).toBeInTheDocument();
    expect(screen.getAllByTestId('sent-line')).toHaveLength(5);
  });

  it('REQ-045: a KOT with a finished item is rejected only for that line; the rest stays', async () => {
    const fake = fakeApi();
    fake.setNextSend(async () => ({
      ok: false, status: 422,
      error: { code: 'ITEM_UNAVAILABLE', message_en: 'x', message_hi: 'x', details: { lines: [{ variant_id: 'v_chk' }] } },
    }));
    renderScreen({ api: fake.api });
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(addBtn('Tandoori Roti'));
    fireEvent.click(sendBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Finished, not sent: Butter Chicken');
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('1 items · ₹15');
  });

  it('REQ-118 / REQ-050: a lost answer keeps the cart and the key; the retry makes exactly one KOT', async () => {
    const fake = fakeApi();
    let firstKey = '';
    fake.setNextSend(async (key) => {
      firstKey = key;
      // The server saved it, but the answer never arrived.
      fake.api.kots.push({ orderId: 'ord_1', key, lines: [{}] });
      return { ok: false, status: 0, error: { code: 'TIMEOUT', message_en: 'Not saved, try again', message_hi: 'x' } };
    });
    renderScreen({ api: fake.api });
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(sendBtn());
    expect(await screen.findByRole('alert')).toHaveTextContent('Not saved, try again');
    expect(screen.getByTestId('cart-bar')).toHaveTextContent('1 items');
    fireEvent.click(sendBtn());
    expect(await screen.findByRole('status')).toHaveTextContent('KOT 1');
    expect(vi.mocked(fake.api.sendToKitchen).mock.calls[1][1]).toBe(firstKey);
    expect(fake.api.kots).toHaveLength(1);
  });

  it('REQ-050: reloading restores the cart from the device store', async () => {
    const store = memoryCartStore();
    const first = renderScreen({ store });
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    await waitFor(() => expect(store.data.get('table:din_5')?.lines).toHaveLength(1));
    first.unmount();
    renderScreen({ store });
    await waitFor(() => expect(screen.getByTestId('cart-bar')).toHaveTextContent('1 items · ₹220'));
  });

  it('REQ-016: offline disables Send, keeps the cart, polls every 3 s and never sends on reconnect', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      let online = false;
      const check = vi.fn(async () => online);
      const fake = fakeApi();
      renderScreen({ api: fake.api, check });
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      await ready();
      fireEvent.click(addBtn('Butter Chicken'));
      await waitFor(() => expect(sendBtn()).toBeDisabled());
      const calls = check.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      expect(check.mock.calls.length).toBe(calls + 1);
      online = true;
      await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
      await waitFor(() => expect(sendBtn()).toBeEnabled());
      expect(screen.getByTestId('cart-bar')).toHaveTextContent('1 items · ₹220');
      expect(fake.api.sendToKitchen).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('REQ-028 / REQ-118: while Send is pending the button is disabled with a spinner', async () => {
    const fake = fakeApi();
    let release: (r: ApiResult<Kot>) => void = () => undefined;
    fake.setNextSend(() => new Promise((r) => { release = r; }));
    renderScreen({ api: fake.api });
    await ready();
    fireEvent.click(addBtn('Butter Chicken'));
    fireEvent.click(sendBtn());
    await waitFor(() => expect(screen.getByRole('progressbar')).toBeInTheDocument());
    expect(sendBtn()).toBeDisabled();
    await act(async () => { release(ok(kot(7, 'k'))); });
    expect(await screen.findByRole('status')).toHaveTextContent('KOT 7');
  });

  it('REQ-093: switching from Table 5 to Token T-012 updates the pill before anything can be added', async () => {
    const r = renderScreen();
    await ready();
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Table 5');
    r.rerenderTarget(T012);
    expect(screen.getByTestId('context-pill')).toHaveTextContent('Token T-012');
    await waitFor(() => expect(addBtn('Butter Chicken')).toBeEnabled());
    fireEvent.click(addBtn('Butter Chicken'));
    await waitFor(() => expect(r.store.data.get('order:ord_t12')?.lines).toHaveLength(1));
    expect(r.store.data.get('table:din_5')?.lines ?? []).toHaveLength(0);
  });
});
