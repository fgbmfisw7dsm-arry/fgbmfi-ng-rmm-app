import { db } from './supabaseService';
import type { User } from '../types';

const STORAGE_KEY = 'fgbmfi_checkin_queue';

interface QueuedCheckIn {
  id: string;
  eventId: string;
  delegateId: string;
  registrar: User;
  sessionId?: string;
  timestamp: number;
  retryCount: number;
}

function loadQueue(): QueuedCheckIn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveQueue(queue: QueuedCheckIn[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

export function enqueueCheckIn(eventId: string, delegateId: string, registrar: User, sessionId?: string): void {
  const queue = loadQueue();
  queue.push({
    id: crypto.randomUUID(),
    eventId,
    delegateId,
    registrar,
    sessionId,
    timestamp: Date.now(),
    retryCount: 0,
  });
  saveQueue(queue);
}

export function getQueueLength(): number {
  return loadQueue().length;
}

export function clearQueue(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function flushQueue(onProgress?: (processed: number, total: number) => void): Promise<{ flushed: number; failed: number }> {
  const queue = loadQueue();
  if (queue.length === 0) return { flushed: 0, failed: 0 };

  let flushed = 0;
  let failed = 0;
  const remaining: QueuedCheckIn[] = [];

  for (const item of queue) {
    try {
      await db.checkInDelegate(item.eventId, item.delegateId, item.registrar, item.sessionId);
      flushed++;
    } catch {
      if (item.retryCount < 10) {
        remaining.push({ ...item, retryCount: item.retryCount + 1 });
      }
      failed++;
    }
    onProgress?.(flushed + failed, queue.length);
  }

  saveQueue(remaining);
  return { flushed, failed };
}

export function flushQueueOnConnect(): void {
  const queue = loadQueue();
  if (queue.length === 0) return;
  flushQueue();
}