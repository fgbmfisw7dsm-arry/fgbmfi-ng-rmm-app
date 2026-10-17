import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';
import { getQueueStats, retryFailed, discardFailed, flushQueueOnConnect } from '../services/offlineQueue';
import { setConnectionState, type ConnectionState } from '../services/connectivity';

const ConnectionStatus: React.FC = () => {
  const [state, setState] = useState<ConnectionState>('connected');
  const [lastChecked, setLastChecked] = useState<string>('');
  const [queue, setQueue] = useState({ pending: 0, failed: 0, total: 0 });

  const checkHealth = useCallback(async () => {
    try {
      const start = performance.now();
      const { error } = await supabase.from('events').select('event_id', { count: 'exact', head: true }).limit(1);
      const latency = performance.now() - start;
      const next: ConnectionState = error ? 'disconnected' : latency > 500 ? 'degraded' : 'connected';
      setState(next);
      setConnectionState(next);
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      setState('disconnected');
      setConnectionState('disconnected');
      setLastChecked(new Date().toLocaleTimeString());
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  useEffect(() => {
    const updateQueue = () => {
      try { setQueue(getQueueStats()); } catch { setQueue({ pending: 0, failed: 0, total: 0 }); }
    };
    updateQueue();
    const interval = setInterval(updateQueue, 5000);
    window.addEventListener('fgbmfi-queue-changed', updateQueue);
    window.addEventListener('online', updateQueue);
    return () => {
      clearInterval(interval);
      window.removeEventListener('fgbmfi-queue-changed', updateQueue);
      window.removeEventListener('online', updateQueue);
    };
  }, []);

  const retryNow = () => {
    retryFailed();
    flushQueueOnConnect();
    try { setQueue(getQueueStats()); } catch { /* ignore */ }
  };

  const discardAllFailed = () => {
    if (!queue.failed) return;
    if (!window.confirm(`Discard ${queue.failed} failed queue item(s)? This cannot be undone.`)) return;
    discardFailed();
    try { setQueue(getQueueStats()); } catch { /* ignore */ }
  };

  const colorMap: Record<ConnectionState, string> = {
    connected: 'bg-green-500',
    degraded: 'bg-yellow-500',
    disconnected: 'bg-red-500',
  };

  const labelMap: Record<ConnectionState, string> = {
    connected: 'Connected',
    degraded: 'Slow Connection',
    disconnected: 'Disconnected',
  };

  return (
    <div className="flex items-center gap-2 ml-auto" title={`${labelMap[state]} — Last checked: ${lastChecked}`}>
      {queue.pending > 0 && (
        <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
          {queue.pending} pending
        </span>
      )}
      {queue.failed > 0 && (
        <span className="text-[9px] font-black text-red-600 bg-red-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
          {queue.failed} failed
        </span>
      )}
      {queue.total > 0 && (
        <button
          type="button"
          onClick={retryNow}
          className="text-[9px] font-black text-blue-600 bg-blue-50 hover:bg-blue-100 px-2 py-0.5 rounded-full uppercase tracking-widest"
          title="Retry pending and failed queue items now"
        >
          Retry
        </button>
      )}
      {queue.failed > 0 && (
        <button
          type="button"
          onClick={discardAllFailed}
          className="text-[9px] font-black text-gray-500 bg-gray-100 hover:bg-gray-200 px-2 py-0.5 rounded-full uppercase tracking-widest"
          title="Discard failed queue items"
        >
          Discard
        </button>
      )}
      <div className={`w-2 h-2 rounded-full ${colorMap[state]} shadow-sm ${state === 'disconnected' ? 'animate-pulse' : ''}`} />
      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest hidden sm:inline">
        {labelMap[state]}
      </span>
    </div>
  );
};

export default ConnectionStatus;
