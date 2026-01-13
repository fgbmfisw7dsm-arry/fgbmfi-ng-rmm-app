
import React, { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { SystemSettings } from '../types';

interface ConfigSectionProps {
    title: string;
    items: string[];
    onAdd: (val: string) => void;
    onEdit: (index: number, newVal: string) => void;
    onDelete: (index: number) => void;
    onSave: () => void;
    isSaving: boolean;
}

const ConfigSection: React.FC<ConfigSectionProps> = ({ title, items = [], onAdd, onEdit, onDelete, onSave, isSaving }) => {
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
            <h3 className="text-[10px] font-black uppercase tracking-widest text-blue-900 mb-4 border-b pb-2 flex justify-between items-center">
                <span>{title} Setup</span>
                <div className="flex items-center gap-3">
                    <span className="text-gray-400">{items.length} Total</span>
                    <button 
                        onClick={onSave}
                        disabled={isSaving}
                        className={`px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-tighter transition-all ${isSaving ? 'bg-orange-100 text-orange-600 animate-pulse' : 'bg-blue-900 text-white hover:bg-slate-800'}`}
                    >
                        {isSaving ? 'Syncing...' : 'Save Section'}
                    </button>
                </div>
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
                                            <button onClick={() => { onEdit(idx, editVal); setEditIdx(null); }} className="text-green-600 font-black uppercase text-[9px]">Apply</button>
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
    const [savingSection, setSavingSection] = useState<string | null>(null);

    const sortSettings = (data: any): SystemSettings => {
        return {
            id: data.id, 
            districts: [...(data.districts || [])].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })),
            ranks: [...(data.ranks || [])].sort((a, b) => a.localeCompare(b)),
            offices: [...(data.offices || [])].sort((a, b) => a.localeCompare(b)),
            titles: [...(data.titles || [])].sort((a, b) => a.localeCompare(b)),
            regions: [...(data.regions || [])].sort((a, b) => a.localeCompare(b))
        };
    };

    const loadSettings = async () => {
        setLoading(true);
        try {
            const data = await db.getSettings();
            
            // AUTOMATIC TITLE RESTORATION:
            // If titles are missing or empty, re-inject the standard FGBMFI title list
            let processedData = { ...data };
            if (!processedData.titles || processedData.titles.length === 0) {
                processedData.titles = ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'];
            }
            
            setSettings(sortSettings(processedData));
        } catch (err) {
            console.error("Critical: Failed to load system settings", err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        loadSettings();
    }, []);

    const saveSection = async (sectionName: string, fieldKey: keyof SystemSettings) => {
        if (!settings) return;
        setSavingSection(sectionName);
        
        try {
            // SURGICAL SYNC:
            // Pass the specific column key to the database service so ONLY that column is updated.
            const updatedData = await db.updateSettings(settings, fieldKey);
            
            // Update local state with the exact row confirmed by the database
            setSettings(sortSettings(updatedData));
            
            alert(`SUCCESS: ${sectionName} has been synchronized and verified in the database.`);
        } catch (e: any) {
            console.error(`Save ${sectionName} Error:`, e);
            alert(`ERROR: Could not save ${sectionName}. ` + (e.message || "Unknown error"));
            // Roll back to the last known good server state to prevent UI mismatch
            await loadSettings();
        } finally {
            setSavingSection(null);
        }
    };

    const handleAction = (key: keyof SystemSettings, action: 'add' | 'edit' | 'delete', val: string | number, newVal?: string) => {
        if (!settings) return;
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
        setSettings(sortSettings(newSettings));
    };

    if (loading && !settings) return <div className="p-20 text-center font-black uppercase tracking-widest text-gray-400 animate-pulse">Initializing System Setup...</div>;

    return (
        <div className="space-y-8 max-w-6xl mx-auto">
            <div className="bg-white p-6 rounded-2xl shadow-sm border">
                <h2 className="text-xl font-black uppercase tracking-widest text-blue-900">System Parameters Setup</h2>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-tighter mt-1">
                    Manage global dropdowns and metadata. Save each section individually to surgically update the database.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-20">
                <ConfigSection 
                    title="Titles" 
                    items={settings?.titles || []} 
                    onAdd={(v) => handleAction('titles', 'add', v)} 
                    onEdit={(i, v) => handleAction('titles', 'edit', i, v)} 
                    onDelete={(i) => handleAction('titles', 'delete', i)} 
                    onSave={() => saveSection('Titles', 'titles')}
                    isSaving={savingSection === 'Titles'}
                />
                <ConfigSection 
                    title="Regions" 
                    items={settings?.regions || []} 
                    onAdd={(v) => handleAction('regions', 'add', v)} 
                    onEdit={(i, v) => handleAction('regions', 'edit', i, v)} 
                    onDelete={(i) => handleAction('regions', 'delete', i)} 
                    onSave={() => saveSection('Regions', 'regions')}
                    isSaving={savingSection === 'Regions'}
                />
                <ConfigSection 
                    title="Districts" 
                    items={settings?.districts || []} 
                    onAdd={(v) => handleAction('districts', 'add', v)} 
                    onEdit={(i, v) => handleAction('districts', 'edit', i, v)} 
                    onDelete={(i) => handleAction('districts', 'delete', i)} 
                    onSave={() => saveSection('Districts', 'districts')}
                    isSaving={savingSection === 'Districts'}
                />
                <ConfigSection 
                    title="Ranks" 
                    items={settings?.ranks || []} 
                    onAdd={(v) => handleAction('ranks', 'add', v)} 
                    onEdit={(i, v) => handleAction('ranks', 'edit', i, v)} 
                    onDelete={(i) => handleAction('ranks', 'delete', i)} 
                    onSave={() => saveSection('Ranks', 'ranks')}
                    isSaving={savingSection === 'Ranks'}
                />
                <ConfigSection 
                    title="Offices" 
                    items={settings?.offices || []} 
                    onAdd={(v) => handleAction('offices', 'add', v)} 
                    onEdit={(i, v) => handleAction('offices', 'edit', i, v)} 
                    onDelete={(i) => handleAction('offices', 'delete', i)} 
                    onSave={() => saveSection('Offices', 'offices')}
                    isSaving={savingSection === 'Offices'}
                />
            </div>
        </div>
    );
};

export default SetupModule;
