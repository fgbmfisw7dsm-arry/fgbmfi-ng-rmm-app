// v1.82: shared connectivity signal. `navigator.onLine` is unreliable (true on a
// captive portal / dead uplink), so the ConnectionStatus health probe also feeds
// this store. Door pages use it for UI hints; queue decisions still use the
// conservative offline/network-failure paths in the service layer.

export type ConnectionState = 'connected' | 'degraded' | 'disconnected';

let state: ConnectionState =
  typeof navigator !== 'undefined' && navigator.onLine === false ? 'disconnected' : 'connected';

const listeners = new Set<(s: ConnectionState) => void>();

export const getConnectionState = (): ConnectionState => state;

export const setConnectionState = (next: ConnectionState): void => {
  if (state === next) return;
  state = next;
  listeners.forEach(fn => {
    try { fn(next); } catch { /* listener error */ }
  });
};

export const subscribeConnection = (fn: (s: ConnectionState) => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

export const isDefinitelyOffline = (): boolean =>
  state === 'disconnected' || (typeof navigator !== 'undefined' && navigator.onLine === false);

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setConnectionState('connected'));
  window.addEventListener('offline', () => setConnectionState('disconnected'));
}
