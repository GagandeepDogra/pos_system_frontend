import { ROLES, type Role } from '@dhaba/shared';
import { useI18n } from '../i18n/I18nProvider';
import { ScreenFrame } from '../components/ScreenFrame';
import { TopBar } from '../components/TopBar';

interface Props {
  userName: string;
  deviceLock: Role | null;
  onDeviceLock: (role: Role | null) => void;
  onHome: () => void;
  onSwitchUser: () => void;
}

const LOCK_CHOICES: (Role | null)[] = [null, ...ROLES.filter((r) => r !== 'ADMIN')];

/**
 * Entry of the separate admin area, opened only after the Admin PIN (REQ-031).
 * Holds the one-time device role lock (REQ-022); the admin menu, tables, staff
 * and report screens are added by the admin work.
 */
export function AdminAreaScreen({ userName, deviceLock, onDeviceLock, onHome, onSwitchUser }: Props) {
  const { t } = useI18n();
  return (
    <ScreenFrame title={t('admin.title')} status={<TopBar userName={userName} onSwitchUser={onSwitchUser} />} onBack={onHome} onHome={onHome}>
      <section className="admin-lock" aria-labelledby="device-lock-title">
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
    </ScreenFrame>
  );
}
