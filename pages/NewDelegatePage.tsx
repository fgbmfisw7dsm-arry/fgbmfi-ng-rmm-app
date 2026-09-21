import React, { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { Delegate, SystemSettings, Rank, Office, UserRole, isRegistrarRole, isRegionalRole, isDistrictRole, getScopeFilter, Chapter, FieldRequirement } from '../types';
import { AppContext } from '../context/AppContext';
import CountryDialSelect from '../components/CountryDialSelect';


// Fallback defaults in case settings table is empty
const DEFAULT_TITLES = ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];
const FREE_GUEST_CHAPTER = 'Guest';
const ROUTED_TYPES = ['Free Guest', 'National Guest', 'International'];

// v1.55 (EMS): default required-field rules per delegate type, effective for
// the current live event. Overridable per event from Events & Config ->
// "Required Fields by Delegate Type" (events.event_config.required_fields).
const DEFAULT_REQUIRED_FIELDS: Record<string, FieldRequirement> = {
    'Member': { phone: true, payment_amount: true, payment_reference: true },
    'National Guest': { phone: true, payment_amount: true, payment_reference: true },
    'International': { phone: true, payment_amount: true, payment_reference: true },
    'Dependant-Adult': { phone: true, payment_amount: true, payment_reference: true },
    'Dependant-Teen': { phone: true, payment_amount: true, payment_reference: true },
    'Dependant-Children': { phone: true, payment_amount: true, payment_reference: true },
    'Free Guest': {},
};

const NewDelegatePage = () => {
  const { activeEventId, activeEvent, user } = useContext(AppContext);
  const isLocked = activeEvent?.is_active === false;
  
  const role = (user?.role || '').toLowerCase();
  const isDistrictScoped = isDistrictRole(role) && !!user?.district;
  const isRegionalScoped = isRegionalRole(role) && !!user?.region;
  const initialDistrict = isDistrictScoped ? (user?.district || '') : '';

  const eventConfig = (activeEvent?.event_config || {}) as Record<string, unknown>;
  const showRank = eventConfig.show_rank !== false;
  const showOffice = eventConfig.show_office !== false;
  const showDelegateType = eventConfig.show_delegate_type !== false;
  const showPaymentFields = eventConfig.show_payment_fields !== false;
  const freeGuestLocked = isRegistrarRole(role) && eventConfig.restrict_registrar_to_free_guest === true;

  // v1.55: per-type required-field resolution (Events & Config override wins;
  // falls back to DEFAULT_REQUIRED_FIELDS for the current live event).
  const requiredMap = (eventConfig.required_fields || {}) as Record<string, FieldRequirement>;
  const requiredFor = (type?: string): FieldRequirement => {
    const t = (type || '').trim();
    return {
      ...(DEFAULT_REQUIRED_FIELDS[t] || { phone: true, payment_amount: true, payment_reference: true }),
      ...(requiredMap[t] || {}),
    };
  };

  const [form, setForm] = useState<Partial<Delegate>>({ 
    title: 'Mr', first_name: '', last_name: '', phone: '', email: '', 
    district: initialDistrict, chapter: '', rank: 'CP', office: 'OTHER', delegate_type: 'Member'
  });
  
  const [loading, setLoading] = useState(false);
  const [dialCode, setDialCode] = useState('+234'); // v1.55: ISD picker, Nigeria default
  const [paymentAmount, setPaymentAmount] = useState(''); // v1.55: stored on the delegate
  const [paymentRef, setPaymentRef] = useState('');       // v1.55: stored on the delegate

  const req = requiredFor(form.delegate_type);
  const reqPhone = req.phone === true;
  const reqEmail = req.email === true;
  const reqAmount = req.payment_amount === true;
  const reqRef = req.payment_reference === true;
  const [availableDistricts, setAvailableDistricts] = useState<string[]>([]);
  const [availableTitles, setAvailableTitles] = useState<string[]>(DEFAULT_TITLES);
  const [availableRanks, setAvailableRanks] = useState<string[]>([]);
  const [availableOffices, setAvailableOffices] = useState<string[]>([]);
  const [availableDelegateTypes, setAvailableDelegateTypes] = useState<string[]>(['Member', 'National Guest', 'Free Guest', 'Dependant-Adult', 'Dependant-Teen', 'Dependant-Children', 'International']);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [typeDistrictMap, setTypeDistrictMap] = useState<Record<string, string>>({});

  const routedDistrict = (type?: string): string => (((typeDistrictMap || {})[(type || '').trim()] || '').trim());
  const forcedTypeRouted = ROUTED_TYPES.includes(form.delegate_type || '') ? routedDistrict(form.delegate_type || '') : '';
  const districtLocked = freeGuestLocked || isDistrictScoped || (ROUTED_TYPES.includes(form.delegate_type || '') && !!forcedTypeRouted);
  const displayedDistrict = freeGuestLocked ? (routedDistrict('Free Guest') || form.district) : (forcedTypeRouted || form.district);
  
  const [successData, setSuccessData] = useState<{
    id: string;
    name: string;
    district: string;
    checkInStatus: string;
    checkInOk: boolean;
  } | null>(null);

  useEffect(() => {
    if (isDistrictScoped && !freeGuestLocked) {
        setForm(prev => ({ ...prev, district: user?.district }));
    }
  }, [user, isDistrictScoped, freeGuestLocked]);

useEffect(() => {
    if (freeGuestLocked) {
        setForm(prev => ({ ...prev, delegate_type: 'Free Guest', district: routedDistrict('Free Guest'), chapter: FREE_GUEST_CHAPTER }));
    }
}, [freeGuestLocked, typeDistrictMap]);

useEffect(() => {
    if (!freeGuestLocked && ROUTED_TYPES.includes(form.delegate_type || '')) {
        const d = routedDistrict(form.delegate_type || '');
        if (d && form.district !== d) setForm(prev => ({ ...prev, district: d }));
    }
}, [form.delegate_type, typeDistrictMap, freeGuestLocked]);

useEffect(() => { 
    db.getSettings().then(data => {
        if (data) {
            if (data.districts && data.districts.length > 0) {
                if (isRegionalScoped && user?.region) {
                    const regionPrefix = user.region.trim().toUpperCase();
                    setAvailableDistricts(data.districts.filter((d: string) => 
                        d.trim().toUpperCase().startsWith(regionPrefix)
                    ));
                } else {
                    setAvailableDistricts(data.districts);
                }
            }
            if (data.titles && data.titles.length > 0) setAvailableTitles(data.titles);
            if (data.ranks && data.ranks.length > 0) setAvailableRanks(data.ranks);
            if (data.offices && data.offices.length > 0) setAvailableOffices(data.offices);
            if (data.delegate_types && data.delegate_types.length > 0) setAvailableDelegateTypes(data.delegate_types);
            if (data.delegate_type_districts) setTypeDistrictMap(data.delegate_type_districts);
        }
    }).catch(e => console.warn("Using default lookup lists."));
  }, []);

  useEffect(() => {
    if (form.district) {
        db.getChapters(form.district).then(setChapters).catch(() => setChapters([]));
    } else {
        setChapters([]);
    }
  }, [form.district]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    if(!activeEventId || !user) {
        alert("Action Required: Please select an Active Event in the header.");
        return;
    }
    if(loading) return;

    const need = requiredFor(form.delegate_type);
    if (need.phone === true && !(form.phone || '').trim()) {
        alert(`Phone number is required for ${form.delegate_type} delegates.`);
        return;
    }
    if (need.email === true && !(form.email || '').trim()) {
        alert(`Email address is required for ${form.delegate_type} delegates.`);
        return;
    }
    if (showPaymentFields && need.payment_amount === true && paymentAmount.trim() === '') {
        alert(`Payment Amount is required for ${form.delegate_type} delegates.`);
        return;
    }
    if (showPaymentFields && need.payment_reference === true && paymentRef.trim() === '') {
        alert(`Payment Reference is required for ${form.delegate_type} delegates.`);
        return;
    }
    
    setLoading(true);
    try {
        const composedPhone = (form.phone || '').trim() ? `${dialCode}${String(form.phone).trim()}` : '';
        const parsedAmount = Number(paymentAmount);
        const payload: Partial<Delegate> = {
            ...form,
            phone: composedPhone,
            payment_amount: showPaymentFields && paymentAmount.trim() !== '' && !Number.isNaN(parsedAmount) ? parsedAmount : undefined,
            payment_reference: showPaymentFields && paymentRef.trim() !== '' ? paymentRef.trim() : undefined,
            registration_source: 'EMS',
            event_id: activeEventId
        };
        if (freeGuestLocked) {
            payload.delegate_type = 'Free Guest';
            payload.district = routedDistrict('Free Guest') || form.district;
            payload.chapter = FREE_GUEST_CHAPTER;
        } else if (ROUTED_TYPES.includes(payload.delegate_type || '')) {
            const d = routedDistrict(payload.delegate_type || '');
            if (d) payload.district = d;
        }
        if (isDistrictScoped && !freeGuestLocked) payload.district = user.district;

        const newDelegate = await db.registerDelegate(payload);
        if (!newDelegate || !newDelegate.delegate_id) throw new Error("Database persistence failure.");

        const actualId = newDelegate.delegate_id;
        const delDistrict = newDelegate.district || payload.district || 'General';
        
        let initialCheckInOk = false;
        let initialStatus = "Recorded in Master List";

        try {
            const checkInRes = await db.checkInDelegate(activeEventId, actualId, user);
            if (checkInRes && checkInRes.success) {
                initialCheckInOk = true;
                initialStatus = "Verified Successfully";
            }
        } catch (checkInErr) {
            console.warn("Auto-checkin pending manual action.");
            initialStatus = "Recorded (Pending Arrival Verify)";
        }

        setSuccessData({
            id: actualId,
            name: `${newDelegate.first_name} ${newDelegate.last_name}`,
            district: delDistrict,
            checkInOk: initialCheckInOk,
            checkInStatus: initialStatus
        });

        setForm({ 
            title: availableTitles[0] || 'Mr', first_name: '', last_name: '', phone: '', email: '', 
            district: freeGuestLocked ? (routedDistrict('Free Guest') || '') : (isDistrictScoped ? user?.district : ''), chapter: freeGuestLocked ? FREE_GUEST_CHAPTER : '', rank: 'CP', office: 'OTHER', delegate_type: freeGuestLocked ? 'Free Guest' : 'Member'
        });
        setPaymentAmount('');
        setPaymentRef('');
        
    } catch (e: any) { 
        console.error("Registration Error:", e);
        alert("Registration Failed: " + (e.message || "Connection failure.")); 
    } finally { 
        setLoading(false); 
    }
  };

  const handleManualCheckIn = async () => {
    if (isLocked) return;
    if (!successData || !user || !activeEventId || loading) return;
    setLoading(true);
    try {
        const res = await db.checkInDelegate(activeEventId, successData.id, user);
        if (res && res.success) {
            setSuccessData(prev => prev ? { ...prev, checkInOk: true, checkInStatus: "Verified Successfully" } : null);
            alert("Verification Confirmed.");
        } else {
            alert(res.message || "Verification rejected.");
        }
    } catch (e: any) {
        alert("Error: " + (e.message || "Database connection failure."));
    } finally {
        setLoading(false);
    }
  };

  const resetForNewEntry = () => {
    setSuccessData(null);
    setLoading(false);
  };

  if(!activeEventId) return (
    <div className="p-20 text-center flex flex-col items-center gap-4 opacity-75">
        <div className="text-6xl">🏷️</div>
        <h2 className="text-xl font-black text-blue-900 uppercase">Event Required</h2>
        <p className="text-xs font-bold text-gray-400 uppercase tracking-widest text-center max-w-xs">You must select an active event in the top header menu before adding delegates.</p>
    </div>
  );

  if (successData) {
    return (
      <div className="max-w-xl mx-auto animate-in zoom-in duration-300 pb-20 px-4">
        <div className="bg-white rounded-[3rem] shadow-2xl border-t-8 border-green-500 overflow-hidden">
          <div className="bg-green-50 p-10 text-center border-b border-green-100">
            <div className="w-20 h-20 bg-green-500 rounded-full flex items-center justify-center text-white text-4xl mx-auto mb-6 shadow-xl font-black">✓</div>
            <h2 className="text-2xl font-black text-green-900 uppercase tracking-tighter leading-none">Registration<br/>Confirmed</h2>
            <p className="text-green-700 font-black text-[10px] uppercase tracking-widest mt-4">{successData.name}</p>
          </div>
          
          <div className="p-10 text-center space-y-10">
             <div className={`p-4 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest leading-relaxed shadow-sm transition-all ${successData.checkInOk ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-200 animate-pulse'}`}>
                {successData.checkInStatus}
             </div>

             {!successData.checkInOk && !isLocked && (
                 <button 
                    onClick={handleManualCheckIn} 
                    disabled={loading} 
                    className="w-full py-5 bg-orange-600 hover:bg-orange-700 text-white font-black rounded-2xl uppercase text-xs tracking-widest shadow-2xl transition-all active:scale-95"
                 >
                    {loading ? 'VERIFYING...' : 'VERIFY ARRIVAL NOW'}
                 </button>
             )}

             <button 
               onClick={resetForNewEntry} 
               className="w-full py-6 bg-slate-900 hover:bg-black text-white font-black text-sm rounded-3xl shadow-2xl uppercase tracking-[0.2em] transition-all transform active:scale-[0.98]"
             >
               Add Next Delegate
             </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`max-w-4xl mx-auto space-y-8 animate-in fade-in pb-20 ${isLocked ? 'pointer-events-none opacity-80' : ''}`}>
        {isLocked && (
            <div className="bg-red-600 text-white p-4 rounded-3xl flex items-center justify-center gap-3 shadow-xl border-2 border-red-700">
                <span className="text-xl">🔒</span>
                <span className="text-xs font-black uppercase tracking-widest">Read-Only Mode: Registration Suspended</span>
            </div>
        )}

        {freeGuestLocked && (
            <div className="bg-amber-500 text-white p-4 rounded-3xl flex items-center justify-center gap-3 shadow-xl border-2 border-amber-600">
                <span className="text-xl">🎟️</span>
                <span className="text-xs font-black uppercase tracking-widest">Registrar Access: Delegate type locked to Free Guest per event configuration</span>
            </div>
        )}

        <div className="bg-white p-10 md:p-14 rounded-[3rem] shadow-2xl border border-gray-50">
            <div className="text-center mb-12">
            <h2 className="text-4xl font-black text-blue-900 tracking-tighter uppercase leading-none">New Delegate Entry</h2>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-widest mt-2">Regional Master List Synchronization</p>
            </div>
            
            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Title</label>
                    <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-bold outline-none" value={form.title} onChange={e => setForm({...form, title: e.target.value})}>
                        {availableTitles.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">First Name *</label>
                    <input required className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="REQUIRED" value={form.first_name} onChange={e => setForm({...form, first_name: e.target.value})} />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Last Name *</label>
                    <input required className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="REQUIRED" value={form.last_name} onChange={e => setForm({...form, last_name: e.target.value})} />
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                    {freeGuestLocked ? 'District (Free Guest)' : (districtLocked ? 'District (Routed)' : (isDistrictScoped ? 'District (Auto-Assigned)' : 'District *'))}
                    </label>
                    {districtLocked ? (
                    <div className={`w-full p-4 border-2 rounded-2xl flex items-center justify-between ${freeGuestLocked ? 'border-amber-100 bg-amber-50' : isDistrictScoped ? 'border-blue-50 bg-blue-50' : 'border-teal-100 bg-teal-50'}`}>
                        <span className={`font-black uppercase ${freeGuestLocked ? 'text-amber-800' : isDistrictScoped ? 'text-blue-900' : 'text-teal-800'}`}>{displayedDistrict || '—'}</span>
                        <span className={`text-[8px] font-black uppercase tracking-widest ${freeGuestLocked ? 'text-amber-500' : isDistrictScoped ? 'text-blue-400' : 'text-teal-500'}`}>Locked</span>
                    </div>
                    ) : (
                    <select required className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.district} onChange={e => setForm({...form, district: e.target.value})}>
                        <option value="">-- SELECT DISTRICT --</option>
                        {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    )}
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Chapter</label>
                    {freeGuestLocked ? (
                        <div className="w-full p-4 border-2 border-amber-100 rounded-2xl bg-amber-50 flex items-center justify-between">
                            <span className="font-black text-amber-800 uppercase">{FREE_GUEST_CHAPTER}</span>
                            <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Locked</span>
                        </div>
                    ) : chapters.length > 0 ? (
                        <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.chapter} onChange={e => setForm({...form, chapter: e.target.value})}>
                            <option value="">-- SELECT CHAPTER --</option>
                            {chapters.map(c => <option key={c.chapter_id} value={c.chapter_name}>{c.chapter_name}</option>)}
                        </select>
                    ) : (
                        <input className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="CHAPTER NAME" value={form.chapter} onChange={e => setForm({...form, chapter: e.target.value})} />
                    )}
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{reqPhone ? 'Phone *' : 'Phone'}</label>
                    <div className="flex gap-2">
                        <CountryDialSelect value={dialCode} onChange={setDialCode} />
                        <input required={reqPhone} type="tel" className="flex-1 min-w-0 w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="803..." value={form.phone || ''} onChange={e => setForm({...form, phone: e.target.value})} />
                    </div>
                </div>

                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{reqEmail ? 'Email Address *' : 'Email Address'}</label>
                    <input required={reqEmail} type="email" className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="email@example.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
                </div>
                {showPaymentFields && (
                <>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{reqAmount ? 'Payment Amount (₦) *' : 'Payment Amount (₦)'}</label>
                    <input required={reqAmount} type="number" min="0" step="0.01" className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" placeholder="0.00" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)} />
                </div>
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{reqRef ? 'Payment Reference *' : 'Payment Reference'}</label>
                    <input required={reqRef} className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="e.g. BANK-2026-0001" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} />
                </div>
                </>
                )}
                {showRank && (
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rank</label>
                    <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.rank} onChange={e => setForm({...form, rank: e.target.value})}>
                        {availableRanks.map(r => <option key={r} value={r}>{r}</option>)}
                    </select>
                </div>
                )}
                {showOffice && (
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Office</label>
                    <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.office} onChange={e => setForm({...form, office: e.target.value})}>
                        {availableOffices.map(o => <option key={o} value={o}>{o}</option>)}
                    </select>
                </div>
                )}
                {showDelegateType && (
                <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Delegate Type</label>
                    {freeGuestLocked ? (
                        <div className="w-full p-4 border-2 border-amber-100 rounded-2xl bg-amber-50 flex items-center justify-between">
                            <span className="font-black text-amber-800 uppercase">Free Guest</span>
                            <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Locked</span>
                        </div>
                    ) : (
                        <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.delegate_type} onChange={e => setForm({...form, delegate_type: e.target.value})}>
                            {availableDelegateTypes.map(dt => <option key={dt} value={dt}>{dt}</option>)}
                        </select>
                    )}
                </div>
                )}

                <div className="md:col-span-2 lg:col-span-3 pt-8">
                    <button 
                    type="submit" 
                    disabled={loading || isLocked} 
                    className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white font-black text-lg rounded-[2rem] transition-all shadow-2xl shadow-blue-200 disabled:opacity-50 uppercase tracking-[0.2em] transform active:scale-[0.98]"
                    >
                        {isLocked ? 'Event Locked' : (loading ? 'SYNCHRONIZING...' : 'Complete Registration & Verify Arrival')}
                    </button>
                </div>
            </form>
        </div>
    </div>
  );
};

export default NewDelegatePage;