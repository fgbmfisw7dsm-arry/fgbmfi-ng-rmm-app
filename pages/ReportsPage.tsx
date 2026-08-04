import React, { useState, useEffect, useContext, useRef, useMemo } from 'react';
import { db } from '../services/supabaseService';
import { UserRole, FinancialType, Session, Event, SystemSettings, Pledge, FinancialEntry, isRegistrarRole, getScopeFilter, SessionResponseType, RESPONSE_TYPE_LABELS, MinistryExportData } from '../types';
import { AppContext } from '../context/AppContext';
import { formatCurrency, exportToPDF, exportToCSV } from '../services/utils';

const ReportsPage = () => {
    const { activeEventId, activeEvent, user } = useContext(AppContext);
    const isLocked = activeEvent?.is_active === false;
    const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;
    const [data, setData] = useState<any>(null);
    const [ministryData, setMinistryData] = useState<MinistryExportData | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [events, setEvents] = useState<Event[]>([]);
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [activeTab, setActiveTab] = useState<'attendanceList' | 'attendanceMatrix' | 'sessionsSummary' | 'financialMatrix' | 'pledgeSummary' | 'pledgeList' | 'ministryReport'>('attendanceList');
    const [selectedSessionId, setSelectedSessionId] = useState<string>('');
    const [alterCallFilter, setAlterCallFilter] = useState<'' | SessionResponseType>('');
    const [loading, setLoading] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    const norm = (v?: string) => (v || '').replace(/\s+/g, ' ').trim().toUpperCase();

    useEffect(() => {
        if (!activeEventId) return;
        let mounted = true;
        setLoading(true);

        const fetchData = async () => {
            try {
                const [exportData, sessionData, eventList, sysSettings, ministry] = await Promise.all([
                    db.getAllDataForExport(activeEventId), 
                    db.getSessions(activeEventId), 
                    db.getEvents(),
                    db.getSettings(),
                    db.getMinistryDataForExport(activeEventId)
                ]);

                if (!mounted) return;

                const scope = getScopeFilter(user);
                if (scope.region) {
                    const regionPrefix = norm(scope.region);
                    exportData.delegates = (exportData.delegates || []).filter((d: any) => 
                        norm(d.district).startsWith(regionPrefix)
                    );
                    const myDelegateIds = new Set(exportData.delegates.map((d: any) => d.delegate_id));
                    exportData.checkins = (exportData.checkins || []).filter((c: any) => myDelegateIds.has(c.delegate_id));
                    exportData.pledges = (exportData.pledges || []).filter((p: any) => 
                        norm(p.district).startsWith(regionPrefix)
                    );
                } else if (scope.district) {
                    const userDistrictNorm = norm(scope.district);
                    exportData.delegates = (exportData.delegates || []).filter((d: any) => 
                        norm(d.district) === userDistrictNorm
                    );
                    const myDelegateIds = new Set(exportData.delegates.map((d: any) => d.delegate_id));
                    exportData.checkins = (exportData.checkins || []).filter((c: any) => myDelegateIds.has(c.delegate_id));
                    exportData.pledges = (exportData.pledges || []).filter((p: any) => 
                        norm(p.district) === userDistrictNorm
                    );
                }

                setData(exportData);
                setSessions(sessionData);
                setEvents(eventList);
                setSettings(sysSettings);
                setMinistryData(ministry);
            } catch (err) {
                console.error("Reports aggregation failure:", err);
                if (mounted) setData({});
            } finally {
                if (mounted) setLoading(false);
            }
        };

        fetchData();
        return () => { mounted = false; };
    }, [activeEventId, user?.id]);

    useEffect(() => {
        if (!activeEventId || activeTab !== 'ministryReport') return;
        let mounted = true;
        db.getMinistryDataForExport(activeEventId).then(d => {
            if (mounted) setMinistryData(d);
        }).catch(() => {});
        return () => { mounted = false; };
    }, [activeEventId, activeTab]);

    const reportData = useMemo(() => {
        if (!data || !settings) return null;
        const { delegates = [], checkins = [], financials = [], pledges = [] } = data;
        
        const calculatedPledges = pledges.map((p: Pledge) => {
            const redemptionsForThisPledge = financials.filter((f: FinancialEntry) => 
                f.type === FinancialType.PLEDGE_REDEMPTION && f.pledge_id === p.id
            );
            const totalRedeemed = redemptionsForThisPledge.reduce((sum: number, f: FinancialEntry) => sum + (Number(f.amount) || 0), 0);
            return { ...p, amount_redeemed: totalRedeemed };
        });

        let filteredCheckIns = [];
        if (selectedSessionId) {
            filteredCheckIns = checkins.filter((c: any) => c.session_id === selectedSessionId);
        } else {
            const masterMap = new Map();
            checkins.forEach((c: any) => {
                if (!masterMap.has(c.delegate_id)) {
                    masterMap.set(c.delegate_id, c);
                } else {
                    const existing = masterMap.get(c.delegate_id);
                    if (!existing.session_id && c.session_id) return; 
                    if (existing.session_id && !c.session_id) masterMap.set(c.delegate_id, c); 
                }
            });
            filteredCheckIns = Array.from(masterMap.values());
        }

        const identityMap = new Map();
        filteredCheckIns.forEach((c: any) => {
            const d = delegates.find((del: any) => del.delegate_id === c.delegate_id);
            if (!d) return;
            const identityKey = `${norm(d.first_name)}|${norm(d.last_name)}|${norm(d.district)}|${norm(d.chapter)}`;
            if (!identityMap.has(identityKey)) {
                identityMap.set(identityKey, { ...d, checked_in_at: c.checked_in_at });
            }
        });

        const attendedDelegates = Array.from(identityMap.values());
        const officialDistricts = (settings.districts || []).map(d => d.trim()).sort((a, b) => 
            a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
        );
        const rankColumns = (settings.ranks || []).sort();
        const officeColumns = (settings.offices || []).sort();
        const delegateTypeColumns = (settings.delegate_types || []).sort();

        return { attendedDelegates, officialDistricts, rankColumns, officeColumns, delegateTypeColumns, financials, pledges: calculatedPledges };
    }, [data, selectedSessionId, settings]);

    const handleExportPDF = () => { if (reportRef.current) exportToPDF(reportRef.current, `FGBMFI_Report_${activeTab}.pdf`, 'landscape'); };

    const renderMinistryReport = () => {
        if (!ministryData) return <div className="text-center text-gray-400 py-8">Loading sessions data...</div>;
        const { responses, summaries, voiceDistribution } = ministryData;
        const responseTypes: SessionResponseType[] = [SessionResponseType.FT, SessionResponseType.SLV, SessionResponseType.MI, SessionResponseType.HGB];

        const attendanceArr: { session_id: string; attendance: number }[] = ministryData.attendance || [];
        const attMap = new Map(attendanceArr.map(a => [a.session_id, a.attendance]));

        const groupedBySession = new Map<string, {
            title: string;
            responses: Map<SessionResponseType, typeof responses>;
            summaries: Map<SessionResponseType, number>;
            vd: number;
            att: number;
        }>();

        sessions.forEach(s => {
            groupedBySession.set(s.session_id, {
                title: s.title,
                responses: new Map(responseTypes.map(t => [t, [] as typeof responses])),
                summaries: new Map(responseTypes.map(t => [t, 0])),
                vd: voiceDistribution.find(v => v.session_id === s.session_id)?.total_distributed || 0,
                att: attMap.get(s.session_id) || 0,
            });
        });

        responses.forEach(r => {
            const g = groupedBySession.get(r.session_id);
            if (g) {
                const arr = g.responses.get(r.response_type) || [];
                arr.push(r);
                g.responses.set(r.response_type, arr);
            }
        });

        summaries.forEach(s => {
            const g = groupedBySession.get(s.session_id);
            if (g) g.summaries.set(s.response_type, (g.summaries.get(s.response_type) || 0) + s.total_count);
        });

        const effectiveTypes = alterCallFilter ? responseTypes.filter(t => t === alterCallFilter) : responseTypes;

        const getDelegateTypesForSession = (sessionId: string): SessionResponseType[] => {
            if (!alterCallFilter) return effectiveTypes;
            const g = groupedBySession.get(sessionId);
            if (!g) return [];
            const scanned = g.responses.get(alterCallFilter) || [];
            return scanned.length > 0 ? [alterCallFilter] : [];
        };

        return (
            <div className="space-y-8">
                {Array.from(groupedBySession.entries()).filter(([sessionId]) => !selectedSessionId || sessionId === selectedSessionId).map(([sessionId, group]) => {
                    const typeForDisplay = alterCallFilter ? getDelegateTypesForSession(sessionId) : responseTypes;
                    const hasDelegateData = typeForDisplay.some(t => (group.responses.get(t) || []).length > 0);
                    return (
                        <div key={sessionId} className="mb-8">
                            <div className="bg-slate-800 text-white p-3 font-black uppercase text-xs rounded-t-lg flex justify-between">
                                <span>{group.title}{alterCallFilter ? ` (${RESPONSE_TYPE_LABELS[alterCallFilter]})` : ''}</span>
                                <span className="opacity-70">
                                    ATT: {group.att} | {responseTypes.reduce((sum, t) => sum + (group.responses.get(t) || []).length + (group.summaries.get(t) || 0), 0)} total | VD: {group.vd}
                                </span>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-[10px] border-collapse border border-gray-300">
                                    <thead className="bg-gray-50 uppercase text-gray-400 font-black">
                                        <tr>
                                            <th className="border p-2 text-left">Category</th>
                                            <th className="border p-2 text-center">Scanned</th>
                                            <th className="border p-2 text-center">Manual</th>
                                            <th className="border p-2 text-center bg-blue-50">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr className="border-b bg-gray-50">
                                            <td className="border p-2 font-black uppercase text-blue-900">Attendance</td>
                                            <td className="border p-2 text-center font-bold">{group.att}</td>
                                            <td className="border p-2 text-center">-</td>
                                            <td className="border p-2 text-center font-black bg-blue-50 text-blue-900">{group.att}</td>
                                        </tr>
                                        {responseTypes.map(type => {
                                            const scanned = (group.responses.get(type) || []).length;
                                            const manual = group.summaries.get(type) || 0;
                                            const isHighlighted = alterCallFilter && type === alterCallFilter;
                                            return (
                                                <tr key={type} className={`border-b ${isHighlighted ? 'bg-yellow-50' : 'hover:bg-gray-50'}`}>
                                                    <td className="border p-2 font-black uppercase text-blue-900">{RESPONSE_TYPE_LABELS[type]}</td>
                                                    <td className="border p-2 text-center font-bold">{scanned}</td>
                                                    <td className="border p-2 text-center font-bold">{manual}</td>
                                                    <td className="border p-2 text-center font-black bg-blue-50 text-blue-900">{scanned + manual}</td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="border-b bg-gray-50">
                                                <td className="border p-2 font-black uppercase">Voice Distribution</td>
                                                <td className="border p-2" colSpan={2}></td>
                                                <td className="border p-2 text-center font-black bg-blue-50 text-blue-900">{group.vd}</td>
                                            </tr>
                                    </tbody>
                                </table>
                            </div>

                            {(!alterCallFilter ? responseTypes : [alterCallFilter]).map(type => {
                                const scanned = group.responses.get(type) || [];
                                if (scanned.length === 0) return null;
                                return (
                                    <div key={type} className="mt-4">
                                        <div className="bg-blue-900 text-white p-2 uppercase text-[9px] rounded-t-lg">
                                            <span className="font-black text-[10px] block">{group.title}</span>
                                            <span className="opacity-80">{RESPONSE_TYPE_LABELS[type]} — Individual Records ({scanned.length})</span>
                                        </div>
                                        <table className="w-full text-[9px] border-collapse border border-gray-300">
                                            <thead className="bg-gray-50 uppercase text-gray-400 font-black">
                                                <tr>
                                                    <th className="border p-1.5 w-8">S/N</th>
                                                    <th className="border p-1.5">Name</th>
                                                    <th className="border p-1.5">District</th>
                                                    <th className="border p-1.5">Chapter</th>
                                                    <th className="border p-1.5">Phone</th>
                                                    {showRank && <th className="border p-1.5">Rank</th>}
                                                    {showOffice && <th className="border p-1.5">Office</th>}
                                                    {showDelegateType && <th className="border p-1.5">Type</th>}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {scanned.map((r, i) => (
                                                    <tr key={r.response_id} className="border-b hover:bg-gray-50">
                                                        <td className="border p-1.5 text-center">{i + 1}</td>
                                                        <td className="border p-1.5 font-black uppercase text-blue-900">{r.delegate_name || `${r.first_name} ${r.last_name}`}</td>
                                                        <td className="border p-1.5 font-bold uppercase">{r.district || '-'}</td>
                                                        <td className="border p-1.5 font-bold uppercase">{r.chapter || '-'}</td>
                                                        <td className="border p-1.5 font-mono">{r.phone || '-'}</td>
                                                        {showRank && <td className="border p-1.5 uppercase">{r.rank || '-'}</td>}
                                                        {showOffice && <td className="border p-1.5 uppercase">{r.office || '-'}</td>}
                                                        {showDelegateType && <td className="border p-1.5 uppercase">{(r as any).delegate_type || '-'}</td>}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        );
    };

    if (!activeEventId) return <div className="p-8 text-center text-gray-400 font-bold uppercase tracking-widest">Select Context Event</div>;
    if (loading || !reportData) return <div className="p-20 text-center text-gray-400 font-bold animate-pulse uppercase tracking-widest">Analyzing Data...</div>;

    const { attendedDelegates, officialDistricts, rankColumns, officeColumns, delegateTypeColumns, financials, pledges } = reportData;

    const renderAttendanceList = () => {
        const unrecognizedDists: string[] = [];
        attendedDelegates.forEach(d => {
            const dn = norm(d.district);
            if (dn && !officialDistricts.some(od => norm(od) === dn) && !unrecognizedDists.some(u => norm(u) === dn)) {
                unrecognizedDists.push(d.district);
            }
        });
        const rows = [...officialDistricts, ...unrecognizedDists.sort()];
        return (
            <div className="overflow-x-auto w-full">
                {rows.map(distName => {
                    const group = attendedDelegates.filter(d => norm(d.district) === norm(distName));
                    if (group.length === 0) return null;
                    return (
                        <div key={distName} className="mb-8">
                            <div className="bg-blue-900 text-white p-2 font-black uppercase text-xs rounded-t-lg flex justify-between">
                                <span>{distName}</span>
                                <span className="opacity-70">Total: {group.length}</span>
                            </div>
                            <table className="w-full text-[10px] text-left border-collapse border border-gray-300">
                                <thead className="bg-gray-50 uppercase text-gray-400 font-black">
                                    <tr><th className="border p-2 w-8">S/N</th><th className="border p-2">Name</th><th className="border p-2">Chapter</th>{showOffice && <th className="border p-2">Office</th>}{showRank && <th className="border p-2">Rank</th>}{showDelegateType && <th className="border p-2">Type</th>}<th className="border p-2">Phone</th><th className="border p-2 text-center">Date/Time</th></tr>
                                </thead>
                                <tbody>
                                    {group.map((d, i) => (
                                        <tr key={i} className="hover:bg-gray-50 border-b">
                                            <td className="border p-2 text-center">{i + 1}</td>
                                            <td className="border p-2 font-black uppercase text-blue-900">{d.title} {d.first_name} {d.last_name}</td>
                                            <td className="border p-2 font-bold uppercase">{d.chapter || '-'}</td>
                                            {showOffice && <td className="border p-2 font-bold uppercase">{d.office}</td>}
                                            {showRank && <td className="border p-2 uppercase">{d.rank}</td>}
                                            {showDelegateType && <td className="border p-2 font-medium text-[9px]">{d.delegate_type || 'Member'}</td>}
                                            <td className="border p-2 font-mono">{d.phone}</td>
                                            <td className="border p-2 text-center text-gray-400 uppercase leading-tight font-black">
                                                {d.checked_in_at ? (
                                                    <>
                                                        <div className="text-[8px] opacity-70 mb-0.5">{new Date(d.checked_in_at).toLocaleDateString([], {day:'2-digit', month:'short'})}</div>
                                                        <div className="text-blue-900">{new Date(d.checked_in_at).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
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

    const renderMatrixTable = (title: string, columns: string[], type: 'rank' | 'office' | 'delegate_type') => {
        const allDists: string[] = [...officialDistricts];
        attendedDelegates.forEach(d => {
            const dn = norm(d.district);
            if (dn && !allDists.some(od => norm(od) === dn)) {
                allDists.push(d.district);
            }
        });
        let grandTotal = 0;
        const colTotals: Record<string, number> = {};
        columns.forEach(c => colTotals[c] = 0);

        return (
            <div className="mb-12">
                <h4 className="report-section-header bg-blue-900 text-white p-3 font-black uppercase text-xs rounded-t-xl">{title}</h4>
                <div className="overflow-x-auto w-full custom-scrollbar" style={{ WebkitOverflowScrolling: 'touch' }}>
                    <table className="w-full text-[10px] text-left border-collapse border border-gray-300 min-w-max">
                        <thead className="bg-slate-100 uppercase font-black">
                            <tr><th className="border p-2 sticky left-0 bg-slate-100 z-10">District</th>{columns.map(c => <th key={c} className="border p-2 text-center">{c}</th>)}<th className="border p-2 text-center bg-blue-100 sticky right-0 z-10">Total</th></tr>
                        </thead>
                        <tbody>
                            {allDists.map(rName => {
                                const dels = attendedDelegates.filter(d => norm(d.district) === norm(rName));
                                if (dels.length === 0) return null;
                                grandTotal += dels.length;
                                return (
                                    <tr key={rName} className="hover:bg-blue-50 border-b">
                                        <td className="border p-2 font-black uppercase bg-gray-50 sticky left-0 z-10">{rName}</td>
                                        {columns.map(col => {
                                            const count = dels.filter(d => norm(type === 'rank' ? d.rank : type === 'office' ? d.office : d.delegate_type) === norm(col)).length;
                                            colTotals[col] = (colTotals[col] || 0) + count;
                                            return <td key={col} className="border p-2 text-center font-bold">{count || '-'}</td>;
                                        })}
                                        <td className="border p-2 text-center font-black bg-blue-50 text-blue-900 sticky right-0 z-10">{dels.length}</td>
                                    </tr>
                                );
                            })}
                            <tr className="bg-blue-900 text-white font-black">
                                <td className="border p-2 uppercase sticky left-0 bg-blue-900 z-10">Entity Totals</td>
                                {columns.map(col => <td key={col} className="border p-2 text-center">{colTotals[col] || 0}</td>)}
                                <td className="border p-2 text-center print-gold bg-yellow-400 text-blue-900 sticky right-0 z-10">{grandTotal}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border no-print flex flex-wrap justify-between items-center gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-3">
                        <h2 className="text-xl font-black uppercase text-blue-900">Reports Center</h2>
                        {isLocked && (
                            <span className="bg-red-600 text-white px-3 py-1 rounded-full text-[9px] font-black uppercase shadow-sm">FINALIZED</span>
                        )}
                    </div>
                    <div className="flex gap-2 mt-4 overflow-x-auto pb-2">
                        {['attendanceList', 'attendanceMatrix', 'sessionsSummary', 'financialMatrix', 'pledgeSummary', 'pledgeList', 'ministryReport'].map(tab => {
                             const labels: Record<string, string> = { attendanceList: 'Attendance List', attendanceMatrix: 'Attendance Matrix', sessionsSummary: 'Sessions Summary', financialMatrix: 'Financial Matrix', pledgeSummary: 'Pledge Summary', pledgeList: 'Pledge List', ministryReport: 'Sessions Report' };
                            return (
                            <button key={tab} onClick={() => setActiveTab(tab as any)} className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${activeTab === tab ? 'bg-blue-600 text-white shadow-md' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>{labels[tab] || tab}</button>
                            );
                        })}
                    </div>
                </div>
                <div className="flex gap-4 items-center">
                    <select className="p-2 border rounded-xl text-xs font-black uppercase text-blue-900" value={selectedSessionId} onChange={e => setSelectedSessionId(e.target.value)}>
                        <option value="">All Sessions</option>
                        {sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.title}</option>)}
                    </select>
                    {activeTab === 'ministryReport' && (
                        <select className="p-2 border rounded-xl text-xs font-black uppercase text-blue-900" value={alterCallFilter} onChange={e => setAlterCallFilter(e.target.value as '' | SessionResponseType)}>
                            <option value="">All Alter Calls</option>
                            <option value={SessionResponseType.FT}>{RESPONSE_TYPE_LABELS[SessionResponseType.FT]}</option>
                            <option value={SessionResponseType.SLV}>{RESPONSE_TYPE_LABELS[SessionResponseType.SLV]}</option>
                            <option value={SessionResponseType.MI}>{RESPONSE_TYPE_LABELS[SessionResponseType.MI]}</option>
                            <option value={SessionResponseType.HGB}>{RESPONSE_TYPE_LABELS[SessionResponseType.HGB]}</option>
                        </select>
                    )}
                    <button onClick={handleExportPDF} className="px-6 py-3 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest">Export PDF</button>
                </div>
            </div>

            <div ref={reportRef} className="bg-white p-12 rounded-[2.5rem] shadow-sm border min-h-screen relative overflow-hidden">
                {isLocked && (
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 opacity-[0.03] pointer-events-none select-none text-[20vw] font-black uppercase -rotate-45 z-0 whitespace-nowrap">
                        Finalized Report
                    </div>
                )}

                <div className="text-center mb-8 border-b-4 border-blue-900 pb-6 relative z-10">
                    <h1 className="text-2xl font-black uppercase text-blue-900">{events.find(e => e.event_id === activeEventId)?.name}</h1>
                    <div className="flex justify-center items-center gap-3 mt-2">
                        <h3 className="text-[10px] font-black uppercase text-gray-400 tracking-widest">
                            {activeTab === 'ministryReport' ? 'Sessions Report' : activeTab.replace(/([A-Z])/g, ' $1')}
                        </h3>
                        {isLocked && (
                            <span className="text-[8px] font-black uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded border border-red-100">Locked / Final Copy</span>
                        )}
                    </div>
                    {selectedSessionId && <div className="text-xs font-black text-blue-700 uppercase mt-2">Session: {sessions.find(s => s.session_id === selectedSessionId)?.title}{alterCallFilter && activeTab === 'ministryReport' ? ` (${RESPONSE_TYPE_LABELS[alterCallFilter]})` : ''}</div>}
                </div>
                
                <div className="relative z-10">
                    {activeTab === 'attendanceList' && renderAttendanceList()}
                    
                    {activeTab === 'attendanceMatrix' && (
                        <div className="space-y-12">
                            {showRank && renderMatrixTable("Attendance By Rank", rankColumns, 'rank')}
                            {showOffice && renderMatrixTable("Attendance By Office", officeColumns, 'office')}
                            {showDelegateType && renderMatrixTable("Attendance By Delegate Type", delegateTypeColumns, 'delegate_type')}
                        </div>
                    )}
                    
                    {activeTab === 'sessionsSummary' && (
                        <div className="overflow-x-auto w-full">
                            <table className="w-full text-sm border min-w-max">
                                <thead className="bg-slate-100 uppercase font-black text-[10px]">
                                    <tr><th className="p-3 border text-left">Session</th><th className="p-3 border text-center">Attendance</th><th className="p-3 border text-center">FT</th><th className="p-3 border text-center">SLV</th><th className="p-3 border text-center">MI</th><th className="p-3 border text-center">HGB</th><th className="p-3 border text-center">VD</th><th className="p-3 border text-right">Offering</th><th className="p-3 border text-right">Pledge Redemption</th><th className="p-3 border text-right bg-blue-50">Financial Total</th></tr>
                                </thead>
                                <tbody className="divide-y">
                                    {sessions.map(s => {
                                        const att = (data?.checkins || []).filter((c: any) => c.session_id === s.session_id).length;
                                        const ft = ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.FT).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.FT).reduce((sum: number, r: any) => sum + (Number(r.total_count) || 0), 0));
                                        const slv = ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.SLV).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.SLV).reduce((sum: number, r: any) => sum + (Number(r.total_count) || 0), 0));
                                        const mi = ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.MI).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.MI).reduce((sum: number, r: any) => sum + (Number(r.total_count) || 0), 0));
                                        const hgb = ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.HGB).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.HGB).reduce((sum: number, r: any) => sum + (Number(r.total_count) || 0), 0));
                                        const vd = (ministryData?.voiceDistribution || []).filter((v: any) => v.session_id === s.session_id).reduce((sum: number, v: any) => sum + (Number(v.total_distributed) || 0), 0);
                                        const offering = reportData.financials.filter((f: any) => f.type === FinancialType.OFFERING && f.session_id === s.session_id).reduce((sum: number, f: any) => sum + (Number(f.amount) || 0), 0);
                                        const redemption = reportData.financials.filter((f: any) => f.type === FinancialType.PLEDGE_REDEMPTION && f.session_id === s.session_id).reduce((sum: number, f: any) => sum + (Number(f.amount) || 0), 0);
                                        const financialTotal = offering + redemption;
                                        return (
                                            <tr key={s.session_id} className="hover:bg-gray-50 border-b">
                                                <td className="p-3 border font-black uppercase text-xs">{s.title}</td>
                                                <td className="p-3 border text-center font-bold">{att}</td>
                                                <td className="p-3 border text-center font-bold">{ft}</td>
                                                <td className="p-3 border text-center font-bold">{slv}</td>
                                                <td className="p-3 border text-center font-bold">{mi}</td>
                                                <td className="p-3 border text-center font-bold">{hgb}</td>
                                                <td className="p-3 border text-center font-bold">{vd}</td>
                                                <td className="p-3 border text-right font-bold">{formatCurrency(offering)}</td>
                                                <td className="p-3 border text-right font-bold">{formatCurrency(redemption)}</td>
                                                <td className="p-3 border text-right font-black bg-blue-50">{formatCurrency(financialTotal)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-blue-900 text-white font-black">
                                        <td className="p-3 border uppercase">Totals</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + (data?.checkins || []).filter((c: any) => c.session_id === s.session_id).length, 0)}</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.FT).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.FT).reduce((s2: number, r: any) => s2 + (Number(r.total_count) || 0), 0)), 0)}</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.SLV).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.SLV).reduce((s2: number, r: any) => s2 + (Number(r.total_count) || 0), 0)), 0)}</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.MI).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.MI).reduce((s2: number, r: any) => s2 + (Number(r.total_count) || 0), 0)), 0)}</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + ((ministryData?.responses || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.HGB).length) + ((ministryData?.summaries || []).filter((r: any) => r.session_id === s.session_id && r.response_type === SessionResponseType.HGB).reduce((s2: number, r: any) => s2 + (Number(r.total_count) || 0), 0)), 0)}</td>
                                        <td className="p-3 border text-center">{sessions.reduce((sum, s) => sum + (ministryData?.voiceDistribution || []).filter((v: any) => v.session_id === s.session_id).reduce((s2: number, v: any) => s2 + (Number(v.total_distributed) || 0), 0), 0)}</td>
                                        <td className="p-3 border text-right">{formatCurrency(sessions.reduce((sum, s) => sum + reportData.financials.filter((f: any) => f.type === FinancialType.OFFERING && f.session_id === s.session_id).reduce((s2: number, f: any) => s2 + (Number(f.amount) || 0), 0), 0))}</td>
                                        <td className="p-3 border text-right">{formatCurrency(sessions.reduce((sum, s) => sum + reportData.financials.filter((f: any) => f.type === FinancialType.PLEDGE_REDEMPTION && f.session_id === s.session_id).reduce((s2: number, f: any) => s2 + (Number(f.amount) || 0), 0), 0))}</td>
                                        <td className="p-3 border text-right bg-yellow-400 text-blue-900 print-gold">{formatCurrency(sessions.reduce((sum, s) => sum + reportData.financials.filter((f: any) => f.type === FinancialType.OFFERING && f.session_id === s.session_id).reduce((s2: number, f: any) => s2 + (Number(f.amount) || 0), 0) + reportData.financials.filter((f: any) => f.type === FinancialType.PLEDGE_REDEMPTION && f.session_id === s.session_id).reduce((s2: number, f: any) => s2 + (Number(f.amount) || 0), 0), 0))}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                    
                    {activeTab === 'financialMatrix' && (
                        <div className="overflow-x-auto w-full">
                            <table className="w-full text-sm border min-w-max">
                                <thead className="bg-slate-100 uppercase font-black text-[10px]">
                                    <tr><th className="p-3 border text-left">Category</th>{sessions.map(s => <th key={s.session_id} className="p-3 border text-right">{s.title}</th>)}<th className="p-3 border text-right bg-blue-50">Total</th></tr>
                                </thead>
                                <tbody className="divide-y">
                                    {[FinancialType.OFFERING, FinancialType.PLEDGE_REDEMPTION].map(type => {
                                        let rowSum = 0;
                                        return (
                                            <tr key={type} className="hover:bg-gray-50">
                                                <td className="p-3 border font-black uppercase text-xs">{type.replace('_', ' ')}</td>
                                                {sessions.map(s => {
                                                    const amt = financials.filter((f:any) => f.type === type && f.session_id === s.session_id).reduce((s:number, f:any) => s + (Number(f.amount)||0), 0);
                                                    rowSum += amt;
                                                    return <td key={s.session_id} className="p-3 border text-right font-bold">{formatCurrency(amt)}</td>;
                                                })}
                                                <td className="p-3 border text-right font-black bg-blue-50">{formatCurrency(rowSum)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {activeTab === 'pledgeSummary' && (
                        <div className="overflow-x-auto w-full">
                            <table className="w-full text-sm border min-w-max">
                                <thead className="bg-slate-100 uppercase font-black text-[10px]">
                                    <tr><th className="p-3 border">District</th><th className="p-3 border text-right">Pledged</th><th className="p-3 border text-right">Redeemed</th><th className="p-3 border text-right">Balance</th></tr>
                                </thead>
                                <tbody>
                                    {officialDistricts.map(dist => {
                                        const ps = pledges.filter((p:any) => norm(p.district) === norm(dist));
                                        const pld = ps.reduce((s,p) => s + Number(p.amount_pledged), 0);
                                        const red = ps.reduce((s,p) => s + Number(p.amount_redeemed), 0);
                                        if (pld === 0) return null;
                                        return (
                                            <tr key={dist} className="hover:bg-gray-50 border-b">
                                                <td className="p-3 border font-black uppercase">{dist}</td>
                                                <td className="p-3 border text-right">{formatCurrency(pld)}</td>
                                                <td className="p-3 border text-right text-green-700">{formatCurrency(red)}</td>
                                                <td className="p-3 border text-right text-red-600 font-black">{formatCurrency(pld - red)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                    {activeTab === 'pledgeList' && (
                        <div className="space-y-4">
                            {officialDistricts.map(dist => {
                                const ps = pledges.filter((p:any) => norm(p.district) === norm(dist)).sort((a,b) => a.donor_name.localeCompare(b.donor_name));
                                if (ps.length === 0) return null;
                                return (
                                    <div key={dist} className="mb-6">
                                        <div className="bg-slate-800 text-white p-2 font-black uppercase text-[10px] rounded-t-lg">{dist} Detailed Pledges</div>
                                        <table className="w-full text-[10px] border">
                                            <thead className="bg-gray-50 uppercase font-black">
                                                <tr><th className="p-2 border">Donor</th><th className="p-2 border text-right">Pledged</th><th className="p-2 border text-right">Redeemed</th><th className="p-2 border text-right">Balance</th></tr>
                                            </thead>
                                            <tbody>
                                                {ps.map(p => (
                                                    <tr key={p.id} className="border-b">
                                                        <td className="p-2 border font-bold uppercase">{p.donor_name}</td>
                                                        <td className="p-2 border text-right">{formatCurrency(p.amount_pledged)}</td>
                                                        <td className="p-2 border text-right text-green-700">{formatCurrency(p.amount_redeemed)}</td>
                                                        <td className="p-2 border text-right text-red-600 font-bold">{formatCurrency(p.amount_pledged - p.amount_redeemed)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {activeTab === 'ministryReport' && renderMinistryReport()}
                </div>

                <div className="report-footer print-only mt-20 pt-10 border-t flex justify-between text-[9px] font-black uppercase text-gray-400 tracking-widest relative z-10">
                    <div className="space-y-1">
                        <span>Generated via FGBMFI Nigeria EMS</span>
                        {isLocked && <span className="block text-red-600">Event Locked: Historical Data Integrity Sealed</span>}
                    </div>
                    <span>Date: {new Date().toLocaleDateString()}</span>
                    <span>Authorized Signature: _______________________</span>
                </div>
            </div>
        </div>
    );
};

export default ReportsPage;