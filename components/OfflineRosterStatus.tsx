import React, { useCallback, useEffect, useRef, useState } from 'react';
import { db } from '../services/supabaseService';
import { subscribeConnection, type ConnectionState } from '../services/connectivity';
import type { RosterStatus } from '../services/offlineRoster';

// v1.82: compact offline-roster status pill for the door pages (Check-In /
// Session Ministry). Replaces the old always-on full-width bar: a single small
// pill whose colour is the readiness signal, expanding on tap to count/age and a
// manual "Prepare Offline". Auto-opens only when the cache is missing while
// offline (the one case where the operator must act).
const STALE_MS = 12 * 60 * 60 * 1000;

const rosterAge = (ts: number): string => {
    if (!ts) return 'never';
    const mins = Math.floor((Date.now() - ts) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
};

interface OfflineRosterStatusProps {
    eventId: string;
    scope?: { district?: string; region?: string };
    className?: string;
}

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex items-center justify-between gap-3">
        <dt className="text-slate-400 font-bold uppercase tracking-wider text-[9px]">{label}</dt>
        <dd className="text-slate-700 font-black">{value}</dd>
    </div>
);

const OfflineRosterStatus: React.FC<OfflineRosterStatusProps> = ({ eventId, scope, className }) => {
    const [roster, setRoster] = useState<RosterStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [open, setOpen] = useState(false);
    const [connection, setConnection] = useState<ConnectionState>('connected');
    const wasCritical = useRef(false);

    const refreshStatus = useCallback(async () => {
        if (!eventId) return;
        try { setRoster(await db.getOfflineRosterStatus(eventId)); } catch { /* best effort */ }
    }, [eventId]);

    useEffect(() => subscribeConnection(setConnection), []);

    useEffect(() => {
        if (!eventId) return;
        void refreshStatus();
        void db.ensureOfflineRoster(eventId, scope);
        const onRoster = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (!detail?.eventId || detail.eventId === eventId) void refreshStatus();
        };
        const onOnline = () => {
            void refreshStatus();
            void db.ensureOfflineRoster(eventId, scope);
        };
        window.addEventListener('fgbmfi-roster-changed', onRoster);
        window.addEventListener('online', onOnline);
        return () => {
            window.removeEventListener('fgbmfi-roster-changed', onRoster);
            window.removeEventListener('online', onOnline);
        };
    }, [eventId, scope?.district, scope?.region, refreshStatus]);

    const ready = !!roster?.ready;
    const syncing = busy || !!roster?.syncing;
    const stale = ready && !!roster && (Date.now() - roster.lastSync) > STALE_MS;
    const critical = !ready && connection === 'disconnected';

    useEffect(() => {
        if (critical && !wasCritical.current) setOpen(true);
        wasCritical.current = critical;
    }, [critical]);

    const prepare = async () => {
        if (!eventId) return;
        setBusy(true);
        try {
            await db.ensureOfflineRoster(eventId, scope, { force: true, jitter: false });
            await refreshStatus();
        } finally {
            setBusy(false);
        }
    };

    const dotClass = syncing
        ? 'bg-amber-500 animate-pulse'
        : critical
            ? 'bg-red-500 animate-pulse'
            : (!ready || stale)
                ? 'bg-amber-500'
                : 'bg-green-500';

    const label = syncing
        ? 'Offline: preparing…'
        : critical
            ? 'Offline: missing'
            : !ready
                ? 'Offline: not ready'
                : stale
                    ? `Offline: ${roster!.count.toLocaleString()} · stale`
                    : `Offline: ${roster!.count.toLocaleString()} · ${rosterAge(roster!.lastSync)}`;

    return (
        <div className={`relative inline-block no-print ${className || ''}`}>
            <button
                type="button"
                onClick={() => setOpen(v => !v)}
                title="Offline roster status — tap for details"
                className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-slate-200 bg-white/80 hover:bg-slate-50 text-[9px] font-black uppercase tracking-widest text-slate-600 shadow-sm"
            >
                <span className={`w-2 h-2 rounded-full ${dotClass}`} />
                {label}
                <svg className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {open && (
                <div className="absolute left-0 top-full mt-2 z-30 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white shadow-xl p-4 text-left">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-500">Offline Roster</p>
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="text-[9px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-700"
                        >
                            Close
                        </button>
                    </div>
                    <dl className="mt-3 space-y-1.5 text-[11px]">
                        <Row label="Cached" value={roster ? roster.count.toLocaleString() : '0'} />
                        <Row label="Last refresh" value={roster ? rosterAge(roster.lastSync) : 'never'} />
                        <Row label="Full sync" value={roster ? rosterAge(roster.lastFullSync) : 'never'} />
                        <Row
                            label="Status"
                            value={syncing ? 'Preparing' : ready ? 'Ready' : critical ? 'Missing' : 'Not ready'}
                        />
                    </dl>
                    {!ready && (
                        <p className="mt-3 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
                            QR scans cannot be verified offline until the roster is prepared. Build it while you still have signal.
                        </p>
                    )}
                    {ready && stale && (
                        <p className="mt-3 text-[10px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 leading-relaxed">
                            Roster is older than 12h — refresh it before the session.
                        </p>
                    )}
                    <button
                        type="button"
                        onClick={prepare}
                        disabled={syncing}
                        className="mt-3 w-full px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black uppercase tracking-widest hover:bg-slate-700 disabled:opacity-50"
                    >
                        {syncing ? 'Preparing…' : 'Prepare Offline'}
                    </button>
                </div>
            )}
        </div>
    );
};

export default OfflineRosterStatus;
