import { useEffect, useId, useState } from 'react';
import { ROLES, type DiningTable, type RealtimeEvent, type Role, type Setting, type TableView, type User } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { newIdempotencyKey, type ApiResult } from '../api/client';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { PendingButton } from '../components/PendingButton';
import type { ResultMessage } from '../components/ResultBar';
import { useLiveData } from '../realtime/realtime';
import { mergeRows, upsert } from '../admin/menuAdminModel';
import {
  UNLOCK_BODY, emptyStaffDraft, emptyTableDraft, isLastActiveAdmin, isLocked, lockMinutesLeft, pinError, settingsBody,
  settingsDraftOf, settingsErrors, staffBody, staffError, tableBody, tableDraftOf, tableError, tableHasOpenOrder,
  type SettingsDraft, type StaffDraft, type TableDraft,
} from '../admin/setupAdminModel';
import { EditSheet, TextField, useFailText } from './AdminMenuScreen';
import '../styles/admin.css';

/** The pos-api operations the admin tables, staff and settings screens use (REQ-075, REQ-076, REQ-080, REQ-025). */
export interface AdminSetupApi {
  listTables: () => Promise<ApiResult<TableView[]>>;
  createTable: (key: string, body: Partial<DiningTable>) => Promise<ApiResult<DiningTable>>;
  updateTable: (id: string, rowVersion: number, body: Partial<DiningTable>) => Promise<ApiResult<DiningTable>>;
  listLoginStaff: () => Promise<ApiResult<User[]>>;
  createUser: (key: string, body: Partial<User> & { pin: string }) => Promise<ApiResult<User>>;
  updateUser: (id: string, rowVersion: number, body: Partial<User>) => Promise<ApiResult<User>>;
  resetUserPin: (id: string, rowVersion: number, pin: string) => Promise<ApiResult<User>>;
  getSettings: () => Promise<ApiResult<Setting>>;
  updateSettings: (rowVersion: number, body: Partial<Setting>) => Promise<ApiResult<Setting>>;
}

type Notify = (m: ResultMessage) => void;

/** Icon + word, never colour alone (REQ-086). */
function ActiveWord({ active }: { active: boolean }) {
  const { t } = useI18n();
  return (
    <span className={`admin-status admin-status--${active ? 'on' : 'off'}`}>
      <span aria-hidden="true">{active ? '✓' : '✕'}</span> {t(active ? 'adminSetup.active' : 'adminSetup.inactive')}
    </span>
  );
}
const TABLE_EVENTS: readonly RealtimeEvent[] = ['table.status_changed'];
const NO_EVENTS: readonly RealtimeEvent[] = [];

/** Shared write runner: success → store + green bar; 409 stores `current`; errors go to the sheet or the bar. */
function useWriter(onResult: Notify) {
  const { t } = useI18n();
  const failText = useFailText();
  const [pending, setPending] = useState(false);
  const [sheetError, setSheetError] = useState<string | null>(null);
  async function write<T>(call: Promise<ApiResult<T>>, store: (row: T) => void, done: string, inSheet: boolean): Promise<boolean> {
    setPending(true);
    const res = await call;
    setPending(false);
    if (res.ok) {
      store(res.data);
      setSheetError(null);
      onResult({ kind: 'success', text: done });
      return true;
    }
    if (res.status === 409 && res.current && typeof res.current === 'object') store(res.current as T);
    if (inSheet) setSheetError(failText(res));
    else onResult({ kind: 'error', text: failText(res), nextStep: t('adminMenu.errors.tryAgain') });
    return false;
  }
  return { pending, sheetError, setSheetError, write };
}

// ------------------------------------------------------------------ tables

type TableSheet = { row: DiningTable | null; draft: TableDraft; key: string };

/**
 * Tables (REQ-075): add, rename, set area and seats, deactivate / reactivate. Past orders keep their own
 * table_label_snapshot, so a rename never changes them. A table with an open order cannot be deactivated
 * (the button is off here and the server answers 409 as well).
 */
export function AdminTablesSection({ api, onResult }: { api: AdminSetupApi; onResult: Notify }) {
  const { t } = useI18n();
  const { data, refresh } = useLiveData(api.listTables, TABLE_EVENTS);
  const [rows, setRows] = useState<TableView[]>([]);
  const [sheet, setSheet] = useState<TableSheet | null>(null);
  const [confirm, setConfirm] = useState<TableView | null>(null);
  const w = useWriter(onResult);
  useEffect(() => { if (data) setRows((k) => mergeRows(k, data)); }, [data]);
  const store = (r: DiningTable) => setRows((k) => upsert(k, { ...k.find((x) => x.id === r.id), ...r } as TableView));
  const sorted = [...rows].sort((a, b) => a.table_number.localeCompare(b.table_number, undefined, { numeric: true }));

  function open(row: DiningTable | null) {
    w.setSheetError(null);
    setSheet({ row, draft: row ? tableDraftOf(row) : emptyTableDraft(), key: newIdempotencyKey() });
  }
  function save() {
    if (!sheet) return;
    const err = tableError(sheet.draft, rows, sheet.row?.id);
    if (err) { w.setSheetError(t(err)); return; }
    const body = tableBody(sheet.draft);
    void w.write(
      sheet.row ? api.updateTable(sheet.row.id, sheet.row.row_version, body) : api.createTable(sheet.key, { ...body, is_active: true }),
      store, t('adminSetup.saved'), true,
    ).then((ok) => {
      if (ok) { setSheet(null); refresh(); }
      else if (!sheet.row) setSheet((s) => (s ? { ...s, key: newIdempotencyKey() } : s));
    });
  }
  function setActive(row: TableView, active: boolean) {
    setConfirm(null);
    void w.write(api.updateTable(row.id, row.row_version, { is_active: active }), store,
      t(active ? 'adminSetup.tableOn' : 'adminSetup.tableOff'), false).then((ok) => { if (ok) refresh(); });
  }
  const set = (patch: Partial<TableDraft>) => setSheet((s) => (s ? { ...s, draft: { ...s.draft, ...patch } } : s));

  return (
    <section className="admin-card" aria-labelledby="adm-tables">
      <div className="admin-card__head">
        <h2 id="adm-tables" className="section-title">{t('adminSetup.tables')}</h2>
        <button type="button" className="btn btn--dark" onClick={() => open(null)}>{t('adminSetup.addTable')}</button>
      </div>
      <p className="muted">{t('adminSetup.renameHelp')}</p>
      {data && rows.length === 0 ? <p className="muted">{t('adminSetup.noTables')}</p> : null}
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('adminSetup.tableNumber')}</th><th>{t('adminSetup.area')}</th><th>{t('adminSetup.seats')}</th>
            <th>{t('adminMenu.status')}</th><th><span className="visually-hidden">{t('adminMenu.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const busy = tableHasOpenOrder(r);
            return (
              <tr key={r.id}>
                <td data-label={t('adminSetup.tableNumber')}><span className="text-item">{r.table_number}</span></td>
                <td data-label={t('adminSetup.area')}>{r.area || <span className="muted">{t('adminSetup.noArea')}</span>}</td>
                <td data-label={t('adminSetup.seats')}>{r.seats ?? <span className="muted">{t('adminSetup.notSet')}</span>}</td>
                <td data-label={t('adminMenu.status')}>
                  <ActiveWord active={r.is_active} />
                  {r.is_active && busy ? <span className="muted admin-sub">{t('adminSetup.hasOpenOrder')}</span> : null}
                </td>
                <td className="admin-actions">
                  <button type="button" className="btn" aria-label={t('adminSetup.editTableFor', { name: r.table_number })} onClick={() => open(r)}>
                    {t('adminMenu.edit')}
                  </button>
                  {r.is_active ? (
                    <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(r)}
                      aria-label={t('adminSetup.deactivateFor', { name: r.table_number })}>{t('adminSetup.deactivate')}</button>
                  ) : (
                    <button type="button" className="btn" onClick={() => setActive(r, true)}
                      aria-label={t('adminSetup.reactivateFor', { name: r.table_number })}>{t('adminSetup.reactivate')}</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {sheet ? (
        <EditSheet title={t(sheet.row ? 'adminSetup.editTable' : 'adminSetup.addTable')} error={w.sheetError}
          saveLabel={t('adminMenu.save')} pending={w.pending} onSave={save} onClose={() => setSheet(null)}>
          <TextField label={t('adminSetup.tableNumber')} value={sheet.draft.table_number} maxLength={10}
            onChange={(v) => set({ table_number: v })} />
          <TextField label={t('adminSetup.areaOptional')} value={sheet.draft.area} maxLength={30} onChange={(v) => set({ area: v })} />
          <TextField label={t('adminSetup.seatsOptional')} value={sheet.draft.seats} maxLength={2}
            onChange={(v) => set({ seats: v.replace(/\D/g, '') })} />
        </EditSheet>
      ) : null}
      <ConfirmSheet open={confirm !== null} title={t('adminSetup.confirmTableOff', { name: confirm?.table_number ?? '' })}
        yesLabel={t('adminSetup.deactivate')} noLabel={t('adminMenu.cancel')}
        onYes={() => { if (confirm) setActive(confirm, false); }} onNo={() => setConfirm(null)}>
        <p>{t('adminSetup.confirmTableOffHelp')}</p>
      </ConfirmSheet>
    </section>
  );
}

// ------------------------------------------------------------------ staff

function PinField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>{label}</label>
      <input id={id} className="field__input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8}
        value={value} onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))} />
    </div>
  );
}

function RoleChoice({ value, onChange, disabled }: { value: Role; onChange: (r: Role) => void; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <fieldset className="admin-fieldset">
      <legend className="field__label">{t('adminSetup.role')}</legend>
      <div className="choice-row" role="group">
        {ROLES.map((r) => (
          <button key={r} type="button" className="btn" aria-pressed={value === r} disabled={disabled && value !== r} onClick={() => onChange(r)}>
            {t(`roles.${r}`)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type StaffSheet =
  | { kind: 'add'; draft: StaffDraft; key: string }
  | { kind: 'role'; row: User; role: Role }
  | { kind: 'pin'; row: User; pin: string };

/**
 * Staff (REQ-076, REQ-025): add with role and PIN, change role, reset PIN, unlock after 5 wrong PINs,
 * deactivate (the server revokes the user's tokens) and reactivate. GET /auth/staff lists active staff only;
 * rows changed on this device stay listed so a deactivated person can be turned back on.
 */
export function AdminStaffSection({ api, onResult, now = Date.now }: { api: AdminSetupApi; onResult: Notify; now?: () => number }) {
  const { t } = useI18n();
  const { data, refresh } = useLiveData(api.listLoginStaff, NO_EVENTS);
  const [rows, setRows] = useState<User[]>([]);
  const [sheet, setSheet] = useState<StaffSheet | null>(null);
  const [confirm, setConfirm] = useState<User | null>(null);
  const w = useWriter(onResult);
  useEffect(() => { if (data) setRows((k) => mergeRows(k, data)); }, [data]);
  const store = (r: User) => setRows((k) => upsert(k, r));
  const at = now();

  function done(ok: boolean) { if (ok) { setSheet(null); refresh(); } }

  function save() {
    if (!sheet) return;
    if (sheet.kind === 'add') {
      const err = staffError(sheet.draft, rows);
      if (err) { w.setSheetError(t(err)); return; }
      void w.write(api.createUser(sheet.key, { ...staffBody(sheet.draft), language: 'hi', is_active: true }), store, t('adminSetup.staffAdded'), true)
        .then((ok) => { done(ok); if (!ok) setSheet((s) => (s && s.kind === 'add' ? { ...s, key: newIdempotencyKey() } : s)); });
    } else if (sheet.kind === 'role') {
      void w.write(api.updateUser(sheet.row.id, sheet.row.row_version, { role: sheet.role }), store, t('adminSetup.saved'), true).then(done);
    } else {
      const err = pinError(sheet.pin);
      if (err) { w.setSheetError(t(err)); return; }
      void w.write(api.resetUserPin(sheet.row.id, sheet.row.row_version, sheet.pin), store,
        t('adminSetup.pinReset', { name: sheet.row.display_name }), true).then(done);
    }
  }
  function patch(row: User, body: Partial<User>, msg: string) {
    setConfirm(null);
    void w.write(api.updateUser(row.id, row.row_version, body), store, msg, false).then((ok) => { if (ok) refresh(); });
  }
  function openSheet(s: StaffSheet) { w.setSheetError(null); setSheet(s); }

  let sheetView = null;
  if (sheet?.kind === 'add') {
    const d = sheet.draft;
    const set = (p: Partial<StaffDraft>) => setSheet({ ...sheet, draft: { ...d, ...p } });
    sheetView = (
      <EditSheet title={t('adminSetup.addStaff')} error={w.sheetError} saveLabel={t('adminMenu.save')} pending={w.pending}
        onSave={save} onClose={() => setSheet(null)}>
        <TextField label={t('adminSetup.staffName')} value={d.display_name} maxLength={40} onChange={(v) => set({ display_name: v })} />
        <RoleChoice value={d.role} onChange={(r) => set({ role: r })} />
        <PinField label={t('adminSetup.pin')} value={d.pin} onChange={(v) => set({ pin: v })} />
        <p className="muted">{t('adminSetup.pinHelp')}</p>
      </EditSheet>
    );
  } else if (sheet?.kind === 'role') {
    sheetView = (
      <EditSheet title={t('adminSetup.changeRoleFor', { name: sheet.row.display_name })} error={w.sheetError}
        saveLabel={t('adminMenu.save')} pending={w.pending} canSave={sheet.role !== sheet.row.role} onSave={save} onClose={() => setSheet(null)}>
        <RoleChoice value={sheet.role} onChange={(r) => setSheet({ ...sheet, role: r })} />
      </EditSheet>
    );
  } else if (sheet?.kind === 'pin') {
    sheetView = (
      <EditSheet title={t('adminSetup.resetPinFor', { name: sheet.row.display_name })} error={w.sheetError}
        saveLabel={t('adminSetup.resetPin')} pending={w.pending} onSave={save} onClose={() => setSheet(null)}>
        <PinField label={t('adminSetup.newPin')} value={sheet.pin} onChange={(v) => setSheet({ ...sheet, pin: v })} />
        <p className="muted">{t('adminSetup.pinResetHelp')}</p>
      </EditSheet>
    );
  }

  return (
    <section className="admin-card" aria-labelledby="adm-staff">
      <div className="admin-card__head">
        <h2 id="adm-staff" className="section-title">{t('adminSetup.staff')}</h2>
        <button type="button" className="btn btn--dark" onClick={() => openSheet({ kind: 'add', draft: emptyStaffDraft(), key: newIdempotencyKey() })}>
          {t('adminSetup.addStaff')}
        </button>
      </div>
      {data && rows.length === 0 ? <p className="muted">{t('adminSetup.noStaff')}</p> : null}
      <table className="admin-table">
        <thead>
          <tr>
            <th>{t('adminSetup.staffName')}</th><th>{t('adminSetup.role')}</th><th>{t('adminMenu.status')}</th>
            <th><span className="visually-hidden">{t('adminMenu.actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const locked = isLocked(u, at);
            const lastAdmin = isLastActiveAdmin(u, rows);
            return (
              <tr key={u.id}>
                <td data-label={t('adminSetup.staffName')}><span className="text-item">{u.display_name}</span></td>
                <td data-label={t('adminSetup.role')}>{t(`roles.${u.role}`)}</td>
                <td data-label={t('adminMenu.status')}>
                  <ActiveWord active={u.is_active} />
                  {locked ? (
                    <span className="admin-status admin-status--locked admin-sub">
                      <span aria-hidden="true">✕</span> {t('adminSetup.locked', { minutes: lockMinutesLeft(u, at) })}
                    </span>
                  ) : null}
                </td>
                <td className="admin-actions">
                  {locked ? (
                    <button type="button" className="btn btn--dark" aria-label={t('adminSetup.unlockFor', { name: u.display_name })}
                      onClick={() => patch(u, UNLOCK_BODY, t('adminSetup.unlocked', { name: u.display_name }))}>{t('adminSetup.unlock')}</button>
                  ) : null}
                  {u.is_active ? (
                    <>
                      <button type="button" className="btn" disabled={lastAdmin} aria-label={t('adminSetup.changeRoleFor', { name: u.display_name })}
                        onClick={() => openSheet({ kind: 'role', row: u, role: u.role })}>{t('adminSetup.changeRole')}</button>
                      <button type="button" className="btn" aria-label={t('adminSetup.resetPinFor', { name: u.display_name })}
                        onClick={() => openSheet({ kind: 'pin', row: u, pin: '' })}>{t('adminSetup.resetPin')}</button>
                      <button type="button" className="btn" disabled={lastAdmin} aria-label={t('adminSetup.deactivateFor', { name: u.display_name })}
                        onClick={() => setConfirm(u)}>{t('adminSetup.deactivate')}</button>
                    </>
                  ) : (
                    <button type="button" className="btn" aria-label={t('adminSetup.reactivateFor', { name: u.display_name })}
                      onClick={() => patch(u, { is_active: true }, t('adminSetup.staffOn', { name: u.display_name }))}>{t('adminSetup.reactivate')}</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sheetView}
      <ConfirmSheet open={confirm !== null} title={t('adminSetup.confirmStaffOff', { name: confirm?.display_name ?? '' })}
        yesLabel={t('adminSetup.deactivate')} noLabel={t('adminMenu.cancel')}
        onYes={() => { if (confirm) patch(confirm, { is_active: false }, t('adminSetup.staffOff', { name: confirm.display_name })); }}
        onNo={() => setConfirm(null)}>
        <p>{t('adminSetup.confirmStaffOffHelp')}</p>
      </ConfirmSheet>
    </section>
  );
}

// ------------------------------------------------------------------ settings

const SETTING_FIELDS: { key: keyof SettingsDraft; max: number; wide?: boolean; numeric?: boolean }[] = [
  { key: 'dhaba_name', max: 80 },
  { key: 'phone', max: 15 },
  { key: 'address', max: 200, wide: true },
  { key: 'gst_number', max: 15 },
  { key: 'gst_rate_percent', max: 5, numeric: true },
  { key: 'token_reset_time', max: 5 },
  { key: 'late_kot_minutes', max: 3, numeric: true },
  { key: 'receipt_footer', max: 200, wide: true },
];

/**
 * Settings (REQ-080): dhaba name, address, phone, GST number and rate (both optional: empty = not registered /
 * tax off), receipt footer (printed on the next receipt, which reads GET /settings), token reset time and
 * late-KOT minutes. One Save; a 409 loads the current values and asks to save again.
 */
export function AdminSettingsSection({ api, onResult }: { api: AdminSetupApi; onResult: Notify }) {
  const { t } = useI18n();
  const failText = useFailText();
  const [row, setRow] = useState<Setting | null>(null);
  const [draft, setDraft] = useState<SettingsDraft | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof SettingsDraft, string>>>({});
  const [pending, setPending] = useState(false);
  const formId = useId();

  useEffect(() => {
    let live = true;
    void api.getSettings().then((r) => {
      if (!live) return;
      if (r.ok) { setRow(r.data); setDraft(settingsDraftOf(r.data)); }
      else onResult({ kind: 'error', text: failText(r), nextStep: t('adminMenu.errors.tryAgain') });
    });
    return () => { live = false; };
  }, [api]); // load once per api; onResult/t changes must not refetch

  async function save() {
    if (!row || !draft) return;
    const e = settingsErrors(draft);
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    setPending(true);
    const res = await api.updateSettings(row.row_version, settingsBody(row, draft));
    setPending(false);
    if (res.ok) {
      setRow(res.data); setDraft(settingsDraftOf(res.data));
      onResult({ kind: 'success', text: t('adminSetup.settingsSaved') });
      return;
    }
    if (res.status === 409 && res.current && typeof res.current === 'object') {
      const cur = res.current as Setting;
      setRow(cur); setDraft(settingsDraftOf(cur));
      onResult({ kind: 'error', text: t('adminSetup.settingsChanged'), nextStep: t('adminSetup.settingsCheckAgain') });
      return;
    }
    onResult({ kind: 'error', text: failText(res), nextStep: t('adminMenu.errors.tryAgain') });
  }

  if (!draft) return <p className="muted">{t('status.working')}</p>;
  return (
    <section className="admin-card" aria-labelledby="adm-settings">
      <h2 id="adm-settings" className="section-title">{t('adminSetup.settings')}</h2>
      <form id={formId} className="admin-settings" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {SETTING_FIELDS.map((f) => {
          const id = `${formId}-${f.key}`;
          const err = errors[f.key];
          return (
            <div key={f.key} className={`field${f.wide ? ' admin-settings__wide' : ''}`}>
              <label className="field__label" htmlFor={id}>{t(`adminSetup.fields.${f.key}`)}</label>
              {f.wide ? (
                <textarea id={id} className="field__input admin-textarea" rows={2} maxLength={f.max} value={draft[f.key]}
                  aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : `${id}-help`}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              ) : (
                <input id={id} className="field__input" maxLength={f.max} value={draft[f.key]} inputMode={f.numeric ? 'decimal' : undefined}
                  aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-err` : `${id}-help`}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })} />
              )}
              {err ? <p id={`${id}-err`} className="field-error">{t(err)}</p>
                : <p id={`${id}-help`} className="muted admin-help">{t(`adminSetup.help.${f.key}`)}</p>}
            </div>
          );
        })}
        <div className="admin-settings__save">
          <PendingButton type="submit" variant="secondary" className="btn--dark" pending={pending}>{t('adminSetup.saveSettings')}</PendingButton>
        </div>
      </form>
    </section>
  );
}
