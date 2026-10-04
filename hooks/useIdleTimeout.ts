import { useEffect, useRef, useState, useCallback } from 'react';

// v1.73 — Idle timeout (per device).
//
// 15 minutes of inactivity, with a 60-second warning modal. Every real activity
// resets the clock; an idle tab never affects sibling tabs (BroadcastChannel
// keeps same-browser tabs in sync) or other devices sharing the same login.
//
// Browsers throttle timers in background tabs, so on returning to visible we
// recompute elapsed time directly and fire immediately when already past the
// deadline.

export const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const IDLE_WARNING_MS = 60 * 1000;

const STORAGE_KEY = 'fgbmfi_last_activity';
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'wheel', 'click', 'pointerdown'];

interface UseIdleTimeoutOptions {
  enabled: boolean;
  timeoutMs?: number;
  warningMs?: number;
  onIdle: () => void;
}

interface UseIdleTimeoutResult {
  warning: boolean;
  secondsLeft: number;
  stayActive: () => void;
  signOutNow: () => void;
}

function readSharedActivity(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSharedActivity(ts: number): void {
  try { localStorage.setItem(STORAGE_KEY, String(ts)); } catch { /* ignore */ }
}

export function useIdleTimeout({
  enabled,
  timeoutMs = IDLE_TIMEOUT_MS,
  warningMs = IDLE_WARNING_MS,
  onIdle,
}: UseIdleTimeoutOptions): UseIdleTimeoutResult {
  const lastActivityRef = useRef<number>(Date.now());
  const firedRef = useRef(false);
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(Math.ceil(timeoutMs / 1000));

  const idleRef = useRef(onIdle);
  useEffect(() => { idleRef.current = onIdle; }, [onIdle]);

  const bcRef = useRef<BroadcastChannel | null>(null);

  const reset = useCallback((broadcast: boolean) => {
    const now = Date.now();
    lastActivityRef.current = now;
    firedRef.current = false;
    writeSharedActivity(now);
    setWarning(false);
    setSecondsLeft(Math.ceil(timeoutMs / 1000));
    if (broadcast) {
      try { bcRef.current?.postMessage({ type: 'activity', ts: now }); } catch { /* ignore */ }
    }
  }, [timeoutMs]);

  const stayActive = useCallback(() => reset(true), [reset]);
  const signOutNow = useCallback(() => {
    firedRef.current = true;
    idleRef.current();
  }, []);

  // Cross-tab sync (same browser only). Do NOT stamp storage on receive to avoid
  // ping-pong; just adopt the timestamp.
  useEffect(() => {
    if (!enabled) return;
    if (typeof BroadcastChannel === 'undefined') return;
    const bc = new BroadcastChannel('fgbmfi_idle');
    bcRef.current = bc;
    bc.onmessage = (ev) => {
      const msg = ev.data;
      if (msg && msg.type === 'activity' && typeof msg.ts === 'number') {
        lastActivityRef.current = msg.ts;
        firedRef.current = false;
        setWarning(false);
        setSecondsLeft(Math.ceil(timeoutMs / 1000));
      }
    };
    return () => {
      try { bc.close(); } catch { /* ignore */ }
      bcRef.current = null;
    };
  }, [enabled, timeoutMs]);

  // Adopt the newest shared timestamp on activation so a fresh tab/device is not
  // considered idle.
  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    const shared = readSharedActivity();
    lastActivityRef.current = Math.max(shared, now);
    writeSharedActivity(lastActivityRef.current);
    firedRef.current = false;
    setWarning(false);
    setSecondsLeft(Math.ceil(timeoutMs / 1000));
  }, [enabled, timeoutMs]);

  // Activity listeners (throttled to ~1s).
  useEffect(() => {
    if (!enabled) return;
    let lastStamp = 0;
    const handler = () => {
      const now = Date.now();
      if (now - lastStamp < 1000) return;
      lastStamp = now;
      reset(true);
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, handler));
    };
  }, [enabled, reset]);

  // Checker.
  useEffect(() => {
    if (!enabled) {
      setWarning(false);
      return;
    }
    const check = () => {
      if (firedRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      const remaining = timeoutMs - elapsed;
      if (remaining <= 0) {
        firedRef.current = true;
        idleRef.current();
        return;
      }
      if (remaining <= warningMs) {
        setWarning(true);
        setSecondsLeft(Math.max(1, Math.ceil(remaining / 1000)));
      } else if (warning) {
        setWarning(false);
      }
    };
    const interval = setInterval(check, 1000);
    return () => clearInterval(interval);
  }, [enabled, timeoutMs, warningMs, warning]);

  // Background-throttle correction.
  useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (firedRef.current) return;
      const elapsed = Date.now() - lastActivityRef.current;
      if (elapsed >= timeoutMs) {
        firedRef.current = true;
        idleRef.current();
      } else if (elapsed >= timeoutMs - warningMs) {
        setWarning(true);
        setSecondsLeft(Math.max(1, Math.ceil((timeoutMs - elapsed) / 1000)));
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, timeoutMs, warningMs]);

  return { warning, secondsLeft, stayActive, signOutNow };
}
