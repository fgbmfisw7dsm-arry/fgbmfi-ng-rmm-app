
import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { Delegate, SystemSettings, Chapter, isAdminRole } from '../types';
import { exportToPDF, exportToCSV } from '../services/utils';
import { AppContext } from '../context/AppContext';

const PAGE_SIZE = 50;

const MasterListModule = () => {
    const { activeEventId, activeEvent, user } = useContext(AppContext);
    const isAdmin = isAdminRole((user?.role || '').toLowerCase());

    if (!isAdmin) {
        return (
            <div className="min-h-screen bg-gray-100 flex items-center justify-center p-8">
                <div className="bg-white p-10 rounded-2xl shadow-xl border border-red-100 max-w-md w-full text-center space-y-4">
                    <div className="w-16 h-16 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                        <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m0 0v2m0-2h2m-2 0H10m9.364-7.364A9 9 0 1112 3a9 9 0 017.364 4.636z" /></svg>
                    </div>
                    <h2 className="text-2xl font-black text-red-900 uppercase tracking-tight">Access Denied</h2>
                    <p className="text-sm font-bold text-gray-500 uppercase tracking-wider">This feature is restricted to administrators only.</p>
                    <a href="#/admin" className="inline-block mt-4 px-6 py-3 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest hover:bg-blue-700 transition-all">Return to Dashboard</a>
                </div>
            </div>
        );
    }
    const eventConfig = (activeEvent?.event_config || {}) as Record<string, boolean>;
    const showRank = eventConfig.show_rank !== false;
    const showOffice = eventConfig.show_office !== false;
    const showDelegateType = eventConfig.show_delegate_type !== false;
    const [delegates, setDelegates] = useState<Delegate[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedDistrict, setSelectedDistrict] = useState('');
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [editForm, setEditForm] = useState<Partial<Delegate>>({
        title: '', first_name: '', last_name: '', district: '', chapter: '', rank: '', office: '', phone: '', email: '', delegate_type: 'Member'
    });
    const [editingId, setEditingId] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [totalRecords, setTotalRecords] = useState(0);
    const listRef = useRef<HTMLDivElement>(null);

    const loadData = useCallback(async (p?: number) => {
        if (!activeEventId) return;
        const currentPage = p ?? page;
        setLoading(true);
        try {
            const [paginated, settData] = await Promise.all([
                db.getPaginatedDelegates(currentPage, PAGE_SIZE, searchTerm || undefined, selectedDistrict || undefined, activeEventId),
                db.getSettings()
            ]);
            setDelegates(paginated.data);
            setTotalPages(paginated.totalPages);
            setTotalRecords(paginated.total);
            setSettings(settData);
            if (p !== undefined) setPage(p);
        } catch (err) {
            console.error("Master List Load Error:", err);
        } finally {
            setLoading(false);
        }
    }, [page, searchTerm, selectedDistrict, activeEventId]);

    useEffect(() => {
        loadData(1);
        const delegateSub = supabase.channel(`master_list_sync_${activeEventId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'delegates', filter: activeEventId ? `event_id=eq.${activeEventId}` : undefined }, () => loadData())
          .subscribe();
        const settingsSub = supabase.channel('settings_sync_master')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => loadData())
          .subscribe();
        return () => { supabase.removeChannel(delegateSub); settingsSub.unsubscribe(); };
    }, [loadData]);

    const officialDistricts = useMemo(() => {
        return (settings?.districts || [])
            .map(d => d.trim())
            .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true }));
    }, [settings]);

    const displayGroups = useMemo(() => {
        const groups: string[] = [];
        const seen = new Set<string>();
        const officialSet = new Set(officialDistricts.map(d => d.trim().toUpperCase()));
        
        officialDistricts.forEach(d => {
            groups.push(d);
            seen.add(d.trim().toUpperCase());
        });
        
        delegates.forEach(d => {
            const dNorm = (d.district || '').trim();
            if (dNorm && !seen.has(dNorm.toUpperCase())) {
                seen.add(dNorm.toUpperCase());
                groups.push(dNorm);
            }
        });
        
        return groups;
    }, [delegates, officialDistricts]);

    const titles = settings?.titles || ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!editingId) return;
        if (!editForm.first_name || !editForm.last_name || !editForm.district) {
            alert("First Name, Last Name, and District are required.");
            return;
        }
        setLoading(true);
        try {
            await db.updateDelegate(editingId, editForm);
            alert("SUCCESS: Delegate record updated and normalized.");
            setEditingId(null); 
            await loadData();
        } catch(err: any) {
            alert("UPDATE FAILED: " + (err.message || "An error occurred."));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (editForm.district) {
            db.getChapters(editForm.district).then(setChapters).catch(() => setChapters([]));
        } else {
            setChapters([]);
        }
    }, [editForm.district]);

    const startEditing = (d: Delegate) => {
        const clean = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();
        setEditingId(d.delegate_id);
        setEditForm({ 
            ...d, 
            district: clean(d.district),
            rank: clean(d.rank),
            office: clean(d.office)
        });
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Helper: Robust Official Check (PERMANENT FIX: Case-Insensitive)
    const isValueOfficial = (val: string, list: string[]) => {
        if (!val) return true;
        const normalized = val.replace(/\s+/g, ' ').trim().toUpperCase();
        return list.some(item => item.replace(/\s+/g, ' ').trim().toUpperCase() === normalized);
    };

    const handleExport = () => { if (listRef.current) exportToPDF(listRef.current, "Delegate_Master_List.pdf", 'landscape'); };
    const handleCSVExport = () => { exportToCSV(delegates, 'Delegate_Master_List.csv'); };

    return (
        <div className="space-y-6">
            {editingId && (
                <div className="bg-blue-50 p-8 rounded-2xl shadow-md border-2 border-blue-200 animate-in fade-in slide-in-from-top-4 duration-300 no-print">
                    <div className="flex justify-between items-center mb-6 border-b border-blue-200 pb-4">
                        <h3 className="text-xl font-black text-blue-900 uppercase tracking-widest">Modify Delegate Record</h3>
                        <button onClick={() => setEditingId(null)} className="text-blue-400 hover:text-red-600 transition-colors font-black uppercase text-[10px]">Cancel [X]</button>
                    </div>
                    <form onSubmit={handleUpdate} className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Title</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.title} onChange={e => setEditForm({...editForm, title: e.target.value})}>
                                {titles.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">First Name</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.first_name} onChange={e => setEditForm({...editForm, first_name: e.target.value})} /></div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">Last Name</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.last_name} onChange={e => setEditForm({...editForm, last_name: e.target.value})} /></div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">District</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.district} onChange={e => setEditForm({...editForm, district: e.target.value})}>
                                <option value="">Select District</option>
                                {officialDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                                {editForm.district && !isValueOfficial(editForm.district, officialDistricts) && (
                                    <option value={editForm.district}>{editForm.district} (Un-normalized Data)</option>
                                )}
                            </select>
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Chapter</label>
                            {chapters.length > 0 ? (
                                <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.chapter} onChange={e => setEditForm({...editForm, chapter: e.target.value})}>
                                    <option value="">Select Chapter</option>
                                    {chapters.map(c => <option key={c.chapter_id} value={c.chapter_name}>{c.chapter_name}</option>)}
                                </select>
                            ) : (
                                <input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.chapter} onChange={e => setEditForm({...editForm, chapter: e.target.value})} />
                            )}
                        </div>
                        <div className="space-y-1"><label className="text-[10px] font-black text-blue-800 uppercase">Phone</label><input className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.phone} onChange={e => setEditForm({...editForm, phone: e.target.value})} /></div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Email</label>
                            <input type="email" className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.email} onChange={e => setEditForm({...editForm, email: e.target.value})} />
                        </div>
                        {showRank && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Rank</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.rank} onChange={e => setEditForm({...editForm, rank: e.target.value})}>
                                <option value="">Select Rank</option>
                                {settings?.ranks.map(r => <option key={r} value={r}>{r}</option>)}
                                {editForm.rank && !isValueOfficial(editForm.rank, settings?.ranks || []) && (
                                    <option value={editForm.rank}>{editForm.rank} (Custom)</option>
                                )}
                            </select>
                        </div>
                        )}
                        {showOffice && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Office</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.office} onChange={e => setEditForm({...editForm, office: e.target.value})}>
                                <option value="">Select Office</option>
                                {settings?.offices.map(o => <option key={o} value={o}>{o}</option>)}
                                {editForm.office && !isValueOfficial(editForm.office, settings?.offices || []) && (
                                    <option value={editForm.office}>{editForm.office} (Custom)</option>
                                )}
                            </select>
                        </div>
                        )}
                        {showDelegateType && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-blue-800 uppercase">Delegate Type</label>
                            <select className="w-full p-3 border rounded-xl bg-white font-bold" value={editForm.delegate_type} onChange={e => setEditForm({...editForm, delegate_type: e.target.value})}>
                                <option value="">Select Type</option>
                                {(settings?.delegate_types || []).map(dt => <option key={dt} value={dt}>{dt}</option>)}
                            </select>
                        </div>
                        )}
                        <div className="flex items-end">
                            <button type="submit" disabled={loading} className="w-full py-4 bg-blue-900 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-xl h-[52px]">
                                {loading ? 'SAVING...' : 'SAVE CHANGES'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="bg-white p-6 rounded-xl shadow-sm border flex flex-col md:flex-row gap-4 justify-between items-center no-print">
                <h2 className="text-xl font-black uppercase tracking-widest text-blue-900">Delegates Master List</h2>
                <div className="flex flex-1 flex-wrap gap-2 justify-end w-full md:w-auto">
                    <select className="p-2 border rounded-lg bg-gray-50 text-xs font-bold uppercase" value={selectedDistrict} onChange={e => setSelectedDistrict(e.target.value)}>
                        <option value="">All Official Districts</option>
                        {officialDistricts.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <input className="p-2 border rounded-lg text-xs min-w-[200px] font-medium" placeholder="Search by name, phone, email..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} />
                    <button onClick={handleExport} className="px-6 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black shadow-lg uppercase tracking-widest">Export PDF</button>
                    <button onClick={handleCSVExport} className="px-4 py-2 bg-green-700 text-white rounded-lg text-[10px] font-black uppercase">CSV</button>
                    <button onClick={() => loadData()} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase border">Refresh</button>
                </div>
            </div>

            <div ref={listRef} className="bg-white rounded-xl shadow-sm border p-6 min-h-screen">
                <div className="print-only mb-8 text-center border-b pb-6">
                    <h1 className="text-2xl font-black uppercase tracking-tight text-blue-900">FGBMFI Nigeria</h1>
                    <h3 className="text-sm font-bold uppercase text-gray-400">Delegates Master List</h3>
                </div>

                {loading ? (
                    <div className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Initializing Master Data...</div>
                ) : displayGroups.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="text-5xl opacity-20">📂</div>
                        <div className="text-gray-400 font-black uppercase tracking-widest text-sm">No records found matching your filter.</div>
                    </div>
                ) : displayGroups.map(groupName => {
                    const distDelegates = delegates.filter(d => (d.district || '').trim().toUpperCase() === groupName.toUpperCase());

                    if (distDelegates.length === 0) return null;
                    const isOfficial = officialDistricts.some(od => od.trim().toUpperCase() === groupName.toUpperCase());

                    return (
                        <div key={groupName} className={`mb-8 border rounded-xl overflow-hidden shadow-sm break-inside-avoid ${!isOfficial ? 'border-orange-200 bg-orange-50/20' : ''}`}>
                            <div className={`${!isOfficial ? 'bg-orange-600' : 'bg-slate-900'} text-white p-3 font-black flex justify-between items-center uppercase text-[10px] tracking-widest`}>
                                <span>{groupName} {isOfficial ? 'DISTRICT' : ''}</span>
                                <span className="bg-white/10 px-3 py-1 rounded-full">{distDelegates.length} RECORDS</span>
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full text-[10px] text-left min-w-[800px]">
                                    <thead className="bg-gray-50 border-b uppercase text-gray-500 font-black">
                                        <tr><th className="p-3 w-16">Title</th><th className="p-3">Full Name</th><th className="p-3">Chapter</th><th className="p-3">Email</th>{showRank && <th className="p-3">Rank</th>}{showOffice && <th className="p-3">Office</th>}{showDelegateType && <th className="p-3">Type</th>}<th className="p-3">Phone</th><th className="p-3 no-print w-24 text-center">Actions</th></tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {distDelegates.map(d => (
                                            <tr key={d.delegate_id} className={`hover:bg-gray-50 transition-colors ${editingId === d.delegate_id ? 'bg-blue-50' : ''}`}>
                                                <td className="p-3 font-bold text-gray-400 uppercase">{d.title}</td>
                                                <td className="p-3 font-black text-gray-900 uppercase">{d.first_name} {d.last_name}</td>
                                                <td className="p-3 font-medium">{d.chapter || '-'}</td>
                                                <td className="p-3 font-medium lowercase text-blue-600">{d.email || '-'}</td>
                                                {showRank && <td className="p-3 font-black text-blue-800 uppercase">{d.rank}</td>}
                                                {showOffice && <td className="p-3 font-medium uppercase text-[9px]">{d.office}</td>}
                                                {showDelegateType && <td className="p-3 font-medium text-[9px]">{d.delegate_type || 'Member'}</td>}
                                                <td className="p-3 font-black text-gray-500 tracking-tighter">{d.phone}</td>
                                                <td className="p-3 no-print text-center">
                                                    <button onClick={() => startEditing(d)} className="text-blue-600 font-black uppercase text-[9px] border border-blue-200 px-3 py-1 rounded-lg hover:bg-blue-600 hover:text-white transition-all">Edit</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
                {totalPages > 1 && (
                    <div className="no-print mt-6 flex items-center justify-center gap-3 pt-4 border-t border-gray-200">
                        <button onClick={() => loadData(1)} disabled={page <= 1} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">First</button>
                        <button onClick={() => loadData(page - 1)} disabled={page <= 1} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Prev</button>
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-3">
                            Page {page} of {totalPages}
                        </span>
                        <button onClick={() => loadData(page + 1)} disabled={page >= totalPages} className="px-4 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Next</button>
                        <button onClick={() => loadData(totalPages)} disabled={page >= totalPages} className="px-3 py-2 bg-gray-100 hover:bg-gray-200 disabled:opacity-40 rounded-lg text-[10px] font-black uppercase">Last</button>
                        <span className="text-[9px] font-bold text-gray-400">({totalRecords} total)</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MasterListModule;
