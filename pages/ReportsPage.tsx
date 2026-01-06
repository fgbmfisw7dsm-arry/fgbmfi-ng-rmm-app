
import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { db } from '../services/supabaseService';
import { UserRole, FinancialType, Session, Event, SystemSettings } from '../types';
import { AppContext } from '../context/AppContext';
import { formatCurrency, exportToPDF } from '../services/utils';

const ReportsPage = () => {
    const { activeEventId, user } = useContext(AppContext);
    const [data, setData] = useState<any>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [events, setEvents] = useState<Event[]>([]);
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [activeTab, setActiveTab] = useState<'attendanceList' | 'attendanceMatrix' | 'financialMatrix' | 'pledgeSummary' | 'pledgeList'>('attendanceList');
    const [selectedSessionId, setSelectedSessionId] = useState<string>('');
    const [loading, setLoading] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!activeEventId) return;
        setLoading(true);
        Promise.all([
            db.getAllDataForExport(activeEventId), 
            db.getSessions(activeEventId), 
            db.getEvents(),
            db.getSettings()
        ])
        .then(([exportData, sessionData, eventList, sysSettings]) => {
            const userDistrict = user?.district ? user.district.trim().toLowerCase() : null;
            if (user?.role === UserRole.REGISTRAR && userDistrict) {
                exportData.delegates = (exportData.delegates || []).filter((d: any) => 
                    (d.district || '').trim().toLowerCase() === userDistrict
                );
                const myDelegateIds = new Set(exportData.delegates.map((d: any) => d.delegate_id));
                exportData.checkins = (exportData.checkins || []).filter((c: any) => myDelegateIds.has(c.delegate_id));
                exportData.pledges = (exportData.pledges || []).filter((p: any) => 
                    (p.district || '').trim().toLowerCase() === userDistrict
                );
            }
            setData(exportData);
            setSessions(sessionData);
            setEvents(eventList);
            setSettings(sysSettings);
        }).catch(err => {
            console.error("Reports Load Error:", err);
            setData({});
        }).finally(() => setLoading(false));
    }, [activeEventId, user]);

    const reportData = useMemo(() => {
        if (!data || !settings) return null;
        const { delegates = [], checkins = [], financials = [], pledges = [] } = data;
        
        const filteredCheckIns = selectedSessionId 
            ? checkins.filter((c: any) => c.session_id === selectedSessionId)
            : checkins.filter((c: any, idx: number, self: any[]) => self.findIndex((t: any) => t.delegate_id === c.delegate_id) === idx);

        const attendedDelegates = filteredCheckIns.map((c: any) => {
            const d = delegates.find((del: any) => del.delegate_id === c.delegate_id);
            return d ? { ...d, district: (d.district || '').trim(), checked_in_at: c.checked_in_at } : null;
        }).filter(Boolean);

        const officialDistricts = (settings.districts || [])
            .map(d => d.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
            
        // Matrix columns should include both ranks and offices to be safe
        const matrixColumns = Array.from(new Set([...settings.ranks, ...settings.offices])).sort();

        return { delegates, checkins, financials, pledges, attendedDelegates, officialDistricts, matrixColumns };
    }, [data, selectedSessionId, settings]);

    const handleExportPDF = () => { if (reportRef.current) exportToPDF(reportRef.current, `Report_${activeTab}.pdf`, 'landscape'); };

    if (!activeEventId) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Event</div>;
    if (loading || !reportData) return <div className="p-20 text-center text-gray-400 font-bold animate-pulse uppercase tracking-widest">Processing Data Analytics...</div>;

    const { attendedDelegates, officialDistricts, matrixColumns, financials, pledges } = reportData;
    const selectedSessionTitle = sessions.find(s => s.session_id === selectedSessionId)?.title;

    const renderAttendanceList = () => {
        const districtGroups = [...officialDistricts, "Legacy / Uncategorized"];
        
        return (
            <div className="overflow-x-auto w-full">
                {districtGroups.map(districtName => {
                    const districtDelegates = attendedDelegates.filter((d: any) => {
                        const dNorm = (d.district || '').trim();
                        if (districtName === "Legacy / Uncategorized") {
                            return !officialDistricts.some(od => od.toUpperCase() === dNorm.toUpperCase());
                        }
                        return dNorm.toUpperCase() === districtName.toUpperCase();
                    });

                    if (districtDelegates.length === 0) return null;

                    const sortedDistrictDelegates = [...districtDelegates].sort((a, b) => 
                        `${a.first_name} ${a.last_name}`.localeCompare(`${b.first_name} ${b.last_name}`)
                    );

                    return (
                        <div key={districtName} className="mb-8 break-inside-avoid">
                            <div className="bg-blue-900 text-white p-2 font-black uppercase text-xs border border-blue-800 flex justify-between">
                                <span>{districtName}</span>
                                <span className="bg-white/20 px-2 rounded">Total: {districtDelegates.length}</span>
                            </div>
                            <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-[1000px]">
                                <thead>
                                    <tr className="bg-gray-50 font-black uppercase text-gray-400">
                                        <th className="border p-2 w-8 text-center">S/N</th>
                                        <th className="border p-2">Full Name</th>
                                        <th className="border p-2">Office</th>
                                        <th className="border p-2">Email</th>
                                        <th className="border p-2">Rank</th>
                                        <th className="border p-2">Chapter</th>
                                        <th className="border p-2">Phone</th>
                                        <th className="border p-2 text-center">Entry Timestamp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedDistrictDelegates.map((d: any, idx: number) => (
                                        <tr key={d.delegate_id} className="hover:bg-gray-50">
                                            <td className="border p-2 text-center text-gray-400 font-bold">{idx + 1}</td>
                                            <td className="border p-2 font-black uppercase">{d.title} {d.first_name} {d.last_name}</td>
                                            <td className="border p-2 font-bold text-gray-600 uppercase">{d.office || '-'}</td>
                                            <td className="border p-2 font-medium lowercase text-blue-600">{d.email || '-'}</td>
                                            <td className="border p-2 font-bold text-blue-800">{d.rank}</td>
                                            <td className="border p-2 uppercase text-gray-500">{d.chapter}</td>
                                            <td className="border p-2 font-mono">{d.phone}</td>
                                            <td className="border p-2 text-center text-gray-400">
                                                {d.checked_in_at ? (
                                                    <>
                                                        <span className="block font-black text-gray-500">{new Date(d.checked_in_at).toLocaleDateString([], {day:'2-digit', month:'short'})}</span>
                                                        <span>{new Date(d.checked_in_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </>
                                                ) : '-'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    );
                })}
            </div>
        );
    };
    
    const renderAttendanceMatrix = () => {
        const rowLabels = [...officialDistricts, "Other Entities"];
        const colTotals: Record<string, number> = {};
        matrixColumns.forEach(c => colTotals[c] = 0);
        let grandTotal = 0;

        return (
            <div className="overflow-x-auto w-full">
                <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-[1200px]">
                    <thead>
                        <tr className="bg-gray-100 uppercase font-black text-gray-600">
                            <th className="border p-2 text-left bg-gray-100 sticky left-0 z-10 w-48">District / Entity</th>
                            {matrixColumns.map(col => <th key={col} className="border p-2 text-center">{col}</th>)}
                            <th className="border p-2 text-center bg-blue-100 text-blue-900 w-24">Total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rowLabels.map(rowName => {
                            const rowDelegates = attendedDelegates.filter((del: any) => {
                                const dn = (del.district || '').trim().toUpperCase();
                                if (rowName === "Other Entities") {
                                    return !officialDistricts.some(od => od.toUpperCase() === dn);
                                }
                                return dn === rowName.toUpperCase();
                            });
                            
                            if (rowDelegates.length === 0) return null;
                            const rowHeadCount = rowDelegates.length;
                            grandTotal += rowHeadCount;

                            return (
                                <tr key={rowName} className="hover:bg-gray-50 transition-colors">
                                    <td className="border p-2 font-black uppercase bg-gray-50 sticky left-0 z-10 text-[9px]">{rowName}</td>
                                    {matrixColumns.map(col => {
                                        // Specific Rule: Count National/External District once by Office
                                        const count = rowDelegates.filter(d => {
                                            const isNational = (d.district || '').trim().toUpperCase() === "NATIONAL/EXTERNAL DISTRICT";
                                            if (isNational) {
                                                return d.office === col;
                                            }
                                            // Regular logic: Match rank OR office but avoid double counting in total
                                            // However, for matrix cells, if a delegate is "NEC" Rank and "NEC" Office, 
                                            // we just count them once for that column.
                                            return d.rank === col || d.office === col;
                                        }).length;
                                        
                                        colTotals[col] = (colTotals[col] || 0) + count;
                                        return <td key={col} className="border p-2 text-center font-bold text-gray-700">{count || '-'}</td>;
                                    })}
                                    <td className="border p-2 text-center font-black bg-blue-50 text-blue-900 text-xs">{rowHeadCount}</td>
                                </tr>
                            )
                        })}
                        {/* Vertical Totals (Footer) */}
                        <tr className="bg-blue-900 text-white font-black uppercase">
                            <td className="border p-2 sticky left-0 z-10 bg-blue-900">Grand Totals</td>
                            {matrixColumns.map(col => <td key={col} className="border p-2 text-center">{colTotals[col] || '0'}</td>)}
                            <td className="border p-2 text-center bg-yellow-400 text-blue-900 font-black text-sm">{grandTotal}</td>
                        </tr>
                    </tbody>
                </table>
                <p className="mt-4 text-[9px] font-bold text-gray-400 uppercase tracking-widest italic">
                    * Note: National/External District officers are indexed strictly by Office to maintain data integrity.
                </p>
            </div>
        );
    };

    const renderFinancialMatrix = () => {
        const sessionCols = [...sessions, { session_id: 'FULL_EVENT', title: 'Full Event (Master)' }];
        const getAmount = (type: FinancialType, sid: string | null) => financials.filter((f: any) => f.type === type && (f.session_id || 'FULL_EVENT') === (sid || 'FULL_EVENT')).reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
        const types = [{ id: FinancialType.OFFERING, label: 'Offerings' }, { id: FinancialType.PLEDGE_REDEMPTION, label: 'Pledge Redemptions' }];

        return (
            <div className="overflow-x-auto w-full">
                <table className="w-full text-sm text-left border border-gray-300 min-w-[1000px]">
                    <thead className="bg-gray-100 font-bold uppercase text-[10px]">
                        <tr><th className="p-3 border sticky left-0 bg-gray-100 z-10">Financial Category</th>{sessionCols.map(s => <th key={s.session_id} className="p-3 border text-right">{s.title}</th>)}<th className="p-3 border text-right bg-blue-50">Grand Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-300">
                        {types.map(t => {
                            let rowTotal = 0;
                            return (
                                <tr key={t.id}>
                                    <td className="p-3 border font-bold sticky left-0 bg-white">{t.label}</td>
                                    {sessionCols.map(s => { const amt = getAmount(t.id as any, s.session_id); rowTotal += amt; return <td key={s.session_id} className="p-3 border text-right">{formatCurrency(amt)}</td>; })}
                                    <td className="p-3 border text-right font-black bg-blue-50">{formatCurrency(rowTotal)}</td>
                                </tr>
                            );
                        })}
                        <tr className="bg-blue-900 text-white font-black">
                            <td className="p-3 border sticky left-0 bg-blue-900">Session Totals</td>
                            {sessionCols.map(s => <td key={s.session_id} className="p-3 border text-right">{formatCurrency(getAmount(FinancialType.OFFERING, s.session_id) + getAmount(FinancialType.PLEDGE_REDEMPTION, s.session_id))}</td>)}
                            <td className="p-3 border text-right">{formatCurrency(financials.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0))}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    };

    const renderPledgeSummary = () => {
        const rows = [...officialDistricts, "Other Entities"];
        const districtSummary = rows.map(dName => {
            const distPledges = pledges.filter((p: any) => {
                const dn = (p.district || '').trim();
                if (dName === "Other Entities") {
                    return !officialDistricts.some(od => od.toUpperCase() === dn.toUpperCase());
                }
                return dn.toUpperCase() === dName.toUpperCase();
            });
            return {
                district: dName,
                pledged: distPledges.reduce((s: number, p: any) => s + (Number(p.amount_pledged) || 0), 0),
                redeemed: distPledges.reduce((s: number, p: any) => s + (Number(p.amount_redeemed) || 0), 0)
            };
        }).filter(d => d.pledged > 0);

        const totalPledged = districtSummary.reduce((s, d) => s + d.pledged, 0);
        const totalRedeemed = districtSummary.reduce((s, d) => s + d.redeemed, 0);
        return (
             <div className="overflow-x-auto w-full space-y-6">
                 <table className="w-full text-sm text-left border-collapse border border-gray-300 min-w-[1000px]">
                    <thead className="bg-gray-100 uppercase text-[10px] font-black">
                        <tr><th className="border p-3">District</th><th className="border p-3 text-right">Amount Pledged</th><th className="border p-3 text-right">Amount Redeemed</th><th className="border p-3 text-right">Outstanding Balance</th></tr>
                    </thead>
                    <tbody>
                        {districtSummary.map((d: any) => (
                            <tr key={d.district}>
                                <td className="border p-3 font-bold uppercase">{d.district}</td>
                                <td className="border p-3 text-right">{formatCurrency(d.pledged)}</td>
                                <td className="border p-3 text-right text-green-700">{formatCurrency(d.redeemed)}</td>
                                <td className="border p-3 text-right text-red-600 font-black">{formatCurrency(d.pledged - d.redeemed)}</td>
                            </tr>
                        ))}
                        <tr className="bg-blue-900 text-white font-black uppercase text-xs">
                            <td className="border p-3">Grand Totals</td>
                            <td className="border p-3 text-right">{formatCurrency(totalPledged)}</td>
                            <td className="border p-3 text-right">{formatCurrency(totalRedeemed)}</td>
                            <td className="border p-3 text-right">{formatCurrency(totalPledged - totalRedeemed)}</td>
                        </tr>
                    </tbody>
                </table>
             </div>
        );
    }

    const renderPledgeList = () => {
        const sortedPledges = [...pledges];
        const totalPledged = sortedPledges.reduce((s: number, p: any) => s + (Number(p.amount_pledged) || 0), 0);
        const totalRedeemed = sortedPledges.reduce((s: number, p: any) => s + (Number(p.amount_redeemed) || 0), 0);
        const rows = [...officialDistricts, "Other Entities"];

        return (
            <div className="overflow-x-auto w-full space-y-6">
                {rows.map(districtName => {
                    const distPledges = sortedPledges.filter((p: any) => {
                        const dn = (p.district || '').trim();
                        if (districtName === "Other Entities") {
                            return !officialDistricts.some(od => od.toUpperCase() === dn.toUpperCase());
                        }
                        return dn.toUpperCase() === districtName.toUpperCase();
                    });

                    if (distPledges.length === 0) return null;
                    
                    const sortedDistPledges = [...distPledges].sort((a, b) => a.donor_name.localeCompare(b.donor_name));
                    const dPledged = sortedDistPledges.reduce((s, p) => s + Number(p.amount_pledged), 0);
                    const dRedeemed = sortedDistPledges.reduce((s, p) => s + Number(p.amount_redeemed), 0);
                    
                    return (
                        <div key={districtName} className="mb-8 break-inside-avoid">
                            <div className="bg-gray-100 p-2 font-black uppercase text-xs border border-gray-300">{districtName}</div>
                            <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-[1000px]">
                                <thead className="bg-gray-50 font-bold uppercase">
                                    <tr><th className="border p-1">Donor Name</th><th className="border p-1">Chapter</th><th className="border p-1">Phone</th><th className="border p-1 text-right">Pledged</th><th className="border p-1 text-right">Redeemed</th><th className="border p-1 text-right">Balance</th></tr>
                                </thead>
                                <tbody>
                                    {sortedDistPledges.map((p: any) => (
                                        <tr key={p.id}><td className="border p-1 font-bold">{p.donor_name}</td><td className="border p-1">{p.chapter || '-'}</td><td className="border p-1">{p.phone || '-'}</td><td className="border p-1 text-right">{formatCurrency(p.amount_pledged)}</td><td className="border p-1 text-right text-green-700">{formatCurrency(p.amount_redeemed)}</td><td className="border p-1 text-right text-red-600 font-bold">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</td></tr>
                                    ))}
                                    <tr className="bg-gray-50 font-black uppercase"><td colSpan={3} className="border p-1 text-right">Sub-Total:</td><td className="border p-1 text-right">{formatCurrency(dPledged)}</td><td className="border p-1 text-right">{formatCurrency(dRedeemed)}</td><td className="border p-1 text-right">{formatCurrency(dPledged - dRedeemed)}</td></tr>
                                </tbody>
                            </table>
                        </div>
                    );
                })}
                <div className="p-4 bg-blue-900 text-white font-black text-right flex justify-between items-center rounded min-w-[1000px] uppercase text-xs">
                    <span>Grand Totals (All Entities)</span>
                    <div className="flex gap-10"><span>Pledged: {formatCurrency(totalPledged)}</span><span>Redeemed: {formatCurrency(totalRedeemed)}</span><span>Balance: {formatCurrency(totalPledged - totalRedeemed)}</span></div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-4">
             <div className="bg-white p-4 rounded-xl shadow-sm border no-print space-y-4">
                <div className="flex flex-wrap gap-2 justify-between items-center"><h2 className="text-xl font-bold uppercase tracking-tight text-blue-900">Reports Dashboard</h2><button onClick={handleExportPDF} className="px-6 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold uppercase tracking-widest transition-all hover:bg-black">Export PDF</button></div>
                <div className="flex gap-4 items-center">
                     <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Analysis Scope:</span>
                     <select className="p-2 border rounded-lg min-w-[200px] font-bold text-blue-900 bg-blue-50/50" value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}><option value="">Master Attendance</option>{sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}</select>
                </div>
                <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                    <button onClick={() => setActiveTab('attendanceList')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === 'attendanceList' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Attendance List</button>
                    <button onClick={() => setActiveTab('attendanceMatrix')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === 'attendanceMatrix' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Matrix View</button>
                    <button onClick={() => setActiveTab('financialMatrix')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === 'financialMatrix' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Financial Matrix</button>
                    <button onClick={() => setActiveTab('pledgeSummary')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === 'pledgeSummary' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Pledge Summary</button>
                    <button onClick={() => setActiveTab('pledgeList')} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === 'pledgeList' ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500'}`}>Pledge List (Detailed)</button>
                </div>
             </div>
             <div ref={reportRef} className="bg-white p-10 rounded-xl shadow-sm border min-h-screen">
                <div className="text-center mb-8 border-b-2 border-blue-900 pb-4">
                    <h1 className="text-2xl font-black uppercase mb-1 tracking-tight text-blue-900">{events.find(e => e.event_id === activeEventId)?.name}</h1>
                    <h3 className="text-sm font-black uppercase text-gray-400 tracking-[0.2em]">
                        {activeTab.replace(/([A-Z])/g, ' $1').trim()}
                    </h3>
                    {selectedSessionId && (
                        <div className="text-[11px] font-black text-blue-700 uppercase mt-1 tracking-widest animate-in fade-in duration-500">
                           ({selectedSessionTitle})
                        </div>
                    )}
                </div>
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-500">
                    {activeTab === 'attendanceList' && renderAttendanceList()}
                    {activeTab === 'attendanceMatrix' && renderAttendanceMatrix()}
                    {activeTab === 'financialMatrix' && renderFinancialMatrix()}
                    {activeTab === 'pledgeSummary' && renderPledgeSummary()}
                    {activeTab === 'pledgeList' && renderPledgeList()}
                </div>
             </div>
        </div>
    );
};

export default ReportsPage;
