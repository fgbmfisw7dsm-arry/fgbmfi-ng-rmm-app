import React, { useEffect, useState, useMemo, useCallback, useRef, useSyncExternalStore } from 'react';
import {
  subscribePresence,
  getPresenceSnapshot,
  getDeviceId,
  getDeviceLabel,
  setDeviceLabel,
} from '../services/presenceService';
import { db } from '../services/supabaseService';
import type { PresenceSession } from '../types';

const sessionKey = (s: Pick<PresenceSession, 'user_id' | 'device_id'>): string => `${s.user_id}::${s.device_id}`;

// After a kick, a device's presence entry only disappears once the target client
// honors the kick and untracks. Hide it optimistically; if it is still present
// and alive past this grace window, un-hide it (the kick was not acknowledged).
const PENDING_GRACE_MS = 60_000;
const NOTICE_AUTO_CLEAR_MS = 6_000;

const roleLabel = (role: string): string => {
  switch ((role || '').toLowerCase()) {
    case 'national_admin': return 'National Admin';
    case 'regional_admin': return 'Regional Admin';
    case 'district_admin': return 'District Admin';
    case 'national_registrar': return 'National Registrar';
    case 'regional_registrar': return 'Regional Registrar';
    case 'district_registrar': return 'District Registrar';
    case 'admin': return 'System Admin';
    case 'registrar': return 'Registrar';
    case 'finance': return 'Finance Admin';
    case 'event_admin': return 'Event Admin';
    case 'executive_admin': return 'Executive Admin';
    case 'exec_registrar': return 'Exec Registrar';
    default: return role || 'User';
  }
};

const fmt = (iso?: string): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

const relative = (iso?: string): string => {
  if (!iso) return '—';
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 10) return 'just now';
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
};

const ConnectedUsersPage: React.FC = () => {
  const sessions = useSyncExternalStore(subscribePresence, getPresenceSnapshot);
  const [search, setSearch] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Devices we optimistically hid after issuing a disconnect request.
  const [hiddenDevices, setHiddenDevices] = useState<Map<string, number>>(new Map());
  const [, setTick] = useState(0);
  const myDeviceId = getDeviceId();

  // Keep "last seen" relative labels fresh.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, []);

  // Auto-clear the action notice (user can also dismiss it manually).
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_AUTO_CLEAR_MS);
    return () => clearTimeout(t);
  }, [notice]);

  // Visible sessions = live presence minus optimistically-hidden kicked devices.
  const visibleSessions = useMemo(
    () => sessions.filter((s) => !hiddenDevices.has(sessionKey(s))),
    [sessions, hiddenDevices]
  );

  // Reconcile optimistic hides with live presence:
  //  - gone from presence  -> drop the hidden key (target left; done).
  //  - still present past the grace window -> un-hide (kick not acknowledged).
  const liveKeysRef = useRef<Set<string>>(new Set());
  liveKeysRef.current = useMemo(() => new Set(sessions.map(sessionKey)), [sessions]);
  useEffect(() => {
    if (hiddenDevices.size === 0) return;
    const now = Date.now();
    let changed = false;
    const next = new Map(hiddenDevices);
    hiddenDevices.forEach((hiddenAt, key) => {
      if (!liveKeysRef.current.has(key)) {
        next.delete(key);
        changed = true;
      } else if (now - hiddenAt > PENDING_GRACE_MS) {
        next.delete(key);
        changed = true;
      }
    });
    if (changed) setHiddenDevices(next);
  }, [sessions, hiddenDevices]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return visibleSessions;
    return visibleSessions.filter((s) =>
      [s.email, s.role, s.district, s.region, s.device_label, s.active_event_id]
        .some((v) => (v || '').toLowerCase().includes(q)));
  }, [visibleSessions, search]);

  const accounts = useMemo(() => new Set(visibleSessions.map((s) => s.user_id)).size, [visibleSessions]);
  const devices = visibleSessions.length;
  const pendingCount = hiddenDevices.size;

  const grouped = useMemo(() => {
    const map = new Map<string, { user_id: string; email: string; role: string; devices: PresenceSession[] }>();
    filtered.forEach((s) => {
      const g = map.get(s.user_id);
      if (g) g.devices.push(s);
      else map.set(s.user_id, { user_id: s.user_id, email: s.email, role: s.role, devices: [s] });
    });
    return Array.from(map.values());
  }, [filtered]);

  const handleDisconnectDevice = useCallback(async (s: PresenceSession) => {
    if (!window.confirm(`Disconnect this device?\n\n${s.email} — ${s.device_label || s.device_id}${s.device_id === myDeviceId ? '\n\n⚠ This is your current device.' : ''}`)) return;
    const key = sessionKey(s);
    setBusyKey(key);
    setNotice(null);
    try {
      await db.kickUser(s.user_id, { deviceId: s.device_id, reason: 'Disconnected by administrator (this device)' });
      setHiddenDevices((prev) => new Map(prev).set(key, Date.now()));
      setNotice({ kind: 'ok', text: `Disconnect requested for ${s.device_label || s.device_id}.` });
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.message || 'Disconnect failed.' });
    } finally {
      setBusyKey(null);
    }
  }, [myDeviceId]);

  const handleDisconnectAll = useCallback(async (userId: string, email: string) => {
    if (!window.confirm(`Disconnect ALL sessions for ${email}?\n\nEvery device using this login will be signed out.`)) return;
    setBusyKey(`${userId}::__all__`);
    setNotice(null);
    try {
      await db.kickUser(userId, { deviceId: null, reason: 'Disconnected by administrator (all sessions)' });
      const now = Date.now();
      setHiddenDevices((prev) => {
        const next = new Map(prev);
        sessions.filter((s) => s.user_id === userId).forEach((s) => next.set(sessionKey(s), now));
        return next;
      });
      setNotice({ kind: 'ok', text: `Disconnect requested for all sessions of ${email}.` });
    } catch (e: any) {
      setNotice({ kind: 'err', text: e?.message || 'Disconnect failed.' });
    } finally {
      setBusyKey(null);
    }
  }, [sessions]);

  const handleRename = useCallback((s: PresenceSession) => {
    const next = window.prompt('Device label (helps identify shared-login devices):', s.device_label || getDeviceLabel());
    if (next == null) return;
    setDeviceLabel(next);
    if (s.device_id === myDeviceId) {
      setNotice({ kind: 'ok', text: 'This device was renamed. It will update on the next heartbeat.' });
    } else {
      setNotice({ kind: 'err', text: 'Labels can only be set on the device itself. Rename it from that device.' });
    }
  }, [myDeviceId]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-500">
      <div className="bg-white p-8 rounded-3xl shadow-sm border flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h2 className="text-2xl font-black uppercase tracking-tight text-blue-900 leading-none">Connected Users</h2>
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2 leading-relaxed">
            Live sessions across all devices. Shared logins count as one account but multiple devices.
          </p>
          {pendingCount > 0 && (
            <p className="text-[9px] font-bold text-amber-600 uppercase tracking-widest mt-2 leading-relaxed">
              {pendingCount} disconnect request{pendingCount > 1 ? 's' : ''} pending — excluded from counts until acknowledged.
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <div className="px-5 py-3 bg-blue-50 border border-blue-100 rounded-2xl text-center min-w-[90px]">
            <div className="text-2xl font-black text-blue-700 tabular-nums">{accounts}</div>
            <div className="text-[9px] font-black text-blue-400 uppercase tracking-widest">Accounts</div>
          </div>
          <div className="px-5 py-3 bg-emerald-50 border border-emerald-100 rounded-2xl text-center min-w-[90px]">
            <div className="text-2xl font-black text-emerald-700 tabular-nums">{devices}</div>
            <div className="text-[9px] font-black text-emerald-500 uppercase tracking-widest">Devices</div>
          </div>
        </div>
      </div>

      {notice && (
        <div className={`p-4 rounded-2xl border text-xs font-bold flex items-center justify-between gap-3 ${notice.kind === 'ok' ? 'bg-green-50 text-green-700 border-green-100' : 'bg-red-50 text-red-600 border-red-100'}`}>
          <span>{notice.text}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            className="shrink-0 text-lg leading-none opacity-50 hover:opacity-100 transition-opacity"
          >
            ×
          </button>
        </div>
      )}

      <div className="bg-white rounded-3xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b flex items-center gap-3">
          <input
            className="flex-1 p-3.5 border-2 border-gray-100 rounded-xl font-bold bg-gray-50 text-sm focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none transition-all"
            placeholder="Search by email, role, district, device…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest hidden sm:inline">
            {filtered.length} shown
          </span>
        </div>

        {grouped.length === 0 ? (
          <div className="p-16 text-center text-gray-300 italic font-bold text-[11px] uppercase tracking-widest">
            No connected sessions detected.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {grouped.map((acct) => (
              <div key={acct.user_id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <p className="font-black text-gray-800 uppercase tracking-tight truncate">{acct.email}</p>
                    <p className="text-[9px] font-bold text-blue-600 uppercase tracking-widest">
                      {roleLabel(acct.role)} · {acct.devices.length} device{acct.devices.length > 1 ? 's' : ''}
                    </p>
                  </div>
                  <button
                    onClick={() => handleDisconnectAll(acct.user_id, acct.email)}
                    disabled={busyKey === `${acct.user_id}::__all__`}
                    className="text-[9px] font-black uppercase tracking-widest text-red-600 border border-red-100 px-3 py-2 rounded-xl hover:bg-red-600 hover:text-white transition-all disabled:opacity-40"
                  >
                    {busyKey === `${acct.user_id}::__all__` ? 'Sending…' : 'Disconnect all sessions'}
                  </button>
                </div>

                <div className="space-y-2">
                  {acct.devices.map((s) => {
                    const self = s.device_id === myDeviceId;
                    const key = `${s.user_id}::${s.device_id}`;
                    return (
                      <div key={key} className="flex flex-wrap items-center gap-3 bg-gray-50/60 border border-gray-100 rounded-2xl px-4 py-3">
                        <div className="flex-1 min-w-[180px]">
                          <p className="font-black text-sm text-gray-700 uppercase tracking-tight">
                            {s.device_label || 'Unnamed device'}
                            {self && <span className="ml-2 text-[8px] text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded-full">This device</span>}
                          </p>
                          <p className="text-[9px] font-mono text-gray-400 truncate">{s.device_id}</p>
                        </div>
                        <div className="text-[9px] font-bold text-gray-500 uppercase tracking-wider min-w-[110px]">
                          <div>Connected {relative(s.joined_at)}</div>
                          <div className="text-gray-400">Seen {relative(s.last_seen)}</div>
                        </div>
                        <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wider min-w-[100px]">
                          {(s.district || s.region) ? (s.district || `${s.region} region`) : 'National'}
                        </div>
                        <div className="flex items-center gap-2">
                          {self && (
                            <button onClick={() => handleRename(s)} className="text-[9px] font-black uppercase tracking-widest text-blue-600 border border-blue-100 px-3 py-2 rounded-xl hover:bg-blue-600 hover:text-white transition-all">
                              Rename
                            </button>
                          )}
                          <button
                            onClick={() => handleDisconnectDevice(s)}
                            disabled={busyKey === key}
                            className="text-[9px] font-black uppercase tracking-widest text-red-600 border border-red-100 px-3 py-2 rounded-xl hover:bg-red-600 hover:text-white transition-all disabled:opacity-40"
                          >
                            {busyKey === key ? 'Sending…' : 'Disconnect'}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest leading-relaxed">
        Note: disconnect sends a cooperative sign-out signal that the target device honors immediately while connected. It does not revoke the account itself — use User Management to deactivate an account if needed.
      </p>

      <div className="hidden">
        <span>{fmt(new Date().toISOString())}</span>
      </div>
    </div>
  );
};

export default ConnectedUsersPage;
