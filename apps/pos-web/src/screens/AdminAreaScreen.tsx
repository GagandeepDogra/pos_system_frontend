import { useCallback, useState } from 'react';
import { ROLES, type Role } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';
import { ResultBar, type ResultMessage } from '../components/ResultBar';
import { AdminMenuSection, AdminPricesSection, type AdminMenuApi } from './AdminMenuScreen';
import { AdminSettingsSection, AdminStaffSection, AdminTablesSection, type AdminSetupApi } from './AdminSetupScreen';
import { AdminBackupSection, AdminDayCloseSection, AdminHistorySection, AdminReportsSection, type AdminReportsApi } from './AdminReportsScreen';
import { addSnapshot } from '../admin/reportsAdminModel';
import '../styles/admin.css';
import '../styles/takeaway.css';

interface Props {
  api: AdminMenuApi & AdminSetupApi & AdminReportsApi;
  userName: string;
  deviceLock: Role | null;
  onDeviceLock: (role: Role | null) => void;
  onHome: () => void;
  onSwitchUser: () => void;
  /** Day close: collect an unsettled bill on the payment screen. */
  onCollect?: (orderId: string) => void;
  /** Section shown first (default 'menu'). */
  initialSection?: AdminSection;
}

const LOCK_CHOICES: (Role | null)[] = [null, ...ROLES.filter((r) => r !== 'ADMIN')];

/**
 * Sections of the admin area, in the order of the 'Manage restaurant' navigation (Figma 3:30).
 * Later admin work adds its sections (tables, staff, reports, ...) to this list and to `renderSection`.
 */
export const ADMIN_SECTIONS = ['reports', 'menu', 'prices', 'tables', 'staff', 'history', 'dayClose', 'backup', 'settings', 'device'] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

/**
 * The separate admin area, opened only after the Admin PIN (REQ-031): the 'Manage restaurant'
 * navigation (a side column on desktop, a row of tabs on a phone) and the chosen section.
 */
export function AdminAreaScreen({ api, userName, deviceLock, onDeviceLock, onHome, onSwitchUser, onCollect, initialSection = 'menu' }: Props) {
  const { t } = useI18n();
  const [section, setSection] = useState<AdminSection>(initialSection);
  const [result, setResult] = useState<ResultMessage | null>(null);
  const dismiss = useCallback(() => setResult(null), []);
  // Snapshots known on this device: from GET /admin/day-close and each completed day close (REQ-096).
  const [snapshots, setSnapshots] = useState<string[]>([]);
  const onSnapshot = useCallback((name: string | null, all?: string[]) => {
    setSnapshots((prev) => addSnapshot(all ? [...all, ...prev.filter((s) => !all.includes(s))] : prev, name));
  }, []);

  function renderSection() {
    if (section === 'reports') return <AdminReportsSection api={api} onResult={setResult} />;
    if (section === 'history') return <AdminHistorySection api={api} onResult={setResult} />;
    if (section === 'dayClose') return <AdminDayCloseSection api={api} onResult={setResult} onCollect={onCollect} onSnapshot={onSnapshot} />;
    if (section === 'backup') return <AdminBackupSection api={api} onResult={setResult} snapshots={snapshots} />;
    if (section === 'menu') return <AdminMenuSection api={api} onResult={setResult} />;
    if (section === 'prices') return <AdminPricesSection api={api} onResult={setResult} />;
    if (section === 'tables') return <AdminTablesSection api={api} onResult={setResult} />;
    if (section === 'staff') return <AdminStaffSection api={api} onResult={setResult} />;
    if (section === 'settings') return <AdminSettingsSection api={api} onResult={setResult} />;
    return (
      <section className="admin-lock admin-card" aria-labelledby="device-lock-title">
        <h2 id="device-lock-title" className="section-title">{t('deviceLock.title')}</h2>
        <p className="muted">{t('deviceLock.help')}</p>
        <div className="choice-row" role="group" aria-label={t('deviceLock.title')}>
          {LOCK_CHOICES.map((r) => (
            <button key={r ?? 'none'} type="button" className="btn" aria-pressed={deviceLock === r} onClick={() => onDeviceLock(r)}>
              {r ? t(`roles.${r}`) : t('deviceLock.none')}
            </button>
          ))}
        </div>
      </section>
    );
  }

  return (
    <ScreenFrame title={t('admin.title')} className="admin-area" status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />} onBack={onHome} onHome={onHome}>
      <ResultBar message={result} onDismiss={dismiss} />
      <div className="admin-layout">
        <nav className="admin-nav" aria-labelledby="admin-nav-title">
          <h2 id="admin-nav-title" className="admin-nav__title">{t('admin.manage')}</h2>
          {ADMIN_SECTIONS.map((s) => (
            <button key={s} type="button" className={`btn admin-nav__item${section === s ? ' admin-nav__item--on' : ''}`}
              aria-current={section === s ? 'page' : undefined} onClick={() => { setSection(s); setResult(null); }}>
              {t(`admin.sections.${s}`)}
            </button>
          ))}
          <button type="button" className="btn admin-nav__item admin-nav__back" onClick={onHome}>{t('admin.backToPos')}</button>
        </nav>
        <div className="admin-main">
          <h2 className="admin-main__title">{t(`admin.sections.${section}`)}</h2>
          {renderSection()}
        </div>
      </div>
    </ScreenFrame>
  );
}
