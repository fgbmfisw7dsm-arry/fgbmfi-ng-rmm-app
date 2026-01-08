
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

    // Track user.id instead of user object to prevent blinking loops if context re-provides user reference
    useEffect(() => {
        if (!activeEventId) return;
        let mounted = true;
        setLoading(true);

        const fetchData = async () => {
            try {
                const [exportData, sessionData, eventList, sysSettings] = await Promise.all([
                    db.getAllDataForExport(activeEventId), 
                    db.getSessions(activeEventId), 
                    db.getEvents(),
                    db.getSettings()
                ]);

                if (!mounted) return;

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
            } catch (err) {
                console.error("Reports aggregation failure:", err);
                if (mounted) setData({});
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchData();
        return () => { mounted = false; };
    }, [activeEventId, user?.id]); // Only re-fetch if event or actual user id changes

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
            
        const matrixColumns = Array.from(new Set([...settings.ranks, ...settings.offices])).sort();

        return { delegates, checkins, financials, pledges, attendedDelegates, officialDistricts, matrixColumns };
    }, [data, selectedSessionId, settings]);

    const handleExportPDF = () => { if (reportRef.current) exportToPDF(reportRef.current, `FGBMFI_Report_${activeTab}.pdf`, 'landscape'); };

    if (!activeEventId) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Context Event</div>;
    if (loading || !reportData) return <div className="p-20 text-center text-gray-400 font-bold animate-pulse uppercase tracking-widest">Analyzing Attendance Matrix...</div>;

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
                            <div className="bg-blue-900 text-white p-2 font-black uppercase text-xs border border-blue-800 flex justify-between rounded-t-lg">
                                <span>{districtName}</span>
                                <span className="bg-white/20 px-2 rounded">Total: {districtDelegates.length}</span>
                            </div>
                            <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-[950px]">
                                <thead>
                                    <tr className="bg-gray-50 font-black uppercase text-gray-400">
                                        <th className="border p-2 w-8 text-center whitespace-nowrap">S/N</th>
                                        <th className="border p-2 whitespace-nowrap">Full Name</th>
                                        <th className="border p-2 whitespace-nowrap">Office</th>
                                        <th className="border p-2 whitespace-nowrap">Rank</th>
                                        <th className="border p-2 whitespace-nowrap">Chapter</th>
                                        <th className="border p-2 whitespace-nowrap">Phone</th>
                                        <th className="border p-2 text-center whitespace-nowrap">Verification Time</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedDistrictDelegates.map((d: any, idx: number) => (
                                        <tr key={d.delegate_id} className="hover:bg-gray-50 border-b last:border-b-0">
                                            <td className="border p-2 text-center text-gray-400 font-bold">{idx + 1}</td>
                                            <td className="border p-2 font-black uppercase text-blue-900 whitespace-nowrap">{d.title} {d.first_name} {d.last_name}</td>
                                            <td className="border p-2 font-bold text-gray-600 uppercase whitespace-nowrap">{d.office || '-'}</td>
                                            <td className="border p-2 font-bold text-blue-800 uppercase whitespace-nowrap">{d.rank}</td>
                                            <td className="border p-2 uppercase text-gray-500 font-medium whitespace-nowrap">{d.chapter || 'Individual'}</td>
                                            <td className="border p-2 font-mono text-gray-600 whitespace-nowrap">{d.phone}</td>
                                            <td className="border p-2 text-center text-gray-400 whitespace-nowrap">
                                                {d.checked_in_at ? (
                                                    <>
                                                        <span className="block font-black text-gray-500">{new Date(d.checked_in_at).toLocaleDateString([], {day:'2-digit', month:'short'})}</span>
                                                        <span className="text-[9px]">{new Date(d.checked_in_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
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
                        <tr className="bg-slate-100 uppercase font-black text-slate-700">
                            <th className="border p-3 text-left bg-slate-100 sticky left-0 z-10 w-48 shadow-sm whitespace-nowrap">District / Entity</th>
                            {matrixColumns.map(col => <th key={col} className="border p-3 text-center whitespace-nowrap">{col}</th>)}
                            <th className="border p-3 text-center bg-blue-100 text-blue-900 w-24 whitespace-nowrap">ROW TOTAL</th>
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
                                <tr key={rowName} className="hover:bg-blue-50/30 border-b group transition-colors">
                                    <td className="border p-3 font-black uppercase bg-gray-50 group-hover:bg-blue-50 sticky left-0 z-10 text-[9px] border-r-2 border-gray-200 whitespace-nowrap">{rowName}</td>
                                    {matrixColumns.map(col => {
                                        const isNationalRow = rowName.toUpperCase() === "NATIONAL/EXTERNAL DISTRICT";
                                        const count = rowDelegates.filter(d => {
                                            if (isNationalRow) {
                                                return (d.office || '').trim().toUpperCase() === col.toUpperCase();
                                            }
                                            return (d.rank || '').trim().toUpperCase() === col.toUpperCase() || 
                                                   (d.office || '').trim().toUpperCase() === col.toUpperCase();
                                        }).length;
                                        colTotals[col] = (colTotals[col] || 0) + count;
                                        return <td key={col} className={`border p-3 text-center font-bold ${count > 0 ? 'text-blue-900' : 'text-gray-300'} whitespace-nowrap`}>{count || '-'}</td>;
                                    })}
                                    <td className="border p-3 text-center font-black bg-blue-100/50 text-blue-900 text-xs shadow-inner whitespace-nowrap">{rowHeadCount}</td>
                                </tr>
                            )
                        })}
                        <tr className="bg-blue-900 text-white font-black uppercase shadow-2xl">
                            <td className="border p-3 sticky left-0 z-10 bg-blue-900 text-white shadow-xl whitespace-nowrap">Grand Entity Totals</td>
                            {matrixColumns.map(col => (
                                <td key={col} className="border p-3 text-center bg-blue-800/80 whitespace-nowrap">{colTotals[col] || '0'}</td>
                            ))}
                            <td className="border p-3 text-center bg-yellow-400 text-blue-900 font-black text-sm shadow-xl animate-pulse whitespace-nowrap">
                                {grandTotal}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        );
    };

    const renderFinancialMatrix = () => {
        const sessionCols = [...sessions, { session_id: 'FULL_EVENT', title: 'Full Event (Master)' }];
        const getAmount = (type: FinancialType, sid: string | null) => financials.filter((f: any) => f.type === type && (f.session_id || 'FULL_EVENT') === (sid || 'FULL_EVENT')).reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
        const types = [{ id: FinancialType.OFFERING, label: 'Offerings' }, { id: FinancialType.PLEDGE_REDEMPTION, label: 'Pledge Redemptions' }];

        return (
            <div className="overflow-x-auto w-full">
                <table className="w-full text-sm text-left border border-gray-300 min-w-[950px] rounded-lg overflow-hidden">
                    <thead className="bg-slate-100 font-black uppercase text-[10px] text-slate-700">
                        <tr><th className="p-3 border sticky left-0 bg-slate-100 z-10 whitespace-nowrap">Financial Category</th>{sessionCols.map(s => <th key={s.session_id} className="p-3 border text-right whitespace-nowrap">{s.title}</th>)}<th className="p-3 border text-right bg-blue-50 whitespace-nowrap">Grand Total</th></tr>
                    </thead>
                    <tbody className="divide-y divide-gray-300">
                        {types.map(t => {
                            let rowTotal = 0;
                            return (
                                <tr key={t.id} className="hover:bg-gray-50">
                                    <td className="p-3 border font-black uppercase text-[11px] sticky left-0 bg-white group-hover:bg-gray-50 whitespace-nowrap">{t.label}</td>
                                    {sessionCols.map(s => { const amt = getAmount(t.id as any, s.session_id); rowTotal += amt; return <td key={s.session_id} className="p-3 border text-right font-bold text-slate-600 whitespace-nowrap">{formatCurrency(amt)}</td>; })}
                                    <td className="p-3 border text-right font-black bg-blue-50 text-blue-900 whitespace-nowrap">{formatCurrency(rowTotal)}</td>
                                </tr>
                            );
                        })}
                        <tr className="bg-blue-900 text-white font-black uppercase text-[11px]">
                            <td className="p-3 border sticky left-0 bg-blue-900 whitespace-nowrap">Financial Session Totals</td>
                            {sessionCols.map(s => <td key={s.session_id} className="p-3 border text-right whitespace-nowrap">{formatCurrency(getAmount(FinancialType.OFFERING, s.session_id) + getAmount(FinancialType.PLEDGE_REDEMPTION, s.session_id))}</td>)}
                            <td className="p-3 border text-right bg-blue-950 whitespace-nowrap">{formatCurrency(financials.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0))}</td>
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
             <div className="overflow-x-auto w-full">
                 <table className="w-full text-sm text-left border-collapse border border-gray-300 min-w-[950px] rounded-lg">
                    <thead className="bg-slate-100 uppercase text-[10px] font-black text-slate-700">
                        <tr><th className="border p-3 whitespace-nowrap">District Entity</th><th className="border p-3 text-right whitespace-nowrap">Amount Pledged</th><th className="border p-3 text-right whitespace-nowrap">Amount Redeemed</th><th className="border p-3 text-right whitespace-nowrap">Balance Outstanding</th></tr>
                    </thead>
                    <tbody>
                        {districtSummary.map((d: any) => (
                            <tr key={d.district} className="hover:bg-gray-50 transition-colors">
                                <td className="border p-3 font-black uppercase text-slate-800 whitespace-nowrap">{d.district}</td>
                                <td className="border p-3 text-right font-bold whitespace-nowrap">{formatCurrency(d.pledged)}</td>
                                <td className="border p-3 text-right text-green-700 font-bold whitespace-nowrap">{formatCurrency(d.redeemed)}</td>
                                <td className="border p-3 text-right text-red-600 font-black whitespace-nowrap">{formatCurrency(d.pledged - d.redeemed)}</td>
                            </tr>
                        ))}
                        <tr className="bg-blue-900 text-white font-black uppercase text-xs">
                            <td className="border p-3 whitespace-nowrap">Global Pledge Totals</td>
                            <td className="border p-3 text-right whitespace-nowrap">{formatCurrency(totalPledged)}</td>
                            <td className="border p-3 text-right whitespace-nowrap">{formatCurrency(totalRedeemed)}</td>
                            <td className="border p-3 text-right bg-red-800 whitespace-nowrap">{formatCurrency(totalPledged - totalRedeemed)}</td>
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
            <div className="overflow-x-auto w-full space-y-8">
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
                            <div className="bg-slate-800 text-white p-2 font-black uppercase text-xs rounded-t-lg">{districtName} Detailed Pledges</div>
                            <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-[950px]">
                                <thead className="bg-gray-50 font-black uppercase text-slate-500">
                                    <tr><th className="border p-2 whitespace-nowrap">Donor Identity</th><th className="border p-2 whitespace-nowrap">Chapter</th><th className="border p-2 whitespace-nowrap">Contact</th><th className="border p-2 text-right whitespace-nowrap">Pledged (NGN)</th><th className="border p-2 text-right whitespace-nowrap">Redeemed (NGN)</th><th className="border p-2 text-right whitespace-nowrap">Balance (NGN)</th></tr>
                                </thead>
                                <tbody>
                                    {sortedDistPledges.map((p: any) => (
                                        <tr key={p.id} className="hover:bg-gray-50 border-b last:border-b-0">
                                            <td className="border p-2 font-black uppercase text-blue-900 whitespace-nowrap">{p.donor_name}</td>
                                            <td className="border p-2 uppercase text-gray-500 font-medium whitespace-nowrap">{p.chapter || '-'}</td>
                                            <td className="border p-2 font-mono text-gray-600 whitespace-nowrap">{p.phone || '-'}</td>
                                            <td className="border p-2 text-right font-bold text-slate-700 whitespace-nowrap">{formatCurrency(p.amount_pledged)}</td>
                                            <td className="border p-2 text-right text-green-700 font-bold whitespace-nowrap">{formatCurrency(p.amount_redeemed)}</td>
                                            <td className="border p-2 text-right text-red-600 font-black whitespace-nowrap">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</td>
                                        </tr>
                                    ))}
                                    <tr className="bg-slate-50 font-black uppercase text-slate-900">
                                        <td colSpan={3} className="border p-2 text-right whitespace-nowrap">Sub-Total for {districtName}:</td>
                                        <td className="border p-2 text-right whitespace-nowrap">{formatCurrency(dPledged)}</td>
                                        <td className="border p-2 text-right text-green-700 whitespace-nowrap">{formatCurrency(dRedeemed)}</td>
                                        <td className="border p-2 text-right text-red-600 whitespace-nowrap">{formatCurrency(dPledged - dRedeemed)}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    );
                })}
                <div className="p-6 bg-blue-900 text-white font-black text-right flex justify-between items-center rounded-2xl min-w-[950px] uppercase text-xs shadow-xl">
                    <span>Global Cumulative Pledge Ledger</span>
                    <div className="flex gap-10">
                        <span>Pledged: {formatCurrency(totalPledged)}</span>
                        <span>Redeemed: {formatCurrency(totalRedeemed)}</span>
                        <span className="bg-red-800 px-4 py-1 rounded">Net Balance: {formatCurrency(totalPledged - totalRedeemed)}</span>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
             <div className="bg-white p-6 rounded-2xl shadow-sm border no-print space-y-6">
                <div className="flex flex-wrap gap-4 justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black uppercase tracking-tighter text-blue-900 leading-none">Reports & Analytics</h2>
                        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Regional Performance Data Matrix</p>
                    </div>
                    <button onClick={handleExportPDF} className="px-8 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest transition-all hover:bg-black hover:scale-105 active:scale-95 shadow-xl">Export Master PDF</button>
                </div>
                
                <div className="flex flex-wrap items-center gap-6 border-t pt-6">
                     <div className="flex items-center gap-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Scope:</span>
                        <select className="p-3 border rounded-xl min-w-[250px] font-black uppercase text-xs text-blue-900 bg-blue-50/50 focus:ring-4 focus:ring-blue-500/10 outline-none transition-all" value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}>
                            <option value="">Master Attendance Scope</option>
                            {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
                        </select>
                     </div>
                </div>

                <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide border-b">
                    {[
                        { id: 'attendanceList', label: 'Detailed List' },
                        { id: 'attendanceMatrix', label: 'Attendance Matrix' },
                        { id: 'financialMatrix', label: 'Financial Matrix' },
                        { id: 'pledgeSummary', label: 'Pledge Summary' },
                        { id: 'pledgeList', label: 'Pledge Ledger' }
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as any)} 
                            className={`px-6 py-3 rounded-xl text-[10px] font-black uppercase whitespace-nowrap transition-all ${activeTab === tab.id ? 'bg-blue-600 text-white shadow-lg scale-105' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
             </div>

             <div ref={reportRef} className="bg-white p-12 rounded-[2.5rem] shadow-sm border min-h-screen">
                <div className="text-center mb-10 border-b-4 border-blue-900 pb-8">
                    <h1 className="text-3xl font-black uppercase mb-1 tracking-tight text-blue-900 leading-none">{events.find(e => e.event_id === activeEventId)?.name}</h1>
                    <h3 className="text-[11px] font-black uppercase text-gray-400 tracking-[0.4em] mt-3">
                        {activeTab.replace(/([A-Z])/g, ' $1').trim()}
                    </h3>
                    {selectedSessionId && (
                        <div className="text-sm font-black text-blue-700 uppercase mt-4 tracking-widest animate-in fade-in duration-700">
                           ● Context: {selectedSessionTitle}
                        </div>
                    )}
                </div>

                <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                    {activeTab === 'attendanceList' && renderAttendanceList()}
                    {activeTab === 'attendanceMatrix' && renderAttendanceMatrix()}
                    {activeTab === 'financialMatrix' && renderFinancialMatrix()}
                    {activeTab === 'pledgeSummary' && renderPledgeSummary()}
                    {activeTab === 'pledgeList' && renderPledgeList()}
                </div>
                
                <div className="print-only mt-20 pt-10 border-t flex justify-between text-[9px] font-black uppercase text-gray-400 tracking-widest">
                    <span>Generated via FGBMFI Nigeria EMS</span>
                    <span>Date: {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</span>
                    <span>Authorized Signature: _______________________</span>
                </div>
             </div>
        </div>
    );
};

export default ReportsPage;
