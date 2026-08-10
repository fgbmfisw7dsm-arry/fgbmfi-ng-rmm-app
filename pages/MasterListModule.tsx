
import React, { useState, useEffect, useRef, useMemo, useCallback, useContext } from 'react';
import { db } from '../services/supabaseService';
import { supabase } from '../services/supabaseClient';
import { Delegate, SystemSettings, Chapter, isAdminRole } from '../types';
import { exportToPDF, exportToCSV } from '../services/utils';
import { getScopeFilter } from '../types';
import { AppContext } from '../context/AppContext';

const PAGE_SIZE = 25;

const MasterListModule = () => {
    const { activeEventId, activeEvent, user, events, onEventChange } = useContext(AppContext);
    const isAdmin = isAdminRole((user?.role || '').toLowerCase());

    useEffect(() => {
        if (!activeEventId && Array.isArray(events)) {
            const liveEvent = events.find(e => e.is_active !== false);
            if (liveEvent) onEventChange(liveEvent.event_id);
        }
    }, [activeEventId, events, onEventChange]);

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
    const scope = getScopeFilter(user);
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
    const pageRef = useRef(1);
    const listRef = useRef<HTMLDivElement>(null);
    const [districtListLoading, setDistrictListLoading] = useState(false);
    const [districtList, setDistrictList] = useState<{ district: string; count: number }[]>([]);
    const [districtSections, setDistrictSections] = useState<Record<string, { delegates: Delegate[]; page: number; total: number; pages: number; loading: boolean }>>({});

    const loadData = useCallback(async (p?: number) => {
        if (!activeEventId) return;
        const currentPage = p ?? pageRef.current;
        setLoading(true);
        try {
            const [paginated, settData] = await Promise.all([
                db.getPaginatedDelegates(currentPage, PAGE_SIZE, searchTerm || undefined, selectedDistrict || undefined, scope.region, activeEventId),
                db.getSettings()
            ]);
            setDelegates(paginated.data);
            setTotalPages(paginated.totalPages);
            setTotalRecords(paginated.total);
            setSettings(settData);
            setPage(currentPage);
            pageRef.current = currentPage;
        } catch (err) {
            console.error("Master List Load Error:", err);
        } finally {
            setLoading(false);
        }
    }, [searchTerm, selectedDistrict, activeEventId]);

    const loadDistrictPage = useCallback(async (district: string, pageNum: number) => {
        if (!activeEventId) return;
        setDistrictSections(prev => ({
            ...prev,
            [district]: { ...(prev[district] || { delegates: [], page: 1, total: 0, pages: 0 }), loading: true },
        }));
        try {
            const result = await db.getPaginatedDelegates(pageNum, PAGE_SIZE, undefined, district, undefined, activeEventId);
            setDistrictSections(prev => ({
                ...prev,
                [district]: { delegates: result.data, page: pageNum, total: result.total, pages: result.totalPages, loading: false },
            }));
        } catch (err) {
            console.error(`[MasterList] loadDistrictPage error for ${district}:`, err);
            setDistrictSections(prev => ({
                ...prev,
                [district]: { ...(prev[district] || { delegates: [], page: 1, total: 0, pages: 0 }), loading: false },
            }));
        }
    }, [activeEventId]);

    const loadAllDistricts = useCallback(async () => {
        if (!activeEventId) return;
        setDistrictListLoading(true);
        try {
            const [list, settData] = await Promise.all([
                db.getDistrictsWithDelegates(activeEventId),
                db.getSettings(),
            ]);
            setDistrictList(list);
            setSettings(settData);
            const init: Record<string, any> = {};
            for (const d of list) {
                init[d.district] = { delegates: [], page: 1, total: d.count, pages: Math.ceil(d.count / PAGE_SIZE), loading: true };
            }
            setDistrictSections(init);
            for (const d of list) {
                loadDistrictPage(d.district, 1);
            }
        } catch (err) {
            console.error('[MasterList] loadAllDistricts error:', err);
        } finally {
            setDistrictListLoading(false);
        }
    }, [activeEventId, loadDistrictPage]);

    useEffect(() => {
        if (!activeEventId) return;
        if (!selectedDistrict && !searchTerm) {
            loadAllDistricts();
        } else {
            loadData(1);
        }
    }, [activeEventId, selectedDistrict, searchTerm]);

    useEffect(() => {
        if (!selectedDistrict && !searchTerm) return;
        const delegateSub = supabase.channel(`master_list_sync_${activeEventId}`)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'delegates', filter: activeEventId ? `event_id=eq.${activeEventId}` : undefined }, () => loadData(pageRef.current))
          .subscribe();
        const settingsSub = supabase.channel('settings_sync_master')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'system_settings' }, () => loadData(pageRef.current))
          .subscribe();
        return () => { supabase.removeChannel(delegateSub); settingsSub.unsubscribe(); };
    }, [loadData, selectedDistrict, searchTerm]);

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

    const [exporting, setExporting] = useState<'pdf' | 'csv' | null>(null);

    const handleExport = async () => {
        if (!activeEventId) return;
        setExporting('pdf');
        try {
            const district = selectedDistrict || undefined;
            const search = searchTerm || undefined;
            const all = await db.fetchAllDelegatesForExport(activeEventId, district, search);
            const colSpan = 7 + (showRank ? 1 : 0) + (showOffice ? 1 : 0) + (showDelegateType ? 1 : 0);
            const headerCells = [
                '<th class="p-3 w-12">#</th><th class="p-3 w-16">Title</th><th class="p-3">Full Name</th><th class="p-3">Chapter</th><th class="p-3">Email</th>',
                showRank ? '<th class="p-3">Rank</th>' : '',
                showOffice ? '<th class="p-3">Office</th>' : '',
                showDelegateType ? '<th class="p-3">Type</th>' : '',
                '<th class="p-3">Phone</th>',
            ].join('');
            const rows = all.map((d, i) => {
                const cells = [
                    `<td class="p-3 text-[9px] font-mono text-gray-400">${i + 1}</td>`,
                    `<td class="p-3 font-bold text-gray-400 uppercase">${d.title}</td>`,
                    `<td class="p-3 font-black text-gray-900 uppercase">${d.first_name} ${d.last_name}</td>`,
                    `<td class="p-3 font-medium">${d.chapter || '-'}</td>`,
                    `<td class="p-3 font-medium lowercase text-blue-600">${d.email || '-'}</td>`,
                    showRank ? `<td class="p-3 font-black text-blue-800 uppercase">${d.rank}</td>` : '',
                    showOffice ? `<td class="p-3 font-medium uppercase text-[9px]">${d.office}</td>` : '',
                    showDelegateType ? `<td class="p-3 font-medium text-[9px]">${d.delegate_type || 'Member'}</td>` : '',
                    `<td class="p-3 font-black text-gray-500 tracking-tighter">${d.phone}</td>`,
                ];
                return `<tr class="hover:bg-gray-50">${cells.join('')}</tr>`;
            }).join('');
            const distLabel = district ? district.replace(/[^A-Za-z0-9-]/g, '-') : 'All-Districts';
            const tableHtml = `<table class="w-full text-[10px] text-left min-w-[1000px]"><thead class="bg-gray-50 border-b uppercase text-gray-500 font-black"><tr>${headerCells}</tr></thead><tbody class="divide-y divide-gray-100">${rows}</tbody></table>`;
            const container = document.createElement('div');
            container.innerHTML = tableHtml;
            container.style.position = 'absolute';
            container.style.left = '-9999px';
            document.body.appendChild(container);
            await new Promise(r => requestAnimationFrame(r));
            await new Promise(r => setTimeout(r, 300));
            exportToPDF(container, `Delegate_Master_List_${distLabel}.pdf`, 'landscape', 1600);
            document.body.removeChild(container);
        } catch (err) {
            console.error('PDF export error:', err);
        } finally {
            setExporting(null);
        }
    };

    const handleCSVExport = async () => {
        if (!activeEventId) return;
        setExporting('csv');
        try {
            const district = selectedDistrict || undefined;
            const search = searchTerm || undefined;
            const all = await db.fetchAllDelegatesForExport(activeEventId, district, search);
            const distLabel = district ? district.replace(/[^A-Za-z0-9-]/g, '-') : 'All-Districts';
            const cols = ['title', 'first_name', 'last_name', 'chapter', 'email'];
            if (showRank) cols.push('rank');
            if (showOffice) cols.push('office');
            if (showDelegateType) cols.push('delegate_type');
            cols.push('phone', 'district');
            exportToCSV(all, `Delegate_Master_List_${distLabel}.csv`, cols);
        } catch (err) {
            console.error('CSV export error:', err);
        } finally {
            setExporting(null);
        }
    };

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
                    <button onClick={handleExport} disabled={!!exporting} className="px-6 py-2 bg-slate-900 text-white rounded-lg text-[10px] font-black shadow-lg uppercase tracking-widest disabled:opacity-50">{exporting === 'pdf' ? 'Exporting PDF...' : 'Export PDF'}</button>
                    <button onClick={handleCSVExport} disabled={!!exporting} className="px-4 py-2 bg-green-700 text-white rounded-lg text-[10px] font-black uppercase disabled:opacity-50">{exporting === 'csv' ? 'Exporting CSV...' : 'CSV'}</button>
                    <button onClick={() => loadData()} className="px-4 py-2 bg-gray-100 text-gray-600 rounded-lg text-[10px] font-black uppercase border">Refresh</button>
                </div>
            </div>

            <div ref={listRef} className="bg-white rounded-xl shadow-sm border p-6 min-h-screen">
                <div className="print-only mb-8 text-center border-b pb-6">
                    <h1 className="text-2xl font-black uppercase tracking-tight text-blue-900">FGBMFI Nigeria</h1>
                    <h3 className="text-sm font-bold uppercase text-gray-400">Delegates Master List</h3>
                </div>

                {loading || districtListLoading ? (
                    <div className="py-20 text-center text-gray-400 font-bold uppercase tracking-widest animate-pulse">Initializing Master Data...</div>
                ) : !selectedDistrict && !searchTerm ? (
                    /* --- MULTI-DISTRICT VIEW: per-district sections with independent pagination --- */
                    districtList.length === 0 ? (
                        <div className="py-20 text-center space-y-4">
                            <div className="text-5xl opacity-20">📂</div>
                            <div className="text-gray-400 font-black uppercase tracking-widest text-sm">No delegates in any district for this event.</div>
                        </div>
                    ) : (
                        districtList.map(({ district, count }) => {
                            const sec = districtSections[district];
                            const delegates = sec?.delegates || [];
                            const secPage = sec?.page || 1;
                            const secPages = sec?.pages || 0;
                            const secLoading = sec?.loading ?? true;
                            const secTotal = sec?.total || count;
                            const colSpan = 7 + (showRank ? 1 : 0) + (showOffice ? 1 : 0) + (showDelegateType ? 1 : 0);
                            const isOfficial = isValueOfficial(district, officialDistricts);
                            return (
                                <div key={district} className="mb-6 border rounded-xl overflow-hidden shadow-sm print:break-inside-avoid">
                                    <div className={`${isOfficial ? 'bg-slate-900' : 'bg-orange-600'} text-white p-3 font-black flex justify-between items-center uppercase text-[10px] tracking-widest`}>
                                        <span>{district} DISTRICT</span>
                                        <span className="bg-white/10 px-3 py-1 rounded-full">{secTotal} RECORDS</span>
                                    </div>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[10px] text-left min-w-[1000px]">
                                            <thead className="bg-gray-50 border-b uppercase text-gray-500 font-black">
                                                <tr><th className="p-3 w-12">#</th><th className="p-3 w-16">Title</th><th className="p-3">Full Name</th><th className="p-3">Chapter</th><th className="p-3">Email</th>{showRank && <th className="p-3">Rank</th>}{showOffice && <th className="p-3">Office</th>}{showDelegateType && <th className="p-3">Type</th>}<th className="p-3">Phone</th><th className="p-3 no-print w-24 text-center">Actions</th></tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {secLoading ? (
                                                    <tr><td colSpan={colSpan} className="p-8 text-center text-gray-300 font-mono text-[9px]">Loading...</td></tr>
                                                ) : delegates.length === 0 ? (
                                                    <tr><td colSpan={colSpan} className="p-8 text-center text-gray-300 font-mono text-[9px]">No records on this page</td></tr>
                                                ) : (
                                                    delegates.map((d, i) => (
                                                        <tr key={d.delegate_id} className={`hover:bg-gray-50 transition-colors ${editingId === d.delegate_id ? 'bg-blue-50' : ''}`}>
                                                            <td className="p-3 text-[9px] font-mono text-gray-400">{(secPage - 1) * PAGE_SIZE + i + 1}</td>
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
                                                    ))
                                                )}
                                                {!secLoading && delegates.length < PAGE_SIZE && Array.from({ length: PAGE_SIZE - delegates.length }, (_, i) => (
                                                    <tr key={`__pad_${district}_${i}`} className="bg-gray-50/50">
                                                        <td colSpan={colSpan} className="p-3 text-center text-[9px] text-gray-300 font-mono">&nbsp;</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    {secPages > 1 && (
                                        <div className="no-print flex items-center justify-center gap-2 py-2 px-3 bg-gray-50 border-t border-gray-100">
                                            <button onClick={() => loadDistrictPage(district, 1)} disabled={secPage <= 1} className="px-2 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">First</button>
                                            <button onClick={() => loadDistrictPage(district, secPage - 1)} disabled={secPage <= 1} className="px-3 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Prev</button>
                                            <span className="text-[8px] font-bold text-gray-400 uppercase px-1">Pg {secPage}/{secPages}</span>
                                            <button onClick={() => loadDistrictPage(district, secPage + 1)} disabled={secPage >= secPages} className="px-3 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Next</button>
                                            <button onClick={() => loadDistrictPage(district, secPages)} disabled={secPage >= secPages} className="px-2 py-1 bg-white hover:bg-gray-100 disabled:opacity-30 rounded text-[8px] font-black uppercase border">Last</button>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )
                ) : delegates.length === 0 ? (
                    <div className="py-20 text-center space-y-4">
                        <div className="text-5xl opacity-20">📂</div>
                        <div className="text-gray-400 font-black uppercase tracking-widest text-sm">No records found matching your filter.</div>
                    </div>
                ) : (
                    /* --- SPECIFIC DISTRICT / SEARCH MODE: unified table --- */
                    <div>
                        {selectedDistrict && (
                            <div className="bg-slate-900 text-white p-3 font-black flex justify-between items-center uppercase text-[10px] tracking-widest rounded-xl mb-4">
                                <span>{selectedDistrict} DISTRICT</span>
                                <span className="bg-white/10 px-3 py-1 rounded-full">{totalRecords} TOTAL</span>
                            </div>
                        )}
                        <div className="overflow-x-auto">
                            <table className="w-full text-[10px] text-left min-w-[1000px]">
                                <thead className="bg-gray-50 border-b uppercase text-gray-500 font-black">
                                    <tr><th className="p-3 w-12">#</th><th className="p-3 w-16">Title</th><th className="p-3">Full Name</th><th className="p-3">Chapter</th><th className="p-3">Email</th>{showRank && <th className="p-3">Rank</th>}{showOffice && <th className="p-3">Office</th>}{showDelegateType && <th className="p-3">Type</th>}<th className="p-3">Phone</th><th className="p-3 no-print w-24 text-center">Actions</th></tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {delegates.map((d, i) => (
                                        <tr key={d.delegate_id} className={`hover:bg-gray-50 transition-colors ${editingId === d.delegate_id ? 'bg-blue-50' : ''}`}>
                                            <td className="p-3 text-[9px] font-mono text-gray-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
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
                                    {delegates.length < PAGE_SIZE && Array.from({ length: PAGE_SIZE - delegates.length }, (_, i) => (
                                        <tr key={`__pad_${i}`} className="bg-gray-50/50">
                                            <td colSpan={7 + (showRank ? 1 : 0) + (showOffice ? 1 : 0) + (showDelegateType ? 1 : 0)} className="p-3 text-center text-[9px] text-gray-300 font-mono">&nbsp;</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
                {totalPages > 1 && (selectedDistrict || searchTerm) && (
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
