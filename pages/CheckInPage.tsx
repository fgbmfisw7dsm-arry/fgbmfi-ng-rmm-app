import React, { useState, useEffect, useContext, useCallback, useRef } from 'react';
import { db } from '../services/supabaseService';
import { Session, Delegate, UserRole, isAdminRole, isRegistrarRole, getScopeFilter, Chapter } from '../types';
import { AppContext } from '../context/AppContext';
import QRCode from 'qrcode';
import QRScanner from '../components/QRScanner';
import { useQuery } from '@tanstack/react-query';
import { enqueueCheckIn } from '../services/offlineQueue';
import { generateBadgeImage } from '../services/badgeImageGenerator';

const CheckInPage = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const [query, setQuery] = useState('');
  const [code, setCode] = useState('');
  const [results, setResults] = useState<(Delegate & { checkedIn: boolean })[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [feedback, setFeedback] = useState<{type: 'success' | 'error', msg: string} | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [badgeDelegate, setBadgeDelegate] = useState<Delegate | null>(null);
  const [badgeQrSvg, setBadgeQrSvg] = useState<string>('');
  const [badgeBannerDataUrl, setBadgeBannerDataUrl] = useState<string>('');
  const [badgeCanvasUrl, setBadgeCanvasUrl] = useState<string>('');
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [pendingReg, setPendingReg] = useState<{ scannedCode: string; parsedData: Record<string,string> | null } | null>(null);
  const [regForm, setRegForm] = useState({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [registering, setRegistering] = useState(false);
  const processingRef = useRef(false);
  const scannedRef = useRef(false);

  const localVerifiedIds = useRef<Set<string>>(new Set());
  const qrCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const isLocked = activeEvent?.is_active === false;
  const isAdmin = isAdminRole(user?.role || '');
  const isRegistrar = isRegistrarRole(user?.role || '');
  const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
  const showRank = eventConfig.show_rank !== false;
  const showOffice = eventConfig.show_office !== false;
  const showDelegateType = eventConfig.show_delegate_type !== false;

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

  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions', activeEventId],
    queryFn: () => db.getSessions(activeEventId),
    enabled: !!activeEventId,
    staleTime: 300000,
  });

  const scope = getScopeFilter(user);
  const districtFilter = scope.district;
  const regionFilter = scope.region;

  const { data: searchResults } = useQuery({
    queryKey: ['delegates', activeEventId, query, selectedSessionId, districtFilter, regionFilter],
    queryFn: () => db.searchDelegates(query, activeEventId, districtFilter, selectedSessionId, regionFilter),
    enabled: query.trim().length > 1 && !!activeEventId,
    staleTime: 15000,
  });

  useEffect(() => {
    return () => {
      setQuery('');
      setResults([]);
      setFeedback(null);
      setCode('');
      setBadgeDelegate(null);
      setBadgeQrSvg('');
      setBadgeBannerDataUrl('');
      setBadgeCanvasUrl('');
      setPendingReg(null);
    };
  }, []);

  useEffect(() => {
    if (!searchResults) return;
    if (query.trim().length === 0) {
      setResults([]);
      return;
    }
    const reconciledData = searchResults.map(d => {
      const key = `${d.delegate_id}_${selectedSessionId || 'arrival'}`;
      const isVerifiedLocally = localVerifiedIds.current.has(key);
      return {
        ...d,
        checkedIn: d.checkedIn || isVerifiedLocally,
        verifiedLocally: isVerifiedLocally
      };
    });
    setResults(reconciledData);
  }, [searchResults, query, selectedSessionId, activeEventId]);

  const renderQrToCanvas = useCallback((delegateId: string, qrHash: string) => {
    const canvas = qrCanvasRefs.current[delegateId];
    if (canvas && qrHash) {
      QRCode.toCanvas(canvas, qrHash, { width: 100, margin: 1, color: { dark: '#1e3a5f' } }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    results.forEach(d => {
      if (d.qr_hash && d.checkedIn) {
        renderQrToCanvas(d.delegate_id, d.qr_hash);
      }
    });
  }, [results, renderQrToCanvas]);

  const handleManualCheckIn = async (delegateId: string) => {
    if (isLocked) return;
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
            if (!res.alreadyCheckedIn) {
              localVerifiedIds.current.add(`${delegateId}_${selectedSessionId || 'arrival'}`);
            }
            setResults(prev => prev.map(d => 
              d.delegate_id === delegateId ? { ...d, checkedIn: true, verifiedLocally: !res.alreadyCheckedIn, qr_hash: res.delegate?.qr_hash || d.qr_hash } : d
            ));
            setFeedback({ type: res.alreadyCheckedIn ? 'error' : 'success', msg: res.message || 'Verified!' });
            setTimeout(() => setFeedback(null), res.alreadyCheckedIn ? 3000 : 2000);
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
    if (isLocked) return;
    if(!user || !activeEventId) { processingRef.current = false; return; }
    setFeedback({ type: 'success', msg: 'Verifying code...' });
    try {
        const res = await db.checkInByCode(activeEventId, codeVal, user, selectedSessionId);
        if(res && res.success) { 
          setFeedback({ type: res.alreadyCheckedIn ? 'error' : 'success', msg: res.message || 'Verified!' }); 
          setPendingReg(null);
          setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
          if (res.delegate?.delegate_id) {
            const dKey = `${res.delegate.delegate_id}_${selectedSessionId || 'arrival'}`;
            if (res.alreadyCheckedIn) {
              localVerifiedIds.current.delete(dKey);
              setResults(prev => prev.map(d =>
                d.delegate_id === res.delegate!.delegate_id ? { ...d, checkedIn: true, verifiedLocally: false } : d
              ));
            } else {
              localVerifiedIds.current.add(dKey);
              setResults(prev => prev.map(d =>
                d.delegate_id === res.delegate!.delegate_id ? { ...d, checkedIn: true, verifiedLocally: true } : d
              ));
            }
          }
          setTimeout(() => { setFeedback(null); setCode(''); }, res.alreadyCheckedIn ? 3000 : 5000);
        } else if (res.needsRegistration) {
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
            office: res.parsedData?.['office'] || 'OTHER'
          });
        } else { 
          setFeedback({ type: 'error', msg: res.message || 'Invalid or Scoped Code' }); 
          setPendingReg(null);
          setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
          setTimeout(() => setFeedback(null), 5000);
        }
    } catch(e: any) { 
        console.error("Fast Check-in Error:", e);
        setFeedback({ type: 'error', msg: e.message || "Fast check-in rejected" }); 
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
    if (cleaned.length === 24 || cleaned.length === 36) {
      handleCodeSubmit(cleaned);
    }
  };

  const handleBadge = async (delegate: Delegate) => {
    try {
      const { badgeUrl, qrUrl, bannerUrl } = await generateBadgeImage(delegate, { showRank, showOffice });

      setBadgeQrSvg(qrUrl);
      setBadgeBannerDataUrl(bannerUrl);
      setBadgeCanvasUrl(badgeUrl);
      setBadgeDelegate(delegate);
    } catch (e) {
      console.error('QR generation for badge failed:', e);
      setFeedback({ type: 'error', msg: 'Failed to generate badge. Please try again.' });
      setTimeout(() => setFeedback(null), 3000);
    }
  };

const handleLostBadge = useCallback(async (delegateId: string) => {
    if (!activeEventId || !user) return;
    if (isLocked) return;
    setRegeneratingId(delegateId);
    try {
      const newHash = await db.regenerateQrHash(delegateId);
      setResults(prev => prev.map(d => 
        d.delegate_id === delegateId ? { ...d, qr_hash: newHash } : d
      ));
      const canvas = qrCanvasRefs.current[delegateId];
      if (canvas) {
        QRCode.toCanvas(canvas, newHash, { width: 100, margin: 1, color: { dark: '#1e3a5f' } }).catch(() => {});
      }
      setFeedback({ type: 'success', msg: 'Badge replaced! New QR code generated.' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Failed to replace badge.' });
    } finally {
      setRegeneratingId(null);
    }
  }, [activeEventId, user, isLocked]);

  const closeBadgeModal = () => {
    setBadgeDelegate(null);
    setBadgeQrSvg('');
    setBadgeBannerDataUrl('');
    setBadgeCanvasUrl('');
  };

  const printBadge = () => {
    window.print();
  };

  const downloadBadgePDF = async () => {
    if (!badgeCanvasUrl) return;
    const nameSlug = `${badgeDelegate?.first_name || 'delegate'}_${badgeDelegate?.last_name || ''}`.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = reject;
        image.src = badgeCanvasUrl;
      });
      const JsPDF = (window as any).jspdf?.jsPDF || (window as any).jsPDF;
      if (!JsPDF) throw new Error('PDF library not loaded');
      const pdf = new JsPDF('p', 'mm', [63, 90]);
      pdf.addImage(img, 'PNG', 0, 0, 63, 90);
      pdf.save(`FGBMFI_Badge_${nameSlug}.pdf`);
    } catch (e) {
      console.error('PDF generation failed:', e);
      setFeedback({ type: 'error', msg: 'PDF generation failed. Please try again.' });
      setTimeout(() => setFeedback(null), 3000);
    }
  };

  const downloadBadgeImage = async () => {
    if (!badgeCanvasUrl) return;
    const nameSlug = `${badgeDelegate?.first_name || 'delegate'}_${badgeDelegate?.last_name || ''}`.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const a = document.createElement('a');
      a.href = badgeCanvasUrl;
      a.download = `FGBMFI_Badge_${nameSlug}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setFeedback({ type: 'success', msg: 'Image downloaded!' });
      setTimeout(() => setFeedback(null), 2000);
    } catch (e) {
      console.error('Image download failed:', e);
    }
  };

  const shareBadge = async () => {
    if (!badgeCanvasUrl) return;
    const nameSlug = `${badgeDelegate?.first_name || 'delegate'}_${badgeDelegate?.last_name || ''}`.replace(/[^a-zA-Z0-9]/g, '_');
    try {
      const resp = await fetch(badgeCanvasUrl);
      const blob = await resp.blob();
      const file = new File([blob], `FGBMFI_Badge_${nameSlug}.png`, { type: 'image/png' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'FGBMFI Badge' } as any);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `FGBMFI_Badge_${nameSlug}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setFeedback({ type: 'success', msg: 'Share not supported — image downloaded instead' });
        setTimeout(() => setFeedback(null), 3000);
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        console.error('Share failed:', e);
      }
    }
  };

  const clearSearch = () => {
    setQuery('');
    setResults([]);
    setFeedback(null);
    setPendingReg(null);
  };

  const handleScan = (code: string) => {
    setShowScanner(false);
    if (!code?.trim() || processingRef.current) return;
    processingRef.current = true;
    scannedRef.current = true;
    setFeedback(null);
    setPendingReg(null);
    setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
    setCode(code);
    handleCodeSubmit(code);
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
      const newDelegate = await db.registerDelegateFromQR(activeEventId, pendingReg.scannedCode, { ...regForm });
      const res = await db.checkInDelegate(activeEventId, newDelegate.delegate_id, user, selectedSessionId);
      setPendingReg(null);
      setCode('');
      setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
      setFeedback({ type: res.alreadyCheckedIn ? 'error' : 'success', msg: res.success ? (res.alreadyCheckedIn ? 'Already Checked-in' : 'Registered & Verified!') : 'Registered but check-in failed.' });
      setTimeout(() => setFeedback(null), 3000);
    } catch (e: any) {
      setFeedback({ type: 'error', msg: e.message || 'Registration failed.' });
    } finally {
      setRegistering(false);
    }
  };

  if(!activeEventId) return (
    <div className="p-20 text-center flex flex-col items-center gap-6 opacity-60">
        <div className="text-6xl">📍</div>
        <h2 className="text-xl font-black text-blue-900 uppercase">Event Selection Required</h2>
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-center">Select an active event in the top header menu to continue.</p>
    </div>
  );

  return (
    <>
    <div className={`max-w-4xl mx-auto space-y-8 animate-in fade-in pb-20 px-4 ${isLocked ? 'opacity-80' : ''} ${badgeDelegate ? 'print:hidden' : ''}`}>
       {isLocked && (
            <div className="bg-red-600 text-white p-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl border-2 border-red-700 animate-in slide-in-from-top-4">
                <span className="text-xl">🔒</span>
                <span className="text-xs font-black uppercase tracking-widest">Event Locked: Read-Only Mode Active</span>
            </div>
       )}

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
       
       <div className={`bg-white p-8 rounded-3xl shadow-xl border-t-8 border-blue-600 animate-in slide-in-from-top-4 ${isLocked ? 'pointer-events-none grayscale opacity-60' : ''}`}>
            <h2 className="text-lg font-black mb-4 text-blue-900 uppercase tracking-tighter">2. Fast Check-in (QR Code / Delegate ID)</h2>
            <div className="flex flex-col sm:flex-row gap-3 items-stretch">
              <input 
                className="flex-1 p-6 text-center text-4xl md:text-6xl font-black tracking-[0.15em] border-2 border-blue-50 rounded-2xl bg-blue-50 focus:bg-white focus:border-blue-500 outline-none transition-all placeholder:text-blue-200 font-mono" 
                placeholder="Scan QR code or enter delegate ID" 
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
                title="Scan QR code with camera"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9V7a2 2 0 012-2h2M3 15v2a2 2 0 002 2h2M21 9V7a2 2 0 00-2-2h-2M21 15v2a2 2 0 01-2 2h-2M7 12h.01M12 12h.01M17 12h.01M7 16h10" /></svg>
                <span className="text-[8px]">SCAN QR</span>
              </button>
              <button 
                onClick={() => {
                  setCode('');
                  setPendingReg(null);
                  setFeedback(null);
                  setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' });
                }}
                disabled={isLocked}
                className="px-4 py-4 bg-gray-200 hover:bg-gray-300 disabled:bg-gray-100 text-gray-600 font-black rounded-2xl text-[11px] uppercase tracking-widest shadow transition-all active:scale-95 flex flex-col items-center justify-center gap-1"
                title="Clear input and start new scan"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                <span className="text-[8px]">CLEAR</span>
              </button>
            </div>
            {feedback && (
              <div className={`mt-4 p-3 rounded-xl text-center font-black uppercase text-sm tracking-wider animate-in zoom-in ${
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
          <div className="bg-white p-8 rounded-3xl shadow-xl border-t-8 border-amber-500 animate-in slide-in-from-top-4">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h2 className="text-lg font-black text-amber-700 uppercase tracking-tighter">Register Delegate</h2>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Delegate not in database</p>
                <p className="text-[8px] font-mono text-gray-500 mt-1 break-all">Scanned: {pendingReg.scannedCode}</p>
                {pendingReg.parsedData ? (
                  <p className="text-[8px] font-bold text-green-600 mt-0.5">Data extracted from QR</p>
                ) : (
                  <p className="text-[8px] font-bold text-red-400 mt-0.5">Could not parse QR — fill manually</p>
                )}
              </div>
              <button onClick={() => { setPendingReg(null); setFeedback(null); setCode(''); setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' }); }} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Title</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.title} onChange={e => setRegForm(f => ({...f, title: e.target.value}))} placeholder="Mr/Mrs/Dr" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">First Name *</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.first_name} onChange={e => setRegForm(f => ({...f, first_name: e.target.value}))} placeholder="First name" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Last Name *</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.last_name} onChange={e => setRegForm(f => ({...f, last_name: e.target.value}))} placeholder="Last name" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">District *</label>
                <select className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.district} onChange={e => setRegForm(f => ({...f, district: e.target.value}))}>
                    <option value="">-- SELECT DISTRICT --</option>
                    {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Chapter</label>
                {chapters.length > 0 ? (
                    <select className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.chapter} onChange={e => setRegForm(f => ({...f, chapter: e.target.value}))}>
                        <option value="">-- SELECT CHAPTER --</option>
                        {chapters.map(c => <option key={c.chapter_id} value={c.chapter_name}>{c.chapter_name}</option>)}
                    </select>
                ) : (
                    <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.chapter} onChange={e => setRegForm(f => ({...f, chapter: e.target.value}))} placeholder="Chapter" />
                )}
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Phone</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.phone} onChange={e => setRegForm(f => ({...f, phone: e.target.value}))} placeholder="Phone" />
              </div>
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Email</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.email} onChange={e => setRegForm(f => ({...f, email: e.target.value}))} placeholder="Email" />
              </div>
              {showRank && (
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Rank</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.rank} onChange={e => setRegForm(f => ({...f, rank: e.target.value}))} placeholder="CP" />
              </div>
              )}
              {showOffice && (
              <div className="sm:col-span-2">
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Office</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.office} onChange={e => setRegForm(f => ({...f, office: e.target.value}))} placeholder="Office" />
              </div>
              )}
              {showDelegateType && (
              <div>
                <label className="text-[9px] font-black text-gray-400 uppercase tracking-wider block mb-1">Delegate Type</label>
                <input className="w-full p-3 border-2 border-gray-100 rounded-xl text-sm font-bold focus:border-amber-500 outline-none" value={regForm.delegate_type} onChange={e => setRegForm(f => ({...f, delegate_type: e.target.value}))} placeholder="Member" />
              </div>
              )}
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handleQuickRegister} disabled={registering || isLocked} className="flex-1 py-4 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-white font-black rounded-2xl text-[11px] uppercase tracking-widest shadow-lg transition-all active:scale-95">
                {registering ? 'Registering...' : 'Register & Check In'}
              </button>
              <button onClick={() => { setPendingReg(null); setFeedback(null); setCode(''); setRegForm({ title: '', first_name: '', last_name: '', district: '', chapter: '', phone: '', email: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member' }); }} className="flex-1 py-4 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black rounded-2xl text-[11px] uppercase tracking-widest transition-all">
                Cancel
              </button>
            </div>
          </div>
        )}

        <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
         <h2 className="text-[10px] font-black text-gray-400 uppercase mb-4 tracking-[0.2em]">3. Database Lookup & Manual Verify</h2>
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
                    title="Clear search"
                 >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                 </button>
             )}
         </div>
       </div>

       <div className="space-y-4">
         {results.map(d => (
           <div key={d.delegate_id} className={`bg-white p-6 rounded-2xl border-2 flex flex-col md:flex-row gap-4 justify-between items-center shadow-sm transition-all ${
d.checkedIn ? 'bg-green-50 border-green-200 scale-[0.98]' : 'hover:border-blue-500 border-gray-50'
}`}>
              <div className="flex-1 w-full text-left">
                <div className="flex items-center flex-wrap gap-2">
                    <h3 className="font-black text-blue-900 uppercase text-lg leading-tight">{d.title} {d.first_name} {d.last_name}</h3>
                    {showRank && <span className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter">RANK: {d.rank}</span>}
                </div>
                 <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{d.district} DISTRICT • {d.chapter || 'INDIVIDUAL'}{showOffice && d.office ? ` • ${d.office}` : ''}{showDelegateType && d.delegate_type ? ` • ${d.delegate_type}` : ''}</p>
              </div>
              <div className="flex items-center gap-4 w-full md:w-auto justify-end">
                  {d.checkedIn ? (
                    <div className="flex flex-col items-end gap-3">
                        {d.verifiedLocally ? (
                          <span className="px-6 py-2 bg-green-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow-lg shadow-green-100 animate-in zoom-in">Verified</span>
                        ) : (
                          <span className="px-6 py-2 bg-red-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow-lg shadow-red-100 animate-in zoom-in">Already Checked-in</span>
                        )}
                        <div className="flex items-center gap-3">
                          <canvas 
                            ref={el => { qrCanvasRefs.current[d.delegate_id] = el; }}
                            className="rounded-lg shadow-md border border-gray-200"
                            width={100}
                            height={100}
                          />
                          <div className="text-right flex flex-col items-end gap-2">
                             <div className="flex gap-2 mt-1">
                               <button 
                                 onClick={() => handleBadge(d)}
                                 className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-xl text-[9px] uppercase tracking-widest shadow transition-all active:scale-95"
                                 title="Generate and distribute E-Badge"
                               >
                                 E-Badge
                               </button>
                               {(isAdmin || isRegistrar) && (
                                 <button 
                                   onClick={() => handleLostBadge(d.delegate_id)}
                                   disabled={regeneratingId === d.delegate_id || isLocked}
                                   className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:bg-gray-400 text-white font-black rounded-xl text-[9px] uppercase tracking-widest shadow transition-all active:scale-95"
                                   title="Replace lost badge"
                                 >
                                   {regeneratingId === d.delegate_id ? '...' : 'Lost Badge'}
                                 </button>
                               )}
                             </div>
                          </div>
                        </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-center gap-3">
                      <button 
                        onClick={() => handleBadge(d)}
                        className="w-full md:w-auto px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest shadow-lg shadow-purple-100 transition-all active:scale-95"
                        title="Generate and distribute E-Badge"
                      >
                        E-Badge
                      </button>
                      <button 
                        onClick={() => handleManualCheckIn(d.delegate_id)} 
                        disabled={!!processingId || isLocked}
                        className="w-full md:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-black rounded-2xl text-[10px] uppercase tracking-widest shadow-xl shadow-blue-100 transition-all active:scale-95"
                      >
                        {isLocked ? 'LOCKED' : (processingId === d.delegate_id ? 'WAIT...' : 'VERIFY ENTRY')}
                      </button>
                    </div>
                  )}
              </div>
           </div>
         ))}
       </div>

       {badgeDelegate && (
         <>
           <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4 print:hidden" onClick={closeBadgeModal}>
             <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8 animate-in zoom-in" onClick={e => e.stopPropagation()}>
               <div className="flex justify-between items-start mb-6">
                 <h3 className="text-lg font-black text-blue-900 uppercase tracking-tighter">E-Badge</h3>
                 <button onClick={closeBadgeModal} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
               </div>

                  <div id="badge-print-area" className="bg-white border-2 border-blue-900 rounded-xl" style={{ width: '63mm', height: '90mm', position: 'relative', overflow: 'hidden', backgroundColor: '#ffffff' }}>
                    {badgeBannerDataUrl && (
                      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: `url(${badgeBannerDataUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
                    )}
                     <div style={{ position: 'absolute', top: '29%', left: 0, right: 0, height: '64%', backgroundColor: '#ffffff', textAlign: 'center', padding: '1.5mm 2mm' }}>
                       <div style={{ width: '30mm', height: '30mm', margin: '0 auto' }}>
                         {badgeQrSvg && <img src={badgeQrSvg} alt="QR" style={{ width: '100%', height: '100%' }} />}
                       </div>
                       <div style={{ marginTop: '1.5mm', lineHeight: '1.4' }}>
                          {(() => {
                            const nameText = [badgeDelegate.title, badgeDelegate.first_name, badgeDelegate.last_name].filter(Boolean).join(' ').toUpperCase();
                            const fs = nameText.length > 22 ? '11px' : nameText.length > 18 ? '12px' : nameText.length > 14 ? '13px' : '14px';
                            return <div style={{ fontSize: fs, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', wordBreak: 'break-word', maxWidth: '95%', margin: '0 auto' }} className="font-black text-blue-900 uppercase tracking-tight leading-tight">{badgeDelegate.title} {badgeDelegate.first_name} {badgeDelegate.last_name}</div>;
                          })()}
                         <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">District: {badgeDelegate.district || 'N/A'}</div>
                         <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">Chapter: {badgeDelegate.chapter || 'N/A'}</div>
                         {showOffice && badgeDelegate.office && (
                           <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">Office: {badgeDelegate.office}</div>
                         )}
                         {showRank && badgeDelegate.rank && (
                           <div className="text-[9px] font-bold text-gray-600 uppercase tracking-wider">Rank: {badgeDelegate.rank}</div>
                         )}
                          {(badgeDelegate.external_id || badgeDelegate.delegate_id) && (
                            (() => { const displayId = badgeDelegate.external_id?.startsWith('CON26') ? badgeDelegate.external_id : badgeDelegate.delegate_id.slice(0, 8); return <div className="text-[8px] font-black text-gray-500 uppercase">ID: <span className="text-gray-700 font-mono text-[8px]">{displayId}</span></div>; })()
                          )}
                       </div>
                     </div>
                     <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '7%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                       <span className="text-white font-black uppercase tracking-wider drop-shadow" style={{ fontSize: '11px' }}>{(badgeDelegate.delegate_type || 'Member').toUpperCase()}</span>
                     </div>
                  </div>

                <div className="mt-6 grid grid-cols-2 gap-2">
                  <button onClick={printBadge} className="py-3 bg-blue-900 hover:bg-blue-800 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95">
                    Print
                  </button>
                  <button onClick={downloadBadgePDF} className="py-3 bg-slate-700 hover:bg-slate-600 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95">
                    PDF
                  </button>
                  <button onClick={downloadBadgeImage} className="py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95">
                    Image
                  </button>
                  <button onClick={shareBadge} className="py-3 bg-purple-600 hover:bg-purple-500 text-white font-black rounded-xl text-[10px] uppercase tracking-widest shadow transition-all active:scale-95">
                    Share
                  </button>
                </div>
                <div className="mt-2 flex gap-3">
                  <button onClick={closeBadgeModal} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-600 font-black rounded-xl text-[11px] uppercase tracking-widest transition-all">
                    Close
                  </button>
                </div>
             </div>
            </div>

          </>
        )}

       {showScanner && (
          <QRScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
        )}
    </div>

        {badgeDelegate && badgeCanvasUrl && (
          <div className="hidden print:block">
            <style>{`@media print { html, body { margin: 0 !important; padding: 0 !important; background: white; } }`}</style>
            <img src={badgeCanvasUrl} alt="Badge" style={{ width: '63mm', height: '90mm', display: 'block', margin: '0 auto' }} />
          </div>
        )}
    </>
  );
};

export default CheckInPage;
