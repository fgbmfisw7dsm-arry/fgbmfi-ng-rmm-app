import { supabase } from './supabaseClient';
import { getScopeFilter } from '../types';
import { normalizePhone } from './utils';

// =============================================================================
// FGBMFI-EMS — Offline Roster Snapshot + Local Resolver (v1.82)
// -----------------------------------------------------------------------------
// Door-only offline support (QR/manual check-in, session attendance, session
// responses). Stores a SLIM per-delegate roster in IndexedDB so Passes 1-2
// (qr_hash / external_id) can resolve a badge code WITHOUT touching the network.
//
// v1.82 changes:
//   • Built on demand from the door pages (Check-In / Session Ministry), not at
//     login — dashboard-only users never download a roster.
//   • Persisted cooldown + delta sync (`delegates.updated_at` watermark) and a
//     24h full reconcile (evicts deleted delegates).
//   • Atomic replacement (single IndexedDB transaction) — a failed/partial
//     refresh can never truncate a good snapshot.
//   • Scope key guard: a roster cached by a national user is not resolvable by a
//     district/regional user on the same browser.
//   • Single-flight + jittered cold start to avoid reconnect/login herds.
//
// Writes are still queued/flushed via offlineQueue.ts.
// =============================================================================

export interface OfflineRosterEntry {
    delegate_id: string;
    event_id: string;
    qr_hash?: string;
    external_id?: string;
    title?: string;
    first_name?: string;
    last_name?: string;
    district?: string;
    chapter?: string;
    delegate_type?: string;
    // v1.82-fix4: contact fields for offline MANUAL lookup (search by name/phone/email).
    phone?: string;
    phone_normalized?: string;
    email?: string;
    updated_at?: number;
}

export interface RosterMeta {
    scopeKey: string;
    fullSyncedAt: number;
    deltaSyncedAt: number;
    watermark: string | null;
    count: number;
    deltaCapable: boolean;
    dataVersion: number;
}

export interface RosterStatus {
    count: number;
    ready: boolean;
    syncing: boolean;
    scopeKey: string;
    lastSync: number;
    lastFullSync: number;
    deltaCapable: boolean;
}

const DB_NAME = 'fgbmfi-ems';
const DB_VERSION = 2;
const STORE = 'roster';
const META_PREFIX = 'fgbmfi_roster_meta:';
const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DELTA_MIN_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000;
const JITTER_MAX_MS = 15_000;
// v1.82-fix4: bump to force one full resync so existing caches gain phone/email
// (required for offline manual lookup). Version 3 = contact fields present.
const ROSTER_DATA_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;
const inFlight = new Map<string, Promise<void>>();

let offlineWindow = false;
export const getOfflineWindowOpen = (): boolean => offlineWindow;
export const setOfflineWindowOpen = (v: boolean): void => { offlineWindow = v; };

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB unavailable'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            let store: IDBObjectStore;
            if (!db.objectStoreNames.contains(STORE)) {
                store = db.createObjectStore(STORE, { keyPath: 'delegate_id' });
                store.createIndex('qr', 'qr_hash', { unique: false });
                store.createIndex('ext', 'external_id', { unique: false });
                store.createIndex('event', 'event_id', { unique: false });
            } else {
                store = req.transaction!.objectStore(STORE);
                if (!store.indexNames.contains('qr')) store.createIndex('qr', 'qr_hash', { unique: false });
                if (!store.indexNames.contains('ext')) store.createIndex('ext', 'external_id', { unique: false });
                if (!store.indexNames.contains('event')) store.createIndex('event', 'event_id', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result as IDBDatabase);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
};

const keyFor = (eventId: string) => `${META_PREFIX}${eventId}`;

export const scopeKeyOf = (scope?: { district?: string; region?: string }): string => {
    if (scope?.district) return `district:${scope.district.trim().toLowerCase()}`;
    if (scope?.region) return `region:${scope.region.trim().toLowerCase()}`;
    return 'ALL';
};

export const scopeOfUser = (user: { role?: string; district?: string; region?: string } | null | undefined) =>
    getScopeFilter(user || null);

export const getRosterMeta = (eventId: string): RosterMeta | null => {
    try {
        const raw = localStorage.getItem(keyFor(eventId));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return null;
        return {
            scopeKey: String(parsed.scopeKey || 'ALL'),
            fullSyncedAt: Number(parsed.fullSyncedAt) || 0,
            deltaSyncedAt: Number(parsed.deltaSyncedAt) || 0,
            watermark: parsed.watermark ? String(parsed.watermark) : null,
            count: Number(parsed.count) || 0,
            deltaCapable: parsed.deltaCapable !== false,
            dataVersion: Number(parsed.dataVersion) || 0,
        };
    } catch {
        return null;
    }
};

const saveRosterMeta = (eventId: string, meta: RosterMeta): void => {
    try { localStorage.setItem(keyFor(eventId), JSON.stringify(meta)); } catch { /* storage unavailable */ }
};

const notifyRosterChanged = (eventId: string): void => {
    try {
        window.dispatchEvent(new CustomEvent('fgbmfi-roster-changed', { detail: { eventId } }));
    } catch { /* no window */ }
};

const getByIndex = async (index: string, value: string): Promise<OfflineRosterEntry | null> => {
    const db = await openDb();
    return new Promise<OfflineRosterEntry | null>((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).index(index).get(value);
        req.onsuccess = () => resolve((req.result as OfflineRosterEntry) || null);
        req.onerror = () => reject(req.error);
    });
};

const countEvent = async (eventId: string): Promise<number> => {
    const db = await openDb();
    return new Promise<number>((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).index('event').count(IDBKeyRange.only(eventId));
        req.onsuccess = () => resolve(req.result as number);
        req.onerror = () => reject(req.error);
    });
};

// Atomic: collect keys → delete event rows → put new entries in ONE transaction.
// If anything fails the transaction aborts and the previous snapshot survives.
const applyRoster = async (eventId: string, entries: OfflineRosterEntry[], full: boolean): Promise<void> => {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);

        if (full) {
            const keys: IDBValidKey[] = [];
            const cursorReq = store.index('event').openKeyCursor(IDBKeyRange.only(eventId));
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (cursor) {
                    keys.push(cursor.primaryKey);
                    cursor.continue();
                    return;
                }
                for (const key of keys) store.delete(key);
                for (const entry of entries) store.put(entry);
            };
        } else {
            for (const entry of entries) store.put(entry);
        }

        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
    });
};

interface FetchResult {
    entries: OfflineRosterEntry[];
    complete: boolean;
    maxUpdatedAt: string | null;
    deltaCapable: boolean;
}

const fetchRoster = async (
    eventId: string,
    scope: { district?: string; region?: string },
    watermark: string | null,
): Promise<FetchResult> => {
    const entries: OfflineRosterEntry[] = [];

    // v1.82-fix4: `includeContact` adds phone/email (offline manual lookup).
    // Fallback ladder: rich+updated_at → rich-without-updated_at is NOT needed;
    // try rich+updated_at, then base+updated_at (older DB without contact cols),
    // then base (oldest DB) — so delta sync survives wherever updated_at exists.
    const run = async (withUpdatedAt: boolean, includeContact: boolean): Promise<FetchResult> => {
        const baseCols = 'delegate_id, event_id, qr_hash, external_id, title, first_name, last_name, district, chapter, delegate_type';
        const contactCols = includeContact ? ', phone, phone_normalized, email' : '';
        const cols = baseCols + contactCols + (withUpdatedAt ? ', updated_at' : '');
        let from = 0;
        const collected: OfflineRosterEntry[] = [];
        let maxSeen: string | null = null;
        while (true) {
            let q = supabase
                .from('delegates')
                .select(cols)
                .eq('event_id', eventId)
                .order('delegate_id')
                .range(from, from + PAGE_SIZE - 1);
            if (scope.district) q = q.ilike('district', `%${scope.district}%`);
            else if (scope.region) q = q.ilike('district', `${scope.region}%`);
            if (withUpdatedAt && watermark) q = q.gt('updated_at', watermark);

            const { data, error } = await q;
            if (error) {
                return { entries: collected, complete: false, maxUpdatedAt: maxSeen, deltaCapable: withUpdatedAt };
            }
            if (!data || data.length === 0) break;
            for (const d of data) {
                const row = d as any;
                collected.push({ ...row, updated_at: Date.now() });
                if (withUpdatedAt && row.updated_at && (!maxSeen || String(row.updated_at) > maxSeen)) {
                    maxSeen = String(row.updated_at);
                }
            }
            if (data.length < PAGE_SIZE) break;
            from += PAGE_SIZE;
        }
        return { entries: collected, complete: true, maxUpdatedAt: maxSeen, deltaCapable: withUpdatedAt };
    };

    let result = await run(true, true);
    if (!result.complete && result.entries.length === 0) {
        // Contact columns or `updated_at` not deployed yet — degrade gracefully.
        result = await run(true, false);
    }
    if (!result.complete && result.entries.length === 0) {
        result = await run(false, false);
    }
    entries.push(...result.entries);
    return { entries, complete: result.complete, maxUpdatedAt: result.maxUpdatedAt, deltaCapable: result.deltaCapable };
};

const syncRoster = async (
    eventId: string,
    scope: { district?: string; region?: string },
    opts?: { force?: boolean; jitter?: boolean },
): Promise<void> => {
    if (typeof indexedDB === 'undefined' || !eventId) return;

    const scopeKey = scopeKeyOf(scope);
    const meta = getRosterMeta(eventId);
    const now = Date.now();

    const scopeChanged = !!meta && meta.scopeKey !== scopeKey;
    const versionStale = !meta || (meta.dataVersion || 0) !== ROSTER_DATA_VERSION;
    const cold = !meta;
    const fullDue = !meta || versionStale || scopeChanged || meta.deltaCapable === false || (now - meta.fullSyncedAt) > FULL_SYNC_INTERVAL_MS;
    const deltaDue = !!meta && !fullDue && meta.watermark && (now - meta.deltaSyncedAt) > DELTA_MIN_INTERVAL_MS;

    if (!opts?.force) {
        if (!fullDue && !deltaDue) return;
        if (cold && opts?.jitter !== false) await sleep(Math.random() * JITTER_MAX_MS);
    }

    notifyRosterChanged(eventId);

    try {
        if (fullDue) {
            const { entries, complete, maxUpdatedAt, deltaCapable } = await fetchRoster(eventId, scope, null);
            if (!complete) {
                console.warn('[offlineRoster] full sync failed — keeping previous snapshot');
                return;
            }
            await applyRoster(eventId, entries, true);
            const watermark = deltaCapable && maxUpdatedAt
                ? new Date(new Date(maxUpdatedAt).getTime() - WATERMARK_OVERLAP_MS).toISOString()
                : null;
            saveRosterMeta(eventId, {
                scopeKey,
                fullSyncedAt: now,
                deltaSyncedAt: now,
                watermark,
                count: entries.length,
                deltaCapable,
                dataVersion: ROSTER_DATA_VERSION,
            });
        } else if (deltaDue && meta?.watermark) {
            const { entries, complete, maxUpdatedAt } = await fetchRoster(eventId, scope, meta.watermark);
            if (!complete) {
                console.warn('[offlineRoster] delta sync failed — keeping previous snapshot');
                return;
            }
            if (entries.length > 0) await applyRoster(eventId, entries, false);
            const watermark = maxUpdatedAt
                ? new Date(new Date(maxUpdatedAt).getTime() - WATERMARK_OVERLAP_MS).toISOString()
                : meta.watermark;
            const count = await countEvent(eventId);
            saveRosterMeta(eventId, {
                ...meta,
                deltaSyncedAt: now,
                watermark,
                count,
                dataVersion: ROSTER_DATA_VERSION,
            });
        }

        try {
            const storage = navigator.storage;
            if (storage?.persist) await storage.persist();
        } catch { /* best effort */ }
    } catch (e) {
        console.warn('[offlineRoster] sync failed (offline cache is best-effort):', e);
    } finally {
        notifyRosterChanged(eventId);
    }
};

// Single-flight per event. `force` skips jitter/cooldown (Refresh / Prepare offline).
export async function ensureOfflineRoster(
    eventId: string,
    scope?: { district?: string; region?: string },
    opts?: { force?: boolean; jitter?: boolean },
): Promise<void> {
    if (!eventId) return;
    const existing = inFlight.get(eventId);
    if (existing) return existing;
    const p = syncRoster(eventId, scope || {}, opts).finally(() => inFlight.delete(eventId));
    inFlight.set(eventId, p);
    return p;
}

// Backwards-compatible entry point (used by db.refreshOfflineRoster).
export async function buildOfflineRoster(
    eventId: string,
    scope?: { district?: string; region?: string },
): Promise<void> {
    return ensureOfflineRoster(eventId, scope);
}

export async function getRosterStatus(eventId: string): Promise<RosterStatus> {
    const meta = getRosterMeta(eventId);
    let count = 0;
    try { count = await countEvent(eventId); } catch { count = meta?.count || 0; }
    const lastFullSync = meta?.fullSyncedAt || 0;
    const lastDeltaSync = meta?.deltaSyncedAt || 0;
    return {
        count,
        ready: count > 0,
        syncing: inFlight.has(eventId),
        scopeKey: meta?.scopeKey || '',
        lastSync: Math.max(lastFullSync, lastDeltaSync),
        lastFullSync,
        deltaCapable: meta?.deltaCapable !== false,
    };
}

export async function getRosterCount(): Promise<number> {
    const db = await openDb();
    return new Promise<number>((resolve, reject) => {
        const t = db.transaction(STORE, 'readonly');
        const req = t.objectStore(STORE).count();
        req.onsuccess = () => resolve(req.result as number);
        req.onerror = () => reject(req.error);
    });
}

// Resolve a badge code (qr_hash / external_id) locally. Refuses when the cached
// roster's scope does not match the caller's scope (shared-device safety).
export async function resolveCodeLocally(
    eventId: string,
    code: string,
    user?: { role?: string; district?: string; region?: string } | null,
): Promise<OfflineRosterEntry | null> {
    if (typeof indexedDB === 'undefined' || !eventId) return null;
    const raw = (code || '').trim();
    if (!raw) return null;

    const meta = getRosterMeta(eventId);
    if (meta && user) {
        const expected = scopeKeyOf(getScopeFilter(user));
        if (meta.scopeKey !== expected) return null;
    }

    try {
        if (raw.length > 10) {
            const m = await getByIndex('qr', raw);
            if (m && m.event_id === eventId) return m;
        }
        if (raw.length > 4) {
            const m = await getByIndex('ext', raw);
            if (m && m.event_id === eventId) return m;
        }
    } catch { /* idb unavailable */ }
    return null;
}

// v1.82-fix4: local (offline) MANUAL LOOKUP. Mirrors the shipped v1.74 search
// semantics — tokenized word-prefix on name; selective exact identifier match on
// phone/email/external_id/delegate_id. The roster is scope-built already, so the
// caller passes its scopeKey purely as a shared-device safety guard.
const normNameText = (s?: string): string =>
    (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const safeSearchTok = (s: string): string => s.replace(/[(),%\\]/g, '');

export async function searchRosterLocally(
    eventId: string,
    query: string,
    opts?: { page?: number; pageSize?: number; scopeKey?: string },
): Promise<{ entries: OfflineRosterEntry[]; total: number }> {
    if (typeof indexedDB === 'undefined' || !eventId) return { entries: [], total: 0 };
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) return { entries: [], total: 0 };

    const meta = getRosterMeta(eventId);
    if (meta && opts?.scopeKey && meta.scopeKey !== opts.scopeKey) return { entries: [], total: 0 };

    const all = await new Promise<OfflineRosterEntry[]>((resolve, reject) => {
        openDb().then(db => {
            const out: OfflineRosterEntry[] = [];
            const t = db.transaction(STORE, 'readonly');
            const req = t.objectStore(STORE).index('event').openCursor(IDBKeyRange.only(eventId));
            req.onsuccess = () => {
                const cursor = req.result;
                if (cursor) { out.push(cursor.value as OfflineRosterEntry); cursor.continue(); }
                else resolve(out);
            };
            req.onerror = () => reject(req.error);
        }).catch(reject);
    });

    const tokens = trimmed.toLowerCase().split(/\s+/).map(safeSearchTok).filter(t => t.length > 0).slice(0, 4);
    const fullQ = tokens.join(' ');
    const phoneQ = normalizePhone(trimmed);
    const emailQ = trimmed.toLowerCase();
    const idQl = safeSearchTok(trimmed).toLowerCase();

    const scored: { entry: OfflineRosterEntry; score: number }[] = [];
    for (const entry of all) {
        const nameNorm = normNameText(`${entry.first_name || ''} ${entry.last_name || ''}`);
        let score = 0;

        // Selective identifiers (whole-query only — never tokenized).
        if (phoneQ.length >= 7 && entry.phone_normalized && entry.phone_normalized === phoneQ) score = 100;
        else if (emailQ.includes('@') && entry.email && entry.email.toLowerCase() === emailQ) score = 100;
        else if (idQl && entry.external_id && entry.external_id.toLowerCase() === idQl) score = 100;
        else if (idQl && entry.delegate_id && entry.delegate_id.toLowerCase() === idQl) score = 100;
        else if (idQl.length >= 6 && entry.external_id && entry.external_id.toLowerCase().startsWith(idQl)) score = 95;

        if (!score && nameNorm && fullQ) {
            if (nameNorm === fullQ) score = 90;
            else if (nameNorm.startsWith(fullQ + ' ')) score = 80;
        }
        if (!score && nameNorm && tokens.length > 0) {
            const words = nameNorm.split(' ');
            if (tokens.length === 1) {
                if (words.some(w => w === tokens[0])) score = 55;
                else if (words.some(w => w.startsWith(tokens[0]))) score = 50;
            } else if (tokens.every(t => words.some(w => w.startsWith(t)))) {
                score = 60;
            }
        }

        if (score > 0) scored.push({ entry, score });
    }

    scored.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const al = (a.entry.last_name || '').toLowerCase();
        const bl = (b.entry.last_name || '').toLowerCase();
        if (al !== bl) return al < bl ? -1 : 1;
        const af = (a.entry.first_name || '').toLowerCase();
        const bf = (b.entry.first_name || '').toLowerCase();
        return af < bf ? -1 : af > bf ? 1 : 0;
    });

    const total = scored.length;
    const page = Math.max(1, opts?.page || 1);
    const pageSize = Math.max(1, opts?.pageSize || 25);
    const offset = (page - 1) * pageSize;
    return { entries: scored.slice(offset, offset + pageSize).map(s => s.entry), total };
}

export function getPendingSyncCount(): number {
    try {
        const raw = localStorage.getItem('fgbmfi_checkin_queue');
        if (!raw) return 0;
        const q = JSON.parse(raw);
        return Array.isArray(q) ? q.length : 0;
    } catch { return 0; }
}

export function resetOfflineWindow(): void {
    offlineWindow = false;
    try {
        if (typeof indexedDB !== 'undefined') {
            indexedDB.deleteDatabase(DB_NAME);
            dbPromise = null;
        }
        Object.keys(localStorage)
            .filter(k => k.startsWith(META_PREFIX))
            .forEach(k => localStorage.removeItem(k));
    } catch { /* noop */ }
}
