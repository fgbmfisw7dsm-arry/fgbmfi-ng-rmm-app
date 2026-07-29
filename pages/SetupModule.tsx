import React, { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { SystemSettings, Chapter } from '../types';

interface ConfigSectionProps {
    title: string;
    fieldKey: keyof SystemSettings;
    items: string[];
    onAction: (action: 'add' | 'edit' | 'delete', val: string | number, newVal?: string) => Promise<void>;
    isSyncing: boolean;
}

const ConfigSection: React.FC<ConfigSectionProps> = ({ title, fieldKey, items = [], onAction, isSyncing }) => {
    const [newVal, setNewVal] = useState('');
    const [editIdx, setEditIdx] = useState<number | null>(null);
    const [editVal, setEditVal] = useState('');
    const [confirmDeleteIdx, setConfirmDeleteIdx] = useState<number | null>(null);
    const [localProcessing, setLocalProcessing] = useState(false);

    const handleAdd = async () => {
        if (newVal.trim() && !localProcessing) {
            setLocalProcessing(true);
            await onAction('add', newVal.trim());
            setNewVal('');
            setLocalProcessing(false);
        }
    };

    const handleEdit = async (idx: number) => {
        if (editVal.trim() && !localProcessing) {
            setLocalProcessing(true);
            await onAction('edit', idx, editVal.trim());
            setEditIdx(null);
            setLocalProcessing(false);
        }
    };

    const handleDelete = async (idx: number) => {
        if (!localProcessing) {
            setLocalProcessing(true);
            await onAction('delete', idx);
            setConfirmDeleteIdx(null);
            setLocalProcessing(false);
        }
    };

    return (
        <div className="bg-white rounded-3xl border shadow-sm flex flex-col h-full overflow-hidden transition-all hover:shadow-md">
            {/* Section Header */}
            <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
                <div>
                    <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-900">{title} Setup</h3>
                    <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">{items.length} Registered Entries</p>
                </div>
                {(isSyncing || localProcessing) && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-blue-100 text-blue-700 rounded-full animate-pulse">
                        <div className="w-1.5 h-1.5 bg-blue-600 rounded-full animate-ping"></div>
                        <span className="text-[8px] font-black uppercase">Syncing</span>
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="p-6 bg-white border-b">
                <div className="flex gap-2">
                    <input 
                        className="flex-1 p-3.5 border-2 border-gray-100 rounded-xl font-bold bg-gray-50 text-sm focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none transition-all" 
                        placeholder={`New ${title.toLowerCase().slice(0, -1)}...`} 
                        value={newVal} 
                        onChange={e => setNewVal(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleAdd()}
                        disabled={localProcessing}
                    />
                    <button 
                        onClick={handleAdd} 
                        disabled={!newVal.trim() || localProcessing}
                        className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white font-black rounded-xl uppercase text-[10px] tracking-widest shadow-lg shadow-blue-100 disabled:opacity-30 transition-all active:scale-95"
                    >
                        Add
                    </button>
                </div>
            </div>

            {/* Items Table */}
            <div className="flex-1 overflow-auto max-h-[400px] custom-scrollbar">
                <table className="w-full text-xs text-left">
                    <tbody className="divide-y divide-gray-100">
                        {items.length > 0 ? items.map((item, idx) => {
                            const isEditing = editIdx === idx;
                            const isConfirming = confirmDeleteIdx === idx;

                            return (
                                <tr key={idx} className={`transition-colors ${isConfirming ? 'bg-red-50' : 'hover:bg-gray-50/50'}`}>
                                    <td className="p-4">
                                        {isEditing ? (
                                            <input 
                                                autoFocus
                                                className="w-full p-2.5 border-2 border-blue-200 rounded-lg bg-white font-bold text-blue-700 outline-none shadow-inner" 
                                                value={editVal} 
                                                onChange={e => setEditVal(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') handleEdit(idx);
                                                    if (e.key === 'Escape') setEditIdx(null);
                                                }}
                                            />
                                        ) : (
                                            <span className={`font-bold uppercase tracking-tight ${isConfirming ? 'text-red-900 opacity-40' : 'text-gray-700'}`}>
                                                {item}
                                            </span>
                                        )}
                                    </td>
                                    
                                    <td className="p-4 w-44 text-right">
                                        {isEditing ? (
                                            <div className="flex gap-2 justify-end">
                                                <button onClick={() => handleEdit(idx)} className="bg-green-600 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[8px] shadow-sm hover:bg-green-700 transition-all">Save</button>
                                                <button onClick={() => setEditIdx(null)} className="bg-gray-400 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[8px] hover:bg-gray-500 transition-all">Exit</button>
                                            </div>
                                        ) : isConfirming ? (
                                            <div className="flex gap-2 justify-end animate-in slide-in-from-right-2">
                                                <button onClick={() => handleDelete(idx)} className="bg-red-600 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[8px] shadow-lg hover:bg-red-700 transition-all active:scale-95">Yes, Delete</button>
                                                <button onClick={() => setConfirmDeleteIdx(null)} className="bg-slate-800 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[8px] hover:bg-slate-900 transition-all">No</button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-2 justify-end">
                                                <button 
                                                    onClick={() => { setEditIdx(idx); setEditVal(item); setConfirmDeleteIdx(null); }} 
                                                    className="flex items-center gap-1.5 text-blue-600 font-black uppercase text-[9px] border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                                    Edit
                                                </button>
                                                <button 
                                                    onClick={() => { setConfirmDeleteIdx(idx); setEditIdx(null); }} 
                                                    className="flex items-center gap-1.5 text-red-500 font-black uppercase text-[9px] border border-red-100 px-3 py-1.5 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm"
                                                >
                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                    Delete
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            );
                        }) : (
                            <tr><td colSpan={2} className="p-12 text-center text-gray-300 italic font-bold text-[10px] uppercase tracking-widest">No parameters defined</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

const SetupModule = () => {
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [syncingKey, setSyncingKey] = useState<string | null>(null);
    const [chapters, setChapters] = useState<Chapter[]>([]);
    const [chapterFilterDistrict, setChapterFilterDistrict] = useState('');
    const [chapterSearch, setChapterSearch] = useState('');
    const [importingChapters, setImportingChapters] = useState(false);

    const sortSettings = (data: any): SystemSettings => {
        return {
            id: data.id, 
            districts: [...(data.districts || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
            ranks: [...(data.ranks || [])].sort((a, b) => a.localeCompare(b)),
            offices: [...(data.offices || [])].sort((a, b) => a.localeCompare(b)),
            titles: [...(data.titles || [])].sort((a, b) => a.localeCompare(b)),
            regions: [...(data.regions || [])].sort((a, b) => a.localeCompare(b)),
            delegate_types: [...(data.delegate_types || ['Member', 'National Guest', 'Free Guest', 'Dependant-Adult', 'Dependant-Teen', 'Dependant-Children', 'International'])].sort((a, b) => a.localeCompare(b))
        };
    };

    const loadSettings = async () => {
        setLoading(true);
        try {
            const data = await db.getSettings();
            let processedData = { ...data };
            if (!processedData.titles || processedData.titles.length === 0) {
                processedData.titles = ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];
            }
            setSettings(sortSettings(processedData));
        } catch (err) {
            console.error("Setup load error:", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        loadSettings();
        loadChapters();
    }, []);

    const loadChapters = async (district?: string) => {
        try {
            const data = await db.getChapters(district || chapterFilterDistrict);
            setChapters(data);
        } catch {}
    };

    useEffect(() => {
        loadChapters();
    }, [chapterFilterDistrict]);

    const handleAction = async (key: keyof SystemSettings, action: 'add' | 'edit' | 'delete', val: string | number, newVal?: string) => {
        if (!settings) return;
        
        // 1. Prepare NEW settings state
        const newSettings = { ...settings };
        const currentList = Array.isArray(newSettings[key]) ? [...(newSettings[key] as string[])] : [];

        if (action === 'add') {
            currentList.push(val as string);
        } else if (action === 'edit') {
            currentList[val as number] = newVal || '';
        } else if (action === 'delete') {
            currentList.splice(val as number, 1);
        }

        (newSettings[key] as any) = currentList;
        
        // 2. IMMEDIATE SYNC WITH DATABASE
        setSyncingKey(key);
        try {
            // Use surgical update to only touch the changed column
            const updated = await db.updateSettings(newSettings, key);
            setSettings(sortSettings(updated));
        } catch (e: any) {
            alert(`Synchronization Error: ${e.message || 'Database update failed.'}`);
            // Rollback to server state
            await loadSettings();
        } finally {
            setSyncingKey(null);
        }
    };

    const handleImportChapters = async () => {
        if (!window.confirm(`This will import approximately 1,447 chapters from the embedded master data. Existing records with matching chapter codes will be updated. Continue?`)) return;
        setImportingChapters(true);
        try {
            const response = await fetch('/chapters_data.json');
            if (!response.ok) throw new Error('Chapters data not found');
            const data = await response.json();
            const result = await db.importChapters(data);
            if (result.errors.length > 0) {
                console.error('Chapter import errors:', result.errors);
            }
            alert(`Chapters import complete. ${result.inserted} records synced.${result.errors.length > 0 ? ` ${result.errors.length} errors occurred (check console).` : ''}`);
            await loadChapters();
        } catch (e: any) {
            alert('Import failed: ' + (e.message || 'Could not load chapters data.'));
        } finally {
            setImportingChapters(false);
        }
    };

    if (loading && !settings) return (
        <div className="p-20 text-center flex flex-col items-center gap-4">
            <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="font-black uppercase tracking-[0.2em] text-gray-400 text-xs">Initializing Master Parameters...</p>
        </div>
    );

    return (
        <div className="space-y-8 max-w-6xl mx-auto animate-in fade-in duration-500">
            <div className="bg-white p-8 rounded-3xl shadow-sm border flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-blue-900 leading-none">System Parameters Setup</h2>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2 leading-relaxed">
                        Configure global dropdowns and metadata. Changes are synchronized instantly to the cloud.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button onClick={loadSettings} className="px-6 py-2.5 bg-gray-100 text-gray-500 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-gray-200 transition-all border">Force Refresh</button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-32">
                <ConfigSection 
                    title="Titles" 
                    fieldKey="titles"
                    items={settings?.titles || []} 
                    onAction={(a, v, nv) => handleAction('titles', a, v, nv)}
                    isSyncing={syncingKey === 'titles'}
                />
                <ConfigSection 
                    title="Regions" 
                    fieldKey="regions"
                    items={settings?.regions || []} 
                    onAction={(a, v, nv) => handleAction('regions', a, v, nv)}
                    isSyncing={syncingKey === 'regions'}
                />
                <ConfigSection 
                    title="Districts" 
                    fieldKey="districts"
                    items={settings?.districts || []} 
                    onAction={(a, v, nv) => handleAction('districts', a, v, nv)}
                    isSyncing={syncingKey === 'districts'}
                />
                <ConfigSection 
                    title="Ranks" 
                    fieldKey="ranks"
                    items={settings?.ranks || []} 
                    onAction={(a, v, nv) => handleAction('ranks', a, v, nv)}
                    isSyncing={syncingKey === 'ranks'}
                />
                <ConfigSection 
                    title="Offices" 
                    fieldKey="offices"
                    items={settings?.offices || []} 
                    onAction={(a, v, nv) => handleAction('offices', a, v, nv)}
                    isSyncing={syncingKey === 'offices'}
                />
                <ConfigSection 
                    title="Delegate Types" 
                    fieldKey="delegate_types"
                    items={settings?.delegate_types || []} 
                    onAction={(a, v, nv) => handleAction('delegate_types', a, v, nv)}
                    isSyncing={syncingKey === 'delegate_types'}
                />

                <div className="bg-white rounded-3xl border shadow-sm flex flex-col h-full overflow-hidden transition-all hover:shadow-md lg:col-span-2">
                    <div className="p-6 bg-slate-50 border-b flex justify-between items-center">
                        <div>
                            <h3 className="text-xs font-black uppercase tracking-[0.2em] text-blue-900">Chapters Registry</h3>
                            <p className="text-[9px] font-bold text-gray-400 uppercase mt-0.5">{chapters.length} Chapters Loaded</p>
                        </div>
                        <button onClick={handleImportChapters} disabled={importingChapters} className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-black rounded-xl uppercase text-[9px] tracking-widest shadow transition-all">
                            {importingChapters ? 'Importing...' : 'Import 1,447 Chapters'}
                        </button>
                    </div>
                    <div className="p-4 bg-white border-b flex gap-2 flex-wrap">
                        <select className="p-2.5 border-2 border-gray-100 rounded-xl font-bold text-xs bg-gray-50" value={chapterFilterDistrict} onChange={e => setChapterFilterDistrict(e.target.value)}>
                            <option value="">All Districts</option>
                            {(settings?.districts || []).map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                        <input className="flex-1 p-2.5 border-2 border-gray-100 rounded-xl font-bold text-xs bg-gray-50 min-w-[180px]" placeholder="Search chapter name..." value={chapterSearch} onChange={e => setChapterSearch(e.target.value)} />
                    </div>
                    <div className="flex-1 overflow-auto max-h-[400px]">
                        <table className="w-full text-xs text-left">
                            <tbody className="divide-y divide-gray-100">
                                {chapters.filter(c => !chapterSearch || c.chapter_name.toLowerCase().includes(chapterSearch.toLowerCase())).map(c => (
                                    <tr key={c.chapter_id} className="hover:bg-gray-50/50">
                                        <td className="p-3 font-bold text-gray-700 uppercase">{c.chapter_name}</td>
                                        <td className="p-3 font-medium text-blue-700 uppercase">{c.district}</td>
                                        <td className="p-3 text-gray-400 font-mono text-[9px]">{c.chapter_code}</td>
                                        <td className="p-3 text-gray-400">{c.city || '-'}</td>
                                    </tr>
                                ))}
                                {chapters.filter(c => !chapterSearch || c.chapter_name.toLowerCase().includes(chapterSearch.toLowerCase())).length === 0 && (
                                    <tr><td colSpan={4} className="p-12 text-center text-gray-300 italic font-bold text-[10px] uppercase tracking-widest">No chapters found. Click the import button to load from master data.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SetupModule;