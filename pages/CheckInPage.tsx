
import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { db } from '../services/supabaseService';
import { Session, Delegate, UserRole } from '../types';
import { AppContext } from '../context/AppContext';
import { generateCodeFromId } from '../services/utils';

const CheckInPage = () => {
  const { activeEventId, user } = useContext(AppContext);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [results, setResults] = useState<(Delegate & { checkedIn: boolean, code?: string })[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string} | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const localVerifiedIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      setQuery('');
      setResults([]);
      setFeedback(null);
      setCode('');
    };
  }, []);

  const loadSessions = useCallback(async () => {
    if(activeEventId) {
        try {
            const data = await db.getSessions(activeEventId);
            setSessions(data || []);
        } catch (e) {
            console.error("Session load failed:", e);
        }
    }
  }, [activeEventId]);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  const performSearch = useCallback(async () => {
    if (query.trim().length > 1 && activeEventId) {
        try {
            const districtFilter = (user?.role === UserRole.REGISTRAR && user.district) ? user.district : undefined;
            const data = await db.searchDelegates(query, activeEventId, districtFilter, selectedSessionId);
            
            const reconciledData = data.map(d => {
                const key = `${d.delegate_id}_${selectedSessionId || 'arrival'}`;
                const isVerifiedLocally = localVerifiedIds.current.has(key);
                return {
                    ...d,
                    checkedIn: d.checkedIn || isVerifiedLocally,
                    code: d.code || generateCodeFromId(d.delegate_id, activeEventId)
                };
            });
            
            setResults(reconciledData);
        } catch(e: any) { 
            console.error("Search failed:", e); 
        }
    } else if (query.trim().length === 0) { 
        setResults([]); 
    }
  }, [query, activeEventId, selectedSessionId, user]);

  useEffect(() => {
    const timer = setTimeout(performSearch, 400);
    return () => clearTimeout(timer);
  }, [performSearch]);

  const handleManualCheckIn = async (delegateId: string) => {
    if (!activeEventId || !user) {
        alert("Action Blocked: Log in and select an event first.");
        return;
    }
    if (processingId) return;
    
    setProcessingId(delegateId);
    setFeedback({ type: 'success', msg: 'Verifying...' });

    try {
        const res = await db.checkInDelegate(activeEventId, delegateId, user, selectedSessionId);
        if (res && res.success) {
            localVerifiedIds.current.add(`${delegateId}_${selectedSessionId || 'arrival'}`);
            setResults(prev => prev.map(d => 
              d.delegate_id === delegateId ? { ...d, checkedIn: true, code: res.code || generateCodeFromId(delegateId, activeEventId) } : d
            ));
            setFeedback({ type: 'success', msg: 'Verified!' });
            setTimeout(() => setFeedback(null), 2000);
        } else {
            setFeedback({ type: 'error', msg: res.message || 'Verification failed.' });
        }
    } catch (e: any) { 
        console.error("Manual Checkin Error:", e);
        setFeedback({ type: 'error', msg: e.message || "RLS Security Violation or Connection Error" }); 
    } finally {
        setProcessingId(null);
    }
  };

  const handleCodeSubmit = async (codeVal: string) => {
    if(!user || !activeEventId) return;
    setFeedback({ type: 'success', msg: 'Verifying code...' });
    try {
        const res = await db.checkInByCode(activeEventId, codeVal, user, selectedSessionId);
        if(res && res.success) { 
          setFeedback({ type: 'success', msg: 'Verified!' }); 
          setCode(''); 
          performSearch();
        } else { 
          setFeedback({ type: 'error', msg: res.message || 'Invalid or Scoped Code' }); 
        }
        setTimeout(() => setFeedback(null), 3000);
    } catch(e: any) { 
        console.error("Fast Check-in Error:", e);
        setFeedback({ type: 'error', msg: e.message || "Fast check-in rejected" }); 
    }
  };

  const onCodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9]/g, '');
    if (feedback?.type === 'error') setFeedback(null);
    if (val.length <= 4) {
        setCode(val);
        if (val.length === 4) handleCodeSubmit(val);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setFeedback(null);
  };

  if(!activeEventId) return (
    <div className="p-20 text-center flex flex-col items-center gap-6 opacity-60">
        <div className="text-6xl">📍</div>
        <h2 className="text-xl font-black text-blue-900 uppercase">Event Selection Required</h2>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Select an active event in the top header menu to continue.</p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in pb-20 px-4">
       <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
            <h2 className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-[0.2em]">1. Target Verification Scope</h2>
            <select 
                className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-lg text-blue-900 focus:bg-white focus:border-blue-500 outline-none transition-all" 
                value={selectedSessionId} 
                onChange={e => setSelectedSessionId(e.target.value)}
            >
                <option value="">Event Arrival (Master Record)</option>
                {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
            </select>
       </div>
       
       {selectedSessionId && (
           <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-blue-600 animate-in slide-in-from-top-4">
                <h2 className="text-lg font-black mb-4 text-blue-900 uppercase tracking-tighter">2. 4-Digit Fast Check-in</h2>
                <input 
                  className="w-full p-6 text-center text-6xl md:text-8xl font-black tracking-[0.5em] border-2 border-blue-50 rounded-2xl bg-blue-50 focus:bg-white focus:border-blue-500 outline-none transition-all placeholder:text-blue-100 font-mono" 
                  placeholder="0000" 
                  maxLength={4} 
                  value={code} 
                  onChange={onCodeInput} 
                  autoFocus 
                />
                <div className={`h-8 mt-4 text-center font-black uppercase text-xs tracking-widest ${feedback?.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                    {feedback?.msg}
                </div>
           </div>
       )}

       <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
         <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">{selectedSessionId ? '3.' : '2.'} Database Lookup & Manual Verify</h2>
         <div className="relative">
             <input 
               className="w-full p-5 pr-14 text-xl border-2 border-gray-50 rounded-2xl bg-gray-50 focus:bg-white focus:border-blue-500 outline-none font-bold transition-all" 
               placeholder="Search delegate by name or phone..." 
               value={query} 
               onChange={e => {
                 setQuery(e.target.value);
                 if (feedback?.type === 'error') setFeedback(null);
               }} 
             />
             {query && (
                 <button 
                    onClick={clearSearch}
                    className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-full transition-all"
                    title="Clear search"
                 >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
             )}
         </div>
       </div>

       <div className="space-y-4">
         {results.map(d => (
           <div key={d.delegate_id} className={`bg-white p-6 rounded-2xl border-2 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm transition-all ${d.checkedIn ? 'bg-green-50 border-green-200 scale-[0.98]' : 'hover:border-blue-500 border-gray-50'}`}>
              <div className="flex-1 w-full text-left">
                <div className="flex items-center flex-wrap gap-2">
                    <h3 className="font-black text-blue-900 uppercase text-lg leading-tight">{d.title} {d.first_name} {d.last_name}</h3>
                    {/* RESTORED: Rank Badge */}
                    <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">RANK: {d.rank}</span>
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{d.district} DISTRICT • {d.chapter || 'INDIVIDUAL'} • {d.office}</p>
              </div>
              <div className="flex items-center gap-4 w-full md:w-auto justify-end">
                  {d.checkedIn ? (
                    <div className="flex flex-col items-end gap-3">
                        <span className="px-6 py-2 bg-green-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow-lg shadow-green-100 animate-in zoom-in">Verified</span>
                        <div className="text-right flex flex-col items-end">
                           <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest block mb-1">Session Code:</span>
                           <span className="text-3xl font-black text-white tracking-[0.3em] font-mono bg-blue-900 px-6 py-2.5 rounded-2xl shadow-xl inline-block border-2 border-blue-700 animate-in slide-in-from-right-2">
                             {d.code || generateCodeFromId(d.delegate_id, activeEventId)}
                           </span>
                        </div>
                        <button 
                          onClick={clearSearch}
                          className="text-[10px] font-black text-blue-600 uppercase border-b border-blue-200 pb-0.5 mt-1 hover:text-blue-800 transition-colors"
                        >
                          Done & Clear Results
                        </button>
                    </div>
                  ) : (
                    <button 
                      onClick={() => handleManualCheckIn(d.delegate_id)} 
                      disabled={!!processingId}
                      className="w-full md:w-auto px-10 py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-95"
                    >
                        {processingId === d.delegate_id ? 'WAIT...' : 'VERIFY ENTRY'}
                    </button>
                  )}
              </div>
           </div>
         ))}
       </div>
    </div>
  );
};

export default CheckInPage;
