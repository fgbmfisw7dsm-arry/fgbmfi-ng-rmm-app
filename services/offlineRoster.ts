import { supabase } from './supabaseClient';
import { getScopeFilter } from '../types';
import { normalizePhone, parseQrPayload, familyAwareNameKey, resolveDistrictShortCode, normDistrictKey } from './utils';

// =============================================================================
// FGBMFI-EMS — Encrypted, owner-bound Offline Roster (v1.86)
// -----------------------------------------------------------------------------
// Door-only offline support (QR/manual check-in, session attendance, session
// responses).
//
// Security model:
//   • Roster records are AES-GCM encrypted. The non-extractable AES/HMAC keys
//     live in the same IndexedDB database (best available in a pure web app;
//     this protects raw disk / backups / forensic copies, not same-origin JS).
//   • Every read requires a usable meta record with matching ownerUserId,
//     scopeKey, schema version and a non-expired expiresAt. Missing metadata
//     fails CLOSED (no data), never open.
//   • Meta lives in the same database as the data, so deleting one never leaves
//     the other behind.
//   • The cache expires (72h) and is evicted for a different account or scope.
//   • Offline writes are bounded to a 24h offline window; the window refreshes
//     on every successful sync/reconnect.
//   • The legacy plaintext `roster` store is dropped on the version upgrade.
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
    // Contact fields for offline MANUAL lookup. Email is intentionally NOT
    // cached — phone (and name) are the required search fields.
    phone?: string;
    phone_normalized?: string;
    // Legacy field retained for type compatibility only — email is NOT cached.
    email?: string;
    updated_at?: number;
}

export interface RosterMeta {
    event_id: string;
    owner_user_id: string;
    scope_key: string;
    full_synced_at: number;
    delta_synced_at: number;
    watermark: string | null;
    count: number;
    delta_capable: boolean;
    data_version: number;
    created_at: number;
    expires_at: number;
}

export interface RosterStatus {
    count: number;
    ready: boolean;
    syncing: boolean;
    scopeKey: string;
    lastSync: number;
    lastFullSync: number;
    deltaCapable: boolean;
    expired: boolean;
    windowOpen: boolean;
}

interface EncryptedRosterRecord {
    delegate_id: string;
    event_id: string;
    qr_tag?: string;
    ext_tag?: string;
    updated_ms: number;
    iv: Uint8Array;
    ct: ArrayBuffer;
    v: number;
}

interface RosterIdentity {
    userId: string;
    scopeKey: string;
}

interface CryptoKeys {
    aes: CryptoKey;
    hmac: CryptoKey;
}

const DB_NAME = 'fgbmfi-ems';
const DB_VERSION = 3;
const STORE = 'roster_v2';
const LEGACY_STORE = 'roster';
const META_STORE = 'roster_meta';
const CRYPTO_STORE = 'roster_crypto';
const LEGACY_META_PREFIX = 'fgbmfi_roster_meta:';
const FULL_SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DELTA_MIN_INTERVAL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;
const WATERMARK_OVERLAP_MS = 2 * 60 * 1000;
const JITTER_MAX_MS = 15_000;
const ROSTER_DATA_VERSION = 4;
const ROSTER_TTL_MS = 72 * 60 * 60 * 1000;
const OFFLINE_WINDOW_MAX_MS = 24 * 60 * 60 * 1000;
const DECRYPTED_CACHE_MS = 30_000;

let dbPromise: Promise<IDBDatabase> | null = null;
let keysPromise: Promise<CryptoKeys> | null = null;
let ownershipPromise: Promise<void> | null = null;
let ownershipKey = '';
const inFlight = new Map<string, Promise<void>>();
const decryptedCache = new Map<string, { at: number; entries: OfflineRosterEntry[] }>();

let currentUserId: string | null = null;
let currentScopeKey = '';
let offlineWindow = false;
let offlineOpenedAt = 0;
let offlineBlocked = false;

const OFFLINE_CHANNEL = 'fgbmfi-offline-cache';
let offlineChannel: BroadcastChannel | null = null;
try {
    if (typeof BroadcastChannel !== 'undefined') {
        offlineChannel = new BroadcastChannel(OFFLINE_CHANNEL);
        offlineChannel.onmessage = (event) => {
            if (event?.data?.type !== 'offline-reset') return;
            offlineBlocked = true;
            offlineWindow = false;
            offlineOpenedAt = 0;
            currentUserId = null;
            currentScopeKey = '';
            void closeDb();
        };
    }
} catch { /* BroadcastChannel unavailable */ }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const getOfflineOwnerId = (): string | null => currentUserId;
export const getOfflineScopeKey = (): string => currentScopeKey;

export const getOfflineWindowOpen = (): boolean =>
    !offlineBlocked && offlineWindow && !!currentUserId && (Date.now() - offlineOpenedAt) < OFFLINE_WINDOW_MAX_MS;

export const refreshOfflineWindow = (): void => {
    if (currentUserId && !offlineBlocked) {
        offlineWindow = true;
        offlineOpenedAt = Date.now();
    }
};

export const setOfflineSession = (user: { id: string; role?: string; district?: string; region?: string } | null): void => {
    if (offlineBlocked) return;
    if (!user?.id) {
        offlineWindow = false;
        offlineOpenedAt = 0;
        currentUserId = null;
        currentScopeKey = '';
        void closeDb();
        return;
    }
    const nextScope = scopeKeyOf(getScopeFilter(user));
    const changed = currentUserId !== user.id || currentScopeKey !== nextScope;
    currentUserId = user.id;
    currentScopeKey = nextScope;
    offlineWindow = true;
    offlineOpenedAt = Date.now();
    if (changed) void enforceRosterOwnership(user.id, nextScope);
};

export const scopeKeyOf = (scope?: { district?: string; region?: string }): string => {
    if (scope?.district) return `district:${scope.district.trim().toLowerCase()}`;
    if (scope?.region) return `region:${scope.region.trim().toLowerCase()}`;
    return 'ALL';
};

export const scopeOfUser = (user: { role?: string; district?: string; region?: string } | null | undefined) =>
    getScopeFilter(user || null);

const reqToPromise = <T,>(req: IDBRequest<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

const txDone = (tx: IDBTransaction): Promise<void> =>
    new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });

const removeLegacyMetaKeys = (): void => {
    try {
        Object.keys(localStorage)
            .filter(k => k.startsWith(LEGACY_META_PREFIX))
            .forEach(k => localStorage.removeItem(k));
    } catch { /* storage unavailable */ }
};

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
            // Remove the pre-v1.86 plaintext roster store on upgrade.
            if (db.objectStoreNames.contains(LEGACY_STORE)) db.deleteObjectStore(LEGACY_STORE);

            let store: IDBObjectStore;
            if (!db.objectStoreNames.contains(STORE)) {
                store = db.createObjectStore(STORE, { keyPath: 'delegate_id' });
                store.createIndex('event', 'event_id', { unique: false });
                store.createIndex('qr', ['event_id', 'qr_tag'], { unique: false });
                store.createIndex('ext', ['event_id', 'ext_tag'], { unique: false });
            } else {
                store = req.transaction!.objectStore(STORE);
                if (!store.indexNames.contains('event')) store.createIndex('event', 'event_id', { unique: false });
                if (store.indexNames.contains('qr')) store.deleteIndex('qr');
                if (store.indexNames.contains('ext')) store.deleteIndex('ext');
                store.createIndex('qr', ['event_id', 'qr_tag'], { unique: false });
                store.createIndex('ext', ['event_id', 'ext_tag'], { unique: false });
            }
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'event_id' });
            }
            if (!db.objectStoreNames.contains(CRYPTO_STORE)) {
                db.createObjectStore(CRYPTO_STORE);
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => { try { db.close(); } catch { /* ignore */ } dbPromise = null; };
            removeLegacyMetaKeys();
            resolve(db);
        };
        req.onerror = () => {
            dbPromise = null;
            reject(req.error);
        };
        req.onblocked = () => {
            console.warn('[offlineRoster] IndexedDB upgrade blocked by another tab.');
        };
    });
    return dbPromise;
};

const closeDb = async (): Promise<void> => {
    const pending = dbPromise;
    dbPromise = null;
    keysPromise = null;
    try {
        if (pending) (await pending).close();
    } catch { /* ignore */ }
};

const deleteDb = (): Promise<boolean> =>
    new Promise(resolve => {
        if (typeof indexedDB === 'undefined') { resolve(true); return; }
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            resolve(ok);
        };
        const req = indexedDB.deleteDatabase(DB_NAME);
        req.onsuccess = () => finish(true);
        req.onerror = () => finish(false);
        req.onblocked = () => {
            console.warn('[offlineRoster] deleteDatabase blocked — waiting for open connections to close.');
        };
        setTimeout(() => finish(false), 8000);
    });

export async function purgeOfflineRoster(): Promise<boolean> {
    offlineBlocked = true;
    offlineWindow = false;
    offlineOpenedAt = 0;
    currentUserId = null;
    currentScopeKey = '';
    decryptedCache.clear();
    removeLegacyMetaKeys();
    // The write queues share this Web Crypto key; clear them together so a
    // deleted DB can never leave undecryptable queue payloads behind.
    try {
        ['fgbmfi_checkin_queue', 'fgbmfi_session_response_queue', 'fgbmfi_session_aggregate_queue']
            .forEach(key => localStorage.removeItem(key));
    } catch { /* storage unavailable */ }
    try { offlineChannel?.postMessage({ type: 'offline-reset' }); } catch { /* ignore */ }
    await sleep(250);
    await closeDb();
    return deleteDb();
}

// Kept as the explicit "Reset Connection" entry point.
export async function resetOfflineWindow(): Promise<boolean> {
    return purgeOfflineRoster();
}

// ---------------------------------------------------------------------------
// Web Crypto (AES-GCM + HMAC)
// ---------------------------------------------------------------------------

const isCryptoKey = (value: any): value is CryptoKey =>
    !!value && typeof value === 'object' && 'algorithm' in value && 'type' in value && Array.isArray(value.usages);

const bytesToBase64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
};

const base64ToBytes = (value: string): Uint8Array => {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
};

const readCryptoValue = async (key: string): Promise<any> => {
    const db = await openDb();
    const tx = db.transaction(CRYPTO_STORE, 'readonly');
    return reqToPromise(tx.objectStore(CRYPTO_STORE).get(key));
};

const writeCryptoValue = async (key: string, value: any): Promise<void> => {
    const db = await openDb();
    const tx = db.transaction(CRYPTO_STORE, 'readwrite');
    tx.objectStore(CRYPTO_STORE).put(value, key);
    await txDone(tx);
};

const importAes = (raw: string): Promise<CryptoKey> =>
    crypto.subtle.importKey('raw', base64ToBytes(raw), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

const importHmac = (raw: string): Promise<CryptoKey> =>
    crypto.subtle.importKey('raw', base64ToBytes(raw), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);

const generateAndStoreKeys = async (): Promise<CryptoKeys> => {
    const subtle = crypto.subtle;
    const aes = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']) as CryptoKey;
    const hmac = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign']) as CryptoKey;
    try {
        await writeCryptoValue('aes', aes);
        await writeCryptoValue('hmac', hmac);
        return { aes, hmac };
    } catch {
        // Some WebKit/private-mode builds cannot structured-clone CryptoKey.
        // Fall back to raw key material so offline mode still works. This is
        // weaker than a non-extractable key, but still encrypts the roster at
        // rest against raw disk/backup extraction.
        const aesEx = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']) as CryptoKey;
        const hmacEx = await subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, true, ['sign']) as CryptoKey;
        const aesRaw = bytesToBase64(new Uint8Array(await subtle.exportKey('raw', aesEx)));
        const hmacRaw = bytesToBase64(new Uint8Array(await subtle.exportKey('raw', hmacEx)));
        await writeCryptoValue('aes', aesRaw);
        await writeCryptoValue('hmac', hmacRaw);
        return { aes: await importAes(aesRaw), hmac: await importHmac(hmacRaw) };
    }
};

const getCryptoKeys = (): Promise<CryptoKeys> => {
    if (keysPromise) return keysPromise;
    keysPromise = (async () => {
        if (!crypto?.subtle) throw new Error('Web Crypto unavailable');
        const [aesStored, hmacStored] = await Promise.all([
            readCryptoValue('aes'),
            readCryptoValue('hmac'),
        ]);
        const aes = isCryptoKey(aesStored) ? aesStored
            : typeof aesStored === 'string' ? await importAes(aesStored) : null;
        const hmac = isCryptoKey(hmacStored) ? hmacStored
            : typeof hmacStored === 'string' ? await importHmac(hmacStored) : null;
        if (aes && hmac) return { aes, hmac };
        return generateAndStoreKeys();
    })().catch((e) => {
        keysPromise = null;
        throw e;
    });
    return keysPromise;
};

const enc = new TextEncoder();
const dec = new TextDecoder();

const bytesToHex = (bytes: Uint8Array): string => {
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
};

const hmacTag = async (value: string, keys: CryptoKeys): Promise<string> => {
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', keys.hmac, enc.encode(value.trim())));
    return bytesToHex(sig);
};

const encryptEntry = async (entry: OfflineRosterEntry, keys: CryptoKeys): Promise<{ iv: Uint8Array; ct: ArrayBuffer }> => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        keys.aes,
        enc.encode(JSON.stringify(entry)),
    );
    return { iv, ct };
};

const decryptEntry = async (record: EncryptedRosterRecord, keys: CryptoKeys): Promise<OfflineRosterEntry | null> => {
    try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: record.iv }, keys.aes, record.ct);
        const entry = JSON.parse(dec.decode(plain)) as OfflineRosterEntry;
        if (!entry || typeof entry !== 'object') return null;
        entry.delegate_id = entry.delegate_id || record.delegate_id;
        entry.event_id = entry.event_id || record.event_id;
        return entry;
    } catch {
        return null;
    }
};

const makeRecord = async (entry: OfflineRosterEntry, keys: CryptoKeys): Promise<EncryptedRosterRecord> => {
    const { iv, ct } = await encryptEntry(entry, keys);
    return {
        delegate_id: entry.delegate_id,
        event_id: entry.event_id,
        qr_tag: entry.qr_hash ? await hmacTag(entry.qr_hash, keys) : undefined,
        ext_tag: entry.external_id ? await hmacTag(entry.external_id, keys) : undefined,
        updated_ms: Number(entry.updated_at) || Date.now(),
        iv,
        ct,
        v: 1,
    };
};

// v1.87: shared text sealing for the localStorage write queues. Uses the same
// AES-GCM key as the roster so encrypted queues travel with the roster lifecycle.
const SEAL_PREFIX = 'v1';

export const encryptText = async (plain: string): Promise<string> => {
    const keys = await getCryptoKeys();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keys.aes, enc.encode(plain));
    return `${SEAL_PREFIX}:${bytesToBase64(iv)}:${bytesToBase64(new Uint8Array(ct))}`;
};

export const decryptText = async (payload: string): Promise<string | null> => {
    try {
        const parts = (payload || '').split(':');
        if (parts.length !== 3 || parts[0] !== SEAL_PREFIX) return null;
        const keys = await getCryptoKeys();
        const plain = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToBytes(parts[1]) },
            keys.aes,
            base64ToBytes(parts[2]),
        );
        return dec.decode(plain);
    } catch {
        return null;
    }
};

// ---------------------------------------------------------------------------
// Identity / meta
// ---------------------------------------------------------------------------

const normalizeMeta = (raw: any): RosterMeta | null => {
    if (!raw || typeof raw !== 'object') return null;
    return {
        event_id: String(raw.event_id || ''),
        owner_user_id: String(raw.owner_user_id || ''),
        scope_key: String(raw.scope_key || ''),
        full_synced_at: Number(raw.full_synced_at) || 0,
        delta_synced_at: Number(raw.delta_synced_at) || 0,
        watermark: raw.watermark ? String(raw.watermark) : null,
        count: Number(raw.count) || 0,
        delta_capable: raw.delta_capable !== false,
        data_version: Number(raw.data_version) || 0,
        created_at: Number(raw.created_at) || 0,
        expires_at: Number(raw.expires_at) || 0,
    };
};

export async function getRosterMeta(eventId: string): Promise<RosterMeta | null> {
    if (!eventId) return null;
    try {
        const db = await openDb();
        const tx = db.transaction(META_STORE, 'readonly');
        const raw = await reqToPromise(tx.objectStore(META_STORE).get(eventId));
        return normalizeMeta(raw);
    } catch {
        return null;
    }
}

const saveRosterMeta = async (meta: RosterMeta): Promise<void> => {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readwrite');
    tx.objectStore(META_STORE).put(meta);
    await txDone(tx);
};

const getAllMeta = async (): Promise<RosterMeta[]> => {
    const db = await openDb();
    const tx = db.transaction(META_STORE, 'readonly');
    const rows = await reqToPromise(tx.objectStore(META_STORE).getAll());
    return (rows || []).map(normalizeMeta).filter((m): m is RosterMeta => !!m);
};

const isMetaUsable = (meta: RosterMeta | null, identity: RosterIdentity): meta is RosterMeta =>
    !!meta
    && meta.owner_user_id === identity.userId
    && meta.scope_key === identity.scopeKey
    && meta.data_version === ROSTER_DATA_VERSION
    && meta.expires_at > Date.now();

const resolveIdentity = async (
    user?: { id?: string; role?: string; district?: string; region?: string } | null,
    scopeKey?: string,
): Promise<RosterIdentity | null> => {
    if (offlineBlocked) return null;
    const providedId = user?.id || '';
    if (currentUserId && providedId && currentUserId !== providedId) return null;

    let userId: string | null = currentUserId || providedId || null;
    if (!userId) {
        try {
            const { data } = await supabase.auth.getSession();
            userId = data.session?.user?.id || null;
        } catch { /* offline/no session */ }
        if (userId) currentUserId = userId;
    }

    const providedScope = scopeKey || (user ? scopeKeyOf(getScopeFilter(user)) : '');
    if (currentScopeKey && providedScope && currentScopeKey !== providedScope) return null;

    const resolvedScope = currentScopeKey || providedScope;
    if (!userId || !resolvedScope) return null;
    if (!currentScopeKey) currentScopeKey = resolvedScope;
    return { userId, scopeKey: resolvedScope };
};

const deleteEventRoster = async (eventId: string): Promise<void> => {
    if (!eventId) return;
    try {
        const db = await openDb();
        const tx = db.transaction([STORE, META_STORE], 'readwrite');
        const store = tx.objectStore(STORE);
        const metaStore = tx.objectStore(META_STORE);
        const keys: IDBValidKey[] = [];
        const cursorReq = store.index('event').openKeyCursor(IDBKeyRange.only(eventId));
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
                keys.push(cursor.primaryKey);
                cursor.continue();
                return;
            }
            keys.forEach(key => store.delete(key));
            metaStore.delete(eventId);
        };
        await txDone(tx);
        decryptedCache.delete(eventId);
    } catch { /* best effort */ }
};

const enforceRosterOwnership = (ownerUserId: string, scopeKey: string): Promise<void> => {
    const key = `${ownerUserId}\u0000${scopeKey}`;
    if (ownershipPromise && ownershipKey === key) return ownershipPromise;
    const previous = ownershipPromise || Promise.resolve();
    const next = previous.then(async () => {
        try {
            const metas = await getAllMeta();
            const now = Date.now();
            for (const meta of metas) {
                if (
                    meta.owner_user_id !== ownerUserId
                    || meta.scope_key !== scopeKey
                    || meta.data_version !== ROSTER_DATA_VERSION
                    || meta.expires_at <= now
                ) {
                    await deleteEventRoster(meta.event_id);
                }
            }
        } catch { /* best effort */ }
    }).finally(() => {
        if (ownershipPromise === next) {
            ownershipPromise = null;
            ownershipKey = '';
        }
    });
    ownershipPromise = next;
    ownershipKey = key;
    return next;
};

// ---------------------------------------------------------------------------
// IndexedDB read helpers
// ---------------------------------------------------------------------------

const clearRosterCache = (eventId?: string): void => {
    if (eventId) decryptedCache.delete(eventId);
    else decryptedCache.clear();
};

const countEvent = async (eventId: string): Promise<number> => {
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    return reqToPromise(tx.objectStore(STORE).index('event').count(IDBKeyRange.only(eventId)));
};

const getByTag = async (eventId: string, index: 'qr' | 'ext', value: string): Promise<OfflineRosterEntry | null> => {
    const keys = await getCryptoKeys();
    const tag = await hmacTag(value, keys);
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const raw = await reqToPromise(tx.objectStore(STORE).index(index).get(IDBKeyRange.only([eventId, tag])));
    if (!raw) return null;
    return decryptEntry(raw as EncryptedRosterRecord, keys);
};

const loadEventRoster = async (eventId: string): Promise<OfflineRosterEntry[]> => {
    const cached = decryptedCache.get(eventId);
    if (cached && (Date.now() - cached.at) < DECRYPTED_CACHE_MS) return cached.entries;

    const keys = await getCryptoKeys();
    const db = await openDb();
    const tx = db.transaction(STORE, 'readonly');
    const rows = await new Promise<EncryptedRosterRecord[]>((resolve, reject) => {
        const out: EncryptedRosterRecord[] = [];
        const req = tx.objectStore(STORE).index('event').openCursor(IDBKeyRange.only(eventId));
        req.onsuccess = () => {
            const cursor = req.result;
            if (cursor) { out.push(cursor.value as EncryptedRosterRecord); cursor.continue(); }
            else resolve(out);
        };
        req.onerror = () => reject(req.error);
    });

    const entries: OfflineRosterEntry[] = [];
    for (const row of rows) {
        const entry = await decryptEntry(row, keys);
        if (entry) entries.push(entry);
    }
    decryptedCache.set(eventId, { at: Date.now(), entries });
    return entries;
};

// Atomic: collect keys → delete event rows → put new entries in ONE transaction.
const applyRoster = async (eventId: string, entries: OfflineRosterEntry[], full: boolean): Promise<void> => {
    const keys = await getCryptoKeys();
    const records: EncryptedRosterRecord[] = [];
    for (let i = 0; i < entries.length; i += 500) {
        const chunk = entries.slice(i, i + 500);
        records.push(...await Promise.all(chunk.map(entry => makeRecord(entry, keys))));
    }
    const db = await openDb();
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);

    if (full) {
        const keysToDelete: IDBValidKey[] = [];
        const cursorReq = store.index('event').openKeyCursor(IDBKeyRange.only(eventId));
        cursorReq.onsuccess = () => {
            const cursor = cursorReq.result;
            if (cursor) {
                keysToDelete.push(cursor.primaryKey);
                cursor.continue();
                return;
            }
            keysToDelete.forEach(key => store.delete(key));
            records.forEach(record => store.put(record));
        };
    } else {
        records.forEach(record => store.put(record));
    }

    await txDone(tx);
    clearRosterCache(eventId);
};

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

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
    const run = async (withUpdatedAt: boolean, includeContact: boolean): Promise<FetchResult> => {
        const baseCols = 'delegate_id, event_id, qr_hash, external_id, title, first_name, last_name, district, chapter, delegate_type';
        const contactCols = includeContact ? ', phone, phone_normalized' : '';
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
            if (scope.district) q = q.ilike('district', scope.district);
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
    if (!result.complete && result.entries.length === 0) result = await run(true, false);
    if (!result.complete && result.entries.length === 0) result = await run(false, false);
    return result;
};

const syncRoster = async (
    eventId: string,
    scope: { district?: string; region?: string },
    opts?: { force?: boolean; jitter?: boolean },
    identityArg?: RosterIdentity | null,
): Promise<void> => {
    if (typeof indexedDB === 'undefined' || !eventId) return;

    const scopeKey = scopeKeyOf(scope);
    const identity = identityArg || await resolveIdentity(undefined, scopeKey);
    if (!identity) return;
    if (currentUserId !== identity.userId || currentScopeKey !== identity.scopeKey || offlineBlocked) return;

    const meta = await getRosterMeta(eventId);
    const now = Date.now();
    const ownerChanged = !!meta && meta.owner_user_id !== identity.userId;
    const scopeChanged = !!meta && meta.scope_key !== identity.scopeKey;
    const expired = !!meta && meta.expires_at <= now;
    const versionStale = !meta || meta.data_version !== ROSTER_DATA_VERSION;
    const cold = !meta || ownerChanged || scopeChanged || expired;
    const fullDue = cold || versionStale || meta.delta_capable === false || (now - meta.full_synced_at) > FULL_SYNC_INTERVAL_MS;
    const deltaDue = !!meta && !fullDue && meta.watermark && (now - meta.delta_synced_at) > DELTA_MIN_INTERVAL_MS;

    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (isOffline && !opts?.force) return;

    if (!opts?.force) {
        if (!fullDue && !deltaDue) return;
        if (cold && opts?.jitter !== false) await sleep(Math.random() * JITTER_MAX_MS);
    }

    notifyRosterChanged(eventId);

    try {
        // Never mix another account/scope's rows with this one if the sync fails.
        if (cold) await deleteEventRoster(eventId);

        if (fullDue) {
            const { entries, complete, maxUpdatedAt, deltaCapable } = await fetchRoster(eventId, scope, null);
            if (!complete) {
                console.warn('[offlineRoster] full sync failed — keeping previous snapshot');
                return;
            }
            if (currentUserId !== identity.userId || currentScopeKey !== identity.scopeKey || offlineBlocked) return;
            await applyRoster(eventId, entries, true);
            const watermark = deltaCapable && maxUpdatedAt
                ? new Date(new Date(maxUpdatedAt).getTime() - WATERMARK_OVERLAP_MS).toISOString()
                : null;
            if (currentUserId !== identity.userId || currentScopeKey !== identity.scopeKey || offlineBlocked) return;
            await saveRosterMeta({
                event_id: eventId,
                owner_user_id: identity.userId,
                scope_key: identity.scopeKey,
                full_synced_at: now,
                delta_synced_at: now,
                watermark,
                count: entries.length,
                delta_capable: deltaCapable,
                data_version: ROSTER_DATA_VERSION,
                created_at: now,
                expires_at: now + ROSTER_TTL_MS,
            });
        } else if (deltaDue && meta?.watermark) {
            const { entries, complete, maxUpdatedAt } = await fetchRoster(eventId, scope, meta.watermark);
            if (!complete) {
                console.warn('[offlineRoster] delta sync failed — keeping previous snapshot');
                return;
            }
            if (currentUserId !== identity.userId || currentScopeKey !== identity.scopeKey || offlineBlocked) return;
            if (entries.length > 0) await applyRoster(eventId, entries, false);
            const watermark = maxUpdatedAt
                ? new Date(new Date(maxUpdatedAt).getTime() - WATERMARK_OVERLAP_MS).toISOString()
                : meta.watermark;
            const count = await countEvent(eventId);
            if (currentUserId !== identity.userId || currentScopeKey !== identity.scopeKey || offlineBlocked) return;
            await saveRosterMeta({
                ...meta,
                owner_user_id: identity.userId,
                scope_key: identity.scopeKey,
                delta_synced_at: now,
                watermark,
                count,
                data_version: ROSTER_DATA_VERSION,
                expires_at: now + ROSTER_TTL_MS,
            });
        }
        refreshOfflineWindow();
    } catch (e) {
        console.warn('[offlineRoster] sync failed (offline cache is best-effort):', e);
    } finally {
        notifyRosterChanged(eventId);
    }
};

export async function ensureOfflineRoster(
    eventId: string,
    scope?: { district?: string; region?: string },
    opts?: { force?: boolean; jitter?: boolean },
): Promise<void> {
    if (!eventId) return;
    const scopeKey = scopeKeyOf(scope);
    const identity = await resolveIdentity(undefined, scopeKey);
    if (!identity) return;
    if (ownershipPromise) await ownershipPromise;

    // Opening the door page is an authenticated activity: refresh the rolling
    // offline-write window (it still expires 24h after the last activity/sync).
    refreshOfflineWindow();

    // Let the door pages refresh their status pill even when no network sync is
    // due (the first status read can happen before the identity effect runs).
    notifyRosterChanged(eventId);

    const existing = inFlight.get(eventId);
    if (existing) return existing;
    const p = syncRoster(eventId, scope || {}, opts, identity).finally(() => inFlight.delete(eventId));
    inFlight.set(eventId, p);
    return p;
}

export async function buildOfflineRoster(
    eventId: string,
    scope?: { district?: string; region?: string },
): Promise<void> {
    return ensureOfflineRoster(eventId, scope);
}

export async function getRosterStatus(eventId: string): Promise<RosterStatus> {
    const meta = await getRosterMeta(eventId);
    const identity = await resolveIdentity();
    const usable = !!identity && isMetaUsable(meta, identity);
    let count = 0;
    if (usable) {
        try { count = await countEvent(eventId); } catch { count = meta?.count || 0; }
    }
    const lastFullSync = usable ? (meta?.full_synced_at || 0) : 0;
    const lastDeltaSync = usable ? (meta?.delta_synced_at || 0) : 0;
    return {
        count,
        ready: usable && count > 0,
        syncing: inFlight.has(eventId),
        scopeKey: usable ? (meta?.scope_key || '') : '',
        lastSync: Math.max(lastFullSync, lastDeltaSync),
        lastFullSync,
        deltaCapable: usable ? meta?.delta_capable !== false : true,
        expired: !!meta && meta.expires_at <= Date.now(),
        windowOpen: getOfflineWindowOpen(),
    };
}

export async function getRosterCount(): Promise<number> {
    const identity = await resolveIdentity();
    if (!identity) return 0;
    try {
        const metas = await getAllMeta();
        return metas
            .filter(meta => isMetaUsable(meta, identity))
            .reduce((sum, meta) => sum + (Number(meta.count) || 0), 0);
    } catch {
        return 0;
    }
}

// Resolve a badge code (qr_hash / external_id) locally. Fails closed unless the
// cache belongs to the current account + scope and has not expired.
export async function resolveCodeLocally(
    eventId: string,
    code: string,
    user?: { id?: string; role?: string; district?: string; region?: string } | null,
): Promise<OfflineRosterEntry | null> {
    if (typeof indexedDB === 'undefined' || !eventId) return null;
    const raw = (code || '').trim();
    if (!raw) return null;

    const identity = await resolveIdentity(user);
    if (!identity) return null;
    const meta = await getRosterMeta(eventId);
    if (!isMetaUsable(meta, identity)) return null;

    try {
        if (raw.length > 10) {
            const m = await getByTag(eventId, 'qr', raw);
            if (m && m.event_id === eventId) return m;
        }
        if (raw.length > 4) {
            const m = await getByTag(eventId, 'ext', raw);
            if (m && m.event_id === eventId) return m;
        }
    } catch { /* idb/crypto unavailable */ }
    return null;
}

export const USE_OFFLINE_PAYLOAD_RESOLVE = true;

const rosterFamilyKey = (e: OfflineRosterEntry): string =>
    familyAwareNameKey(e.title, e.first_name, e.last_name);

const pickUniqueRosterMatch = (
    rows: OfflineRosterEntry[],
    famKey: string,
    districtKey: string,
): OfflineRosterEntry | null => {
    if (rows.length === 0) return null;
    const famMatch = famKey ? rows.filter(r => rosterFamilyKey(r) === famKey) : [];
    const pool = famMatch.length > 0 ? famMatch : rows;
    if (pool.length > 1 && districtKey) {
        const districtMatch = pool.filter(r => normDistrictKey(r.district) === districtKey);
        if (districtMatch.length === 1) return districtMatch[0];
    }
    return pool.length === 1 ? pool[0] : null;
};

export async function resolvePayloadLocally(
    eventId: string,
    parsed: Record<string, string> | null,
    user?: { id?: string; role?: string; district?: string; region?: string } | null,
): Promise<OfflineRosterEntry | null> {
    if (typeof indexedDB === 'undefined' || !eventId || !parsed) return null;

    const identity = await resolveIdentity(user);
    if (!identity) return null;
    const meta = await getRosterMeta(eventId);
    if (!isMetaUsable(meta, identity)) return null;

    const ident = (parsed['external_id'] || parsed['reg_id'] || '').trim();
    if (ident.length > 4) {
        const m = await getByTag(eventId, 'ext', ident);
        if (m && m.event_id === eventId) return m;
    }

    const delegateId = (parsed['delegate_id'] || '').trim();
    if (delegateId) {
        const m = await resolveDelegateByIdLocally(eventId, delegateId, user);
        if (m) return m;
    }

    const phone = normalizePhone(parsed['phone']);
    const pFirst = (parsed['first_name'] || '').trim();
    const pLast = (parsed['last_name'] || '').trim();
    const famKey = pFirst && pLast ? familyAwareNameKey(parsed['title'], pFirst, pLast) : '';
    const rawDistrict = (parsed['district'] || '').trim();
    const districtKey = rawDistrict ? normDistrictKey(resolveDistrictShortCode(rawDistrict) || rawDistrict) : '';

    if (!phone && !famKey) return null;

    const all = await loadEventRoster(eventId);

    if (phone) {
        const rows = all.filter(e => e.phone_normalized === phone || normalizePhone(e.phone) === phone);
        const hit = pickUniqueRosterMatch(rows, famKey, districtKey);
        if (hit) return hit;
    }

    if (famKey) {
        const rows = all.filter(e => rosterFamilyKey(e) === famKey);
        const hit = pickUniqueRosterMatch(rows, famKey, districtKey);
        if (hit) return hit;
    }

    return null;
}

export async function resolveBadgeLocally(
    eventId: string,
    code: string,
    user?: { id?: string; role?: string; district?: string; region?: string } | null,
): Promise<OfflineRosterEntry | null> {
    const direct = await resolveCodeLocally(eventId, code, user);
    if (direct) return direct;
    if (!USE_OFFLINE_PAYLOAD_RESOLVE) return null;
    return resolvePayloadLocally(eventId, parseQrPayload(code), user);
}

const normNameText = (s?: string): string =>
    (s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

const safeSearchTok = (s: string): string => s.replace(/[(),%\\]/g, '');

export async function searchRosterLocally(
    eventId: string,
    query: string,
    opts?: { page?: number; pageSize?: number; scopeKey?: string; userId?: string },
): Promise<{ entries: OfflineRosterEntry[]; total: number }> {
    if (typeof indexedDB === 'undefined' || !eventId) return { entries: [], total: 0 };
    const trimmed = (query || '').trim();
    if (trimmed.length < 2) return { entries: [], total: 0 };

    const identity = await resolveIdentity(opts?.userId ? { id: opts.userId } : null, opts?.scopeKey);
    if (!identity) return { entries: [], total: 0 };
    const meta = await getRosterMeta(eventId);
    if (!isMetaUsable(meta, identity)) return { entries: [], total: 0 };

    const all = await loadEventRoster(eventId);

    const tokens = trimmed.toLowerCase().split(/\s+/).map(safeSearchTok).filter(t => t.length > 0).slice(0, 4);
    const fullQ = tokens.join(' ');
    const phoneQ = normalizePhone(trimmed);
    const idQl = safeSearchTok(trimmed).toLowerCase();

    const scored: { entry: OfflineRosterEntry; score: number }[] = [];
    for (const entry of all) {
        const nameNorm = normNameText(`${entry.first_name || ''} ${entry.last_name || ''}`);
        let score = 0;

        if (phoneQ.length >= 7 && entry.phone_normalized && entry.phone_normalized === phoneQ) score = 100;
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

export async function resolveDelegateByIdLocally(
    eventId: string,
    delegateId: string,
    user?: { id?: string; role?: string; district?: string; region?: string } | null,
): Promise<OfflineRosterEntry | null> {
    if (typeof indexedDB === 'undefined' || !eventId || !delegateId) return null;
    const identity = await resolveIdentity(user);
    if (!identity) return null;
    const meta = await getRosterMeta(eventId);
    if (!isMetaUsable(meta, identity)) return null;

    try {
        const keys = await getCryptoKeys();
        const db = await openDb();
        const tx = db.transaction(STORE, 'readonly');
        const raw = await reqToPromise(tx.objectStore(STORE).get(delegateId));
        if (!raw) return null;
        const entry = await decryptEntry(raw as EncryptedRosterRecord, keys);
        if (entry && entry.event_id === eventId) return entry;
    } catch { /* idb/crypto unavailable */ }
    return null;
}

export function getPendingSyncCount(): number {
    return 0;
}

const notifyRosterChanged = (eventId: string): void => {
    try {
        window.dispatchEvent(new CustomEvent('fgbmfi-roster-changed', { detail: { eventId } }));
    } catch { /* no window */ }
};
