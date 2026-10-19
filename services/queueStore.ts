import { encryptText, decryptText } from './offlineRoster';

// =============================================================================
// FGBMFI-EMS — Encrypted Write Queue Store (v1.87)
// -----------------------------------------------------------------------------
// localStorage-backed queues (check-ins, session responses, aggregate session
// writes) are persisted as AES-GCM sealed strings using the same Web Crypto key
// as the offline roster. Consumers keep their existing synchronous API: the
// decrypted queue is held in memory and every write is persisted asynchronously.
//
// Legacy plaintext values are read once, migrated to the sealed form, and
// overwritten. If Web Crypto is unavailable, the store falls back to plaintext
// so a door officer never loses a queued check-in.
// =============================================================================

export type QueueKind = 'checkins' | 'responses' | 'aggregates';

const LS_KEYS: Record<QueueKind, string> = {
  checkins: 'fgbmfi_checkin_queue',
  responses: 'fgbmfi_session_response_queue',
  aggregates: 'fgbmfi_session_aggregate_queue',
};

const KINDS: QueueKind[] = ['checkins', 'responses', 'aggregates'];

interface QueueItem {
  id?: string;
}

const memory: Record<QueueKind, QueueItem[]> = { checkins: [], responses: [], aggregates: [] };
let hydrated = false;
let hydratePromise: Promise<void> | null = null;
let writeChain: Promise<void> = Promise.resolve();

const notify = (): void => {
  try { window.dispatchEvent(new CustomEvent('fgbmfi-queue-changed')); } catch { /* no window */ }
};

const writeNow = async (kind: QueueKind): Promise<void> => {
  const json = JSON.stringify(memory[kind] || []);
  try {
    localStorage.setItem(LS_KEYS[kind], await encryptText(json));
  } catch {
    try { localStorage.setItem(LS_KEYS[kind], json); } catch { /* storage unavailable */ }
  }
};

const mergeItems = (stored: QueueItem[], pending: QueueItem[]): QueueItem[] => {
  if (pending.length === 0) return stored;
  const seen = new Set(stored.map(i => i?.id).filter((id): id is string => !!id));
  return [...stored, ...pending.filter(i => !i?.id || !seen.has(i.id))];
};

export const hydrateQueueStore = (): Promise<void> => {
  if (hydrated) return Promise.resolve();
  if (hydratePromise) return hydratePromise;

  hydratePromise = (async () => {
    const toWrite: QueueKind[] = [];
    for (const kind of KINDS) {
      let stored: QueueItem[] = [];
      let hadRaw = false;
      let decryptFailed = false;
      try {
        const raw = localStorage.getItem(LS_KEYS[kind]);
        if (raw != null) {
          hadRaw = true;
          if (raw.startsWith('v1:')) {
            const plain = await decryptText(raw);
            if (plain == null) {
              decryptFailed = true;
            } else {
              try { stored = JSON.parse(plain) as QueueItem[]; } catch { decryptFailed = true; }
            }
          } else {
            stored = JSON.parse(raw) as QueueItem[];
          }
        }
      } catch {
        decryptFailed = true;
      }

      // Merge anything written before hydration finished (usually nothing, but
      // this prevents a fast scan from being dropped while the store loads).
      const pending = memory[kind] || [];
      memory[kind] = mergeItems(Array.isArray(stored) ? stored : [], pending);
      // Never overwrite a value we could not decrypt — that would destroy the
      // queued check-ins instead of preserving them for a later recovery.
      if (!decryptFailed && (hadRaw || memory[kind].length > 0)) toWrite.push(kind);
    }

    hydrated = true;
    await Promise.all(toWrite.map(kind => writeNow(kind)));
    notify();
  })().catch(() => {
    hydrated = true;
  }).finally(() => {
    hydratePromise = null;
  });

  return hydratePromise;
};

export const getQueue = <T,>(kind: QueueKind): T[] => (memory[kind] || []) as T[];

const schedulePersist = (kind: QueueKind): void => {
  writeChain = writeChain.then(async () => {
    if (!hydrated) return; // hydration will persist the merged state
    await writeNow(kind);
    notify();
  }).catch(() => { /* best effort */ });
};

export const setQueue = <T,>(kind: QueueKind, items: T[]): void => {
  memory[kind] = (Array.isArray(items) ? items : []) as QueueItem[];
  schedulePersist(kind);
};

export const clearQueueStore = (): void => {
  KINDS.forEach(kind => {
    memory[kind] = [];
    try { localStorage.removeItem(LS_KEYS[kind]); } catch { /* storage unavailable */ }
  });
  notify();
};

void hydrateQueueStore();
