
import React, { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { SystemSettings } from '../types';

interface ConfigSectionProps {
    title: string;
    items: string[];
    onAdd: (val: string) => void;
    onEdit: (index: number, newVal: string) => void;
    onDelete: (index: number) => void;
}

const ConfigSection: React.FC<ConfigSectionProps> = ({ title, items = [], onAdd, onEdit, onDelete }) => {
    const [newVal, setNewVal] = useState('');
    const [editIdx, setEditIdx] = useState<number | null>(null);
    const [editVal, setEditVal] = useState('');

    const handleAdd = () => {
        if (newVal.trim()) {
            onAdd(newVal.trim());
            setNewVal('');
        }
    };

    return (
        <div className="bg-white p-6 rounded-2xl border shadow-sm flex flex-col h-full">
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-900 mb-4 border-b pb-2 flex justify-between">
                <span>{title} Setup</span>
                <span className="text-gray-400">{items.length} Total</span>
            </h3>
            <div className="flex gap-2 mb-4">
                <input 
                    className="flex-1 p-3 border rounded-xl font-bold bg-gray-50 text-sm focus:ring-2 focus:ring-blue-500 outline-none" 
                    placeholder={`Add new ${title.toLowerCase().slice(0, -1)}...`} 
                    value={newVal} 
                    onChange={e => setNewVal(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
                <button onClick={handleAdd} className="px-4 py-2 bg-blue-600 text-white font-black rounded-xl uppercase text-[10px] tracking-widest shadow-md">Add</button>
            </div>
            <div className="flex-1 overflow-auto rounded-xl border border-gray-100 max-h-[300px]">
                <table className="w-full text-xs text-left">
                    <tbody className="divide-y divide-gray-50">
                        {items.length > 0 ? items.map((item, idx) => (
                            <tr key={idx} className="hover:bg-gray-50 group">
                                <td className="p-3">
                                    {editIdx === idx ? (
                                        <input 
                                            autoFocus
                                            className="w-full p-2 border rounded-lg bg-white font-bold text-blue-700 outline-none ring-1 ring-blue-500" 
                                            value={editVal} 
                                            onChange={e => setEditVal(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') { onEdit(idx, editVal); setEditIdx(null); }
                                                if (e.key === 'Escape') setEditIdx(null);
                                            }}
                                        />
                                    ) : <span className="font-bold text-gray-700 uppercase">{item}</span>}
                                </td>
                                <td className="p-3 w-28 text-right opacity-0 group-hover:opacity-100 transition-opacity">
                                    {editIdx === idx ? (
                                        <div className="flex gap-2 justify-end">
                                            <button onClick={() => { onEdit(idx, editVal); setEditIdx(null); }} className="text-green-600 font-black uppercase text-[9px]">Save</button>
                                            <button onClick={() => setEditIdx(null)} className="text-gray-400 font-black uppercase text-[9px]">Cancel</button>
                                        </div>
                                    ) : (
                                        <div className="flex gap-2 justify-end">
                                            <button onClick={() => { setEditIdx(idx); setEditVal(item); }} className="text-blue-500 font-black uppercase text-[9px]">Edit</button>
                                            <button onClick={() => onDelete(idx)} className="text-red-500 font-black uppercase text-[9px]">Delete</button>
                                        </div>
                                    )}
                                </td>
                            </tr>
                        )) : (
                            <tr><td className="p-8 text-center text-gray-400 italic font-medium">No entries found.</td></tr>
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

    const sortSettings = (data: SystemSettings): SystemSettings => {
        return {
            ...data,
            districts: [...(data.districts || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
            ranks: [...(data.ranks || [])].sort((a, b) => a.localeCompare(b)),
            offices: [...(data.offices || [])].sort((a, b) => a.localeCompare(b)),
            titles: [...(data.titles || [])].sort((a, b) => a.localeCompare(b)),
            regions: [...(data.regions || [])].sort((a, b) => a.localeCompare(b))
        };
    };

    useEffect(() => { 
        db.getSettings().then(data => {
            const defaultTitles = ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];
            if (!data.titles || data.titles.length === 0) {
                data.titles = defaultTitles;
            } else {
                const unwanted = ['Pastor', 'Deacon', 'Brother', 'Sister'];
                data.titles = data.titles.filter(t => !unwanted.includes(t));
            }
            // Apply sorting immediately on load
            setSettings(sortSettings(data));
            setLoading(false);
        }); 
    }, []);

    const saveSettings = async () => {
        if (!settings) return;
        setLoading(true);
        try {
            // Re-sort before final save just in case
            const sorted = sortSettings(settings);
            const payload = { ...sorted, id: 1 };
            await db.updateSettings(payload);
            setSettings(sorted); // Sync state with sorted version
            alert("SUCCESS: System configuration updated and saved to database.");
        } catch (e: any) {
            console.error("Save Settings Error:", e);
            alert("ERROR: Failed to save configuration. " + (e.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    const handleAction = (key: keyof SystemSettings, action: 'add' | 'edit' | 'delete', val: string | number, newVal?: string) => {
        if (!settings) return;
        const newSettings = { ...settings };
        if (action === 'add') {
            newSettings[key] = [...(newSettings[key] as string[]), val as string];
        } else if (action === 'edit') {
            const arr = [...(newSettings[key] as string[])];
            arr[val as number] = newVal || '';
            newSettings[key] = arr;
        } else if (action === 'delete') {
            newSettings[key] = (newSettings[key] as string[]).filter((_, i) => i !== val);
        }
        // Always maintain sorting after any state change
        setSettings(sortSettings(newSettings));
    };

    if (loading || !settings) return <div className="p-20 text-center font-black uppercase tracking-widest text-gray-400 animate-pulse">Initializing System Setup...</div>;

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <div className="bg-white p-6 rounded-2xl shadow-sm border flex flex-col md:flex-row justify-between items-center gap-4">
                <div>
                    <h2 className="text-xl font-black uppercase tracking-widest text-blue-900">System Parameters Setup</h2>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-tighter">Manage global dropdowns, lists and regional metadata</p>
                </div>
                <button 
                    onClick={saveSettings} 
                    disabled={loading}
                    className="px-8 py-4 bg-blue-900 hover:bg-slate-800 text-white font-black rounded-xl shadow-xl transition-all uppercase text-xs tracking-widest disabled:opacity-50"
                >
                    {loading ? 'Saving Changes...' : 'Save Configuration'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-10">
                <ConfigSection 
                    title="Titles" 
                    items={settings.titles} 
                    onAdd={(v) => handleAction('titles', 'add', v)} 
                    onEdit={(i, v) => handleAction('titles', 'edit', i, v)} 
                    onDelete={(i) => handleAction('titles', 'delete', i)} 
                />
                <ConfigSection 
                    title="Regions" 
                    items={settings.regions} 
                    onAdd={(v) => handleAction('regions', 'add', v)} 
                    onEdit={(i, v) => handleAction('regions', 'edit', i, v)} 
                    onDelete={(i) => handleAction('regions', 'delete', i)} 
                />
                <ConfigSection 
                    title="Districts" 
                    items={settings.districts} 
                    onAdd={(v) => handleAction('districts', 'add', v)} 
                    onEdit={(i, v) => handleAction('districts', 'edit', i, v)} 
                    onDelete={(i) => handleAction('districts', 'delete', i)} 
                />
                <ConfigSection 
                    title="Ranks" 
                    items={settings.ranks} 
                    onAdd={(v) => handleAction('ranks', 'add', v)} 
                    onEdit={(i, v) => handleAction('ranks', 'edit', i, v)} 
                    onDelete={(i) => handleAction('ranks', 'delete', i)} 
                />
                <ConfigSection 
                    title="Offices" 
                    items={settings.offices} 
                    onAdd={(v) => handleAction('offices', 'add', v)} 
                    onEdit={(i, v) => handleAction('offices', 'edit', i, v)} 
                    onDelete={(i) => handleAction('offices', 'delete', i)} 
                />
            </div>
        </div>
    );
};

export default SetupModule;
