import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { io } from 'socket.io-client';
import type { RealtimeEvent } from '@dhaba/shared';
import type { ApiResult } from '../api/client';
import { useOnline } from '../offline/connection';

/**
 * The realtime channel (REQ-116): small Socket.IO events after each committed
 * write, plus a reconnect signal. Screens never trust an event alone: they
 * refetch their GET endpoints, so a missed event never leaves a screen wrong.
 */
export interface RealtimeChannel {
  on(event: RealtimeEvent, handler: (payload: unknown) => void): () => void;
  /** Called after the socket reconnects (catch-up refetch). */
  onReconnect(handler: () => void): () => void;
  close(): void;
}

export type RealtimeFactory = (token: string) => RealtimeChannel;

/** Socket.IO on the same origin as the API (`/socket.io`), authenticated with the session token. */
export const createSocketChannel: RealtimeFactory = (token) => {
  const socket = io({ path: '/socket.io', auth: { token }, transports: ['websocket', 'polling'] });
  let connectedOnce = false;
  const reconnectHandlers = new Set<() => void>();
  socket.on('connect', () => {
    if (connectedOnce) reconnectHandlers.forEach((h) => h());
    connectedOnce = true;
  });
  return {
    on(event, handler) {
      socket.on(event, handler);
      return () => { socket.off(event, handler); };
    },
    onReconnect(handler) {
      reconnectHandlers.add(handler);
      return () => { reconnectHandlers.delete(handler); };
    },
    close() { socket.close(); },
  };
};

/** In-memory channel for tests and the design gallery: `emit` / `reconnect` drive it. */
export function createMemoryChannel() {
  const handlers = new Map<string, Set<(p: unknown) => void>>();
  const reconnects = new Set<() => void>();
  let closed = false;
  const channel: RealtimeChannel & {
    emit: (event: RealtimeEvent, payload?: unknown) => void;
    reconnect: () => void;
    readonly closed: boolean;
  } = {
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(handler);
      return () => { handlers.get(event)?.delete(handler); };
    },
    onReconnect(handler) {
      reconnects.add(handler);
      return () => { reconnects.delete(handler); };
    },
    close() { closed = true; },
    emit(event, payload) { handlers.get(event)?.forEach((h) => h(payload)); },
    reconnect() { reconnects.forEach((h) => h()); },
    get closed() { return closed; },
  };
  return channel;
}

const RealtimeContext = createContext<RealtimeChannel | null>(null);

export function RealtimeProvider({ channel, children }: { channel: RealtimeChannel | null; children: ReactNode }) {
  return <RealtimeContext.Provider value={channel}>{children}</RealtimeContext.Provider>;
}

export function useRealtime(): RealtimeChannel | null {
  return useContext(RealtimeContext);
}

/** Events coalesce into one refetch after this delay (well inside the 3 s budget, REQ-030). */
export const REFETCH_DEBOUNCE_MS = 150;

/**
 * Loads a GET endpoint and keeps it live: refetches on any of `events`, after
 * the socket reconnects, and when /health comes back after being offline.
 * The last good data stays on screen while a refetch fails.
 */
export function useLiveData<T>(load: () => Promise<ApiResult<T>>, events: readonly RealtimeEvent[]) {
  const channel = useRealtime();
  const online = useOnline();
  const [data, setData] = useState<T | null>(null);
  const [failed, setFailed] = useState(false);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    const res = await loadRef.current();
    if (mine !== seq.current) return; // a newer refetch started; keep only the latest answer
    if (res.ok && res.data !== undefined) {
      setData(res.data);
      setFailed(false);
    } else setFailed(true);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const eventKey = events.join(',');
  useEffect(() => {
    if (!channel) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), REFETCH_DEBOUNCE_MS);
    };
    const offs = eventKey.split(',').map((e) => channel.on(e as RealtimeEvent, schedule));
    offs.push(channel.onReconnect(() => void refresh()));
    return () => {
      clearTimeout(timer);
      offs.forEach((off) => off());
    };
  }, [channel, eventKey, refresh]);

  // Catch up when the server answers /health again after an outage.
  const wasOnline = useRef(online);
  useEffect(() => {
    if (online && !wasOnline.current) void refresh();
    wasOnline.current = online;
  }, [online, refresh]);

  return { data, failed, refresh };
}
