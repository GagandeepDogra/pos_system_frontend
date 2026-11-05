import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Connection to the counter computer (REQ-016). /health is polled every 3 s;
 * any failure (no answer, timeout, 503) means offline. While offline, Send and
 * Pay are disabled under a red banner. Nothing is sent automatically when the
 * connection returns: the cart stays on the device until the user taps Send.
 */
export const HEALTH_INTERVAL_MS = 3000;

export type HealthCheck = () => Promise<boolean>;

export function createHealthMonitor(check: HealthCheck, onChange: (online: boolean) => void, intervalMs = HEALTH_INTERVAL_MS) {
  let online = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  const tick = async () => {
    let ok = false;
    try {
      ok = await check();
    } catch {
      ok = false;
    }
    if (stopped) return;
    if (ok !== online) {
      online = ok;
      onChange(ok);
    }
    timer = setTimeout(tick, intervalMs);
  };
  void tick();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

const ConnectionContext = createContext<boolean>(true);

export function ConnectionProvider({ check, children }: { check: HealthCheck; children: ReactNode }) {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const m = createHealthMonitor(check, setOnline);
    return () => m.stop();
  }, [check]);
  return <ConnectionContext.Provider value={online}>{children}</ConnectionContext.Provider>;
}

/** True while /health answers. Screens disable Send / Pay when false. */
export function useOnline(): boolean {
  return useContext(ConnectionContext);
}

/** Green 'Connected' line, or the red offline banner. */
export function ConnectionLine() {
  const online = useOnline();
  const { t } = useI18n();
  if (online) return <p className="connection connection--ok">{t('connection.online')}</p>;
  return (
    <div className="offline-banner" role="alert">
      <strong>{t('connection.offline')}</strong>
      <span>{t('connection.offlineHelp')}</span>
    </div>
  );
}
