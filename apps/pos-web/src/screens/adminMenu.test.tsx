import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Category, Item, MenuView, Variant } from '@dhaba/shared';
import { I18nProvider } from '../i18n/I18nProvider';
import { ConnectionProvider } from '../offline/connection';
import type { ApiResult } from '../api/client';
import { AdminAreaScreen } from './AdminAreaScreen';
import type { AdminMenuApi } from './AdminMenuScreen';
import {
  categoryError, itemBody, itemError, parsePrice, priceChangeError, reorder, variantError, variantUpdateBody, emptyItemDraft,
} from '../admin/menuAdminModel';
import css from '../styles/admin.css?raw';

const audit = { created_at: '', created_by: '', updated_at: '', updated_by: '', row_version: 3 };
const ok = <T,>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string): ApiResult<never> =>
  ({ ok: false, status, error: { code, message_en: `${code} message`, message_hi: `${code} hi`, details: null } as never });

const cat = (id: string, name: string, sort: number, active = true): Category =>
  ({ id, name_en: name, name_hi: `${name}-hi`, sort_order: sort, is_active: active, ...audit });
const item = (id: string, catId: string, name: string, code: string, extra: Partial<Item> = {}): Item => ({
  id, category_id: catId, name_en: name, name_hi: `${name}-hi`, short_code: code, food_type: 'VEG',
  is_active: true, available_today: true, ...audit, ...extra,
});
const variant = (id: string, itemId: string, name: string, price: string, sort: number): Variant =>
  ({ id, item_id: itemId, name, price, sort_order: sort, is_active: true, ...audit });

const MENU: MenuView = {
  categories: [cat('c1', 'Curries', 1), cat('c2', 'Breads', 2)],
  items: [{ ...item('i1', 'c1', 'Dal Makhani', 'DM'), variants: [variant('v1', 'i1', 'Half', '140.00', 1), variant('v2', 'i1', 'Full', '240.00', 2)] }],
};

function fakeApi(over: Partial<AdminMenuApi> = {}): AdminMenuApi {
  return {
    getMenu: vi.fn(async () => ok(MENU)),
    createCategory: vi.fn(async (_k, b) => ok({ ...cat('c9', b.name_en ?? '', 3), ...b } as Category, 201)),
    updateCategory: vi.fn(async (id, _rv, b) => ok({ ...MENU.categories!.find((c) => c.id === id)!, ...b } as Category)),
    createItem: vi.fn(async (_k, b) => ok({ ...item('i9', 'c1', '', ''), ...b } as Item, 201)),
    updateItem: vi.fn(async (id, _rv, b) => ok({ ...item(id, 'c1', 'Dal Makhani', 'DM'), ...b } as Item)),
    createVariant: vi.fn(async (itemId, _k, b) => ok({ ...variant('v9', itemId, '', '1', 3), ...b } as Variant, 201)),
    updateVariant: vi.fn(async (id, _rv, b) => ok({ ...variant(id, 'i1', 'Half', '140.00', 1), ...b } as Variant)),
    changeVariantPrice: vi.fn(async (id, _k, _rv, b) =>
      ok({ id: 'pc1', variant_id: id, old_price: '140.00', new_price: b.new_price, reason: b.reason, changed_by: 'u', created_at: '' }, 201)),
    setItemAvailability: vi.fn(async (id, _rv, a) => ok(item(id, 'c1', 'Dal Makhani', 'DM', { available_today: a }))),
    ...over,
  };
}

function renderAdmin(api: AdminMenuApi) {
  return render(
    <I18nProvider lang="en">
      <ConnectionProvider check={async () => true}>
        <AdminAreaScreen api={api} userName="Gagan" deviceLock={null} onDeviceLock={() => {}} onHome={() => {}} onSwitchUser={() => {}} />
      </ConnectionProvider>
    </I18nProvider>,
  );
}

describe('admin menu model', () => {
  it('REQ-070: a duplicate English category name is rejected (case-insensitive), its own name is not', () => {
    const all = MENU.categories!;
    expect(categoryError(' curries ', all)).toBe('adminMenu.errors.duplicateCategory');
    expect(categoryError('Curries', all, 'c1')).toBeNull();
    expect(categoryError('Rice', all)).toBeNull();
  });

  it('REQ-071: a short code outside 2–5 characters and a duplicate item name in one category are rejected', () => {
    const all = [item('i1', 'c1', 'Dal Makhani', 'DM')];
    const d = { ...emptyItemDraft('c1'), name_en: 'Paneer', name_hi: 'पनीर' };
    expect(itemError({ ...d, short_code: 'P' }, all)).toBe('adminMenu.errors.shortCode');
    expect(itemError({ ...d, short_code: 'PANEER' }, all)).toBe('adminMenu.errors.shortCode');
    expect(itemError({ ...d, short_code: 'PN' }, all)).toBeNull();
    expect(itemError({ ...d, name_en: 'dal makhani', short_code: 'PN' }, all)).toBe('adminMenu.errors.duplicateItem');
    expect(itemError({ ...d, category_id: 'c2', name_en: 'Dal Makhani', short_code: 'PN' }, all)).toBeNull();
  });

  it('REQ-071: the item body never carries is_active or available_today', () => {
    const body = itemBody({ ...emptyItemDraft('c1'), name_en: 'Lassi', name_hi: 'लस्सी', short_code: 'ls' });
    expect(body).not.toHaveProperty('is_active');
    expect(body).not.toHaveProperty('available_today');
    expect(body.short_code).toBe('LS');
    expect(body.photo_url).toBeNull();
  });

  it('REQ-072: a variant price of zero or below and a duplicate variant name are rejected', () => {
    const sib = [variant('v1', 'i1', 'Half', '140', 1)];
    expect(parsePrice('0')).toBeNull();
    expect(parsePrice('-5')).toBeNull();
    expect(parsePrice('12.345')).toBeNull();
    expect(parsePrice('99.5')).toBe('99.50');
    expect(variantError('Full', '0', sib)).toBe('adminMenu.errors.price');
    expect(variantError('half', '200', sib)).toBe('adminMenu.errors.duplicateVariant');
    expect(variantError('Full', '200', sib)).toBeNull();
  });

  it('REQ-072: a variant edit body never includes a price', () => {
    expect(variantUpdateBody({ name: ' Large ', sort_order: 2, is_active: false })).toEqual({ name: 'Large', sort_order: 2, is_active: false });
    expect(Object.keys(variantUpdateBody({ name: 'x', ...({ price: '1' } as object) }))).not.toContain('price');
  });

  it('REQ-094: a price change needs a price above 0, a change, and a reason from the list', () => {
    expect(priceChangeError('140.00', '160', null)).toBe('adminPrices.errors.reason');
    expect(priceChangeError('140.00', '160', 'CHEAPER')).toBe('adminPrices.errors.reason');
    expect(priceChangeError('140.00', '0', 'MARKET_RATE')).toBe('adminPrices.errors.price');
    expect(priceChangeError('140.00', '140', 'MARKET_RATE')).toBe('adminPrices.errors.same');
    for (const r of ['MARKET_RATE', 'NEW_SEASON', 'CORRECTION', 'OTHER']) expect(priceChangeError('140.00', '160', r)).toBeNull();
  });

  it('REQ-070: reorder swaps two neighbours and does nothing at the ends', () => {
    const rows = MENU.categories!;
    expect(reorder(rows, 'c2', -1).map((x) => [x.row.id, x.sort_order])).toEqual([['c2', 1], ['c1', 2]]);
    expect(reorder(rows, 'c1', -1)).toEqual([]);
  });

  it('REQ-094: the admin stylesheet turns tables into cards below 768 px and puts Old/New side by side', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[\s\S]*\.admin-table thead \{ display: none; \}/);
    expect(css).toMatch(/\.price-pair \{[^}]*grid-template-columns: 1fr 1fr/);
  });
});

describe('admin menu screens', () => {
  it('REQ-070: lists categories, blocks a duplicate name before calling the server, and adds a new one', async () => {
    const api = fakeApi();
    renderAdmin(api);
    expect(await screen.findByText('Curries')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add category' })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name in English'), { target: { value: 'curries' } });
    fireEvent.change(within(dialog).getByLabelText('Name in Hindi'), { target: { value: 'करी' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists');
    expect(api.createCategory).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Name in English'), { target: { value: 'Rice' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createCategory).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ name_en: 'Rice', sort_order: 3, is_active: true })));
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('REQ-070: a server 409 on a category shows its message in the sheet', async () => {
    const api = fakeApi({ createCategory: vi.fn(async () => fail(409, 'DUPLICATE')) });
    renderAdmin(api);
    await screen.findByText('Curries');
    fireEvent.click(screen.getAllByRole('button', { name: 'Add category' })[0]);
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name in English'), { target: { value: 'Rice' } });
    fireEvent.change(within(dialog).getByLabelText('Name in Hindi'), { target: { value: 'चावल' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('DUPLICATE message');
  });

  it('REQ-070: deactivating keeps the category listed with Put back on menu, which reactivates it (no delete)', async () => {
    const api = fakeApi();
    renderAdmin(api);
    await screen.findByText('Curries');
    const row = screen.getByText('Curries').closest('tr')!;
    fireEvent.click(within(row).getByRole('button', { name: 'Take off menu' }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenCalledWith('c1', 3, { is_active: false }));
    const row2 = (await screen.findByText('Off menu')).closest('tr')!;
    fireEvent.click(within(row2).getByRole('button', { name: 'Put back on menu' }));
    await waitFor(() => expect(api.updateCategory).toHaveBeenLastCalledWith('c1', 3, { is_active: true }));
  });

  it('REQ-074: the availability toggle sends only available_today and never touches is_active', async () => {
    const api = fakeApi();
    renderAdmin(api);
    const sw = await screen.findByRole('switch', { name: 'Dal Makhani available today' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    await waitFor(() => expect(api.setItemAvailability).toHaveBeenCalledWith('i1', 3, false));
    expect(api.updateItem).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Dal Makhani available today' })).toHaveAttribute('aria-checked', 'false'));
  });

  it('REQ-071: a short code outside 2–5 characters is blocked in the item sheet', async () => {
    const api = fakeApi();
    renderAdmin(api);
    await screen.findByText('Dal Makhani');
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Name in English'), { target: { value: 'Paneer' } });
    fireEvent.change(within(dialog).getByLabelText('Name in Hindi'), { target: { value: 'पनीर' } });
    fireEvent.change(within(dialog).getByLabelText('Short code (2 to 5 letters)'), { target: { value: 'P' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Non-veg' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('2 to 5');
    expect(api.createItem).not.toHaveBeenCalled();
    fireEvent.change(within(dialog).getByLabelText('Short code (2 to 5 letters)'), { target: { value: 'pn' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createItem).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ name_en: 'Paneer', short_code: 'PN', food_type: 'NON_VEG', category_id: 'c1' })));
  });

  it('REQ-072: editing a variant sends no price; a new variant needs a price above 0', async () => {
    const api = fakeApi();
    renderAdmin(api);
    await screen.findByText('Dal Makhani');
    fireEvent.click(screen.getByRole('button', { name: 'Sizes' }));
    const half = (await screen.findByText('Half')).closest('tr')!;
    fireEvent.click(within(half).getByRole('button', { name: 'Edit' }));
    let dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Size name'), { target: { value: 'Small' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.updateVariant).toHaveBeenCalledWith('v1', 3, { name: 'Small' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add size' }));
    dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Size name'), { target: { value: 'Jumbo' } });
    fireEvent.change(within(dialog).getByLabelText('Price ₹'), { target: { value: '0' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('above ₹0');
    expect(api.createVariant).not.toHaveBeenCalled();
  });

  it('REQ-094: the price editor shows Old ₹ / New ₹ and blocks Confirm until a reason is picked', async () => {
    const api = fakeApi();
    renderAdmin(api);
    await screen.findByText('Curries');
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }));
    const half = (await screen.findByText('Half')).closest('tr')!;
    fireEvent.click(within(half).getByRole('button', { name: 'Change price' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Old ₹')).toBeInTheDocument();
    expect(within(dialog).getByText('140')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('New ₹'), { target: { value: '160' } });
    const confirm = within(dialog).getByRole('button', { name: 'Confirm price' });
    expect(confirm).toBeDisabled();
    fireEvent.submit(dialog);
    expect(api.changeVariantPrice).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Market rate' }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(api.changeVariantPrice).toHaveBeenCalledWith('v1', expect.any(String), 3, { new_price: '160.00', reason: 'MARKET_RATE' }));
    expect(await screen.findByRole('status')).toHaveTextContent('Price changed');
    expect(await screen.findByText('₹160')).toBeInTheDocument();
  });

  it('REQ-073: a rejected price change keeps the old price shown and the sheet open with the reason', async () => {
    const api = fakeApi({ changeVariantPrice: vi.fn(async () => fail(400, 'BAD_REQUEST')) });
    renderAdmin(api);
    await screen.findByText('Curries');
    fireEvent.click(screen.getByRole('button', { name: 'Prices' }));
    const half = (await screen.findByText('Half')).closest('tr')!;
    fireEvent.click(within(half).getByRole('button', { name: 'Change price' }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('New ₹'), { target: { value: '160' } });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Other' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm price' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('BAD_REQUEST message');
    expect(screen.getByText('₹140')).toBeInTheDocument();
    expect(screen.queryByText('₹160')).not.toBeInTheDocument();
  });
});
