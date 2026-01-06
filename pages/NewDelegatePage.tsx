
import React, { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { Delegate, SystemSettings, Rank, Office, UserRole } from '../types';
import { AppContext } from '../context/AppContext';
import { generateCodeFromId } from '../services/utils';

// Fallback defaults in case settings table is empty
const DEFAULT_TITLES = ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];
const DEFAULT_DISTRICTS = ['Lagos Central', 'Abuja Central', 'Rivers', 'Kano', 'Kaduna', 'Enugu', 'Edo', 'Anambra'];

const NewDelegatePage = () => {
  const { activeEventId, user } = useContext(AppContext);
  
  // Logic: Is this a District Registrar who should be locked to one district?
  const isDistrictScoped = (user?.role || '').toLowerCase() === UserRole.REGISTRAR && !!user?.district;
  const initialDistrict = isDistrictScoped ? (user?.district || '') : '';

  const [form, setForm] = useState<Partial<Delegate>>({ 
    title: 'Mr', first_name: '', last_name: '', phone: '', email: '', 
    district: initialDistrict, chapter: '', rank: 'CP', office: 'OTHER' 
  });
  
  const [loading, setLoading] = useState(false);
  const [availableDistricts, setAvailableDistricts] = useState<string[]>(DEFAULT_DISTRICTS);
  const [availableTitles, setAvailableTitles] = useState<string[]>(DEFAULT_TITLES);
  const [availableRanks, setAvailableRanks] = useState<string[]>([]);
  const [availableOffices, setAvailableOffices] = useState<string[]>([]);
  
  const [successData, setSuccessData] = useState<{
    id: string;
    name: string;
    code: string;
    district: string;
    checkInStatus: string;
    checkInOk: boolean;
  } | null>(null);

  // Synchronize form when user district changes (or on load)
  useEffect(() => {
    if (isDistrictScoped) {
        setForm(prev => ({ ...prev, district: user?.district }));
    }
  }, [user]);

  useEffect(() => { 
    db.getSettings().then(data => {
        if (data) {
            if (data.districts && data.districts.length > 0) setAvailableDistricts(data.districts);
            if (data.titles && data.titles.length > 0) setAvailableTitles(data.titles);
            if (data.ranks && data.ranks.length > 0) setAvailableRanks(data.ranks);
            if (data.offices && data.offices.length > 0) setAvailableOffices(data.offices);
        }
    }).catch(e => console.warn("Using default lookup lists."));
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if(!activeEventId || !user) {
        alert("Action Required: Please select an Active Event in the header.");
        return;
    }
    if(loading) return;
    
    setLoading(true);
    try {
        const payload = { ...form };
        // Force the district for scoped registrars just in case of stale state
        if (isDistrictScoped) payload.district = user.district;

        const newDelegate = await db.registerDelegate(payload);
        if (!newDelegate || !newDelegate.delegate_id) throw new Error("Database persistence failure.");

        const actualId = newDelegate.delegate_id;
        const delDistrict = newDelegate.district || payload.district || 'General';
        const displayCode = generateCodeFromId(actualId, activeEventId);
        
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
            code: displayCode,
            district: delDistrict,
            checkInOk: initialCheckInOk,
            checkInStatus: initialStatus
        });

        // Clear form for next entry
        setForm({ 
            title: availableTitles[0] || 'Mr', first_name: '', last_name: '', phone: '', email: '', 
            district: isDistrictScoped ? user?.district : '', chapter: '', rank: 'CP', office: 'OTHER' 
        });
        
    } catch (e: any) { 
        console.error("Registration Error:", e);
        alert("Registration Failed: " + (e.message || "Connection failure.")); 
    } finally { 
        setLoading(false); 
    }
  };

  const handleManualCheckIn = async () => {
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
             <div className="space-y-4">
                <label className="text-[11px] font-black text-gray-400 uppercase tracking-[0.4em]">Personal Security Code</label>
                <div className="text-8xl font-black text-blue-900 tracking-widest bg-gray-50 py-10 rounded-[2.5rem] border-2 border-gray-100 font-mono shadow-inner leading-none select-all">
                  {successData.code}
                </div>
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.1em] leading-relaxed">Required for fast session verification.</p>
             </div>

             <div className={`p-4 rounded-xl border-2 font-black uppercase text-[10px] tracking-widest leading-relaxed shadow-sm transition-all ${successData.checkInOk ? 'bg-blue-50 text-blue-600 border-blue-100' : 'bg-orange-50 text-orange-600 border-orange-200 animate-pulse'}`}>
                {successData.checkInStatus}
             </div>

             {!successData.checkInOk && (
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
    <div className="max-w-4xl mx-auto bg-white p-10 md:p-14 rounded-[3rem] shadow-2xl border border-gray-50 animate-in fade-in pb-20">
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
                  {isDistrictScoped ? 'District (Auto-Assigned)' : 'District *'}
                </label>
                {isDistrictScoped ? (
                  <div className="w-full p-4 border-2 border-blue-50 rounded-2xl bg-blue-50 flex items-center justify-between">
                    <span className="font-black text-blue-900 uppercase">{user?.district}</span>
                    <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" /></svg>
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
                <input className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black uppercase outline-none focus:bg-white focus:border-blue-500" placeholder="CHAPTER NAME" value={form.chapter} onChange={e => setForm({...form, chapter: e.target.value})} />
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Phone *</label>
                <input required type="tel" className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" placeholder="080..." value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} />
             </div>

             <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Email Address</label>
                <input type="email" className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" placeholder="email@example.com" value={form.email} onChange={e => setForm({...form, email: e.target.value})} />
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Rank</label>
                <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.rank} onChange={e => setForm({...form, rank: e.target.value})}>
                    {availableRanks.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
             </div>
             <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Office</label>
                <select className="w-full p-4 border-2 border-gray-50 rounded-2xl bg-gray-50 font-black outline-none focus:bg-white focus:border-blue-500" value={form.office} onChange={e => setForm({...form, office: e.target.value})}>
                    {availableOffices.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
             </div>

             <div className="md:col-span-2 lg:col-span-3 pt-8">
                <button 
                  type="submit" 
                  disabled={loading} 
                  className="w-full py-6 bg-blue-600 hover:bg-blue-700 text-white font-black text-lg rounded-[2rem] transition-all shadow-2xl shadow-blue-200 disabled:opacity-50 uppercase tracking-[0.2em] transform active:scale-[0.98]"
                >
                    {loading ? 'SYNCHRONIZING...' : 'Complete Registration & Verify Arrival'}
                </button>
             </div>
        </form>
    </div>
  );
};

export default NewDelegatePage;
