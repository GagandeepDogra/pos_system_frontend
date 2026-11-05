import { useState } from 'react';
import { LANGUAGES, type Language, type User } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { TopBar } from '../components/TopBar';
import { AdminPinSheet } from '../components/AdminPinSheet';
import type { ApiResult } from '../api/client';

const QUICK_ACTIONS = [
  { screen: 'tables', key: 'dashboard.dineIn', icon: '/icons/dine-in.svg' },
  { screen: 'takeaway', key: 'dashboard.takeaway', icon: '/icons/takeaway.svg' },
  { screen: 'kitchen', key: 'dashboard.kitchen', icon: '/icons/kitchen.svg' },
  { screen: 'bills', key: 'dashboard.payment', icon: '/icons/payment.svg' },
];

interface Props {
  user: User;
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
 * The live counts under "Right now" are added by the dashboard work.
 */
export function DashboardScreen({ user, onOpen, onSwitchUser, onLanguage, createApproval, onAdminApproved }: Props) {
  const { t, pair, lang } = useI18n();
  const [adminPad, setAdminPad] = useState(false);
  const today = new Date().toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="shell">
      <TopBar userName={user.display_name} onSwitchUser={onSwitchUser} />
      <main className="workspace">
        <h1 className="heading">{t('dashboard.hello', { name: user.display_name })}</h1>
        <p className="muted">{t('dashboard.roleDate', { role: t(`roles.${user.role}`), date: today })}</p>
        <div className="quick-actions">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.screen} type="button" className="quick-action" onClick={() => onOpen(a.screen)}>
              <img src={a.icon} alt="" width={32} height={32} />
              <span className="quick-action__label">{pair(a.key)}</span>
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
