import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppContext } from '../context/AppContext';
import { supabase } from '../services/supabaseClient';
import { db } from '../services/supabaseService';
import { SessionResponseType, RESPONSE_TYPE_LABELS, Delegate, Chapter, getScopeFilter, isAdminRole, isRegistrarRole } from '../types';
import QRScanner from '../components/QRScanner';
import { useMinistry } from '../hooks/useMinistry';
import { generateCodeFromId, exportToPDF, exportToCSV } from '../services/utils';

const RESPONSE_TYPES: SessionResponseType[] = [SessionResponseType.FT, SessionResponseType.SLV, SessionResponseType.MI, SessionResponseType.HGB];

const SessionMinistryPage: React.FC = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const queryClient = useQueryClient();
  const isLocked = activeEvent?.is_active === false;
  const isAdmin = isAdminRole(user?.role || '');
  const isRegistrar = isRegistrarRole(user?.role || '');
  const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
  const showRank = eventConfig.show_rank !== false;
  const showOffice = eventConfig.show_office !== false;
  const showDelegateType = eventConfig.show_delegate_type !== false;

  const [selectedSessionId, setSelectedSessionId] = useState<string>('');
  const [activeResponseType, setActiveResponseType] = useState<SessionResponseType>(SessionResponseType.FT);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [results, setResults] = useState<(Delegate & { recorded: boolean; code?: string })[]>([]);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [pendingReg, setPendingReg] = useState<{ scannedCode: string; parsedData: Record<string, string> | null } | null>(null);
  const [regForm, setRegForm] = useState({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [registering, setRegistering] = useState(false);
  const [vdValue, setVdValue] = useState<Record<string, string>>({});
  const [recordedIds, setRecordedIds] = useState<Set<string>>(new Set());
  const [summaryRef, setSummaryRef] = useState<HTMLDivElement | null>(null);
  const [manualType, setManualType] = useState<SessionResponseType | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [savingManual, setSavingManual] = useState(false);

  const processingRef = useRef(false);
  const scannedRef = useRef(false);
  const localRecordedIds = useRef<Set<string>>(new Set());

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

  const { dashboard, recordResponse, recordVD, recordSummary } = useMinistry(activeEventId, user);

  const currentDashboard = dashboard.data?.find(d => d.session_id === selectedSessionId);

  useEffect(() => {
    db.getSettings().then(data => {
      if (data?.districts?.length) setAvailableDistricts(data.districts);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (regForm.district) {
      db.getChapters(regForm.district).then(setChapters).catch(() => setChapters([]));
    } else {
      setChapters([]);
    }
  }, [regForm.district]);

  useEffect(() => {
    if (!activeEventId || !selectedSessionId) return;
    db.getSessionResponseIds(activeEventId, selectedSessionId, activeResponseType)
      .then(setRecordedIds)
      .catch(() => setRecordedIds(new Set()));
  }, [activeEventId, selectedSessionId, activeResponseType, dashboard.dataUpdatedAt]);

  useEffect(() => {
    return () => {
      setQuery('');
      setResults([]);
      setFeedback(null);
      setCode('');
      setPendingReg(null);
    };
  }, []);

  const scope = getScopeFilter(user);
  const districtFilter = scope.district;
  const regionFilter = scope.region;

  const { data: searchResults } = useQuery({
    queryKey: ['delegates', activeEventId, query, districtFilter, regionFilter],
    queryFn: () => db.searchDelegates(query, activeEventId, districtFilter, undefined, regionFilter),
    enabled: query.trim().length > 1 && !!activeEventId,
    staleTime: 15000,
  });

  useEffect(() => {
    if (!searchResults) return;
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const combined = new Set([...recordedIds, ...localRecordedIds.current]);
    setResults((searchResults as any[]).map((d: any) => ({
      ...d,
      recorded: combined.has(d.delegate_id),
      code: d.code || generateCodeFromId(d.delegate_id, activeEventId),
    })));
  }, [searchResults, query, activeEventId, recordedIds]);

  const handleRecord = async (delegateId: string) => {
    if (isLocked) return;
    if (!activeEventId || !user || !selectedSessionId) {
      alert('Action Blocked: Log in and select a session first.');
      return;
    }
    if (processingId) return;

    setProcessingId(delegateId);
    setFeedback({ type: 'success', msg: 'Recording...' });

    try {
      const res = await recordResponse.mutateAsync({
        delegateId, sessionId: selectedSessionId, responseType: activeResponseType,
      });
      if (res.success) {
        localRecordedIds.current.add(delegateId);
        setResults(prev => prev.map(d =>
          d.delegate_id === delegateId ? { ...d, recorded: true } : d
        ));
        setFeedback({ type: 'success', msg: 'Recorded!' });
        setTimeout(() => setFeedback(null), 2000);
      } else {
        setFeedback({ type: 'error', msg: res.message || 'Already Recorded' });
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Failed to record.' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCodeSubmit = async (codeVal: string) => {
    if (isLocked || !user || !activeEventId) { processingRef.current = false; return; }
    if (!selectedSessionId) {
      setFeedback({ type: 'error', msg: 'Please select a session first.' });
      processingRef.current = false;
      return;
    }
    setFeedback({ type: 'success', msg: 'Verifying code...' });
    try {
      const res = await db.checkInByCode(activeEventId, codeVal, user, selectedSessionId);
      if (res?.success && res.delegate) {
        await handleRecord(res.delegate.delegate_id);
      } else if (res?.needsRegistration) {
        setFeedback(null);
        setCode(res.scannedCode || '');
        setPendingReg({ scannedCode: res.scannedCode || codeVal, parsedData: res.parsedData || null });
        setRegForm({
          title: res.parsedData?.['title'] || '',
          first_name: res.parsedData?.['first_name'] || '',
          last_name: res.parsedData?.['last_name'] || '',
          district: res.parsedData?.['district'] || '',
          chapter: res.parsedData?.['chapter'] || '',
          phone: res.parsedData?.['phone'] || '',
          email: res.parsedData?.['email'] || '',
          rank: res.parsedData?.['rank'] || 'CP',
          office: res.parsedData?.['office'] || 'OTHER',
          delegate_type: res.parsedData?.['delegate_type'] || 'Member',
        } as typeof regForm);
      } else {
        setFeedback({ type: 'error', msg: res?.message || 'Invalid code or delegate not found.' });
        setPendingReg(null);
        setTimeout(() => setFeedback(null), 5000);
      }
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Failed to verify code.' });
    } finally {
      processingRef.current = false;
    }
  };

  const onCodeInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isLocked) return;
    const val = e.target.value;
    const cleaned = val.replace(/[^a-zA-Z0-9_-]/g, '');
    if (scannedRef.current) {
      scannedRef.current = false;
      setCode(cleaned);
      return;
    }
    setCode(cleaned);
    if (feedback?.type === 'error') setFeedback(null);
    setPendingReg(null);
    if (cleaned.length === 4 || cleaned.length === 24 || cleaned.length === 36) {
      handleCodeSubmit(cleaned);
    }
  };

  const handleScan = (scannedCode: string) => {
    setShowScanner(false);
    if (!scannedCode?.trim() || processingRef.current) return;
    processingRef.current = true;
    scannedRef.current = true;
    setFeedback(null);
    setPendingReg(null);
    setCode(scannedCode);
    handleCodeSubmit(scannedCode);
  };

  const handleQuickRegister = async () => {
    if (!activeEventId || !user || !pendingReg || registering) return;
    if (!regForm.first_name || !regForm.last_name || !regForm.district) {
      setFeedback({ type: 'error', msg: 'First name, last name, and district are required.' });
      return;
    }
    setRegistering(true);
    setFeedback({ type: 'success', msg: 'Registering...' });
    try {
      const newDelegate = await db.registerDelegateFromQR(activeEventId, pendingReg.scannedCode, regForm as any);
      await handleRecord(newDelegate.delegate_id);
      setPendingReg(null);
      setCode('');
      setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Registration failed.' });
    } finally {
      setRegistering(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setFeedback(null);
    setPendingReg(null);
  };

  const handleManualSave = async () => {
    if (!manualType || !selectedSessionId) return;
    const count = parseInt(manualValue, 10);
    if (isNaN(count) || count < 0) return;
    setSavingManual(true);
    try {
      await recordSummary.mutateAsync({ sessionId: selectedSessionId, responseType: manualType, totalCount: count });
      setManualType(null);
      setManualValue('');
    } catch {}
    setSavingManual(false);
  };

  const handleVDSave = async (sessionId: string) => {
    const val = parseInt(vdValue[sessionId] || '', 10);
    if (isNaN(val) || val < 0) return;
    try {
      await recordVD.mutateAsync({ sessionId, total: val });
      setVdValue(prev => ({ ...prev, [sessionId]: '' }));
    } catch {}
  };

  const total = (type: SessionResponseType): number => {
    if (!currentDashboard) return 0;
    const key = type.toLowerCase();
    return Number((currentDashboard as any)[`${key}_count`] || 0);
  };

  const handleExportPDF = () => {
    if (summaryRef) exportToPDF(summaryRef, `Sessions_Summary_${activeEvent?.name?.replace(/\s+/g, '_') || 'Report'}.pdf`, 'landscape', 1600);
  };

  const handleExportCSV = () => {
    const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    const headerRows = [
      { '': 'FGBMFI Nigeria — Events Management System' },
      { '': activeEvent?.name || '' },
      { '': 'Sessions Summary (All Sessions)' },
      { '': `Generated: ${today}` },
      { '': '' },
    ];
    const dataRows = (dashboard.data || []).map(d => ({
      Session: d.session_title,
      ATT: d.attendance,
      FT: d.ft_count || 0,
      SLV: d.slv_count || 0,
      MI: d.mi_count || 0,
      HGB: d.hgb_count || 0,
      VD: d.voice_distribution || 0,
    }));
    exportToCSV([...headerRows, ...dataRows], `Sessions_Summary_${activeEvent?.name?.replace(/\s+/g, '_') || 'Report'}.csv`);
  };

  if (!activeEventId) {
    return (
      <div className="p-20 text-center flex flex-col items-center gap-6 opacity-60">
        <div className="text-6xl">&#128203;</div>
        <h2 className="text-xl font-black text-blue-900 uppercase">Event Selection Required</h2>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Select an active event in the top header menu to continue.</p>
      </div>
    );
  }

  return (
    <>
      <div className={`max-w-4xl mx-auto space-y-8 animate-in fade-in pb-20 px-4 ${isLocked ? 'opacity-80' : ''}`}>
        {isLocked && (
          <div className="bg-red-600 text-white p-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl border-2 border-red-700">
            <span className="text-xl">&#128274;</span>
            <span className="text-xs font-black uppercase tracking-widest">Event Locked: Read-Only Mode Active</span>
          </div>
        )}

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-[10px] font-black text-gray-400 uppercase mb-3 tracking-[0.2em]">Session Context</h2>
          <select
            className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-lg text-blue-900 focus:bg-white focus:border-blue-500 outline-none transition-all"
            value={selectedSessionId}
            onChange={e => setSelectedSessionId(e.target.value)}
          >
            {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
          </select>
        </div>

        {selectedSessionId && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {RESPONSE_TYPES.map(type => (
              <button
                key={type}
                onClick={() => { setActiveResponseType(type); setQuery(''); setResults([]); setFeedback(null); }}
                className={`p-4 rounded-2xl text-center font-black uppercase text-xs transition-all shadow-sm ${
                  activeResponseType === type
                    ? 'bg-blue-600 text-white shadow-lg scale-105'
                    : 'bg-white text-gray-700 border border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="text-2xl mb-1">{total(type)}</div>
                <div className="text-[9px] tracking-wider">{RESPONSE_TYPE_LABELS[type]}</div>
              </button>
            ))}
          </div>
        )}
        {selectedSessionId && (
          <div className="flex justify-end">
            <button
              onClick={() => { setManualType(activeResponseType); setManualValue(''); }}
              disabled={isLocked}
              className="px-4 py-2 bg-slate-700 hover:bg-slate-800 disabled:bg-gray-400 text-white font-black rounded-xl text-[10px] uppercase tracking-wider shadow transition-all active:scale-95"
              title="Enter aggregate total for the selected call type"
            >
              Enter Total ({RESPONSE_TYPE_LABELS[activeResponseType]})
            </button>
          </div>
        )}

        <div className={`bg-white p-8 rounded-3xl shadow-xl border-t-8 border-blue-600 ${isLocked ? 'pointer-events-none grayscale opacity-60' : ''}`}>
          <h2 className="text-lg font-black mb-4 text-blue-900 uppercase tracking-tighter">
            Record as {RESPONSE_TYPE_LABELS[activeResponseType]} — QR / Code
          </h2>
          <div className="flex flex-col sm:flex-row gap-3 items-stretch">
            <input
              className="flex-1 p-6 text-center text-3xl md:text-5xl font-black tracking-[0.15em] border-2 border-blue-50 rounded-2xl bg-blue-50 focus:bg-white focus:border-blue-500 outline-none transition-all placeholder:text-blue-200 font-mono"
              placeholder="Scan QR or enter delegate code"
              maxLength={64}
              value={code}
              onChange={onCodeInput}
              autoFocus={!isLocked}
              readOnly={isLocked}
            />
            <button
              onClick={() => setShowScanner(true)}
              disabled={isLocked}
              className="px-6 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest shadow-lg transition-all active:scale-95 flex flex-col items-center justify-center gap-1"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9V7a2 2 0 012-2h2M3 15v2a2 2 0 002 2h2M21 9V7a2 2 0 00-2-2h-2M21 15v2a2 2 0 01-2 2h-2M7 12h.01M12 12h.01M17 12h.01M7 16h10" /></svg>
              <span className="text-[8px]">SCAN QR</span>
            </button>
            <button
              onClick={() => { setCode(''); setPendingReg(null); setFeedback(null); }}
              disabled={isLocked}
              className="px-4 py-4 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-600 font-black rounded-2xl text-[11px] uppercase tracking-widest shadow transition-all active:scale-95 flex flex-col items-center justify-center gap-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              <span className="text-[8px]">CLEAR</span>
            </button>
          </div>
          {feedback && (
            <div className={`mt-4 p-3 rounded-xl text-center font-black uppercase text-sm tracking-wider ${
              feedback.type === 'success'
                ? 'bg-green-500 text-white shadow-lg shadow-green-200'
                : 'bg-red-500 text-white shadow-lg shadow-red-200'
            }`}>
              {feedback.type === 'success' && <span className="mr-1">&#10003;</span>}
              {feedback.msg}
            </div>
          )}
        </div>

        {pendingReg && (
          <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-amber-500">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-black text-amber-700 uppercase tracking-tighter">Register Delegate</h2>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Delegate not in database</p>
                <p className="text-[8px] font-mono text-gray-500 mt-1 break-all">Scanned: {pendingReg.scannedCode}</p>
              </div>
              <button onClick={() => { setPendingReg(null); setFeedback(null); setCode(''); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Title</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.title} onChange={e => setRegForm(f => ({ ...f, title: e.target.value }))} placeholder="Mr/Mrs/Dr" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">First Name *</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.first_name} onChange={e => setRegForm(f => ({ ...f, first_name: e.target.value }))} placeholder="First name" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Last Name *</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.last_name} onChange={e => setRegForm(f => ({ ...f, last_name: e.target.value }))} placeholder="Last name" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">District *</label>
                <select className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.district} onChange={e => setRegForm(f => ({ ...f, district: e.target.value }))}>
                  <option value="">-- SELECT DISTRICT --</option>
                  {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Chapter</label>
                {chapters.length > 0 ? (
                  <select className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.chapter} onChange={e => setRegForm(f => ({ ...f, chapter: e.target.value }))}>
                    <option value="">-- SELECT CHAPTER --</option>
                    {chapters.map(c => <option key={c.chapter_id} value={c.chapter_name}>{c.chapter_name}</option>)}
                  </select>
                ) : (
                  <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.chapter} onChange={e => setRegForm(f => ({ ...f, chapter: e.target.value }))} placeholder="Chapter" />
                )}
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Phone</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.phone} onChange={e => setRegForm(f => ({ ...f, phone: e.target.value }))} placeholder="Phone" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Email</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.email} onChange={e => setRegForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Rank</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.rank} onChange={e => setRegForm(f => ({ ...f, rank: e.target.value }))} placeholder="CP" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-[9px] font-black text-gray-400 uppercase block mb-1">Office</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.office} onChange={e => setRegForm(f => ({ ...f, office: e.target.value }))} placeholder="Office" />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleQuickRegister} disabled={registering || isLocked} className="flex-1 py-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest shadow-lg transition-all active:scale-95">
                {registering ? 'Registering...' : 'Register & Record'}
              </button>
              <button onClick={() => { setPendingReg(null); setFeedback(null); setCode(''); }} className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
          <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">Database Lookup & Manual Record</h2>
          <div className="relative">
            <input
              className="w-full p-5 pr-14 text-xl border-2 border-gray-50 rounded-2xl bg-gray-50 focus:bg-white focus:border-blue-500 outline-none font-bold transition-all"
              placeholder="Search delegate by name or phone..."
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                if (feedback?.type === 'error') setFeedback(null);
                setPendingReg(null);
              }}
            />
            {query && (
              <button
                onClick={clearSearch}
                className="absolute right-4 top-1/2 -translate-y-1/2 w-10 h-10 flex items-center justify-center bg-gray-200 hover:bg-red-100 text-gray-500 hover:text-red-600 rounded-full transition-all"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {results.map(d => {
            const isRecorded = d.recorded;
            return (
              <div key={d.delegate_id} className={`bg-white p-6 rounded-2xl border-2 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm transition-all ${
                isRecorded ? 'bg-red-50 border-red-200 scale-[0.98]' : 'hover:border-blue-500 border-gray-50'
              }`}>
                <div className="flex-1 w-full text-left">
                  <div className="flex items-center flex-wrap gap-2">
                    <h3 className="font-black text-blue-900 uppercase text-lg leading-tight">{d.title} {d.first_name} {d.last_name}</h3>
                    {showRank && <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">RANK: {d.rank}</span>}
                  </div>
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{d.district} DISTRICT &bull; {d.chapter || 'INDIVIDUAL'}{showOffice && d.office ? ` • ${d.office}` : ''}{showDelegateType && d.delegate_type ? ` • ${d.delegate_type}` : ''}</p>
                </div>
                <div className="flex items-center gap-4 w-full md:w-auto justify-end">
                  {isRecorded ? (
                    <span className="px-6 py-2 bg-red-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow-lg shadow-red-100">Already Recorded</span>
                  ) : (
                    <button
                      onClick={() => handleRecord(d.delegate_id)}
                      disabled={!!processingId || isLocked}
                      className="w-full md:w-auto px-10 py-5 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-95"
                    >
                      {isLocked ? 'LOCKED' : (processingId === d.delegate_id ? 'WAIT...' : `Record as ${activeResponseType}`)}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {selectedSessionId && (
          <div className="bg-white p-6 rounded-3xl shadow-sm border">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-black uppercase text-blue-900">Sessions Summary (All Sessions)</h3>
              <div className="flex gap-2 no-print">
                <button onClick={handleExportPDF} className="px-4 py-2 bg-slate-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-slate-700 transition-colors">
                  Export PDF
                </button>
                <button onClick={handleExportCSV} className="px-4 py-2 bg-green-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-green-700 transition-colors">
                  Export Excel
                </button>
              </div>
            </div>
            <div ref={el => setSummaryRef(el)} className="overflow-x-auto">
              <div className="hidden print-only mb-8 text-center border-b-4 border-blue-900 pb-6">
                <div className="text-[11px] font-black text-gray-400 uppercase tracking-[0.15em] mb-1">FGBMFI Nigeria — Events Management System</div>
                <h1 className="text-2xl font-black uppercase text-blue-900 tracking-tight">{activeEvent?.name}</h1>
                <div className="inline-block mt-2 px-4 py-1 bg-blue-50 rounded-full">
                  <h3 className="text-[11px] font-black uppercase text-blue-700 tracking-widest">Sessions Summary (All Sessions)</h3>
                </div>
                <p className="text-[9px] font-bold text-gray-400 mt-4 uppercase tracking-wider">Generated: {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-100 uppercase font-black text-gray-500">
                  <tr>
                    <th className="p-3 text-left rounded-l-lg">Session</th>
                    <th className="p-3 text-center">ATT</th>
                    <th className="p-3 text-center">FT</th>
                    <th className="p-3 text-center">SLV</th>
                    <th className="p-3 text-center">MI</th>
                    <th className="p-3 text-center">HGB</th>
                    <th className="p-3 text-center rounded-r-lg">VD</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(dashboard.data || []).map(d => {
                    return (
                      <tr key={d.session_id} className={`hover:bg-blue-50 transition-colors ${d.session_id === selectedSessionId ? 'bg-blue-50' : ''}`}>
                        <td className="p-3 font-bold uppercase text-blue-900">{d.session_title}</td>
                        <td className="p-3 text-center font-bold">{d.attendance || '-'}</td>
                        <td className="p-3 text-center font-bold">{d.ft_count || '-'}</td>
                        <td className="p-3 text-center font-bold">{d.slv_count || '-'}</td>
                        <td className="p-3 text-center font-bold">{d.mi_count || '-'}</td>
                        <td className="p-3 text-center font-bold">{d.hgb_count || '-'}</td>
                        <td className="p-3 text-center font-bold">{d.voice_distribution || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  {(() => {
                    const data = dashboard.data || [];
                    const sumAtt = data.reduce((s, d) => s + (d.attendance || 0), 0);
                    const sumFT = data.reduce((s, d) => s + (d.ft_count || 0), 0);
                    const sumSLV = data.reduce((s, d) => s + (d.slv_count || 0), 0);
                    const sumMI = data.reduce((s, d) => s + (d.mi_count || 0), 0);
                    const sumHGB = data.reduce((s, d) => s + (d.hgb_count || 0), 0);
                    const sumVD = data.reduce((s, d) => s + (d.voice_distribution || 0), 0);
                    return (
                      <tr className="bg-blue-900 text-white font-black">
                        <td className="p-3 uppercase">Totals</td>
                        <td className="p-3 text-center">{sumAtt || '-'}</td>
                        <td className="p-3 text-center">{sumFT || '-'}</td>
                        <td className="p-3 text-center">{sumSLV || '-'}</td>
                        <td className="p-3 text-center">{sumMI || '-'}</td>
                        <td className="p-3 text-center">{sumHGB || '-'}</td>
                        <td className="p-3 text-center">{sumVD || '-'}</td>
                      </tr>
                    );
                  })()}
                </tfoot>
              </table>
            </div>

            <div className="mt-6 p-5 bg-gray-50 rounded-2xl border no-print">
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
          </div>
        )}
      </div>

      {showScanner && (
        <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
      )}

      {manualType && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setManualType(null)}>
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-lg font-black uppercase text-blue-900 mb-1">Enter Manual Total</h3>
            <p className="text-xs text-gray-500 mb-4">{RESPONSE_TYPE_LABELS[manualType]} | {sessions.find(s => s.session_id === selectedSessionId)?.title}</p>
            <input
              type="number"
              min="0"
              className="w-full border-2 border-gray-200 rounded-xl p-3 text-2xl font-black text-center"
              placeholder="Enter count..."
              value={manualValue}
              onChange={e => setManualValue(e.target.value)}
              autoFocus
              onKeyDown={e => e.key === 'Enter' && handleManualSave()}
            />
            <div className="flex gap-3 mt-4">
              <button onClick={() => setManualType(null)} className="flex-1 py-3 rounded-xl bg-gray-100 text-gray-600 font-black uppercase text-sm">Cancel</button>
              <button onClick={handleManualSave} disabled={savingManual || recordSummary.isPending} className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-black uppercase text-sm hover:bg-blue-700 disabled:opacity-50">
                {savingManual || recordSummary.isPending ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default SessionMinistryPage;
