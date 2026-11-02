import { supabase } from './supabaseClient';
import type { User, PresenceSession } from '../types';

// v1.73 — Connected Users monitor (Supabase Realtime Presence).
//
// Shared logins are the norm: one app_users row, many concurrent devices. Each
// browser connection is a distinct presence entry keyed by its socket; the
// payload carries user_id + a persistent device_id so the monitor can group by
// (user_id, device_id) and show "N accounts / M devices". Presence auto-prunes
// a socket on disconnect, so the list is genuinely live with zero DB writes.

const DEVICE_ID_KEY = 'fgbmfi_device_id';
const DEVICE_LABEL_KEY = 'fgbmfi_device_label';
const CHANNEL_NAME = 'online-users';
// v1.89: 5 min (was 45 s). Presence syncs are broadcast to every subscriber, so
// re-tracking costs O(N) messages per client — at 100 devices a 45 s heartbeat
// is roughly N^2/45s and exhausts the monthly Realtime message quota. A 5 min
// cadence keeps the monitor useful while cutting the fan-out ~7x. A track also
// fires immediately when the tab regains visibility, so the list never looks
// stale for longer than that in practice.
const HEARTBEAT_MS = 5 * 60_000;

function randomId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  } catch { /* ignore */ }
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = randomId();
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return 'unknown-device';
  }
}

function defaultDeviceLabel(): string {
  try {
    const ua = navigator.userAgent || '';
    const os = /Android/i.test(ua) ? 'Android'
      : /iPhone|iPad|iPod/i.test(ua) ? 'iOS'
      : /Windows/i.test(ua) ? 'Windows'
      : /Mac OS X/i.test(ua) ? 'macOS'
      : /Linux/i.test(ua) ? 'Linux' : 'Device';
    const browser = /Edg\//i.test(ua) ? 'Edge'
      : /OPR\//i.test(ua) ? 'Opera'
      : /Chrome\//i.test(ua) ? 'Chrome'
      : /Safari\//i.test(ua) ? 'Safari'
      : /Firefox\//i.test(ua) ? 'Firefox' : 'Browser';
    return `${os} · ${browser}`;
  } catch {
    return 'Device';
  }
}

export function getDeviceLabel(): string {
  try {
    return localStorage.getItem(DEVICE_LABEL_KEY) || defaultDeviceLabel();
  } catch {
    return defaultDeviceLabel();
  }
}

export function setDeviceLabel(label: string): void {
  try {
    localStorage.setItem(DEVICE_LABEL_KEY, (label || '').trim() || defaultDeviceLabel());
  } catch { /* ignore */ }
}

interface Payload {
  user_id: string;
  email: string;
  role: string;
  district?: string;
  region?: string;
  active_event_id?: string;
  device_id: string;
  device_label?: string;
  joined_at: string;
  last_seen: string;
}

const EMPTY: PresenceSession[] = [];

let channel: ReturnType<typeof supabase.channel> | null = null;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let sessions: PresenceSession[] = EMPTY;
let currentUserId: string | null = null;
let currentPayloadBase: Omit<Payload, 'joined_at' | 'last_seen'> | null = null;
let currentJoinedAt = '';
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((cb) => {
    try { cb(); } catch { /* ignore */ }
  });
}

function aggregate(state: Record<string, unknown[]>): PresenceSession[] {
  const byConnection = new Map<string, PresenceSession>();
  Object.entries(state || {}).forEach(([connectionKey, metadatas]) => {
    const list = Array.isArray(metadatas) ? (metadatas as Payload[]) : [];
    if (list.length === 0) return;
    // A connection can briefly hold multiple metadatas during a re-track; keep
    // the freshest payload for that connection.
    const fresh = list.reduce((a, b) =>
      (new Date(b.last_seen || 0).getTime() >= new Date(a.last_seen || 0).getTime() ? b : a));
    byConnection.set(connectionKey, {
      connection_key: connectionKey,
      user_id: fresh.user_id || '',
      email: fresh.email || '',
      role: fresh.role || '',
      district: fresh.district,
      region: fresh.region,
      active_event_id: fresh.active_event_id,
      device_id: fresh.device_id || 'unknown-device',
      device_label: fresh.device_label,
      joined_at: fresh.joined_at || fresh.last_seen || new Date().toISOString(),
      last_seen: fresh.last_seen || new Date().toISOString(),
      tabs: list.length,
    });
  });

  // Collapse multiple tabs on the same device into one row (sum tabs, earliest join).
  const byDevice = new Map<string, PresenceSession>();
  byConnection.forEach((s) => {
    const key = `${s.user_id}::${s.device_id}`;
    const existing = byDevice.get(key);
    if (!existing) {
      byDevice.set(key, { ...s });
    } else {
      existing.tabs += s.tabs;
      if (new Date(s.joined_at).getTime() < new Date(existing.joined_at).getTime()) existing.joined_at = s.joined_at;
      if (new Date(s.last_seen).getTime() > new Date(existing.last_seen).getTime()) existing.last_seen = s.last_seen;
    }
  });

  return Array.from(byDevice.values()).sort((a, b) => {
    if (a.role !== b.role) return a.role.localeCompare(b.role);
    return (a.email || '').localeCompare(b.email || '');
  });
}

function trackMeta(): Payload {
  const now = new Date().toISOString();
  return { ...(currentPayloadBase as Omit<Payload, 'joined_at' | 'last_seen'>), joined_at: currentJoinedAt || now, last_seen: now };
}

export function startPresence(user: User, activeEventId?: string): void {
  if (!user?.id) return;
  // Presence is a monitoring nicety — it must NEVER be able to crash app boot
  // (e.g. a Realtime/session_kicks hiccup on the very first load after deploy).
  try {
    const deviceId = getDeviceId();
    if (channel && currentUserId === user.id && currentPayloadBase?.device_id === deviceId) {
      // Same user + same device — just refresh event context + heartbeat payload.
      currentPayloadBase = { ...(currentPayloadBase as Omit<Payload, 'joined_at' | 'last_seen'>), active_event_id: activeEventId || undefined };
      channel.track(trackMeta());
      return;
    }
    stopPresence();

    currentUserId = user.id;
    currentJoinedAt = new Date().toISOString();
    currentPayloadBase = {
      user_id: user.id,
      email: user.email || '',
      role: (user.role || '') as string,
      district: user.district,
      region: user.region,
      active_event_id: activeEventId || undefined,
      device_id: deviceId,
      device_label: getDeviceLabel(),
    };

    // v1.89 — presence key MUST be per device, not per account. The app
    // deliberately supports one login across many devices; keying on user.id
    // collapsed every device into a single presence entry (the monitor showed
    // "1 device / N tabs" and per-device Disconnect was unusable).
    channel = supabase.channel(CHANNEL_NAME, {
      config: { presence: { key: `${user.id}::${deviceId}` } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      try {
        sessions = aggregate(channel?.presenceState() as Record<string, unknown[]> || {});
        emit();
      } catch { /* ignore */ }
    });

    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        try {
          channel?.track(trackMeta());
          sessions = aggregate(channel?.presenceState() as Record<string, unknown[]> || {});
          emit();
        } catch { /* ignore */ }
      }
    });

    const beat = () => {
      try {
        if (!channel || navigator.onLine === false) return;
        // Skip while backgrounded: an idle tab does not need to keep its
        // presence fresh, and each track fans out to every subscriber.
        if (typeof document !== 'undefined' && document.hidden) return;
        channel.track(trackMeta());
      } catch { /* ignore */ }
    };

    heartbeat = setInterval(beat, HEARTBEAT_MS);

    // Re-track the moment the tab becomes visible again so the monitor does not
    // wait a full heartbeat interval to reflect the device.
    if (typeof document !== 'undefined') {
      visibilityHandler = () => { if (!document.hidden) beat(); };
      document.addEventListener('visibilitychange', visibilityHandler);
    }
  } catch (e) {
    console.warn('[presence] start failed (non-fatal):', e);
  }
}

export function stopPresence(): void {
  try {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = null; }
    if (visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', visibilityHandler);
      visibilityHandler = null;
    }
    if (channel) {
      try { channel.untrack(); } catch { /* ignore */ }
      try { supabase.removeChannel(channel); } catch { /* ignore */ }
      channel = null;
    }
  } catch { /* ignore */ }
  currentUserId = null;
  currentPayloadBase = null;
  currentJoinedAt = '';
  if (sessions !== EMPTY) {
    sessions = EMPTY;
    emit();
  }
}

export function subscribePresence(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getPresenceSnapshot(): PresenceSession[] {
  return sessions;
}

export function getPresenceCounts(): { accounts: number; devices: number } {
  const accounts = new Set<string>();
  const devices = new Set<string>();
  sessions.forEach((s) => {
    accounts.add(s.user_id);
    devices.add(`${s.user_id}::${s.device_id}`);
  });
  return { accounts: accounts.size, devices: devices.size };
}
