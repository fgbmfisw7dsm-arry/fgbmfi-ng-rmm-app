import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppContext } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { db } from '../services/supabaseService';
import { SessionResponseType, RESPONSE_TYPE_LABELS, SessionMinistryDashboard } from '../types';
import QRScanner from '../components/QRScanner';
import { useMinistry } from '../hooks/useMinistry';
import { generateCodeFromId } from '../services/utils';

const RESPONSE_TYPES: SessionResponseType[] = [SessionResponseType.FT, SessionResponseType.SLV, SessionResponseType.MI, SessionResponseType.HGB];

const SCAN_ICONS: Record<SessionResponseType, string> = {
  [SessionResponseType.FT]: 'FP',
  [SessionResponseType.SLV]: 'S',
  [SessionResponseType.HGB]: 'H',
  [SessionResponseType.MI]: 'M',
};

const SCAN_COLORS: Record<SessionResponseType, string> = {
  [SessionResponseType.FT]: 'from-amber-500 to-orange-600',
  [SessionResponseType.SLV]: 'from-emerald-500 to-teal-600',
  [SessionResponseType.HGB]: 'from-red-500 to-rose-600',
  [SessionResponseType.MI]: 'from-blue-500 to-indigo-600',
};

const SessionMinistryPage: React.FC = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const isLocked = activeEvent?.is_active === false;

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeScan, setActiveScan] = useState<SessionResponseType | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [manualType, setManualType] = useState<SessionResponseType | null>(null);
  const [manualValue, setManualValue] = useState<string>('');
  const [vdValue, setVdValue] = useState<Record<string, string>>({});
  const [scanCount, setScanCount] = useState(0);
  const [lastScanResult, setLastScanResult] = useState<{ success: boolean; name?: string; message: string } | null>(null);
  const [scanError, setScanError] = useState<string>('');

  const processingRef = useRef(false);
  const scannedIdsRef = useRef<Set<string>>(new Set());

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions', activeEventId],
    queryFn: () => db.getSessions(activeEventId),
    enabled: !!activeEventId,
    staleTime: 300000,
  });

  useEffect(() => {
    if (sessions.length > 0 && !selectedSessionId) {
      setSelectedSessionId(sessions[0].session_id);
    }
  }, [sessions, selectedSessionId]);

  const { dashboard, recordResponse, recordSummary, recordVD } = useMinistry(activeEventId, user);

  const currentDashboard = dashboard.data?.find(d => d.session_id === selectedSessionId);

  const total = (type: SessionResponseType): number => {
    if (!currentDashboard) return 0;
    const scanned = (currentDashboard as any)[`${type.toLowerCase()}_count`] || 0;
    const manual = (currentDashboard as any)[`${type.toLowerCase()}_summary`] || 0;
    return Number(scanned) + Number(manual);
  };

  const parseDelegateIdFromQR = async (code: string): Promise<string | null> => {
    try {
      const parsed = JSON.parse(code);
      if (parsed.delegate_id) return parsed.delegate_id;
      if (parsed.external_id) return parsed.external_id;
    } catch {}
    if (code.length > 4) {
      if (code.length > 10) {
        const { data } = await supabase.from('delegates').select('delegate_id').eq('qr_hash', code).maybeSingle();
        if (data) return data.delegate_id;
      }
      const { data } = await supabase.from('delegates').select('delegate_id').eq('external_id', code).maybeSingle();
      if (data) return data.delegate_id;
      const { data: idMatch } = await supabase.from('delegates').select('delegate_id').eq('delegate_id', code).maybeSingle();
      if (idMatch) return idMatch.delegate_id;
      const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').limit(5000);
      const match = delegates?.find(d => generateCodeFromId(d.delegate_id, activeEventId) === code);
      return match?.delegate_id || null;
    }
    return null;
  };

  const handleScan = useCallback(async (code: string) => {
    if (processingRef.current || !activeScan || !selectedSessionId) return;
    processingRef.current = true;
    setScanError('');

    try {
      const delegateId = await parseDelegateIdFromQR(code);
      if (!delegateId) {
        setLastScanResult({ success: false, message: 'Delegate not found in database' });
        setScanError('Invalid code — delegate not in system');
        setTimeout(() => setLastScanResult(null), 2500);
        return;
      }

      const result = await recordResponse.mutateAsync({
        delegateId, sessionId: selectedSessionId, responseType: activeScan,
      });

      if (result.success) {
        scannedIdsRef.current.add(delegateId);
        setScanCount(prev => prev + 1);
        const { data: del } = await supabase.from('delegates').select('first_name,last_name').eq('delegate_id', delegateId).maybeSingle();
        const name = del ? `${del.first_name} ${del.last_name}` : 'Delegate';
        setLastScanResult({ success: true, name, message: 'Recorded' });
      } else {
        setLastScanResult({ success: false, message: result.message });
      }
    } catch (e: any) {
      setLastScanResult({ success: false, message: e.message || 'Failed to save' });
      setScanError(e.message || 'Save failed');
    } finally {
      processingRef.current = false;
      setTimeout(() => setLastScanResult(null), 2000);
    }
  }, [activeScan, selectedSessionId, recordResponse, activeEventId]);

  const startScan = (type: SessionResponseType) => {
    setActiveScan(type);
    setScanCount(0);
    scannedIdsRef.current = new Set();
    setShowScanner(true);
    setScanError('');
    setLastScanResult(null);
  };

  const stopScan = () => {
    setShowScanner(false);
    setActiveScan(null);
    setScanError('');
    setLastScanResult(null);
    dashboard.refetch();
  };

  const handleManualSave = async () => {
    if (!manualType || !selectedSessionId) return;
    const count = parseInt(manualValue, 10);
    if (isNaN(count) || count < 0) return;
    try {
      await recordSummary.mutateAsync({ sessionId: selectedSessionId, responseType: manualType, totalCount: count });
      setManualType(null);
      setManualValue('');
    } catch {}
  };

  const handleVDSave = async (sessionId: string) => {
    const val = parseInt(vdValue[sessionId] || '', 10);
    if (isNaN(val) || val < 0) return;
    try {
      await recordVD.mutateAsync({ sessionId, total: val });
      setVdValue(prev => ({ ...prev, [sessionId]: '' }));
    } catch {}
  };

  if (!activeEventId) {
    return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Event Context</div>;
  }

  const selectedSession = sessions.find(s => s.session_id === selectedSessionId);

  return (
    <div className="space-y-6">
      {showScanner && activeScan && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col">
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between p-4 bg-black/70">
            <button onClick={stopScan} className="text-white px-4 py-2 rounded-lg bg-white/20 font-bold text-sm uppercase hover:bg-white/30">
              Back
            </button>
            <div className="text-center">
              <span className={`inline-block px-4 py-1 rounded-full text-white text-xs font-black uppercase bg-gradient-to-r ${SCAN_COLORS[activeScan]}`}>
                {RESPONSE_TYPE_LABELS[activeScan]}
              </span>
            </div>
            <div className="w-20 text-right">
              <span className="text-white font-black text-lg">{scanCount}</span>
              <span className="text-white/50 text-xs block">Scanned</span>
            </div>
          </div>

          {lastScanResult && (
            <div className={`absolute top-20 left-1/2 -translate-x-1/2 z-10 px-6 py-3 rounded-xl text-white font-black text-sm text-center shadow-2xl transition-all duration-200 ${lastScanResult.success ? 'bg-green-600' : 'bg-amber-600'}`}>
              {lastScanResult.success ? `${lastScanResult.name} recorded` : lastScanResult.message}
            </div>
          )}

          <div className="flex-1">
            <QRScanner onScan={handleScan} onClose={stopScan} />
          </div>

          {scanError && (
            <div className="absolute bottom-24 left-4 right-4 p-3 bg-red-600 text-white rounded-lg text-xs font-bold text-center">
              {scanError}
            </div>
          )}
        </div>
      )}

      {manualType && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setManualType(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black uppercase text-blue-900 mb-1">Enter Manual Total</h3>
            <p className="text-xs text-gray-500 mb-4">{RESPONSE_TYPE_LABELS[manualType]} | {selectedSession?.title}</p>
            <input
              type="number"
              min="0"
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-lg font-black text-center"
              placeholder="Enter count..."
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleManualSave()}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setManualType(null)} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-black uppercase text-sm">Cancel</button>
              <button onClick={handleManualSave} disabled={recordSummary.isPending} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-black uppercase text-sm hover:bg-blue-700 disabled:opacity-50">
                {recordSummary.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white p-6 rounded-2xl shadow-sm border no-print">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-black uppercase text-blue-900">Session Details Tracking</h2>
            <p className="text-xs text-gray-400 font-bold uppercase tracking-wider mt-1">
              Capture altar call responses via QR scan or manual entry
            </p>
          </div>
          {isLocked && (
            <span className="bg-red-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase shadow-sm">Event Locked</span>
          )}
        </div>

        <div className="mb-6">
          <label className="block text-xs font-black uppercase text-gray-500 tracking-wider mb-2">Active Session</label>
          <select
            className="w-full md:w-96 border-2 border-gray-200 rounded-xl p-3 text-sm font-bold text-blue-900"
            value={selectedSessionId}
            onChange={e => setSelectedSessionId(e.target.value)}
          >
            {sessions.map(s => (
              <option key={s.session_id} value={s.session_id}>{s.title}</option>
            ))}
          </select>
        </div>

        {selectedSessionId && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {RESPONSE_TYPES.map(type => (
              <div key={type} className={`bg-gradient-to-br ${SCAN_COLORS[type]} rounded-2xl p-5 text-white shadow-lg`}>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.15em] opacity-80">{SCAN_ICONS[type]}</span>
                  <span className="text-3xl font-black">{total(type)}</span>
                </div>
                <h3 className="text-sm font-black uppercase tracking-tight mb-1">{RESPONSE_TYPE_LABELS[type]}</h3>
                <div className="flex items-center gap-2 text-[10px] font-bold opacity-70 mb-4">
                  <span>Scan: {Number((currentDashboard as any)?.[`${type.toLowerCase()}_count`] || 0)}</span>
                  <span>|</span>
                  <span>Manual: {Number((currentDashboard as any)?.[`${type.toLowerCase()}_summary`] || 0)}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => startScan(type)}
                    disabled={isLocked}
                    className="flex-1 py-2 rounded-lg bg-white/20 text-white font-black uppercase text-[10px] hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Scan QR
                  </button>
                  <button
                    onClick={() => { setManualType(type); setManualValue(''); }}
                    disabled={isLocked}
                    className="flex-1 py-2 rounded-lg bg-white/20 text-white font-black uppercase text-[10px] hover:bg-white/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Enter #
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {selectedSessionId && (
          <div className="mt-6 p-5 bg-gray-50 rounded-2xl border">
            <h3 className="text-sm font-black uppercase text-gray-600 mb-3">Voice Magazine Distribution</h3>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="0"
                className="flex-1 border-2 border-gray-200 rounded-xl p-3 text-lg font-black text-center"
                placeholder="Total distributed..."
                value={vdValue[selectedSessionId] || ''}
                onChange={e => setVdValue(prev => ({ ...prev, [selectedSessionId]: e.target.value }))}
              />
              <button
                onClick={() => handleVDSave(selectedSessionId)}
                disabled={isLocked || recordVD.isPending}
                className="px-6 py-3 bg-slate-900 text-white rounded-xl font-black uppercase text-sm hover:bg-slate-800 disabled:opacity-40"
              >
                {recordVD.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
            {currentDashboard?.voice_distribution > 0 && (
              <p className="mt-2 text-xs font-bold text-blue-600">Current: {currentDashboard.voice_distribution} copies recorded</p>
            )}
          </div>
        )}
      </div>

      <div className="bg-white p-6 rounded-2xl shadow-sm border">
        <h3 className="text-lg font-black uppercase text-blue-900 mb-4">Sessions Summary (All Sessions)</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-100 uppercase font-black text-gray-500">
              <tr>
                <th className="p-3 text-left rounded-l-lg">Session</th>
                <th className="p-3 text-center">ATT</th>
                <th className="p-3 text-center">FT</th>
                <th className="p-3 text-center">SLV</th>
                <th className="p-3 text-center">MI</th>
                <th className="p-3 text-center">HGB</th>
                <th className="p-3 text-center">VD</th>
                <th className="p-3 text-center rounded-r-lg bg-blue-50">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(dashboard.data || []).map(d => {
                const rowTotal = (d.ft_count + d.ft_summary) + (d.slv_count + d.slv_summary) + (d.mi_count + d.mi_summary) + (d.hgb_count + d.hgb_summary);
                return (
                  <tr key={d.session_id} className={`hover:bg-blue-50 transition-colors ${d.session_id === selectedSessionId ? 'bg-blue-50' : ''}`}>
                    <td className="p-3 font-bold uppercase text-blue-900">{d.session_title}</td>
                    <td className="p-3 text-center font-bold">{d.attendance || '-'}</td>
                    <td className="p-3 text-center font-bold">{d.ft_count + d.ft_summary || '-'}</td>
                    <td className="p-3 text-center font-bold">{d.slv_count + d.slv_summary || '-'}</td>
                    <td className="p-3 text-center font-bold">{d.mi_count + d.mi_summary || '-'}</td>
                    <td className="p-3 text-center font-bold">{d.hgb_count + d.hgb_summary || '-'}</td>
                    <td className="p-3 text-center font-bold">{d.voice_distribution || '-'}</td>
                    <td className="p-3 text-center font-black bg-blue-50 text-blue-900">{rowTotal || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default SessionMinistryPage;
