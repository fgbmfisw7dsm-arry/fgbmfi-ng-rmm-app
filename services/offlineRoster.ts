import { supabase } from './supabaseClient';

// =============================================================================
// FGBMFI-EMS — Offline Roster Snapshot + Local Resolver (v1.66)
// -----------------------------------------------------------------------------
// Door-only offline support (QR/manual check-in, session attendance, session
// responses, quick-register of unknown delegates). Stores a SLIM per-delegate
// roster in IndexedDB so Passes 1-3 (qr_hash / external_id / delegate_id) can
// resolve a badge code WITHOUT touching the network. Writes are still queued
// and flushed via offlineQueue.ts (same localStorage key, event+delegate+session
// idempotency keys) when connectivity returns.
//   • Storage: IndexedDB db "fgbmfi-ems", store "roster", keyPath delegate_id,
//     index "qr" on qr_hash and "ext" on external_id.
//   • Refresh: buildOfflineRoster(eventId) paginates the event's delegates
//     (server-side paginated, scoped the same way the officer's queries are)
//     and upserts slim rows. Called on login / event switch / realtime and
//     after imports.
//   • Window guard: resolveCodeLocally checks an in-memory sessionSignature;
//     online-only sessions never use offline resolution.
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
    updated_at: number;
}

const DB_NAME = 'fgbmfi-ems';
const DB_VERSION = 1;
const STORE = 'roster';

let dbPromise: Promise<IDBDatabase> | null = null;
let lastRefresh: Record<string, number> = {};
const REFRESH_COOLDOWN_MS = 60_000;

// Offline window guard (D5): a coarse monotonic marker per browser session.
// Reset to false on explicit admin action or when the session refresh timer is
// observed to be exhausted (see resetOfflineWindowBound). While true, offline
// resolution + queueing are permitted.
let offlineWindowOpen = false;
export const getOfflineWindowOpen = (): boolean => offlineWindowOpen;
export const setOfflineWindowOpen = (v: boolean): void => { offlineWindowOpen = v; };

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
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'delegate_id' });
                store.createIndex('qr', 'qr_hash', { unique: false });
                store.createIndex('ext', 'external_id', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result as IDBDatabase);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
};

const tx = async <T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
    });
};

const putBatch = async (entries: OfflineRosterEntry[]): Promise<void> => {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        for (const e of entries) store.put(e);
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
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

const clearEvent = async (eventId: string): Promise<void> => {
    const db = await openDb();
    return new Promise<void>((resolve, reject) => {
        const t = db.transaction(STORE, 'readwrite');
        const store = t.objectStore(STORE);
        const allReq = store.openCursor();
        allReq.onsuccess = () => {
            const cursor = allReq.result;
            if (cursor) {
                if ((cursor.value as OfflineRosterEntry).event_id === eventId) cursor.delete();
                cursor.continue();
            }
        };
        t.oncomplete = () => resolve();
        t.onerror = () => reject(t.error);
    });
};

// D1: slim roster upsert for an event (paginated fetch, same scoping callers use).
// Accepts an optional { district?, region? } scope so district/regional officers only
// cache the delegates they may actually verify (mirrors getScopeFilter semantics).
// Cell value mapped into the roster; failures are tolerated (offline feature is best-effort).
export async function buildOfflineRoster(eventId: string, scope?: { district?: string; region?: string }): Promise<void> {
    if (typeof indexedDB === 'undefined' || !eventId) return;
    const now = Date.now();
    if (lastRefresh[eventId] && now - lastRefresh[eventId] < REFRESH_COOLDOWN_MS) return;
    lastRefresh[eventId] = now;

    try {
        const entries: OfflineRosterEntry[] = [];
        let page = 1;
        const pageSize = 1000;
        while (true) {
            let q = supabase
                .from('delegates')
                .select('delegate_id, event_id, qr_hash, external_id, title, first_name, last_name, district, chapter, delegate_type')
                .eq('event_id', eventId)
                .order('delegate_id')
                .range((page - 1) * pageSize, page * pageSize - 1);
            if (scope?.district) q = q.ilike('district', `%${scope.district}%`);
            else if (scope?.region) q = q.ilike('district', `${scope.region}%`);
            const { data, error } = await q;
            if (error || !data || data.length === 0) break;
            for (const d of data) {
                entries.push({ ...(d as any), updated_at: Date.now() });
            }
            if (data.length < pageSize) break;
            page++;
        }
        if (entries.length > 0) {
            await clearEvent(eventId);
            await putBatch(entries);
        }
    } catch (e) {
        console.warn('[buildOfflineRoster] refresh failed (offline cache is best-effort):', e);
    }
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

// D2: mirror Passes 1-3 against the local roster. Returns the full entry (with
// name/district for the identity snapshot) when a single strong match exists,
// else null.
export async function resolveCodeLocally(eventId: string, code: string): Promise<OfflineRosterEntry | null> {
    if (typeof indexedDB === 'undefined' || !eventId) return null;
    const raw = (code || '').trim();
    if (!raw) return null;
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

// D4: queue-length badge support (counts the same localStorage queue offlineQueue flushes)
export function getPendingSyncCount(): number {
    try {
        const raw = localStorage.getItem('fgbmfi_checkin_queue');
        if (!raw) return 0;
        const q = JSON.parse(raw);
        return Array.isArray(q) ? q.length : 0;
    } catch { return 0; }
}

// D5: force-close the offline window (e.g. after sign-out).
export function resetOfflineWindow(): void {
    offlineWindowOpen = false;
    try {
        if (typeof indexedDB !== 'undefined') {
            indexedDB.deleteDatabase(DB_NAME);
            dbPromise = null;
        }
    } catch { /* noop */ }
}