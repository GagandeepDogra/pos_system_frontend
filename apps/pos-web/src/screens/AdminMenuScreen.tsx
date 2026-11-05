import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import {
  FOOD_TYPES, PRICE_CHANGE_REASONS, type Category, type Item, type MenuItemView, type MenuView, type PriceChange,
  type PriceChangeReason, type RealtimeEvent, type Variant,
} from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey, type ApiResult } from '../api/client';
import { PendingButton } from '../components/PendingButton';
import type { ResultMessage } from '../components/ResultBar';
import { useLiveData } from '../realtime/realtime';
import { formatRupees, normaliseMenu } from '../cart/menuModel';
import {
  bySort, categoryError, emptyItemDraft, itemBody, itemDraftOf, itemError, mergeRows, nextSortOrder, parsePrice,
  priceChangeBody, priceChangeError, reorder, splitMenu, upsert, variantError, variantUpdateBody, type ItemDraft,
} from '../admin/menuAdminModel';
import '../styles/admin.css';

/** The pos-api operations the admin menu and price screens use (REQ-070..074). */
export interface AdminMenuApi {
  getMenu: () => Promise<ApiResult<MenuView | MenuItemView[]>>;
  createCategory: (key: string, body: Partial<Category>) => Promise<ApiResult<Category>>;
  updateCategory: (id: string, rowVersion: number, body: Partial<Category>) => Promise<ApiResult<Category>>;
  createItem: (key: string, body: Partial<Item>) => Promise<ApiResult<Item>>;
  updateItem: (id: string, rowVersion: number, body: Partial<Item>) => Promise<ApiResult<Item>>;
  createVariant: (itemId: string, key: string, body: Partial<Variant>) => Promise<ApiResult<Variant>>;
  updateVariant: (id: string, rowVersion: number, body: Partial<Variant>) => Promise<ApiResult<Variant>>;
  changeVariantPrice: (id: string, key: string, rowVersion: number, body: { new_price: string; reason: PriceChangeReason }) =>
    Promise<ApiResult<PriceChange>>;
  setItemAvailability: (id: string, rowVersion: number, available: boolean) => Promise<ApiResult<Item>>;
}

const MENU_EVENTS: readonly RealtimeEvent[] = ['menu.availability_changed'];

/** Menu rows known on this device: the GET plus rows it leaves out (deactivated ones changed here). */
function useAdminMenu(api: AdminMenuApi) {
  const { data, refresh } = useLiveData(api.getMenu, MENU_EVENTS);
  const [cats, setCats] = useState<Category[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [variants, setVariants] = useState<Variant[]>([]);
  useEffect(() => {
    if (!data) return;
    const menu = normaliseMenu(data);
    const split = splitMenu(menu.items);
    setCats((k) => mergeRows(k, menu.categories));
    setItems((k) => mergeRows(k, split.items));
    setVariants((k) => mergeRows(k, split.variants));
  }, [data]);
  return { loaded: data !== null, cats, items, variants, setCats, setItems, setVariants, refresh };
}

type Notify = (m: ResultMessage) => void;

function useFailText() {
  const { t, lang } = useI18n();
  return useCallback(
    (res: ApiResult<unknown>) => {
      if (res.ok) return '';
      if (res.status === 0 || res.status >= 500) return t('adminMenu.errors.network');
      return lang === 'hi' ? res.error.message_hi : res.error.message_en;
    },
    [t, lang],
  );
}

/** A bottom sheet with a title, fields, and NO (left) / Save (right). */
function EditSheet({ title, error, saveLabel, pending, canSave = true, onSave, onClose, children }: {
  title: string; error: string | null; saveLabel: string; pending: boolean; canSave?: boolean;
  onSave: () => void; onClose: () => void; children: ReactNode;
}) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="sheet-scrim">
      <form className="sheet admin-sheet" role="dialog" aria-modal="true" aria-labelledby={id}
        onSubmit={(e) => { e.preventDefault(); if (canSave) onSave(); }}>
        <h2 id={id} className="sheet__title">{title}</h2>
        {children}
        {error ? <p className="field-error" role="alert">{error}</p> : null}
        <div className="sheet__actions">
          <button type="button" className="btn" onClick={onClose}>{t('adminMenu.cancel')}</button>
          <PendingButton type="submit" pending={pending} disabled={!canSave}>{saveLabel}</PendingButton>
        </div>
      </form>
    </div>
  );
}

function TextField({ label, value, onChange, maxLength, invalid }: {
  label: string; value: string; onChange: (v: string) => void; maxLength?: number; invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input id={id} className="field__input" value={value} maxLength={maxLength} aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function StatusWord({ active }: { active: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`admin-status admin-status--${active ? 'on' : 'off'}`}>
      <span aria-hidden="true">{active ? '✓' : '✕'}</span> {active ? t('adminMenu.active') : t('adminMenu.inactive')}
    </span>
  );
}

function MoveButtons({ label, onMove, first, last }: { label: string; onMove: (d: -1 | 1) => void; first: boolean; last: boolean }) {
  const { t } = useI18n();
  return (
    <span className="admin-move">
      <button type="button" className="btn admin-icon-btn" disabled={first} aria-label={t('adminMenu.moveUp', { name: label })} onClick={() => onMove(-1)}>{t('adminMenu.up')}</button>
      <button type="button" className="btn admin-icon-btn" disabled={last} aria-label={t('adminMenu.moveDown', { name: label })} onClick={() => onMove(1)}>{t('adminMenu.down')}</button>
    </span>
  );
}

type CatSheet = { row: Category | null; name_en: string; name_hi: string; key: string };
type ItemSheet = { row: Item | null; draft: ItemDraft; key: string };
type VariantSheet = { row: Variant | null; name: string; price: string; key: string };

/**
 * Admin menu (REQ-070..072, REQ-074): categories, then the selected category's items, then the selected
 * item's variants. Tables on desktop, one card per row on a phone (same markup, styles/admin.css). Nothing is
 * ever deleted: rows are deactivated and can be turned back on. Variant prices change only in the price editor.
 */
export function AdminMenuSection({ api, onResult }: { api: AdminMenuApi; onResult: Notify }) {
  const { t, lang } = useI18n();
  const failText = useFailText();
  const m = useAdminMenu(api);
  const [catId, setCatId] = useState<string | null>(null);
  const [itemId, setItemId] = useState<string | null>(null);
  const [catSheet, setCatSheet] = useState<CatSheet | null>(null);
  const [itemSheet, setItemSheet] = useState<ItemSheet | null>(null);
  const [varSheet, setVarSheet] = useState<VariantSheet | null>(null);
  const [priceFor, setPriceFor] = useState<Variant | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const cats = bySort(m.cats);
  const cat = cats.find((c) => c.id === catId) ?? cats[0] ?? null;
  const catItems = cat ? m.items.filter((i) => i.category_id === cat.id) : [];
  const item = catItems.find((i) => i.id === itemId) ?? null;
  const itemVariants = item ? bySort(m.variants.filter((v) => v.item_id === item.id)) : [];
  const name = (r: { name_en: string; name_hi: string }) => (lang === 'hi' && r.name_hi ? r.name_hi : r.name_en);

  /** Runs one write; on success stores the row, closes the sheet and refetches the menu. */
  async function write<T extends { id: string }>(call: Promise<ApiResult<T>>, store: (row: T) => void, done: string, inSheet: boolean) {
    setPending(true);
    const res = await call;
    setPending(false);
    if (res.ok) {
      store(res.data);
      setCatSheet(null); setItemSheet(null); setVarSheet(null); setSheetError(null);
      onResult({ kind: 'success', text: done });
      m.refresh();
      return true;
    }
    if (res.status === 409 && res.current && typeof res.current === 'object') store(res.current as T);
    if (inSheet) setSheetError(failText(res));
    else onResult({ kind: 'error', text: failText(res), nextStep: t('adminMenu.errors.tryAgain') });
    return false;
  }
  const storeCat = (r: Category) => m.setCats((k) => upsert(k, r));
  const storeItem = (r: Item) => m.setItems((k) => upsert(k, r));
  const storeVar = (r: Variant) => m.setVariants((k) => upsert(k, r));

  function saveCategory() {
    if (!catSheet) return;
    const err = categoryError(catSheet.name_en, m.cats, catSheet.row?.id);
    if (err || !catSheet.name_hi.trim()) { setSheetError(t(err ?? 'adminMenu.errors.nameRequired')); return; }
    const body = { name_en: catSheet.name_en.trim(), name_hi: catSheet.name_hi.trim() };
    void write(
      catSheet.row
        ? api.updateCategory(catSheet.row.id, catSheet.row.row_version, body)
        : api.createCategory(catSheet.key, { ...body, sort_order: nextSortOrder(m.cats), is_active: true }),
      storeCat, t('adminMenu.saved'), true,
    );
  }

  function saveItem() {
    if (!itemSheet) return;
    const err = itemError(itemSheet.draft, m.items, itemSheet.row?.id);
    if (err) { setSheetError(t(err)); return; }
    const body = itemBody(itemSheet.draft);
    void write(
      itemSheet.row ? api.updateItem(itemSheet.row.id, itemSheet.row.row_version, body) : api.createItem(itemSheet.key, { ...body, is_active: true }),
      storeItem, t('adminMenu.saved'), true,
    );
  }

  function saveVariant() {
    if (!varSheet || !item) return;
    const err = variantError(varSheet.name, varSheet.row ? null : varSheet.price, itemVariants, varSheet.row?.id);
    if (err) { setSheetError(t(err)); return; }
    void write(
      varSheet.row
        ? api.updateVariant(varSheet.row.id, varSheet.row.row_version, variantUpdateBody({ name: varSheet.name }))
        : api.createVariant(item.id, varSheet.key, {
          name: varSheet.name.trim(), price: parsePrice(varSheet.price) as string, sort_order: nextSortOrder(itemVariants), is_active: true,
        }),
      storeVar, t('adminMenu.saved'), true,
    );
  }

  async function move<T extends { id: string; sort_order: number; row_version: number }>(
    rows: T[], id: string, dir: -1 | 1, patch: (r: T, s: number) => Promise<ApiResult<T>>, store: (r: T) => void,
  ) {
    for (const { row, sort_order } of reorder(rows, id, dir)) {
      if (!(await write(patch(row, sort_order), store, t('adminMenu.reordered'), false))) return;
    }
  }

  const openCat = (row: Category | null) => { setSheetError(null); setCatSheet({ row, name_en: row?.name_en ?? '', name_hi: row?.name_hi ?? '', key: newIdempotencyKey() }); };
  const openItem = (row: Item | null) => {
    if (!cat) return;
    setSheetError(null);
    setItemSheet({ row, draft: row ? itemDraftOf(row) : emptyItemDraft(cat.id), key: newIdempotencyKey() });
  };
  const openVar = (row: Variant | null) => { setSheetError(null); setVarSheet({ row, name: row?.name ?? '', price: '', key: newIdempotencyKey() }); };
  const setDraft = (p: Partial<ItemDraft>) => setItemSheet((s) => (s ? { ...s, draft: { ...s.draft, ...p } } : s));

  return (
    <div className="admin-menu">
      <section className="admin-card" aria-labelledby="adm-cats">
        <div className="admin-card__head">
          <h2 id="adm-cats" className="section-title">{t('adminMenu.categories')}</h2>
          <button type="button" className="btn btn--dark" onClick={() => openCat(null)}>{t('adminMenu.addCategory')}</button>
        </div>
        {m.loaded && cats.length === 0 ? <p className="muted">{t('adminMenu.noCategories')}</p> : null}
        <table className="admin-table">
          <thead>
            <tr><th>{t('adminMenu.name')}</th><th>{t('adminMenu.order')}</th><th>{t('adminMenu.status')}</th><th><span className="visually-hidden">{t('adminMenu.actions')}</span></th></tr>
          </thead>
          <tbody>
            {cats.map((c, i) => (
              <tr key={c.id} className={c.id === cat?.id ? 'admin-row--selected' : undefined}>
                <td data-label={t('adminMenu.name')}>
                  <button type="button" className="admin-link" aria-pressed={c.id === cat?.id} onClick={() => { setCatId(c.id); setItemId(null); }}>
                    <span className="text-item">{c.name_en}</span> <span className="muted">{c.name_hi}</span>
                  </button>
                </td>
                <td data-label={t('adminMenu.order')}>
                  <MoveButtons label={c.name_en} first={i === 0} last={i === cats.length - 1}
                    onMove={(d) => void move(cats, c.id, d, (r, s) => api.updateCategory(r.id, r.row_version, { sort_order: s }), storeCat)} />
                </td>
                <td data-label={t('adminMenu.status')}><StatusWord active={c.is_active} /></td>
                <td className="admin-actions">
                  <button type="button" className="btn" onClick={() => openCat(c)}>{t('adminMenu.edit')}</button>
                  <button type="button" className="btn"
                    onClick={() => void write(api.updateCategory(c.id, c.row_version, { is_active: !c.is_active }), storeCat,
                      t(c.is_active ? 'adminMenu.deactivated' : 'adminMenu.reactivated'), false)}>
                    {c.is_active ? t('adminMenu.deactivate') : t('adminMenu.reactivate')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {cat ? (
        <section className="admin-card" aria-labelledby="adm-items">
          <div className="admin-card__head">
            <h2 id="adm-items" className="section-title">{t('adminMenu.itemsIn', { name: name(cat) })}</h2>
            <button type="button" className="btn btn--dark" onClick={() => openItem(null)}>{t('adminMenu.addItem')}</button>
          </div>
          {catItems.length === 0 ? <p className="muted">{t('adminMenu.noItems')}</p> : null}
          <table className="admin-table">
            <thead>
              <tr>
                <th>{t('adminMenu.name')}</th><th>{t('adminMenu.shortCode')}</th><th>{t('adminMenu.foodType')}</th>
                <th>{t('adminMenu.availableToday')}</th><th>{t('adminMenu.status')}</th><th><span className="visually-hidden">{t('adminMenu.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {catItems.map((it) => (
                <tr key={it.id} className={it.id === item?.id ? 'admin-row--selected' : undefined}>
                  <td data-label={t('adminMenu.name')}>
                    <span className="text-item">{it.name_en}</span> <span className="muted">{it.name_hi}</span>
                    {it.kitchen_station ? <span className="muted admin-sub">{it.kitchen_station}</span> : null}
                  </td>
                  <td data-label={t('adminMenu.shortCode')}>{it.short_code}</td>
                  <td data-label={t('adminMenu.foodType')}>
                    <span className={`diet diet--${it.food_type === 'VEG' ? 'veg' : 'nonveg'}`}>
                      <span className="admin-dot" aria-hidden="true" /> {t(`adminMenu.food.${it.food_type}`)}
                    </span>
                  </td>
                  <td data-label={t('adminMenu.availableToday')}>
                    <button type="button" role="switch" className="btn admin-switch" aria-checked={it.available_today}
                      aria-label={t('adminMenu.availableFor', { name: it.name_en })}
                      onClick={() => void write(api.setItemAvailability(it.id, it.row_version, !it.available_today), storeItem,
                        t(it.available_today ? 'adminMenu.markedOff' : 'adminMenu.markedOn'), false)}>
                      {it.available_today ? t('adminMenu.yes') : t('adminMenu.no')}
                    </button>
                  </td>
                  <td data-label={t('adminMenu.status')}><StatusWord active={it.is_active} /></td>
                  <td className="admin-actions">
                    <button type="button" className="btn" aria-pressed={it.id === item?.id} onClick={() => setItemId(it.id === item?.id ? null : it.id)}>
                      {t('adminMenu.variants')}
                    </button>
                    <button type="button" className="btn" onClick={() => openItem(it)}>{t('adminMenu.edit')}</button>
                    <button type="button" className="btn"
                      onClick={() => void write(api.updateItem(it.id, it.row_version, { is_active: !it.is_active }), storeItem,
                        t(it.is_active ? 'adminMenu.deactivated' : 'adminMenu.reactivated'), false)}>
                      {it.is_active ? t('adminMenu.deactivate') : t('adminMenu.reactivate')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {item ? (
        <section className="admin-card" aria-labelledby="adm-vars">
          <div className="admin-card__head">
            <h2 id="adm-vars" className="section-title">{t('adminMenu.variantsOf', { name: name(item) })}</h2>
            <button type="button" className="btn btn--dark" onClick={() => openVar(null)}>{t('adminMenu.addVariant')}</button>
          </div>
          {itemVariants.length === 0 ? <p className="muted">{t('adminMenu.noVariants')}</p> : null}
          <VariantTable rows={itemVariants} onPrice={setPriceFor} onEdit={openVar}
            onMove={(v, d) => void move(itemVariants, v.id, d, (r, s) => api.updateVariant(r.id, r.row_version, variantUpdateBody({ sort_order: s })), storeVar)}
            onToggle={(v) => void write(api.updateVariant(v.id, v.row_version, variantUpdateBody({ is_active: !v.is_active })), storeVar,
              t(v.is_active ? 'adminMenu.deactivated' : 'adminMenu.reactivated'), false)} />
        </section>
      ) : null}

      {catSheet ? (
        <EditSheet title={t(catSheet.row ? 'adminMenu.editCategory' : 'adminMenu.addCategory')} error={sheetError}
          saveLabel={t('adminMenu.save')} pending={pending} onSave={saveCategory} onClose={() => setCatSheet(null)}>
          <TextField label={t('adminMenu.nameEn')} value={catSheet.name_en} maxLength={40} onChange={(v) => setCatSheet({ ...catSheet, name_en: v })} />
          <TextField label={t('adminMenu.nameHi')} value={catSheet.name_hi} maxLength={40} onChange={(v) => setCatSheet({ ...catSheet, name_hi: v })} />
        </EditSheet>
      ) : null}

      {itemSheet ? (
        <EditSheet title={t(itemSheet.row ? 'adminMenu.editItem' : 'adminMenu.addItem')} error={sheetError}
          saveLabel={t('adminMenu.save')} pending={pending} onSave={saveItem} onClose={() => setItemSheet(null)}>
          <TextField label={t('adminMenu.nameEn')} value={itemSheet.draft.name_en} maxLength={60} onChange={(v) => setDraft({ name_en: v })} />
          <TextField label={t('adminMenu.nameHi')} value={itemSheet.draft.name_hi} maxLength={60} onChange={(v) => setDraft({ name_hi: v })} />
          <TextField label={t('adminMenu.shortCodeHint')} value={itemSheet.draft.short_code} maxLength={8} onChange={(v) => setDraft({ short_code: v })} />
          <div className="choice-row" role="radiogroup" aria-label={t('adminMenu.foodType')}>
            {FOOD_TYPES.map((f) => (
              <button key={f} type="button" role="radio" className="btn" aria-checked={itemSheet.draft.food_type === f}
                aria-pressed={itemSheet.draft.food_type === f} onClick={() => setDraft({ food_type: f })}>
                {t(`adminMenu.food.${f}`)}
              </button>
            ))}
          </div>
          <TextField label={t('adminMenu.photoUrl')} value={itemSheet.draft.photo_url} maxLength={200} onChange={(v) => setDraft({ photo_url: v })} />
          <TextField label={t('adminMenu.station')} value={itemSheet.draft.kitchen_station} maxLength={30} onChange={(v) => setDraft({ kitchen_station: v })} />
        </EditSheet>
      ) : null}

      {varSheet ? (
        <EditSheet title={t(varSheet.row ? 'adminMenu.editVariant' : 'adminMenu.addVariant')} error={sheetError}
          saveLabel={t('adminMenu.save')} pending={pending} onSave={saveVariant} onClose={() => setVarSheet(null)}>
          <TextField label={t('adminMenu.variantName')} value={varSheet.name} maxLength={30} onChange={(v) => setVarSheet({ ...varSheet, name: v })} />
          {varSheet.row ? (
            <p className="muted">{t('adminMenu.priceElsewhere', { price: formatRupees(varSheet.row.price) })}</p>
          ) : (
            <TextField label={t('adminMenu.priceRs')} value={varSheet.price} onChange={(v) => setVarSheet({ ...varSheet, price: v })} />
          )}
        </EditSheet>
      ) : null}

      {priceFor ? (
        <PriceEditor api={api} variant={priceFor} itemName={item ? name(item) : ''} onClose={() => setPriceFor(null)}
          onSaved={(pc) => {
            storeVar({ ...priceFor, price: pc.new_price, row_version: priceFor.row_version + 1 });
            setPriceFor(null);
            onResult({ kind: 'success', text: t('adminPrices.saved') });
            m.refresh();
          }}
          onConflict={(v) => { storeVar(v); setPriceFor(v); }} />
      ) : null}
    </div>
  );
}

function VariantTable({ rows, onPrice, onEdit, onMove, onToggle }: {
  rows: Variant[]; onPrice: (v: Variant) => void; onEdit?: (v: Variant) => void;
  onMove?: (v: Variant, d: -1 | 1) => void; onToggle?: (v: Variant) => void;
}) {
  const { t } = useI18n();
  return (
    <table className="admin-table">
      <thead>
        <tr>
          <th>{t('adminMenu.variantName')}</th><th>{t('adminMenu.price')}</th>
          {onMove ? <th>{t('adminMenu.order')}</th> : null}<th>{t('adminMenu.status')}</th>
          <th><span className="visually-hidden">{t('adminMenu.actions')}</span></th>
        </tr>
      </thead>
      <tbody>
        {rows.map((v, i) => (
          <tr key={v.id}>
            <td data-label={t('adminMenu.variantName')}><span className="text-item">{v.name}</span></td>
            <td data-label={t('adminMenu.price')}><span className="admin-price">{t('adminMenu.rupees', { amount: formatRupees(v.price) })}</span></td>
            {onMove ? (
              <td data-label={t('adminMenu.order')}>
                <MoveButtons label={v.name} first={i === 0} last={i === rows.length - 1} onMove={(d) => onMove(v, d)} />
              </td>
            ) : null}
            <td data-label={t('adminMenu.status')}><StatusWord active={v.is_active} /></td>
            <td className="admin-actions">
              <button type="button" className="btn" onClick={() => onPrice(v)}>{t('adminPrices.change')}</button>
              {onEdit ? <button type="button" className="btn" onClick={() => onEdit(v)}>{t('adminMenu.edit')}</button> : null}
              {onToggle ? (
                <button type="button" className="btn" onClick={() => onToggle(v)}>
                  {v.is_active ? t('adminMenu.deactivate') : t('adminMenu.reactivate')}
                </button>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Price editor (REQ-094): 'Old ₹' and 'New ₹' side by side, and a reason that must be picked before
 * Confirm is enabled. One Idempotency-Key per open sheet, kept on a timeout so a retry cannot write a
 * second history row. The server writes the price and its history row together (REQ-073).
 */
export function PriceEditor({ api, variant, itemName, onClose, onSaved, onConflict }: {
  api: Pick<AdminMenuApi, 'changeVariantPrice'>; variant: Variant; itemName: string;
  onClose: () => void; onSaved: (pc: PriceChange) => void; onConflict: (current: Variant) => void;
}) {
  const { t } = useI18n();
  const failText = useFailText();
  const [newPrice, setNewPrice] = useState('');
  const [reason, setReason] = useState<PriceChangeReason | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [key, setKey] = useState(newIdempotencyKey);
  const reasonId = useId();
  const check = priceChangeError(variant.price, newPrice, reason);
  const priceBad = newPrice.trim() !== '' && check !== null && check !== 'adminPrices.errors.reason';

  async function confirm() {
    if (check || !reason) { setError(t(check ?? 'adminPrices.errors.reason')); return; }
    setPending(true);
    const res = await api.changeVariantPrice(variant.id, key, variant.row_version, priceChangeBody(newPrice, reason));
    setPending(false);
    if (res.ok) { onSaved(res.data); return; }
    if (res.status > 0 && res.status < 500) setKey(newIdempotencyKey());
    if (res.status === 409 && res.current && typeof res.current === 'object') {
      onConflict(res.current as Variant);
      setError(t('adminPrices.errors.changed'));
      return;
    }
    setError(failText(res));
  }

  return (
    <EditSheet title={t('adminPrices.title', { name: [itemName, variant.name].filter(Boolean).join(' · ') })}
      error={error ?? (priceBad ? t(check as string) : null)} saveLabel={t('adminPrices.confirm')} pending={pending}
      canSave={check === null} onSave={() => void confirm()} onClose={onClose}>
      <div className="price-pair">
        <div className="field">
          <span className="field__label" id={`${reasonId}-old`}>{t('adminPrices.old')}</span>
          <output className="field__input price-pair__old" aria-labelledby={`${reasonId}-old`}>{formatRupees(variant.price)}</output>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${reasonId}-new`}>{t('adminPrices.new')}</label>
          <input id={`${reasonId}-new`} className="field__input" inputMode="decimal" autoComplete="off" value={newPrice}
            aria-invalid={priceBad || undefined} onChange={(e) => { setNewPrice(e.target.value); setError(null); }} />
        </div>
      </div>
      <div className="field">
        <span className="field__label" id={reasonId}>{t('adminPrices.reason')}</span>
        <div className="choice-row price-reasons" role="radiogroup" aria-labelledby={reasonId} aria-required="true">
          {PRICE_CHANGE_REASONS.map((r) => (
            <button key={r} type="button" role="radio" className="btn" aria-checked={reason === r} aria-pressed={reason === r}
              onClick={() => { setReason(r); setError(null); }}>
              {t(`adminPrices.reasons.${r}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">{t('adminPrices.newLinesOnly')}</p>
    </EditSheet>
  );
}

/** Prices (REQ-073, REQ-094): every variant by category and item with its current price and Change price. */
export function AdminPricesSection({ api, onResult }: { api: AdminMenuApi; onResult: Notify }) {
  const { t, lang } = useI18n();
  const m = useAdminMenu(api);
  const [edit, setEdit] = useState<{ v: Variant; itemName: string } | null>(null);
  const groups = useMemo(() => bySort(m.cats).flatMap((c) => m.items.filter((i) => i.category_id === c.id)
    .map((i) => ({ item: i, rows: bySort(m.variants.filter((v) => v.item_id === i.id)) }))
    .filter((g) => g.rows.length > 0)), [m.cats, m.items, m.variants]);
  const name = (r: Item) => (lang === 'hi' && r.name_hi ? r.name_hi : r.name_en);
  const store = (v: Variant) => m.setVariants((k) => upsert(k, v));

  return (
    <div className="admin-menu">
      {m.loaded && groups.length === 0 ? <p className="muted">{t('adminMenu.noVariants')}</p> : null}
      {groups.map((g) => (
        <section key={g.item.id} className="admin-card" aria-label={name(g.item)}>
          <h2 className="section-title">{name(g.item)}</h2>
          <VariantTable rows={g.rows} onPrice={(v) => setEdit({ v, itemName: name(g.item) })} />
        </section>
      ))}
      {edit ? (
        <PriceEditor api={api} variant={edit.v} itemName={edit.itemName} onClose={() => setEdit(null)}
          onSaved={(pc) => {
            store({ ...edit.v, price: pc.new_price, row_version: edit.v.row_version + 1 });
            setEdit(null);
            onResult({ kind: 'success', text: t('adminPrices.saved') });
            m.refresh();
          }}
          onConflict={(v) => { store(v); setEdit({ v, itemName: edit.itemName }); }} />
      ) : null}
    </div>
  );
}
