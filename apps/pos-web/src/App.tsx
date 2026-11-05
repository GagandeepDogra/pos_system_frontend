import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language, Role, User } from '@dhaba/shared';
import { I18nProvider } from './i18n/I18nProvider';
import { getUserLanguage, setUserLanguage } from './i18n/languageStore';
import { switchUserLanguage } from './i18n/switchLanguage';
import { createApiClient, type ApiResult, type RequestOptions } from './api/client';
import { endpoints } from './api/endpoints';
import { ConnectionProvider } from './offline/connection';
import { clearSession, isExpired, loadSession, saveSession, type Session } from './session/session';
import { canOpen, getDeviceLock, homeScreen, setDeviceLock } from './session/deviceLock';
import { createApprovalHolder } from './session/approval';
import { LoginScreen } from './screens/LoginScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { AdminAreaScreen } from './screens/AdminAreaScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { DesignPreview } from './screens/DesignPreview';

/** Before anyone logs in, the login screen uses the device's last choice. */
const DEVICE_USER = '__device__';
/** How often the session deadline (12 h / shift end) is checked. */
export const SESSION_CHECK_MS = 15_000;

function startSession(): Session | null {
  const s = loadSession();
  if (s && isExpired(s)) {
    clearSession();
    return null;
  }
  return s;
}

export function App({ fetchImpl }: { fetchImpl?: typeof fetch } = {}) {
  const [session, setSession] = useState<Session | null>(startSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [lock, setLock] = useState<Role | null>(() => getDeviceLock());
  const [screen, setScreen] = useState<string>(() => homeScreen(getDeviceLock()));
  const [deviceLang, setDeviceLang] = useState<Language>(() => getUserLanguage(DEVICE_USER));
  const approvals = useMemo(() => createApprovalHolder(), []);

  const logout = useCallback(() => {
    // The previous user's token leaves the device (REQ-027).
    clearSession();
    setSession(null);
    approvals.take();
    setScreen(homeScreen(getDeviceLock()));
  }, [approvals]);

  const ep = useMemo(() => {
    const client = createApiClient({ fetchImpl, getToken: () => sessionRef.current?.token });
    // Any 401 (expired, revoked, older than 12 h) sends the device back to the staff tiles.
    const request = async <T,>(path: string, opts?: RequestOptions): Promise<ApiResult<T>> => {
      const res = await client.request<T>(path, opts);
      if (!res.ok && res.status === 401 && path !== '/auth/login' && sessionRef.current) logout();
      return res;
    };
    return endpoints({ request });
  }, [fetchImpl, logout]);

  const healthCheck = useCallback(async () => (await ep.getHealth({ retries: 0, timeoutMs: 2500 })).ok, [ep]);

  // REQ-026: end the session at the 12 h limit or the configured shift end (not on a kitchen device).
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => {
      if (sessionRef.current && isExpired(sessionRef.current)) logout();
    }, SESSION_CHECK_MS);
    return () => clearInterval(id);
  }, [session, logout]);

  const onLoggedIn = async (token: string, user: User) => {
    const s: Session = { token, user, loginAt: Date.now(), kitchenDevice: lock === 'KITCHEN', shiftEnd: null };
    saveSession(s);
    sessionRef.current = s;
    setSession(s);
    setScreen(homeScreen(lock));
    const settings = await ep.getSettings();
    if (settings.ok && settings.data?.shift_end_time && sessionRef.current?.token === token) {
      const withShift = { ...s, shiftEnd: settings.data.shift_end_time };
      saveSession(withShift);
      setSession(withShift);
    }
  };

  const open = (target: string) => {
    if (canOpen(lock, target)) setScreen(target);
  };
  const goHome = () => setScreen(homeScreen(lock));

  const user = session?.user;
  const lang: Language = user ? getUserLanguage(user.id, user.language) : deviceLang;

  const chooseLanguage = async (l: Language) => {
    if (!session) {
      setUserLanguage(DEVICE_USER, l);
      setDeviceLang(l);
      return;
    }
    setUserLanguage(session.user.id, l);
    const updated = { ...session, user: { ...session.user, language: l } };
    setSession(updated);
    const res = await switchUserLanguage(ep, session.user, l);
    if (res.ok && res.data && sessionRef.current?.user.id === res.data.id) {
      const s = { ...sessionRef.current, user: res.data };
      saveSession(s);
      setSession(s);
    }
  };

  let body;
  if (import.meta.env.DEV && window.location.hash === '#/design') body = <DesignPreview />;
  else if (!session || !user) {
    body = <LoginScreen api={ep} kitchenDevice={lock === 'KITCHEN'} onLanguage={(l) => void chooseLanguage(l)} onLoggedIn={(tk, u) => void onLoggedIn(tk, u)} />;
  } else if (screen === 'admin' && user.role === 'ADMIN' && canOpen(lock, 'admin')) {
    body = (
      <AdminAreaScreen
        userName={user.display_name}
        deviceLock={lock}
        onDeviceLock={(r) => { setDeviceLock(r); setLock(r); }}
        onHome={goHome}
        onSwitchUser={logout}
      />
    );
  } else if (screen === 'dashboard' && canOpen(lock, 'dashboard')) {
    body = (
      <DashboardScreen
        user={user}
        onOpen={open}
        onSwitchUser={logout}
        onLanguage={(l) => void chooseLanguage(l)}
        createApproval={ep.createApproval}
        onAdminApproved={(token, adminId) => {
          approvals.put(token, adminId);
          // Entering the admin area uses the single-use approval.
          if (approvals.take()) setScreen('admin');
        }}
      />
    );
  } else {
    const shown = canOpen(lock, screen) ? screen : homeScreen(lock);
    body = (
      <PlaceholderScreen
        screen={shown}
        userName={user.display_name}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={lock === 'KITCHEN' ? undefined : goHome}
      />
    );
  }

  return (
    <I18nProvider lang={lang}>
      <ConnectionProvider check={healthCheck}>{body}</ConnectionProvider>
    </I18nProvider>
  );
}
