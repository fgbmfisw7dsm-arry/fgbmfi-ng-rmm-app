import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '../services/supabaseClient';

type ConnectionState = 'connected' | 'degraded' | 'disconnected';

const ConnectionStatus: React.FC = () => {
  const [state, setState] = useState<ConnectionState>('connected');
  const [lastChecked, setLastChecked] = useState<string>('');
  const [queueLength, setQueueLength] = useState(0);

  const checkHealth = useCallback(async () => {
    try {
      const start = performance.now();
      const { error } = await supabase.from('events').select('event_id', { count: 'exact', head: true }).limit(1);
      const latency = performance.now() - start;
      if (error) {
        setState('disconnected');
      } else if (latency > 500) {
        setState('degraded');
      } else {
        setState('connected');
      }
      setLastChecked(new Date().toLocaleTimeString());
    } catch {
      setState('disconnected');
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
      try {
        const raw = localStorage.getItem('fgbmfi_checkin_queue');
        if (raw) {
          setQueueLength(JSON.parse(raw).length);
        } else {
          setQueueLength(0);
        }
      } catch { setQueueLength(0); }
    };
    updateQueue();
    const interval = setInterval(updateQueue, 5000);
    return () => clearInterval(interval);
  }, []);

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
      {queueLength > 0 && (
        <span className="text-[9px] font-black text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full uppercase tracking-widest">
          {queueLength} pending
        </span>
      )}
      <div className={`w-2 h-2 rounded-full ${colorMap[state]} shadow-sm ${state === 'disconnected' ? 'animate-pulse' : ''}`} />
      <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest hidden sm:inline">
        {labelMap[state]}
      </span>
    </div>
  );
};

export default ConnectionStatus;