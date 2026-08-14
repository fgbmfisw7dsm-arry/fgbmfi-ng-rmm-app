import React, { useState, useEffect, useContext, useMemo } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { FinancialEntry, Pledge, Delegate, FinancialType, Session, getScopeFilter, PAYMENT_MODES } from '../types';
import { AppContext } from '../context/AppContext';
import { formatCurrency, exportToCSV, exportToPDF } from '../services/utils';

type PdfRow = { cells: string[]; background?: string; color?: string; bold?: boolean; colSpan?: boolean };

const buildPdfTable = (heading: string, subheading: string, headers: string[], rows: PdfRow[], numericCols: number[]): HTMLElement => {
    const root = document.createElement('div');
    root.className = 'print-mode';
    root.style.background = '#ffffff';
    root.style.padding = '24px';
    root.style.fontFamily = 'Helvetica, Arial, sans-serif';

    const h = document.createElement('div');
    h.textContent = heading;
    h.style.fontSize = '22px';
    h.style.fontWeight = 'bold';
    h.style.color = '#1e3a8a';
    h.style.marginBottom = '2px';
    root.appendChild(h);

    const sub = document.createElement('div');
    sub.textContent = subheading;
    sub.style.fontSize = '12px';
    sub.style.color = '#64748b';
    sub.style.fontWeight = 'bold';
    sub.style.textTransform = 'uppercase';
    sub.style.marginBottom = '14px';
    root.appendChild(sub);

    const table = document.createElement('table');
    table.style.width = '100%';
    table.style.borderCollapse = 'collapse';

    const thead = document.createElement('thead');
    const hr = document.createElement('tr');
    headers.forEach(hh => {
        const th = document.createElement('th');
        th.textContent = hh;
        th.style.textAlign = 'left';
        th.style.padding = '8px';
        th.style.borderBottom = '2px solid #1e3a8a';
        th.style.fontSize = '10px';
        th.style.textTransform = 'uppercase';
        th.style.color = '#1e3a8a';
        hr.appendChild(th);
    });
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(r => {
        const tr = document.createElement('tr');
        if (r.colSpan) {
            const td = document.createElement('td');
            td.textContent = r.cells[0] || '';
            td.colSpan = headers.length;
            td.style.padding = '6px 8px';
            td.style.fontSize = '11px';
            td.style.fontWeight = 'bold';
            if (r.background) td.style.background = r.background;
            if (r.color) td.style.color = r.color;
            tr.appendChild(td);
        } else {
            r.cells.forEach((c, ci) => {
                const td = document.createElement('td');
                td.textContent = c;
                td.style.padding = '6px 8px';
                td.style.borderBottom = '1px solid #e2e8f0';
                td.style.fontSize = '11px';
                if (r.background) td.style.background = r.background;
                if (r.color) td.style.color = r.color;
                if (r.bold) td.style.fontWeight = 'bold';
                if (numericCols.includes(ci)) { td.style.textAlign = 'right'; td.style.fontWeight = '700'; }
                tr.appendChild(td);
            });
        }
        tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    root.appendChild(table);
    return root;
};

const Pager = ({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) => {
    const btn = 'px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed';
    return (
        <div className="flex items-center justify-between mt-4 no-print">
            <div className="text-[10px] font-black uppercase text-gray-400">Page {page} of {totalPages}</div>
            <div className="flex gap-1">
                <button className={btn} disabled={page <= 1} onClick={() => onPage(1)}>First</button>
                <button className={btn} disabled={page <= 1} onClick={() => onPage(page - 1)}>Prev</button>
                <button className={btn} disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button>
                <button className={btn} disabled={page >= totalPages} onClick={() => onPage(totalPages)}>Last</button>
            </div>
        </div>
    );
};

const FinancialsPage = () => {
    const { activeEventId, activeEvent, user } = useContext(AppContext);
    const isLocked = activeEvent?.is_active === false;
    const pledgeNameConfig = activeEvent?.event_config?.pledge_names;
    const pledgeNames = Array.isArray(pledgeNameConfig) ? (pledgeNameConfig as string[]) : [];
    const [entries, setEntries] = useState<FinancialEntry[]>([]);
    const [pledges, setPledges] = useState<Pledge[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeTab, setActiveTab] = useState<'transactions' | 'redemptions' | 'pledges'>('transactions');
    const [loading, setLoading] = useState(false);
    const [page, setPage] = useState(1);

    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState<Delegate[]>([]);
    const [redemptionSearch, setRedemptionSearch] = useState('');
    const [redemptionResults, setRedemptionResults] = useState<Pledge[]>([]);

    const [selectedPledge, setSelectedPledge] = useState<Pledge | null>(null);
    const [tForm, setTForm] = useState<Partial<FinancialEntry>>({ amount: 0, type: FinancialType.OFFERING, session_id: '', payment_mode: '', remarks: '' });
    const [pForm, setPForm] = useState<Partial<Pledge>>({ donor_name: '', district: '', chapter: '', phone: '', email: '', amount_pledged: 0, pledge_name: '' });
    const [rForm, setRForm] = useState({ amount: 0, payment_mode: '', remarks: 'Pledge Redemption' });

    const loadData = () => {
        if (activeEventId) {
            db.getFinancialEntriesForEvent(activeEventId).then(setEntries);
            db.getPledgesForEvent(activeEventId).then(setPledges);
            db.getSessions(activeEventId).then(setSessions);
        }
    };

    useEffect(() => {
        loadData();
        const financialSub = supabase.channel('financial_realtime')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'financial_entries' }, () => loadData())
          .on('postgres_changes', { event: '*', schema: 'public', table: 'pledges' }, () => loadData())
          .subscribe();
        return () => { financialSub.unsubscribe(); };
    }, [activeEventId]);

    useEffect(() => { setPage(1); }, [activeTab, activeEventId]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (searchTerm.length > 2 && activeEventId) {
                const scope = getScopeFilter(user);
                const res = await db.searchDelegates(searchTerm, activeEventId, scope.district, undefined, scope.region);
                setSearchResults(res);
            } else setSearchResults([]);
        }, 400);
        return () => clearTimeout(timer);
    }, [searchTerm, activeEventId, user]);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (redemptionSearch.length > 1 && activeEventId) {
                const scope = getScopeFilter(user);
                const res = await db.searchPledges(redemptionSearch, activeEventId, scope.district, scope.region);
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
            amount_pledged: pForm.amount_pledged,
            pledge_name: pForm.pledge_name
        });
        setSearchTerm('');
        setSearchResults([]);
    };

    const handleSelectPledge = (p: Pledge) => {
        setSelectedPledge(p);
        setRForm({ amount: p.amount_pledged - p.amount_redeemed, payment_mode: '', remarks: 'Pledge Redemption' });
        setRedemptionSearch('');
        setRedemptionResults([]);
    };

    const submitTransaction = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLocked) return;
        if (!activeEventId) return;
        if ((tForm.amount || 0) <= 0) return alert("Enter valid amount.");
        setLoading(true);
        try {
            await db.addFinancialEntry({ ...tForm, event_id: activeEventId });
            alert("Offering Recorded!");
            loadData();
            setTForm({ amount: 0, type: FinancialType.OFFERING, session_id: '', payment_mode: '', remarks: '' });
        } catch (err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    const submitPledge = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLocked) return;
        if (!activeEventId) return;
        if (!pForm.donor_name || !pForm.district || (pForm.amount_pledged || 0) <= 0) return alert("Donor Name, District, and Amount are required.");
        setLoading(true);
        try {
            await db.createPledge({ ...pForm, event_id: activeEventId });
            alert("Pledge Recorded Successfully!");
            loadData();
            setPForm({ donor_name: '', district: '', chapter: '', phone: '', email: '', amount_pledged: 0, pledge_name: '' });
        } catch (err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    const submitRedemption = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isLocked) return;
        if (!activeEventId || !selectedPledge || rForm.amount <= 0) return alert("Invalid entry.");
        setLoading(true);
        try {
            await db.addFinancialEntry({
                event_id: activeEventId,
                type: FinancialType.PLEDGE_REDEMPTION,
                amount: rForm.amount,
                pledge_id: selectedPledge.id,
                payer_name: selectedPledge.donor_name,
                payment_mode: rForm.payment_mode || undefined,
                remarks: rForm.remarks
            });
            alert("Redemption Recorded!");
            setSelectedPledge(null);
            loadData();
        } catch (err: any) { alert("Save Failed: " + err.message); } finally { setLoading(false); }
    };

    const offeringEntries = useMemo(() => entries.filter(e => e.type === FinancialType.OFFERING), [entries]);
    const redemptionEntries = useMemo(() => entries.filter(e => e.type === FinancialType.PLEDGE_REDEMPTION), [entries]);

    const sessionOrder = useMemo(() => {
        const m = new Map<string, number>();
        sessions.forEach((s, i) => m.set(s.session_id, i));
        return m;
    }, [sessions]);
    const MASTER_INDEX = sessions.length;
    const sessionTitle = (sid?: string) => {
        if (!sid) return 'Full Event (Master)';
        return sessions.find(s => s.session_id === sid)?.title || 'Full Event (Master)';
    };

    const offeringFlat = useMemo(() => {
        const arr = [...offeringEntries];
        arr.sort((a, b) => {
            const ai = a.session_id && sessionOrder.has(a.session_id) ? sessionOrder.get(a.session_id)! : MASTER_INDEX;
            const bi = b.session_id && sessionOrder.has(b.session_id) ? sessionOrder.get(b.session_id)! : MASTER_INDEX;
            if (ai !== bi) return ai - bi;
            return (a.created_at || '').localeCompare(b.created_at || '');
        });
        return arr;
    }, [offeringEntries, sessionOrder, MASTER_INDEX]);

    const offeringTotal = useMemo(() => offeringEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0), [offeringEntries]);
    const redemptionTotal = useMemo(() => redemptionEntries.reduce((s, e) => s + (Number(e.amount) || 0), 0), [redemptionEntries]);
    const pledgeTotalPledged = useMemo(() => pledges.reduce((s, p) => s + (Number(p.amount_pledged) || 0), 0), [pledges]);
    const pledgeTotalRedeemed = useMemo(() => pledges.reduce((s, p) => s + (Number(p.amount_redeemed) || 0), 0), [pledges]);
    const pledgeTotalBalance = pledgeTotalPledged - pledgeTotalRedeemed;

    const offeringTotalsBySession = useMemo(() => {
        const m = new Map<string, number>();
        offeringEntries.forEach(e => {
            const key = e.session_id || '';
            m.set(key, (m.get(key) || 0) + (Number(e.amount) || 0));
        });
        return m;
    }, [offeringEntries]);

    const lastIndexOfSession = useMemo(() => {
        const m = new Map<string, number>();
        offeringFlat.forEach((e, i) => m.set(e.session_id || '', i));
        return m;
    }, [offeringFlat]);

    const PAGE_SIZE = 25;
    const paginate = <T,>(arr: T[], pg: number): { rows: T[]; totalPages: number; page: number; from: number; to: number; total: number } => {
        const totalPages = Math.max(1, Math.ceil(arr.length / PAGE_SIZE));
        const safePage = Math.min(pg, totalPages);
        return {
            rows: arr.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
            totalPages,
            page: safePage,
            from: arr.length === 0 ? 0 : (safePage - 1) * PAGE_SIZE + 1,
            to: Math.min(safePage * PAGE_SIZE, arr.length),
            total: arr.length
        };
    };

    const offeringPage = paginate(offeringFlat, page);
    const redemptionPage = paginate(redemptionEntries, page);
    const pledgePage = paginate(pledges, page);

    const safeEventName = (activeEvent?.name || 'Event').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const dateStamp = new Date().toISOString().slice(0, 10);
    const dateStr = (d?: string) => d ? new Date(d).toLocaleDateString() : '';
    const eventTitle = activeEvent?.name || 'Event';
    const dateRange = `${activeEvent?.start_date ? new Date(activeEvent.start_date).toLocaleDateString() : ''} — ${activeEvent?.end_date ? new Date(activeEvent.end_date).toLocaleDateString() : ''}`;

    const exportOfferingsCSV = () => {
        const cols = ['Session', 'Payment Mode', 'Amount', 'Remarks', 'Date'];
        const rows: Record<string, any>[] = [];
        offeringFlat.forEach((e, i) => {
            const key = e.session_id || '';
            rows.push({ Session: sessionTitle(e.session_id), 'Payment Mode': e.payment_mode || '-', Amount: Number(e.amount) || 0, Remarks: e.remarks || '', Date: dateStr(e.created_at) });
            if (lastIndexOfSession.get(key) === i) {
                rows.push({ Session: `${sessionTitle(e.session_id)} — SUBTOTAL`, 'Payment Mode': '', Amount: offeringTotalsBySession.get(key) || 0, Remarks: '', Date: '' });
            }
        });
        rows.push({ Session: 'GRAND TOTAL', 'Payment Mode': '', Amount: offeringTotal, Remarks: '', Date: '' });
        exportToCSV(rows, `FGBMFI_Offerings_${safeEventName}_${dateStamp}.csv`, cols);
    };

    const exportOfferingsPDF = () => {
        const rows: PdfRow[] = [];
        let currentKey: string | null = null;
        offeringFlat.forEach((e, i) => {
            const key = e.session_id || '';
            if (key !== currentKey) {
                rows.push({ cells: [sessionTitle(e.session_id)], colSpan: true, background: '#1e3a8a', color: '#ffffff', bold: true });
                currentKey = key;
            }
            rows.push({ cells: [e.payment_mode || '-', formatCurrency(e.amount), e.remarks || '-', dateStr(e.created_at)] });
            if (lastIndexOfSession.get(key) === i) {
                rows.push({ cells: ['Subtotal', '', formatCurrency(offeringTotalsBySession.get(key) || 0), ''], background: '#fbbf24', color: '#1e3a8a', bold: true });
            }
        });
        rows.push({ cells: ['Grand Total', '', formatCurrency(offeringTotal), ''], background: '#1e3a8a', color: '#ffffff', bold: true });
        exportToPDF(buildPdfTable(eventTitle, `Offerings · ${dateRange}`, ['Payment Mode', 'Amount', 'Remarks', 'Date'], rows, [1]), `FGBMFI_Offerings_${safeEventName}_${dateStamp}.pdf`, 'portrait', undefined, 'report');
    };

    const exportRedemptionsCSV = () => {
        const cols = ['Donor Name', 'Payment Mode', 'Amount', 'Date', 'Remarks'];
        const rows: Record<string, any>[] = redemptionEntries.map(e => ({ 'Donor Name': e.payer_name || '-', 'Payment Mode': e.payment_mode || '-', Amount: Number(e.amount) || 0, Date: dateStr(e.created_at), Remarks: e.remarks || '' }));
        rows.push({ 'Donor Name': 'GRAND TOTAL', 'Payment Mode': '', Amount: redemptionTotal, Date: '', Remarks: '' });
        exportToCSV(rows, `FGBMFI_Redemptions_${safeEventName}_${dateStamp}.csv`, cols);
    };

    const exportRedemptionsPDF = () => {
        const rows: PdfRow[] = redemptionEntries.map(e => ({ cells: [e.payer_name || '-', e.payment_mode || '-', formatCurrency(e.amount), dateStr(e.created_at), e.remarks || '-'] }));
        rows.push({ cells: ['Grand Total', '', formatCurrency(redemptionTotal), '', ''], background: '#1e3a8a', color: '#ffffff', bold: true });
        exportToPDF(buildPdfTable(eventTitle, `Pledge Redemptions · ${dateRange}`, ['Donor Name', 'Payment Mode', 'Amount', 'Date', 'Remarks'], rows, [2]), `FGBMFI_Redemptions_${safeEventName}_${dateStamp}.pdf`, 'portrait', undefined, 'report');
    };

    const exportPledgesCSV = () => {
        const cols = ['Donor Name', 'District', 'Pledge Name', 'Pledged', 'Redeemed', 'Balance'];
        const rows: Record<string, any>[] = pledges.map(p => ({ 'Donor Name': p.donor_name, District: p.district, 'Pledge Name': p.pledge_name || 'General', Pledged: Number(p.amount_pledged) || 0, Redeemed: Number(p.amount_redeemed) || 0, Balance: (Number(p.amount_pledged) || 0) - (Number(p.amount_redeemed) || 0) }));
        rows.push({ 'Donor Name': 'GRAND TOTAL', District: '', 'Pledge Name': '', Pledged: pledgeTotalPledged, Redeemed: pledgeTotalRedeemed, Balance: pledgeTotalBalance });
        exportToCSV(rows, `FGBMFI_Pledges_${safeEventName}_${dateStamp}.csv`, cols);
    };

    const exportPledgesPDF = () => {
        const rows: PdfRow[] = pledges.map(p => ({ cells: [p.donor_name, p.district, p.pledge_name || 'General', formatCurrency(p.amount_pledged), formatCurrency(p.amount_redeemed), formatCurrency((Number(p.amount_pledged) || 0) - (Number(p.amount_redeemed) || 0))] }));
        rows.push({ cells: ['Grand Total', '', '', formatCurrency(pledgeTotalPledged), formatCurrency(pledgeTotalRedeemed), formatCurrency(pledgeTotalBalance)], background: '#1e3a8a', color: '#ffffff', bold: true });
        exportToPDF(buildPdfTable(eventTitle, `Pledges · ${dateRange}`, ['Donor Name', 'District', 'Pledge Name', 'Pledged', 'Redeemed', 'Balance'], rows, [3, 4, 5]), `FGBMFI_Pledges_${safeEventName}_${dateStamp}.pdf`, 'portrait', undefined, 'report');
    };

    if (!activeEventId) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Active Event</div>;

    return (
        <div className={`space-y-6 ${isLocked ? 'opacity-80' : ''}`}>
            {isLocked && (
                <div className="bg-red-600 text-white p-4 rounded-2xl flex items-center justify-center gap-3 shadow-xl border-2 border-red-700">
                    <span className="text-xl">🔒</span>
                    <span className="text-xs font-black uppercase tracking-widest">Read-Only Mode: Financial Ledger Locked</span>
                </div>
            )}

            <div className="bg-white p-2 rounded-xl shadow-sm border inline-flex gap-2 no-print">
                <button onClick={() => setActiveTab('transactions')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'transactions' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Offerings</button>
                <button onClick={() => setActiveTab('redemptions')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'redemptions' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>Redemption</button>
                <button onClick={() => setActiveTab('pledges')} className={`px-5 py-2.5 rounded-lg text-sm font-black uppercase transition-all ${activeTab === 'pledges' ? 'bg-blue-600 text-white shadow-lg' : 'bg-gray-50 text-gray-400 hover:bg-gray-100'}`}>New Pledge</button>
            </div>

            {activeTab === 'transactions' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`bg-white p-8 rounded-2xl shadow-sm border h-fit ${isLocked ? 'pointer-events-none grayscale opacity-40' : ''}`}>
                        <h3 className="font-black mb-6 text-blue-900 uppercase text-xs tracking-widest border-b pb-2">Record Offering</h3>
                        <form onSubmit={submitTransaction} className="space-y-5">
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Event Session</label>
                                <select className="w-full p-3 border rounded-xl bg-gray-50 font-bold" value={tForm.session_id} onChange={e => setTForm({ ...tForm, session_id: e.target.value })}>
                                    <option value="">Full Event (Master)</option>
                                    {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Payment Mode (Optional)</label>
                                <select className="w-full p-3 border rounded-xl bg-gray-50 font-bold" value={tForm.payment_mode || ''} onChange={e => setTForm({ ...tForm, payment_mode: e.target.value })}>
                                    <option value="">Select Payment Mode</option>
                                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                </select>
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Amount (NGN)</label>
                                <input type="number" className="w-full p-3 border rounded-xl font-black text-2xl text-blue-600 bg-blue-50/30" placeholder="0.00" value={tForm.amount || ''} onChange={e => setTForm({ ...tForm, amount: parseFloat(e.target.value) })} />
                            </div>
                            <button type="submit" disabled={loading || isLocked} className="w-full py-4 bg-green-600 hover:bg-green-700 text-white font-black rounded-xl shadow-xl transition-all disabled:opacity-50 uppercase text-sm tracking-widest">
                                {isLocked ? 'LOCKED' : (loading ? 'SAVING...' : 'RECORD OFFERING')}
                            </button>
                        </form>
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                        <div className="flex items-center justify-between mb-4 border-b pb-3">
                            <h3 className="font-black text-blue-900 uppercase text-lg tracking-wide">Offerings</h3>
                            <div className="flex gap-2 no-print">
                                <button onClick={exportOfferingsPDF} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-blue-900 text-white hover:bg-blue-800">PDF</button>
                                <button onClick={exportOfferingsCSV} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-green-700 text-white hover:bg-green-800">CSV</button>
                            </div>
                        </div>
                        <div className="text-[10px] font-black uppercase text-gray-400 mb-2">Showing {offeringPage.from}–{offeringPage.to} of {offeringPage.total} offerings</div>
                        <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] uppercase text-gray-400 font-black"><th className="p-4">Payment Mode</th><th className="p-4 text-right">Amount</th><th className="p-4">Remarks</th><th className="p-4">Date</th></tr></thead>
                            <tbody className="divide-y">
                                {offeringPage.rows.length === 0 && (
                                    <tr><td colSpan={4} className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">No offerings recorded</td></tr>
                                )}
                                {(() => {
                                    const tokens: { type: string; title?: string; e?: FinancialEntry; total?: number }[] = [];
                                    let currentKey: string | null = null;
                                    offeringPage.rows.forEach((e, i) => {
                                        const key = e.session_id || '';
                                        if (key !== currentKey) {
                                            tokens.push({ type: 'header', title: sessionTitle(e.session_id) });
                                            currentKey = key;
                                        }
                                        tokens.push({ type: 'entry', e });
                                        if (lastIndexOfSession.get(key) === (offeringPage.page - 1) * PAGE_SIZE + i) {
                                            tokens.push({ type: 'subtotal', total: offeringTotalsBySession.get(key) || 0 });
                                        }
                                    });
                                    return tokens.map((t, i) => {
                                        if (t.type === 'header') {
                                            return <tr key={i} className="bg-blue-900 text-white"><td colSpan={4} className="p-3 font-black uppercase text-[11px]">{t.title}</td></tr>;
                                        }
                                        if (t.type === 'subtotal') {
                                            return (
                                                <tr key={i} className="bg-blue-50 font-black">
                                                    <td colSpan={2} className="p-3 uppercase text-[10px] text-blue-900">Subtotal</td>
                                                    <td className="p-3 text-right text-blue-900">{formatCurrency(t.total || 0)}</td>
                                                    <td></td>
                                                </tr>
                                            );
                                        }
                                        const e = t.e!;
                                        return (
                                            <tr key={i} className="hover:bg-gray-50">
                                                <td className="p-4 font-bold text-gray-800">{e.payment_mode || '-'}</td>
                                                <td className="p-4 font-black text-blue-700 text-right">{formatCurrency(e.amount)}</td>
                                                <td className="p-4 text-gray-500 italic font-medium">{e.remarks || '-'}</td>
                                                <td className="p-4 text-gray-400 font-bold uppercase text-[9px]">{dateStr(e.created_at)}</td>
                                            </tr>
                                        );
                                    });
                                })()}
                            </tbody>
                            {offeringEntries.length > 0 && (
                                <tfoot>
                                    <tr className="bg-blue-900 text-white font-black">
                                        <td colSpan={2} className="p-4 uppercase">Grand Total</td>
                                        <td className="p-4 text-right">{formatCurrency(offeringTotal)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        <Pager page={offeringPage.page} totalPages={offeringPage.totalPages} onPage={setPage} />
                    </div>
                </div>
            )}

            {activeTab === 'redemptions' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`bg-white p-8 rounded-2xl shadow-sm border h-fit ${isLocked ? 'pointer-events-none grayscale opacity-40' : ''}`}>
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
                                    <input type="number" className="w-full p-4 border rounded-xl font-black text-2xl text-green-700 bg-green-50/30" value={rForm.amount} onChange={e => setRForm({ ...rForm, amount: parseFloat(e.target.value) })} />
                                    <div className="text-[10px] text-red-600 font-black text-right mt-1">Bal: {formatCurrency(selectedPledge.amount_pledged - selectedPledge.amount_redeemed)}</div>
                                </div>
                                <div className="space-y-1">
                                    <label className="text-[10px] font-black text-gray-400 uppercase">Payment Mode (Optional)</label>
                                    <select className="w-full p-3 border rounded-xl bg-gray-50 font-bold" value={rForm.payment_mode} onChange={e => setRForm({ ...rForm, payment_mode: e.target.value })}>
                                        <option value="">Select Payment Mode</option>
                                        {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                                    </select>
                                </div>
                                <button type="submit" disabled={loading || isLocked} className="w-full py-5 bg-blue-600 text-white font-black rounded-xl shadow-xl disabled:opacity-50 uppercase tracking-widest text-xs">
                                    {isLocked ? 'LOCKED' : (loading ? 'PROCESSING...' : 'RECORD REDEMPTION')}
                                </button>
                            </form>
                        )}
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                        <div className="flex items-center justify-between mb-4 border-b pb-3">
                            <h3 className="font-black text-blue-900 uppercase text-lg tracking-wide">Pledge Redemptions</h3>
                            <div className="flex gap-2 no-print">
                                <button onClick={exportRedemptionsPDF} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-blue-900 text-white hover:bg-blue-800">PDF</button>
                                <button onClick={exportRedemptionsCSV} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-green-700 text-white hover:bg-green-800">CSV</button>
                            </div>
                        </div>
                        <div className="text-[10px] font-black uppercase text-gray-400 mb-2">Showing {redemptionPage.from}–{redemptionPage.to} of {redemptionPage.total} redemptions</div>
                        <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400"><th className="p-4">Donor Name</th><th className="p-4">Payment Mode</th><th className="p-4 text-right">Amount</th><th className="p-4">Date</th><th className="p-4">Remarks</th></tr></thead>
                            <tbody className="divide-y">
                                {redemptionPage.rows.length === 0 && (
                                    <tr><td colSpan={5} className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">No redemptions recorded</td></tr>
                                )}
                                {redemptionPage.rows.map((p, i) => (
                                    <tr key={i} className="hover:bg-gray-50">
                                        <td className="p-4 font-black text-gray-800 uppercase text-[11px]">{p.payer_name}</td>
                                        <td className="p-4 font-bold text-gray-800">{p.payment_mode || '-'}</td>
                                        <td className="p-4 font-black text-green-700 text-right">{formatCurrency(p.amount)}</td>
                                        <td className="p-4 text-gray-400 font-bold uppercase text-[9px]">{dateStr(p.created_at)}</td>
                                        <td className="p-4 text-gray-500 italic font-medium">{p.remarks}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {redemptionEntries.length > 0 && (
                                <tfoot>
                                    <tr className="bg-blue-900 text-white font-black">
                                        <td colSpan={2} className="p-4 uppercase">Grand Total</td>
                                        <td className="p-4 text-right">{formatCurrency(redemptionTotal)}</td>
                                        <td colSpan={2}></td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        <Pager page={redemptionPage.page} totalPages={redemptionPage.totalPages} onPage={setPage} />
                    </div>
                </div>
            )}

            {activeTab === 'pledges' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className={`bg-white p-8 rounded-2xl shadow-sm border h-fit ${isLocked ? 'pointer-events-none grayscale opacity-40' : ''}`}>
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
                                <input className="w-full p-3 border rounded-xl font-bold bg-white" placeholder="Required" value={pForm.donor_name} onChange={e => setPForm({ ...pForm, donor_name: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">District</label>
                                <input className="w-full p-3 border rounded-xl font-bold bg-white" placeholder="Required" value={pForm.district} onChange={e => setPForm({ ...pForm, district: e.target.value })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Pledge Amount (NGN)</label>
                                <input type="number" className="w-full p-3 border rounded-xl font-black text-2xl text-blue-600 bg-blue-50/30" placeholder="0.00" value={pForm.amount_pledged || ''} onChange={e => setPForm({ ...pForm, amount_pledged: parseFloat(e.target.value) })} />
                            </div>
                            <div className="space-y-1">
                                <label className="text-[10px] font-black text-gray-400 uppercase">Pledge Name</label>
                                <select className="w-full p-3 border rounded-xl font-bold bg-white" value={pForm.pledge_name || ''} onChange={e => setPForm({ ...pForm, pledge_name: e.target.value })}>
                                    <option value="">General</option>
                                    {pledgeNames.map(name => (
                                        <option key={name} value={name}>{name}</option>
                                    ))}
                                </select>
                            </div>
                            <button type="submit" disabled={loading || isLocked} className="w-full py-4 bg-blue-900 text-white font-black rounded-xl shadow-xl transition-all disabled:opacity-50 uppercase tracking-widest text-sm">
                                {isLocked ? 'LOCKED' : (loading ? 'SAVING...' : 'RECORD PLEDGE')}
                            </button>
                        </form>
                    </div>
                    <div className="lg:col-span-2 bg-white p-8 rounded-2xl shadow-sm border overflow-x-auto">
                        <div className="flex items-center justify-between mb-4 border-b pb-3">
                            <h3 className="font-black text-blue-900 uppercase text-lg tracking-wide">New Pledges</h3>
                            <div className="flex gap-2 no-print">
                                <button onClick={exportPledgesPDF} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-blue-900 text-white hover:bg-blue-800">PDF</button>
                                <button onClick={exportPledgesCSV} className="px-3 py-1.5 rounded-lg text-[10px] font-black uppercase bg-green-700 text-white hover:bg-green-800">CSV</button>
                            </div>
                        </div>
                        <div className="text-[10px] font-black uppercase text-gray-400 mb-2">Showing {pledgePage.from}–{pledgePage.to} of {pledgePage.total} pledges</div>
                        <table className="w-full text-xs text-left min-w-[500px]">
                            <thead><tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400"><th className="p-4">Donor Name</th><th className="p-4">District</th><th className="p-4">Pledge Name</th><th className="p-4 text-right">Pledged</th><th className="p-4 text-right">Redeemed</th><th className="p-4 text-right">Balance</th></tr></thead>
                            <tbody className="divide-y">
                                {pledgePage.rows.length === 0 && (
                                    <tr><td colSpan={6} className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">No pledges recorded</td></tr>
                                )}
                                {pledgePage.rows.map(p => (
                                    <tr key={p.id} className="hover:bg-gray-50">
                                        <td className="p-4 font-black text-gray-800 uppercase text-[11px]">{p.donor_name}</td>
                                        <td className="p-4 text-gray-500 font-black uppercase text-[9px]">{p.district}</td>
                                        <td className="p-4 text-purple-700 font-black uppercase text-[9px]">{p.pledge_name || 'General'}</td>
                                        <td className="p-4 font-bold text-right">{formatCurrency(p.amount_pledged)}</td>
                                        <td className="p-4 text-green-700 font-bold text-right">{formatCurrency(p.amount_redeemed)}</td>
                                        <td className="p-4 text-right text-red-600 font-black">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</td>
                                    </tr>
                                ))}
                            </tbody>
                            {pledges.length > 0 && (
                                <tfoot>
                                    <tr className="bg-blue-900 text-white font-black">
                                        <td colSpan={3} className="p-4 uppercase">Grand Total</td>
                                        <td className="p-4 text-right">{formatCurrency(pledgeTotalPledged)}</td>
                                        <td className="p-4 text-right">{formatCurrency(pledgeTotalRedeemed)}</td>
                                        <td className="p-4 text-right">{formatCurrency(pledgeTotalBalance)}</td>
                                    </tr>
                                </tfoot>
                            )}
                        </table>
                        <Pager page={pledgePage.page} totalPages={pledgePage.totalPages} onPage={setPage} />
                    </div>
                </div>
            )}
        </div>
    );
}

export default FinancialsPage;
