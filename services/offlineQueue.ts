import { db } from './supabaseService';
import type { User, SessionResponseType } from '../types';

// =============================================================================
// FGBMFI-EMS — Offline Write Queue (v1.82)
// -----------------------------------------------------------------------------
// localStorage queues for arrival/session check-ins and alter-call responses.
//
// v1.82 changes:
//   • Re-entrancy lock — overlapping `online` events cannot double-flush.
//   • Dedupe before flush (same event+delegate+session+type).
//   • Batched flush through `flush_checkins` / `flush_session_responses`
//     (up to 50 items per request) with a per-item classic fallback.
//   • No silent drops: failures are retained with exponential backoff and
//     surfaced as `failed`; the operator can Retry or Discard explicitly.
// =============================================================================

const STORAGE_KEY = 'fgbmfi_checkin_queue';
const SESSION_RESPONSE_KEY = 'fgbmfi_session_response_queue';
const BATCH_SIZE = 50;

type QueueStatus = 'pending' | 'failed';

interface QueuedCheckIn {
  id: string;
  eventId: string;
  delegateId: string;
  registrar: User;
  sessionId?: string;
  timestamp: number;
  retryCount: number;
  status?: QueueStatus;
  permanent?: boolean;
  lastError?: string;
  nextRetryAt?: number;
}

interface QueuedSessionResponse {
  id: string;
  eventId: string;
  delegateId: string;
  sessionId: string;
  responseType: SessionResponseType;
  registrar: User;
  timestamp: number;
  retryCount: number;
  status?: QueueStatus;
  permanent?: boolean;
  lastError?: string;
  nextRetryAt?: number;
}

export interface QueueStats {
  pending: number;
  failed: number;
  total: number;
}

let checkInFlush: Promise<{ flushed: number; failed: number }> | null = null;
let responseFlush: Promise<{ flushed: number; failed: number }> | null = null;
let flushRpcAvailable = true;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function loadQueue<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

function saveQueue<T>(key: string, queue: T[]): void {
  try { localStorage.setItem(key, JSON.stringify(queue)); } catch { /* storage unavailable */ }
}

function notifyQueueChanged(): void {
  try { window.dispatchEvent(new CustomEvent('fgbmfi-queue-changed')); } catch { /* no window */ }
}

function backoffMs(retryCount: number): number {
  return Math.min(30_000 * Math.pow(2, Math.max(0, retryCount)), 10 * 60_000);
}

function isDue(item: { nextRetryAt?: number; status?: QueueStatus }): boolean {
  if (item.status === 'failed') return false;
  return !item.nextRetryAt || item.nextRetryAt <= Date.now();
}

function isFunctionMissing(error: any): boolean {
  const msg = (error?.message || '').toLowerCase();
  return msg.includes('could not find the function')
    || msg.includes('function public.flush_')
    || error?.code === 'PGRST116'
    || error?.code === 'PGRST202';
}

function dedupeCheckIns(queue: QueuedCheckIn[]): QueuedCheckIn[] {
  const byKey = new Map<string, QueuedCheckIn>();
  for (const item of queue) {
    const key = `${item.eventId}|${item.delegateId}|${item.sessionId || 'arrival'}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    // Keep the oldest timestamp (first scan) but preserve retry/failed state.
    const keep = existing.timestamp <= item.timestamp ? existing : item;
    const other = keep === existing ? item : existing;
    byKey.set(key, {
      ...keep,
      retryCount: Math.max(existing.retryCount || 0, item.retryCount || 0),
      status: other.status === 'failed' || keep.status === 'failed' ? 'failed' : keep.status,
      permanent: !!(existing.permanent || item.permanent),
      lastError: keep.lastError || other.lastError,
      nextRetryAt: Math.max(existing.nextRetryAt || 0, item.nextRetryAt || 0) || undefined,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function dedupeResponses(queue: QueuedSessionResponse[]): QueuedSessionResponse[] {
  const byKey = new Map<string, QueuedSessionResponse>();
  for (const item of queue) {
    const key = `${item.eventId}|${item.delegateId}|${item.sessionId}|${item.responseType}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      continue;
    }
    const keep = existing.timestamp <= item.timestamp ? existing : item;
    const other = keep === existing ? item : existing;
    byKey.set(key, {
      ...keep,
      retryCount: Math.max(existing.retryCount || 0, item.retryCount || 0),
      status: other.status === 'failed' || keep.status === 'failed' ? 'failed' : keep.status,
      permanent: !!(existing.permanent || item.permanent),
      lastError: keep.lastError || other.lastError,
      nextRetryAt: Math.max(existing.nextRetryAt || 0, item.nextRetryAt || 0) || undefined,
    });
  }
  return Array.from(byKey.values()).sort((a, b) => a.timestamp - b.timestamp);
}

export function enqueueCheckIn(eventId: string, delegateId: string, registrar: User, sessionId?: string): void {
  const queue = dedupeCheckIns(loadQueue<QueuedCheckIn>(STORAGE_KEY));
  queue.push({
    id: crypto.randomUUID(),
    eventId,
    delegateId,
    registrar,
    sessionId,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending',
  });
  saveQueue(STORAGE_KEY, queue);
  notifyQueueChanged();
}

export function enqueueSessionResponse(eventId: string, delegateId: string, sessionId: string, responseType: SessionResponseType, registrar: User): void {
  const queue = dedupeResponses(loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY));
  queue.push({
    id: crypto.randomUUID(),
    eventId,
    delegateId,
    sessionId,
    responseType,
    registrar,
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending',
  });
  saveQueue(SESSION_RESPONSE_KEY, queue);
  notifyQueueChanged();
}

export function getQueueLength(): number {
  return loadQueue<QueuedCheckIn>(STORAGE_KEY).length;
}

export function getSessionResponseQueueLength(): number {
  return loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY).length;
}

// v1.82-fix4: ids already queued on THIS device so offline search results can be
// marked checked-in/recorded without the network.
export function getQueuedCheckInIds(eventId: string, sessionId?: string): Set<string> {
  const ids = new Set<string>();
  for (const item of loadQueue<QueuedCheckIn>(STORAGE_KEY)) {
    if (item.eventId !== eventId) continue;
    if ((item.sessionId || '') !== (sessionId || '')) continue;
    ids.add(item.delegateId);
  }
  return ids;
}

export function getQueuedSessionResponseIds(eventId: string, sessionId: string): Set<string> {
  const ids = new Set<string>();
  for (const item of loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY)) {
    if (item.eventId === eventId && item.sessionId === sessionId) ids.add(item.delegateId);
  }
  return ids;
}

export function getQueueStats(): QueueStats {
  const checkins = loadQueue<QueuedCheckIn>(STORAGE_KEY);
  const responses = loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY);
  const all = [...checkins, ...responses];
  const failed = all.filter(i => i.status === 'failed').length;
  return { pending: all.length - failed, failed, total: all.length };
}

export function retryFailed(): void {
  const checkins = loadQueue<QueuedCheckIn>(STORAGE_KEY).map(i =>
    i.status === 'failed' ? { ...i, status: 'pending' as QueueStatus, retryCount: 0, permanent: false, nextRetryAt: 0 } : i);
  const responses = loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY).map(i =>
    i.status === 'failed' ? { ...i, status: 'pending' as QueueStatus, retryCount: 0, permanent: false, nextRetryAt: 0 } : i);
  saveQueue(STORAGE_KEY, checkins);
  saveQueue(SESSION_RESPONSE_KEY, responses);
  notifyQueueChanged();
  flushQueueOnConnect();
}

export function discardFailed(): void {
  saveQueue(STORAGE_KEY, loadQueue<QueuedCheckIn>(STORAGE_KEY).filter(i => i.status !== 'failed'));
  saveQueue(SESSION_RESPONSE_KEY, loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY).filter(i => i.status !== 'failed'));
  notifyQueueChanged();
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSION_RESPONSE_KEY);
  notifyQueueChanged();
}

export async function flushQueue(force = false): Promise<{ flushed: number; failed: number }> {
  if (checkInFlush) return checkInFlush;
  checkInFlush = (async () => {
    let queue = dedupeCheckIns(loadQueue<QueuedCheckIn>(STORAGE_KEY));
    if (queue.length === 0) return { flushed: 0, failed: 0 };

    let flushed = 0;
    let failed = 0;

    const due = force ? queue : queue.filter(isDue);
    if (due.length === 0) return { flushed: 0, failed: 0 };

    for (let offset = 0; offset < due.length; offset += BATCH_SIZE) {
      const batch = due.slice(offset, offset + BATCH_SIZE);
      const dueIds = new Set(batch.map(i => i.id));

      let handled = false;
      if (flushRpcAvailable) {
        try {
          const results = await db.flushCheckIns(batch.map(item => ({
            id: item.id,
            event_id: item.eventId,
            delegate_id: item.delegateId,
            session_id: item.sessionId || null,
            registrar_id: item.registrar?.id || null,
          })));
          const resultById = new Map((results || []).map((r: any) => [String(r.id), r]));
          queue = queue.map(item => {
            if (!dueIds.has(item.id)) return item;
            const r: any = resultById.get(item.id);
            if (!r) return item;
            if (r.status === 'ok' || r.status === 'already') { flushed++; return null; }
            if (r.status === 'locked') {
              failed++;
              return { ...item, status: 'failed' as QueueStatus, permanent: true, lastError: r.message || 'Event is read-only' };
            }
            failed++;
            return {
              ...item,
              retryCount: (item.retryCount || 0) + 1,
              lastError: r.message || 'Sync failed',
              nextRetryAt: Date.now() + backoffMs((item.retryCount || 0) + 1),
            };
          }).filter(Boolean) as QueuedCheckIn[];
          handled = true;
        } catch (e: any) {
          if (isFunctionMissing(e)) {
            flushRpcAvailable = false;
          }
        }
      }

      if (!handled) {
        // Classic per-item fallback (also used when the batch RPC is unavailable).
        for (const item of batch) {
          try {
            const res = await db.checkInDelegate(item.eventId, item.delegateId, item.registrar, item.sessionId, { forceOnline: true });
            if (res?.success) {
              flushed++;
              queue = queue.filter(q => q.id !== item.id);
            } else {
              failed++;
              queue = queue.map(q => q.id === item.id ? {
                ...q,
                retryCount: (q.retryCount || 0) + 1,
                lastError: res?.message || 'Sync failed',
                nextRetryAt: Date.now() + backoffMs((q.retryCount || 0) + 1),
              } : q);
            }
          } catch (e: any) {
            const msg = e?.message || 'Sync failed';
            const locked = /EVENT_LOCKED/i.test(msg);
            failed++;
            queue = queue.map(q => {
              if (q.id !== item.id) return q;
              if (locked) return { ...q, status: 'failed' as QueueStatus, permanent: true, lastError: msg };
              return {
                ...q,
                retryCount: (q.retryCount || 0) + 1,
                lastError: msg,
                nextRetryAt: Date.now() + backoffMs((q.retryCount || 0) + 1),
              };
            });
          }
        }
      }

      saveQueue(STORAGE_KEY, queue);
      notifyQueueChanged();
      if (offset + BATCH_SIZE < due.length) await sleep(250);
    }

    return { flushed, failed };
  })().finally(() => { checkInFlush = null; });

  return checkInFlush;
}

export async function flushSessionResponseQueue(force = false): Promise<{ flushed: number; failed: number }> {
  if (responseFlush) return responseFlush;
  responseFlush = (async () => {
    let queue = dedupeResponses(loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY));
    if (queue.length === 0) return { flushed: 0, failed: 0 };

    let flushed = 0;
    let failed = 0;

    const due = force ? queue : queue.filter(isDue);
    if (due.length === 0) return { flushed: 0, failed: 0 };

    for (let offset = 0; offset < due.length; offset += BATCH_SIZE) {
      const batch = due.slice(offset, offset + BATCH_SIZE);
      const dueIds = new Set(batch.map(i => i.id));

      let handled = false;
      if (flushRpcAvailable) {
        try {
          const results = await db.flushSessionResponses(batch.map(item => ({
            id: item.id,
            event_id: item.eventId,
            delegate_id: item.delegateId,
            session_id: item.sessionId,
            response_type: item.responseType,
            registrar_id: item.registrar?.id || null,
          })));
          const resultById = new Map((results || []).map((r: any) => [String(r.id), r]));
          queue = queue.map(item => {
            if (!dueIds.has(item.id)) return item;
            const r: any = resultById.get(item.id);
            if (!r) return item;
            if (r.status === 'ok' || r.status === 'already') { flushed++; return null; }
            if (r.status === 'locked') {
              failed++;
              return { ...item, status: 'failed' as QueueStatus, permanent: true, lastError: r.message || 'Event is read-only' };
            }
            failed++;
            return {
              ...item,
              retryCount: (item.retryCount || 0) + 1,
              lastError: r.message || 'Sync failed',
              nextRetryAt: Date.now() + backoffMs((item.retryCount || 0) + 1),
            };
          }).filter(Boolean) as QueuedSessionResponse[];
          handled = true;
        } catch (e: any) {
          if (isFunctionMissing(e)) {
            flushRpcAvailable = false;
          }
        }
      }

      if (!handled) {
        for (const item of batch) {
          try {
            const res = await db.recordSessionResponse(item.eventId, item.delegateId, item.sessionId, item.responseType, item.registrar, { forceOnline: true });
            if (res?.success) {
              flushed++;
              queue = queue.filter(q => q.id !== item.id);
            } else if (res?.message === 'Already Recorded') {
              flushed++;
              queue = queue.filter(q => q.id !== item.id);
            } else {
              failed++;
              queue = queue.map(q => q.id === item.id ? {
                ...q,
                retryCount: (q.retryCount || 0) + 1,
                lastError: res?.message || 'Sync failed',
                nextRetryAt: Date.now() + backoffMs((q.retryCount || 0) + 1),
              } : q);
            }
          } catch (e: any) {
            const msg = e?.message || 'Sync failed';
            const locked = /EVENT_LOCKED/i.test(msg);
            failed++;
            queue = queue.map(q => {
              if (q.id !== item.id) return q;
              if (locked) return { ...q, status: 'failed' as QueueStatus, permanent: true, lastError: msg };
              return {
                ...q,
                retryCount: (q.retryCount || 0) + 1,
                lastError: msg,
                nextRetryAt: Date.now() + backoffMs((q.retryCount || 0) + 1),
              };
            });
          }
        }
      }

      saveQueue(SESSION_RESPONSE_KEY, queue);
      notifyQueueChanged();
      if (offset + BATCH_SIZE < due.length) await sleep(250);
    }

    return { flushed, failed };
  })().finally(() => { responseFlush = null; });

  return responseFlush;
}

export function flushQueueOnConnect(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const checkins = loadQueue<QueuedCheckIn>(STORAGE_KEY);
  if (checkins.some(isDue)) { flushQueue().catch(() => { /* handled per item */ }); }
  const responses = loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY);
  if (responses.some(isDue)) { flushSessionResponseQueue().catch(() => { /* handled per item */ }); }
}
