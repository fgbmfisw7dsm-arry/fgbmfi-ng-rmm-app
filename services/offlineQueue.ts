import { db } from './supabaseService';
import type { User, SessionResponseType } from '../types';

const STORAGE_KEY = 'fgbmfi_checkin_queue';
const SESSION_RESPONSE_KEY = 'fgbmfi_session_response_queue';

interface QueuedCheckIn {
  id: string;
  eventId: string;
  delegateId: string;
  registrar: User;
  sessionId?: string;
  timestamp: number;
  retryCount: number;
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
}

function loadQueue<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue<T>(key: string, queue: T[]): void {
  localStorage.setItem(key, JSON.stringify(queue));
}

export function enqueueCheckIn(eventId: string, delegateId: string, registrar: User, sessionId?: string): void {
  const queue = loadQueue<QueuedCheckIn>(STORAGE_KEY);
  queue.push({
    id: crypto.randomUUID(),
    eventId,
    delegateId,
    registrar,
    sessionId,
    timestamp: Date.now(),
    retryCount: 0,
  });
  saveQueue(STORAGE_KEY, queue);
}

export function enqueueSessionResponse(eventId: string, delegateId: string, sessionId: string, responseType: SessionResponseType, registrar: User): void {
  const queue = loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY);
  queue.push({
    id: crypto.randomUUID(),
    eventId,
    delegateId,
    sessionId,
    responseType,
    registrar,
    timestamp: Date.now(),
    retryCount: 0,
  });
  saveQueue(SESSION_RESPONSE_KEY, queue);
}

export function getQueueLength(): number {
  return loadQueue<unknown[]>(STORAGE_KEY).length;
}

export function getSessionResponseQueueLength(): number {
  return loadQueue<unknown[]>(SESSION_RESPONSE_KEY).length;
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(SESSION_RESPONSE_KEY);
}

export async function flushQueue(onProgress?: (processed: number, total: number) => void): Promise<{ flushed: number; failed: number }> {
  const queue = loadQueue<QueuedCheckIn>(STORAGE_KEY);
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedCheckIn[] = [];

  for (const item of queue) {
    try {
      await db.checkInDelegate(item.eventId, item.delegateId, item.registrar, item.sessionId, { forceOnline: true });
      flushed++;
    } catch {
      if (item.retryCount < 10) {
        remaining.push({ ...item, retryCount: item.retryCount + 1 });
      }
      failed++;
    }
    onProgress?.(flushed + failed, queue.length);
  }

  saveQueue(STORAGE_KEY, remaining);
  return { flushed, failed };
}

export async function flushSessionResponseQueue(onProgress?: (processed: number, total: number) => void): Promise<{ flushed: number; failed: number }> {
  const queue = loadQueue<QueuedSessionResponse>(SESSION_RESPONSE_KEY);
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedSessionResponse[] = [];

  for (const item of queue) {
    try {
      await db.recordSessionResponse(item.eventId, item.delegateId, item.sessionId, item.responseType, item.registrar, { forceOnline: true });
      flushed++;
    } catch {
      if (item.retryCount < 10) {
        remaining.push({ ...item, retryCount: item.retryCount + 1 });
      }
      failed++;
    }
    onProgress?.(flushed + failed, queue.length);
  }

  saveQueue(SESSION_RESPONSE_KEY, remaining);
  return { flushed, failed };
}

export function flushQueueOnConnect(): void {
  const queue = loadQueue<unknown>(STORAGE_KEY);
  if (queue.length > 0) flushQueue();
  const srQueue = loadQueue<unknown>(SESSION_RESPONSE_KEY);
  if (srQueue.length > 0) flushSessionResponseQueue();
}