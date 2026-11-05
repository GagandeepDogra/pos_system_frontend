import { useState } from 'react';
import { LANGUAGES, type DashboardTiles, type Language, type RealtimeEvent, type Role, type User } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { TopBar } from '../components/TopBar';
import { AdminPinSheet } from '../components/AdminPinSheet';
import type { ApiResult } from '../api/client';
import { useLiveData } from '../realtime/realtime';

const QUICK_ACTIONS = [
  { screen: 'tables', key: 'dashboard.dineIn', icon: '/icons/dine-in.svg' },
  { screen: 'takeaway', key: 'dashboard.takeaway', icon: '/icons/takeaway.svg' },
  { screen: 'kitchen', key: 'dashboard.kitchen', icon: '/icons/kitchen.svg' },
  { screen: 'bills', key: 'dashboard.payment', icon: '/icons/payment.svg' },
];

/** Primary buttons each role may use (REQ-028); the server still checks every call. */
export const ROLE_ACTIONS: Record<Role, readonly string[]> = {
  ADMIN: ['tables', 'takeaway', 'kitchen', 'bills'],
  CASHIER: ['tables', 'takeaway', 'kitchen', 'bills'],
  KITCHEN: ['kitchen'],
};

/** Any committed write can move a count, so every event refreshes the tiles (REQ-030). */
export const DASHBOARD_EVENTS: readonly RealtimeEvent[] = [
  'dashboard.updated', 'kot.created', 'kot.status_changed', 'order.updated', 'table.status_changed', 'payment.recorded',
];

interface Tile {
  id: string;
  value: string;
  label: string;
  onOpen: () => void;
}

interface Props {
  user: User;
  getDashboard: () => Promise<ApiResult<DashboardTiles>>;
  /** Opens the list behind the Active tables tile (occupied tables only, REQ-029). */
  onOpenActiveTables: () => void;
  onOpen: (screen: string) => void;
  onSwitchUser: () => void;
  onLanguage: (lang: Language) => void;
  createApproval: (key: string, body: { pin: string }) => Promise<ApiResult<{ approval_token: string; admin_id: string }>>;
  /** Opens the admin area after the Admin PIN was accepted (REQ-031). */
  onAdminApproved: (token: string, adminId: string) => void;
}

/**
 * Dashboard shell (Home · Phone): greeting, the four role buttons with the
 * 'hi / en' label pair, the ADMIN button for Admins and the switch-user bar.
 * The "Right now" tiles are live: they refetch GET /dashboard on every
 * realtime event and after a reconnect (REQ-029, REQ-030).
 */
export function DashboardScreen({ user, getDashboard, onOpenActiveTables, onOpen, onSwitchUser, onLanguage, createApproval, onAdminApproved }: Props) {
  const { t, pair, lang } = useI18n();
  const [adminPad, setAdminPad] = useState(false);
  const { data } = useLiveData(getDashboard, DASHBOARD_EVENTS);
  const today = new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const allowed = ROLE_ACTIONS[user.role] ?? [];
  const actions = QUICK_ACTIONS.filter((a) => allowed.includes(a.screen));
  const kitchenRole = user.role === 'KITCHEN';

  const tiles: Tile[] = [];
  if (data) {
    // Today's sales is Admin only, even if a server ever sent it to someone else (REQ-020).
    if (user.role === 'ADMIN' && data.todays_sales != null) {
      tiles.push({ id: 'sales', value: t('money.rupees', { amount: data.todays_sales }), label: t('tiles.todaysSales'), onOpen: () => setAdminPad(true) });
    }
    if (!kitchenRole) {
      tiles.push({ id: 'active-tables', value: String(data.active_tables ?? 0), label: t('tiles.activeTables'), onOpen: onOpenActiveTables });
    }
    tiles.push({ id: 'pending-kots', value: String(data.pending_kots ?? 0), label: t('tiles.pendingKots'), onOpen: () => onOpen('kitchen') });
    tiles.push({ id: 'ready-orders', value: String(data.ready_orders ?? 0), label: t('tiles.readyOrders'), onOpen: () => onOpen('kitchen') });
    if (!kitchenRole && data.open_takeaways != null) {
      tiles.push({ id: 'open-takeaways', value: String(data.open_takeaways), label: t('tiles.openTakeaways'), onOpen: () => onOpen('takeaway') });
    }
  }

  return (
    <div className="shell dashboard">
      <TopBar userName={user.display_name} onSwitchUser={onSwitchUser} />
      <main className="workspace">
        <h1 className="heading">{t('dashboard.hello', { name: user.display_name })}</h1>
        <p className="muted">{t('dashboard.roleDate', { role: t(`roles.${user.role}`), date: today })}</p>
        <div className="quick-actions" data-testid="quick-actions">
          {actions.map((a) => (
            <button key={a.screen} type="button" className="quick-action" data-action={a.screen} onClick={() => onOpen(a.screen)}>
              <img src={a.icon} alt="" width={32} height={32} />
              <span className="quick-action__label">{pair(a.key)}</span>
            </button>
          ))}
        </div>
        <h2 className="section-title">{t('tiles.rightNow')}</h2>
        <div className="live-tiles" data-testid="live-tiles" aria-live="polite">
          {tiles.map((tile) => (
            <button key={tile.id} type="button" className="live-tile" data-tile={tile.id} onClick={tile.onOpen}>
              <span className="live-tile__value">{tile.value}</span>
              <span className="live-tile__label">{tile.label}</span>
            </button>
          ))}
        </div>
        {user.role === 'ADMIN' ? (
          <button type="button" className="btn btn--block admin-entry" onClick={() => setAdminPad(true)}>
            {pair('dashboard.admin')}
          </button>
        ) : null}
        <div className="lang-switch" role="group" aria-label={t('language.label')}>
          {LANGUAGES.map((l) => (
            <button key={l} type="button" className="btn" aria-pressed={lang === l} onClick={() => onLanguage(l)}>
              {t(`language.${l}`)}
            </button>
          ))}
        </div>
      </main>
      <div className="bottom-actions">
        <button type="button" className="btn btn--block" onClick={onSwitchUser}>
          {t('session.switchUserBar', { name: user.display_name })}
        </button>
      </div>
      {adminPad ? (
        <AdminPinSheet
          title={t('pin.adminTitle')}
          createApproval={createApproval}
          onCancel={() => setAdminPad(false)}
          onApproved={(token, adminId) => {
            setAdminPad(false);
            onAdminApproved(token, adminId);
          }}
        />
      ) : null}
    </div>
  );
}
