import { useEffect, useState } from 'react';
import { useI18n } from '../i18n/I18nProvider';
import { ConnectionLine } from '../offline/connection';

function clock(now: Date): string {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

interface Props {
  /** Signed-in user's name; tapping it switches user (REQ-027). */
  userName?: string;
  onSwitchUser?: () => void;
}

/** App top bar: name, signed-in user (switch), clock and the connection line / offline banner. */
export function TopBar({ userName, onSwitchUser }: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="top-bar">
      <div className="top-bar__row">
        <span className="top-bar__name">{t('app.name')}</span>
        {userName && onSwitchUser ? (
          <button type="button" className="btn top-bar__user" onClick={onSwitchUser} aria-label={t('session.switchUserNamed', { name: userName })}>
            {userName}
          </button>
        ) : null}
        <span className="top-bar__time">{clock(now)}</span>
      </div>
      <ConnectionLine />
    </div>
  );
}
