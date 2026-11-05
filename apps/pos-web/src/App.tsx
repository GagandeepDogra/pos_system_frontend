import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Language, Role, TableStatus, User } from '@dhaba/shared';
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
import { TakeawayScreen } from './screens/TakeawayScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { DesignPreview } from './screens/DesignPreview';
import { TablesScreen } from './screens/TablesScreen';
import { ScreenPreview } from './screens/ScreenPreview';
import { ChooseFoodScreen, type FoodTarget } from './screens/ChooseFoodScreen';
import { KitchenScreen } from './screens/KitchenScreen';
import { OrderScreen } from './screens/OrderScreen';
import { BillsScreen, PaymentScreen } from './screens/PaymentScreen';
import { KitchenNotices } from './kitchen/KitchenNotices';
import { defaultCartStore, type CartStore } from './cart/cartStore';
import type { TableCardData } from './components/TableGrid';
import { createSocketChannel, RealtimeProvider, type RealtimeChannel, type RealtimeFactory } from './realtime/realtime';

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

/** Socket.IO in the app; no socket under unit tests unless a test passes its own channel. */
const DEFAULT_REALTIME: RealtimeFactory | null = import.meta.env.MODE === 'test' ? null : createSocketChannel;

interface AppProps {
  fetchImpl?: typeof fetch;
  /** Builds the realtime channel for a session token (tests pass a memory channel). */
  realtime?: RealtimeFactory | null;
  /** Where the unsent cart is kept on this device (tests pass a memory store). */
  cartStore?: CartStore;
}

export function App({ fetchImpl, realtime = DEFAULT_REALTIME, cartStore }: AppProps = {}) {
  const store = useMemo(() => cartStore ?? defaultCartStore(), [cartStore]);
  const [session, setSession] = useState<Session | null>(startSession);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [lock, setLock] = useState<Role | null>(() => getDeviceLock());
  const [screen, setScreen] = useState<string>(() => homeScreen(getDeviceLock()));
  /** Status filter for the tables list when opened from a dashboard tile. */
  const [tableFilter, setTableFilter] = useState<TableStatus | null>(null);
  /** The table the user tapped; the order/food screens start from it. */
  const [selectedTable, setSelectedTable] = useState<TableCardData | null>(null);
  /** Whose order food selection adds to; set by the tables grid (and later the takeaway screen). */
  const [foodTarget, setFoodTarget] = useState<FoodTarget | null>(null);
  /** The open bill the payment screen settles. */
  const [billOrderId, setBillOrderId] = useState<string | null>(null);
  /** Where the payment screen goes back to: the bills list, or the takeaway list it was opened from. */
  const [payReturn, setPayReturn] = useState<'bills' | 'takeaway'>('bills');
  const [channel, setChannel] = useState<RealtimeChannel | null>(null);
  const token = session?.token;
  useEffect(() => {
    if (!token || !realtime) return;
    const c = realtime(token);
    setChannel(c);
    return () => {
      c.close();
      setChannel(null);
    };
  }, [token, realtime]);
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

  const open = (target: string, filter: TableStatus | null = null) => {
    if (!canOpen(lock, target)) return;
    setTableFilter(filter);
    setScreen(target);
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
  else if (import.meta.env.DEV && window.location.hash.startsWith('#/design/')) {
    body = <ScreenPreview name={window.location.hash.slice('#/design/'.length)} />;
  }
  else if (!session || !user) {
    body = <LoginScreen api={ep} kitchenDevice={lock === 'KITCHEN'} onLanguage={(l) => void chooseLanguage(l)} onLoggedIn={(tk, u) => void onLoggedIn(tk, u)} />;
  } else if (screen === 'admin' && user.role === 'ADMIN' && canOpen(lock, 'admin')) {
    body = (
      <AdminAreaScreen
        api={ep}
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
        getDashboard={ep.getDashboard}
        onOpenActiveTables={() => open('tables', 'OCCUPIED')}
        onOpen={(s) => open(s)}
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
  } else if (screen === 'tables' && canOpen(lock, 'tables')) {
    body = (
      <TablesScreen
        key={tableFilter ?? 'all'}
        listTables={ep.listTables}
        statusFilter={tableFilter}
        userName={user.display_name}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={goHome}
        onTakeaway={() => open('takeaway')}
        onOpenTable={(tb) => {
          // Available → food selection; Occupied / Ready to Close → the order view (REQ-035).
          setSelectedTable(tb);
          setFoodTarget({
            kind: 'table', tableId: tb.id, table: tb.number, detail: tb.area ?? undefined,
            orderId: tb.orderId ?? null, free: tb.status === 'AVAILABLE',
          });
          open(tb.status === 'AVAILABLE' ? 'chooseFood' : 'order');
        }}
      />
    );
  } else if (screen === 'chooseFood' && foodTarget && canOpen(lock, 'chooseFood')) {
    body = (
      <ChooseFoodScreen
        target={foodTarget}
        api={ep}
        store={store}
        userName={user.display_name}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={() => open(foodTarget.kind === 'table' ? 'tables' : 'takeaway')}
      />
    );
  } else if (screen === 'order' && selectedTable?.orderId && canOpen(lock, 'order')) {
    const tb = selectedTable;
    body = (
      <OrderScreen
        key={tb.orderId}
        orderId={tb.orderId as string}
        table={tb.number}
        tableId={tb.id}
        role={user.role}
        api={ep}
        userName={user.display_name}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={() => open('tables')}
        onMoved={(o, target) => setSelectedTable({ ...tb, id: target.id, number: target.table_number, area: target.area ?? null, orderId: o.id || tb.orderId })}
        onAddFood={(o, label) => {
          setFoodTarget({ kind: 'table', tableId: o.table_id ?? tb.id, table: label, detail: tb.area ?? undefined, orderId: o.id, free: false });
          open('chooseFood');
        }}
      />
    );
  } else if (screen === 'bills' && user.role !== 'KITCHEN' && canOpen(lock, 'bills')) {
    body = (
      <BillsScreen api={ep} userName={user.display_name} onSwitchUser={logout} onHome={goHome} onBack={goHome}
        onOpenBill={(o) => { setBillOrderId(o.id); setPayReturn('bills'); open('payment'); }} />
    );
  } else if (screen === 'payment' && billOrderId && canOpen(lock, 'payment')) {
    body = (
      <PaymentScreen key={billOrderId} orderId={billOrderId} api={ep} role={user.role} userName={user.display_name}
        onSwitchUser={logout} onHome={goHome} onBack={() => open(payReturn)} onDone={() => open(payReturn)} />
    );
  } else if (screen === 'takeaway' && user.role !== 'KITCHEN' && canOpen(lock, 'takeaway')) {
    body = (
      <TakeawayScreen
        api={ep}
        userName={user.display_name}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={goHome}
        onAddFood={(tk, orderId) => { setFoodTarget({ kind: 'token', token: tk, orderId }); open('chooseFood'); }}
        onCollect={(orderId) => { setBillOrderId(orderId); setPayReturn('takeaway'); open('payment'); }}
        onViewPayments={() => open('bills')}
      />
    );
  } else if (screen === 'kitchen' && canOpen(lock, 'kitchen')) {
    body = (
      <KitchenScreen
        api={ep}
        userName={user.display_name}
        role={user.role}
        deviceRole={lock}
        onSwitchUser={logout}
        onHome={goHome}
        onBack={lock === 'KITCHEN' ? undefined : goHome}
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
      <ConnectionProvider check={healthCheck}>
        <RealtimeProvider channel={session ? channel : null}>
          {body}
          {/* Cashier and admin phones get the food-ready and out-of-stock chips (REQ-052, REQ-056). */}
          {session && lock !== 'KITCHEN' && session.user.role !== 'KITCHEN' ? <KitchenNotices /> : null}
        </RealtimeProvider>
      </ConnectionProvider>
    </I18nProvider>
  );
}
