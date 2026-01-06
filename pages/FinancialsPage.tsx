
import React, { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { FinancialEntry, Pledge, Delegate, FinancialType, Session, UserRole } from '../types';
import { AppContext } from '../context/AppContext';
import { formatCurrency } from '../services/utils';

const FinancialsPage = () => {
    const { activeEventId, user } = useContext(AppContext);
    const [entries, setEntries] = useState<FinancialEntry[]>([]);
    const [pledges, setPledges] = useState<Pledge[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeTab, setActiveTab] = useState<'transactions' | 'redemptions' | 'pledges'>('transactions');
    const [loading, setLoading] = useState(false);
    
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Delegate[]>([]);
    const [redemptionSearch, setRedemptionSearch] = useState('');
    const [redemptionResults, setRedemptionResults] = useState<Pledge[]>([]);
    
    const [selectedPledge, setSelectedPledge] = useState<Pledge | null>(null);
    const [tForm, setTForm] = useState<Partial<FinancialEntry>>({ amount: 0, type: FinancialType.OFFERING, session_id: '', payer_name: '', remarks: '' });
    const [pForm, setPForm] = useState<Partial<Pledge>>({ donor_name: '', district: '', chapter: '', phone: '', email: '', amount_pledged: 0 });
    const [rForm, setRForm] = useState({ amount: 0, remarks: 'Pledge Redemption' });

    const loadData = () => {
        if(activeEventId) {
            db.getAllDataForExport(activeEventId).then(d => { 
                setEntries(d.financials || []); 
                setPledges(d.pledges || []);
            });
            db.getSessions(activeEventId).then(setSessions);
        }
    };

    useEffect(() => {
        loadData();
        const financialSub = supabase.channel('financial_realtime')
          .on('postgres_changes', { event: '*', table: 'financial_entries' }, () => loadData())
          .on('postgres_changes', { event: '*', table: 'pledges' }, () => loadData())
          .subscribe();
        return () => { financialSub.unsubscribe(); };
    }, [activeEventId]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if(searchTerm.length > 2 && activeEventId) {
                const districtFilter = (user?.role === UserRole.REGISTRAR && user.district) ? user.district : undefined;
                const res = await db.searchDelegates(searchTerm, activeEventId, districtFilter);
                setSearchResults(res);
            } else setSearchResults([]);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm, activeEventId, user]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (redemptionSearch.length > 1 && activeEventId) {
                const districtFilter = (user?.role === UserRole.REGISTRAR && user.district) ? user.district : undefined;
                const res = await db.searchPledges(redemptionSearch, activeEventId, districtFilter);
                setRedemptionResults(res);
            } else setRedemptionResults([]);
        }, 400);
        return () => clearTimeout(timer);
    }, [redemptionSearch, activeEventId, user]);

    const selectDonorForPledge = (d: Delegate) => {
        setPForm({ 
            donor_name: `${d.first_name} ${d.last_name}`, 
            district: d.district, 
            chapter: d.chapter || '', 
            phone: d.phone || '', 
            email: d.email || '', 
            amount_pledged: pForm.amount_pledged 
        });
        setSearchTerm(''); 
        setSearchResults([]);
    };

    const handleSelectPledge = (p: Pledge) => {
        setSelectedPledge(p);
        setRForm({ amount: p.amount_pledged - p.amount_redeemed, remarks: 'Pledge Redemption' });
        setRedemptionSearch('');
        setRedemptionResults([]);
    };

    const submitTransaction = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeEventId) return;
        if ((tForm.amount || 0) <= 0) return alert("Enter valid amount.");
        setLoading(true);
        try { 
            await db.addFinancialEntry({ ...tForm, event_id: activeEventId }); 
            alert("Offering Recorded!"); 
            loadData(); 
            setTForm({ amount: 0, type: FinancialType.OFFERING, session_id: '', payer_name: '', remarks: '' }); 
        } catch(err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    const submitPledge = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeEventId) return;
        if (!pForm.donor_name || !pForm.district || (pForm.amount_pledged || 0) <= 0) return alert("Donor Name, District, and Amount are required.");
        setLoading(true);
        try { 
            await db.createPledge({ ...pForm, event_id: activeEventId }); 
            alert("Pledge Recorded Successfully!"); 
            loadData(); 
            setPForm({ donor_name: '', district: '', chapter: '', phone: '', email: '', amount_pledged: 0 }); 
        } catch(err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    const submitRedemption = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!activeEventId || !selectedPledge || rForm.amount <= 0) return alert("Invalid entry.");
        setLoading(true);
        try {
            await db.addFinancialEntry({
                event_id: activeEventId, 
                type: FinancialType.PLEDGE_REDEMPTION,
                amount: rForm.amount, 
                pledge_id: selectedPledge.id, 
                payer_name: selectedPledge.donor_name, 
                remarks: rForm.remarks
            });
            alert("Redemption Recorded!"); 
            setSelectedPledge(null);
            loadData();
        } catch(err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    if(!activeEventId) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Active Event</div>;

    return (
        <div className="space-y-6">
            <div className="bg-white p-2 rounded-xl shadow-sm border inline-flex gap-2 no-print">
                <button onClick={() => setActiveTab('transactions')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'transactions' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Offerings</button>
                <button onClick={() => setActiveTab('redemptions')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'redemptions' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Redemption</button>
                <button onClick={() => setActiveTab('pledges')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'pledges' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>New Pledge</button>
            </div>

            {activeTab === 'transactions' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit">
                        <h3 className="font-black mb-6 text-blue-900 uppercase text-xs tracking-widest border-b pb-2">Record Offering</h3>
                        <form onSubmit={submitTransaction} className="space-y-5">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Event Session</label>
                                <select className="w-full p-3 border rounded-xl bg-gray-50 font-bold" value={tForm.session_id} onChange={e => setTForm({...tForm, session_id: e.target.value})}>
                                    <option value="">Full Event (Master)</option>
                                    {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Payer Name (Optional)</label>
                                <input className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-blue-500 font-medium" placeholder="e.g. Bro John" value={tForm.payer_name} onChange={e => setTForm({...tForm, payer_name: e.target.value})} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Amount (NGN)</label>
                                <input type="number" className="w-full p-3 border rounded-xl font-black text-2xl text-blue-600 bg-blue-50/30" placeholder="0.00" value={tForm.amount || ''} onChange={e => setTForm({...tForm, amount: parseFloat(e.target.value)})} />
                            </div>
                            <button type="submit" disabled={loading} className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black rounded-xl shadow-xl transition-all disabled:opacity-50 uppercase text-sm tracking-widest">
                                {loading ? 'SAVING...' : 'RECORD OFFERING'}
                            </button>
                        </form>
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                         <h3 className="font-black mb-6 uppercase text-[10px] text-gray-400 tracking-widest border-b pb-2">Latest Records</h3>
                         <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] uppercase text-gray-400 font-black"><th className="p-4">Session</th><th className="p-4">Name</th><th className="p-4 text-right">Amount</th><th className="p-4">Remarks</th></tr></thead>
                            <tbody className="divide-y">
                                {entries.filter(e => e.type === FinancialType.OFFERING).slice(-15).reverse().map((p, i) => {
                                    const s = sessions.find(sn => sn.session_id === p.session_id);
                                    return (
                                        <tr key={i} className="hover:bg-gray-50">
                                            <td className="p-4 text-[10px] font-black text-gray-400 uppercase">{s?.title || 'Full Event'}</td>
                                            <td className="p-4 font-bold text-gray-800">{p.payer_name}</td>
                                            <td className="p-4 font-black text-blue-700 text-right">{formatCurrency(p.amount)}</td>
                                            <td className="p-4 text-gray-500 italic font-medium">{p.remarks || '-'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                         </table>
                    </div>
                </div>
            )}

            {activeTab === 'redemptions' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit">
                        <h3 className="font-black mb-6 text-blue-900 uppercase text-xs tracking-widest border-b pb-2">Process Redemption</h3>
                        {!selectedPledge ? (
                            <div className="relative mb-4">
                                <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-wider">Search Pledge Donor</label>
                                <input className="w-full p-4 border rounded-xl bg-blue-50/50 focus:ring-2 focus:ring-blue-500 font-bold text-blue-900" placeholder="Type name..." value={redemptionSearch} onChange={e => setRedemptionSearch(e.target.value)} />
                                {redemptionResults.length > 0 && (
                                    <div className="absolute z-10 w-full bg-white border shadow-2xl mt-1 rounded-xl max-h-60 overflow-auto divide-y border-gray-100">
                                        {redemptionResults.map(p => (
                                            <div key={p.id} onClick={() => handleSelectPledge(p)} className="p-4 hover:bg-blue-50 cursor-pointer flex justify-between items-center transition-all">
                                                <div className="flex-1">
                                                    <div className="font-black text-blue-900 text-sm uppercase">{p.donor_name}</div>
                                                    <div className="text-[9px] text-gray-400 uppercase font-black">{p.district} DISTRICT</div>
                                                </div>
                                                <div className="text-right">
                                                    <div className="font-black text-red-600 text-sm">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : (
                            <form onSubmit={submitRedemption} className="space-y-5">
                                <div className="p-4 bg-blue-900 text-white rounded-xl flex justify-between items-center shadow-lg">
                                    <div className="flex-1">
                                        <div className="text-[8px] font-black text-blue-300 uppercase">Selected Donor</div>
                                        <div className="font-black text-sm uppercase truncate">{selectedPledge.donor_name}</div>
                                    </div>
                                    <button type="button" onClick={() => setSelectedPledge(null)} className="text-white text-[9px] font-black uppercase bg-blue-800 px-3 py-1.5 rounded-lg">Change</button>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-gray-400 uppercase">Payment Amount</label>
                                    <input type="number" className="w-full p-4 border rounded-xl font-black text-2xl text-green-700 bg-green-50/30" value={rForm.amount} onChange={e => setRForm({...rForm, amount: parseFloat(e.target.value)})} />
                                    <div className="text-[10px] text-red-600 font-black text-right mt-1">Bal: {formatCurrency(selectedPledge.amount_pledged - selectedPledge.amount_redeemed)}</div>
                                </div>
                                <button type="submit" disabled={loading} className="w-full py-5 bg-blue-600 text-white font-black rounded-xl shadow-xl disabled:opacity-50 uppercase tracking-widest text-xs">
                                    {loading ? 'PROCESSING...' : 'RECORD REDEMPTION'}
                                </button>
                            </form>
                        )}
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                         <h3 className="font-black mb-6 uppercase text-[10px] text-gray-400 tracking-widest border-b pb-2">Recent Redemptions</h3>
                         <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400"><th className="p-4">Donor Name</th><th className="p-4 text-right">Amount</th><th className="p-4">Date</th><th className="p-4">Remarks</th></tr></thead>
                            <tbody className="divide-y">
                                {entries.filter(e => e.type === FinancialType.PLEDGE_REDEMPTION).slice(-15).reverse().map((p, i) => (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="p-4 font-black text-gray-800 uppercase text-[11px]">{p.payer_name}</td>
                                        <td className="p-4 font-black text-green-700 text-right">{formatCurrency(p.amount)}</td>
                                        <td className="p-4 text-gray-400 font-bold uppercase text-[9px]">{new Date(p.created_at).toLocaleDateString()}</td>
                                        <td className="p-4 text-gray-500 italic font-medium">{p.remarks}</td>
                                    </tr>
                                ))}
                            </tbody>
                         </table>
                    </div>
                </div>
            )}

            {activeTab === 'pledges' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit">
                        <h3 className="font-black mb-6 text-blue-900 uppercase text-xs tracking-widest border-b pb-2">New Pledge Entry</h3>
                        <div className="relative mb-6">
                            <label className="text-[10px] font-black text-gray-400 block mb-2 uppercase tracking-wider">Donor Lookup</label>
                            <input className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-sm" placeholder="Search master list..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                            {searchResults.length > 0 && (
                                <div className="absolute z-20 w-full bg-white border shadow-2xl mt-1 rounded-xl max-h-56 overflow-auto divide-y border-gray-100">
                                    {searchResults.map(d => (
                                        <div key={d.delegate_id} onClick={() => selectDonorForPledge(d)} className="p-3 hover:bg-blue-50 cursor-pointer text-[11px] font-black text-gray-700 uppercase transition-all">
                                            {d.first_name} {d.last_name} <span className="text-blue-500 ml-1">({d.district})</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        <form onSubmit={submitPledge} className="space-y-5">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Donor Name</label>
                                <input className="w-full p-3 border rounded-xl font-bold bg-white" placeholder="Required" value={pForm.donor_name} onChange={e => setPForm({...pForm, donor_name: e.target.value})} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">District</label>
                                <input className="w-full p-3 border rounded-xl font-bold bg-white" placeholder="Required" value={pForm.district} onChange={e => setPForm({...pForm, district: e.target.value})} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Pledge Amount (NGN)</label>
                                <input type="number" className="w-full p-3 border rounded-xl font-black text-2xl text-blue-600 bg-blue-50/30" placeholder="0.00" value={pForm.amount_pledged || ''} onChange={e => setPForm({...pForm, amount_pledged: parseFloat(e.target.value)})} />
                            </div>
                            <button type="submit" disabled={loading} className="w-full py-4 bg-blue-900 text-white font-black rounded-xl shadow-xl transition-all disabled:opacity-50 uppercase tracking-widest text-sm">
                                {loading ? 'SAVING...' : 'RECORD PLEDGE'}
                            </button>
                        </form>
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                        <h3 className="font-black mb-6 uppercase text-[10px] text-gray-400 tracking-widest border-b pb-2">Active Pledges</h3>
                        <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400"><th className="p-4">Donor Name</th><th className="p-4">District</th><th className="p-4 text-right">Pledged</th><th className="p-4 text-right">Redeemed</th><th className="p-4 text-right">Balance</th></tr></thead>
                            <tbody className="divide-y">
                                {pledges.map(p => (
                                    <tr key={p.id} className="hover:bg-gray-50">
                                        <td className="p-4 font-black text-gray-800 uppercase text-[11px]">{p.donor_name}</td>
                                        <td className="p-4 text-gray-500 font-black uppercase text-[9px]">{p.district}</td>
                                        <td className="p-4 font-bold text-right">{formatCurrency(p.amount_pledged)}</td>
                                        <td className="p-4 text-green-700 font-bold text-right">{formatCurrency(p.amount_redeemed)}</td>
                                        <td className="p-4 text-right text-red-600 font-black">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}

export default FinancialsPage;
