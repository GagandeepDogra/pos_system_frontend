import { useEffect, useState } from 'react';
import { LANGUAGES, type Language, type User } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import { useI18n } from '../i18n/I18nProvider';
import { PinPad } from '../components/PinPad';
import { TopBar } from '../components/TopBar';

export interface LoginApi {
  listLoginStaff: () => Promise<ApiResult<User[]>>;
  login: (body: { user_id: string; pin: string; kitchen_device?: boolean }) => Promise<ApiResult<{ token: string; user: User }>>;
}

interface Props {
  api: LoginApi;
  /** Device locked to the kitchen: ask for a login that does not end at shift end. */
  kitchenDevice: boolean;
  onLanguage: (lang: Language) => void;
  onLoggedIn: (token: string, user: User) => void;
}

function remainingTries(details: unknown): number | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as Record<string, unknown>;
  const n = d.remaining_tries ?? d.remaining_attempts ?? d.remaining;
  return typeof n === 'number' ? n : null;
}

/**
 * Login (REQ-024): active staff as large name tiles; tap a name, then type the
 * 4-digit PIN on the large keypad. A wrong PIN shakes the pad once and shows
 * the tries left. The same screen is the user-switch screen (REQ-027).
 */
export function LoginScreen({ api, kitchenDevice, onLanguage, onLoggedIn }: Props) {
  const { t, lang } = useI18n();
  const [staff, setStaff] = useState<User[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [chosen, setChosen] = useState<User | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoadFailed(false);
    const res = await api.listLoginStaff();
    if (res.ok) setStaff((Array.isArray(res.data) ? res.data : []).filter((u) => u.is_active));
    else setLoadFailed(true);
  };
  useEffect(() => {
    void load();
  }, []);

  const submit = async (pin: string) => {
    if (!chosen) return;
    setBusy(true);
    const res = await api.login({ user_id: chosen.id, pin, ...(kitchenDevice ? { kitchen_device: true } : {}) });
    setBusy(false);
    if (res.ok) {
      onLoggedIn(res.data.token, res.data.user ?? chosen);
      return;
    }
    setShake((n) => n + 1);
    if (res.status === 401) {
      const left = remainingTries(res.error.details);
      setMessage(left === null ? t('login.wrongPin') : t('login.wrongPinTries', { count: left }));
    } else setMessage(t(`errors.${res.error.code}`));
  };

  return (
    <div className="shell">
      <TopBar />
      <main className="workspace">
        {chosen ? (
          <>
            <button type="button" className="btn login__back" onClick={() => { setChosen(null); setMessage(null); }}>
              {t('nav.back')}
            </button>
            <h1 className="heading">{chosen.display_name}</h1>
            <p className="muted">{t('login.enterPin')}</p>
            <PinPad label={t('login.pinFor', { name: chosen.display_name })} onComplete={submit} shakeKey={shake} message={message} disabled={busy} />
          </>
        ) : (
          <>
            <h1 className="heading">{t('login.title')}</h1>
            <p className="muted">{t('login.subtitle')}</p>
            {loadFailed ? (
              <div className="login__error" role="alert">
                <p>{t('errors.NETWORK')}</p>
                <button type="button" className="btn" onClick={() => void load()}>{t('actions.tryAgain')}</button>
              </div>
            ) : null}
            <ul className="staff-tiles" aria-label={t('login.staffList')}>
              {(staff ?? []).map((u) => (
                <li key={u.id}>
                  <button type="button" className="staff-tile" onClick={() => { setChosen(u); setMessage(null); }}>
                    <span className="staff-tile__name">{u.display_name}</span>
                    <span className="staff-tile__role">{t(`roles.${u.role}`)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className="lang-switch" role="group" aria-label={t('language.label')}>
              {LANGUAGES.map((l) => (
                <button key={l} type="button" className="btn" aria-pressed={lang === l} onClick={() => onLanguage(l)}>
                  {t(`language.${l}`)}
                </button>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
