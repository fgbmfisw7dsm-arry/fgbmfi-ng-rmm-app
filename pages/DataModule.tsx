
import React, { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { AppContext } from '../context/AppContext';
import { SystemSettings, Event } from '../types';
import { downloadJSON } from '../services/utils';

const DataModule = () => {
    const { activeEventId } = useContext(AppContext);
    const [settings, setSettings] = useState<SystemSettings | null>(null);
    const [events, setEvents] = useState<Event[]>([]);
    
    // State for Event Wipe
    const [eventBackupReady, setEventBackupReady] = useState(false);
    const [eventConfirmText, setEventConfirmText] = useState('');
    
    // State for District Wipe
    const [selectedDistrict, setSelectedDistrict] = useState('');
    const [districtBackupReady, setDistrictBackupReady] = useState(false);
    const [districtConfirmText, setDistrictConfirmText] = useState('');

    // State for Global Wipe
    const [isGlobalUnlocked, setIsGlobalUnlocked] = useState(false);
    const [globalConfirmText, setGlobalConfirmText] = useState('');

    const [loading, setLoading] = useState(false);

    useEffect(() => {
        db.getSettings().then(setSettings);
        db.getEvents().then(setEvents);
    }, []);

    const activeEvent = events.find(e => e.event_id === activeEventId);

    // --- LOGIC: HARMONIZE DISTRICTS ---
    const handleHarmonize = async () => {
        console.log("DEBUG: DataModule -> handleHarmonize starting...");
        if (!window.confirm("This will scan the entire database and remove hidden spaces/whitespace from all district names. This fixes duplicate entries in reports. Proceed?")) return;
        
        setLoading(true);
        try {
            const count = await db.harmonizeDistricts();
            console.log("DEBUG: Harmonization task success. Count:", count);
            alert(`SUCCESS: Harmonization complete. Cleaned ${count} records. Your reports should now be grouped correctly.`);
        } catch (e: any) {
            console.error("DEBUG: Harmonize failed:", e);
            alert("Harmonization failed: " + (e.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: DEDUPLICATE DELEGATES ---
    const handleDeduplicate = async () => {
        console.log("DEBUG: DataModule -> handleDeduplicate starting...");
        if (!window.confirm("This will scan the Regional Master List for duplicate delegates (same First Name, Last Name, and Phone). Redundant records will be permanently removed while keeping the first entry. Continue?")) return;
        
        setLoading(true);
        try {
            const count = await db.deduplicateDelegates();
            console.log("DEBUG: Deduplication task success. Count:", count);
            alert(`SUCCESS: Master List Cleaned. Removed ${count} duplicate delegate records.`);
        } catch (e: any) {
            console.error("DEBUG: Deduplicate failed:", e);
            alert("Deduplication failed: " + (e.message || "Unknown error"));
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: CLEAR EVENT DATA ---
    const prepareEventBackup = async () => {
        if (!activeEventId) return alert("Select an active event first.");
        setLoading(true);
        try {
            const data = await db.getAllDataForExport(activeEventId);
            downloadJSON(data, `BACKUP_EVENT_${activeEvent?.name || 'DATA'}_${Date.now()}.json`);
            setEventBackupReady(true);
            alert("BACKUP DOWNLOADED: Step 1 Complete. You can now proceed to Step 2.");
        } catch (e: any) {
            alert("Backup failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleClearEventData = async () => {
        if (eventConfirmText !== 'DELETE EVENT DATA') return alert("Please type 'DELETE EVENT DATA' exactly.");
        if (!window.confirm("FINAL WARNING: This will permanently wipe all attendance and financials for this event. Continue?")) return;

        setLoading(true);
        try {
            await db.clearEventData(activeEventId);
            alert("SUCCESS: All transactional data for this event has been cleared.");
            setEventBackupReady(false);
            setEventConfirmText('');
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: DELETE DISTRICT ---
    const prepareDistrictBackup = async () => {
        if (!selectedDistrict) return alert("Select a district first.");
        setLoading(true);
        try {
            const allData = await db.getAllDelegates();
            const districtData = allData.filter(d => (d.district || '').trim() === selectedDistrict.trim());
            downloadJSON(districtData, `BACKUP_DISTRICT_${selectedDistrict}_${Date.now()}.json`);
            setDistrictBackupReady(true);
            alert(`BACKUP DOWNLOADED for ${selectedDistrict}. You can now proceed to Step 2.`);
        } catch (e: any) {
            alert("Backup failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteDistrict = async () => {
        if (districtConfirmText !== `DELETE ${selectedDistrict.toUpperCase()}`) return alert(`Please type 'DELETE ${selectedDistrict.toUpperCase()}' exactly.`);
        
        setLoading(true);
        try {
            const count = await db.deleteDelegatesByDistrict(selectedDistrict);
            alert(`SUCCESS: Removed ${count} delegates and their history from the system.`);
            setDistrictBackupReady(false);
            setDistrictConfirmText('');
            setSelectedDistrict('');
        } catch (e: any) {
            alert("Error: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    // --- LOGIC: GLOBAL PURGE ---
    const handleGlobalPurge = async () => {
        if (globalConfirmText !== 'ERASE ALL SYSTEM DATA') return alert("Incorrect confirmation text.");
        setLoading(true);
        try {
            await db.deleteDelegatesByScope('all');
            alert("SYSTEM PURGE COMPLETE: All delegates and activity logs have been wiped.");
            setGlobalConfirmText('');
            setIsGlobalUnlocked(false);
        } catch (e: any) {
            alert("Purge failed: " + e.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-8 pb-20">
            {/* ALERT BANNER */}
            <div className="bg-red-600 text-white p-6 rounded-2xl shadow-2xl flex items-center gap-6 border-4 border-red-800 animate-pulse">
                <div className="text-5xl">⚠️</div>
                <div>
                    <h1 className="text-2xl font-black uppercase tracking-tighter">System Danger Zone</h1>
                    <p className="text-sm font-bold opacity-90 uppercase tracking-widest">Authorized Personnel Only. Actions here are permanent and destructive.</p>
                </div>
            </div>

            {/* INTEGRITY TOOLS */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-blue-900 p-8 rounded-3xl shadow-xl text-white border-4 border-blue-700">
                    <h3 className="text-xl font-black uppercase tracking-tight">District Harmonization</h3>
                    <p className="text-xs font-bold text-blue-300 uppercase tracking-widest mt-1 mb-6">Cleans whitespace and hidden characters in District/Chapter names.</p>
                    <button 
                        onClick={() => handleHarmonize()}
                        disabled={loading}
                        className="w-full py-4 bg-white text-blue-900 font-black rounded-xl uppercase text-xs tracking-widest shadow-xl hover:bg-blue-50 transition-all disabled:opacity-50"
                    >
                        {loading ? 'CLEANING DATABASE...' : '🧹 Harmonize Districts'}
                    </button>
                </div>
                
                <div className="bg-slate-900 p-8 rounded-3xl shadow-xl text-white border-4 border-slate-700">
                    <h3 className="text-xl font-black uppercase tracking-tight">Master List Deduplication</h3>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1 mb-6">Removes redundant delegate records across the Regional Master List.</p>
                    <button 
                        onClick={() => handleDeduplicate()}
                        disabled={loading}
                        className="w-full py-4 bg-blue-600 text-white font-black rounded-xl uppercase text-xs tracking-widest shadow-xl hover:bg-blue-700 transition-all disabled:opacity-50"
                    >
                        {loading ? 'ANALYZING RECORDS...' : '📂 Clean Master List Duplicates'}
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                
                {/* MODULE 1: CLEAR EVENT DATA */}
                <div className="bg-white rounded-3xl shadow-xl border-t-8 border-orange-500 overflow-hidden flex flex-col">
                    <div className="p-6 bg-orange-50 border-b border-orange-100">
                        <h3 className="text-lg font-black text-orange-900 uppercase">Clear Active Event Data</h3>
                        <p className="text-[10px] font-bold text-orange-700 uppercase">Wipe Attendance, Offerings & Pledges for the current event</p>
                    </div>
                    <div className="p-8 flex-1 space-y-6">
                        <div className="bg-slate-50 p-4 rounded-xl border border-slate-200">
                            <span className="text-[10px] font-black text-gray-400 uppercase block mb-1">Target Event:</span>
                            <span className="text-xl font-black text-blue-900 uppercase">{activeEvent?.name || 'NO EVENT SELECTED'}</span>
                        </div>

                        {/* STEP 1 */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                                <span className="bg-gray-200 w-5 h-5 rounded-full flex items-center justify-center">1</span> 
                                Secure Data Export
                            </label>
                            <button 
                                onClick={prepareEventBackup}
                                disabled={loading || !activeEventId}
                                className="w-full py-4 bg-blue-600 text-white font-black rounded-xl uppercase text-xs tracking-widest hover:bg-blue-700 transition-all disabled:opacity-30"
                            >
                                {eventBackupReady ? '✅ Backup Downloaded' : 'Generate & Download Backup'}
                            </button>
                        </div>

                        {/* STEP 2 */}
                        <div className={`space-y-4 transition-all duration-500 ${eventBackupReady ? 'opacity-100 scale-100' : 'opacity-20 scale-95 pointer-events-none'}`}>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-red-600 uppercase flex items-center gap-2">
                                    <span className="bg-red-100 w-5 h-5 rounded-full flex items-center justify-center">2</span> 
                                    Type "DELETE EVENT DATA" to confirm
                                </label>
                                <input 
                                    className="w-full p-4 border-2 border-red-100 rounded-xl bg-red-50/30 font-black text-center text-red-600 focus:ring-4 focus:ring-red-500 outline-none"
                                    value={eventConfirmText}
                                    onChange={e => setEventConfirmText(e.target.value)}
                                    placeholder="Enter text..."
                                />
                            </div>
                            <button 
                                onClick={handleClearEventData}
                                disabled={loading || eventConfirmText !== 'DELETE EVENT DATA'}
                                className="w-full py-5 bg-red-600 text-white font-black rounded-xl uppercase text-sm tracking-[0.2em] shadow-2xl hover:bg-red-700 disabled:opacity-10"
                            >
                                {loading ? 'CLEANING DATABASE...' : 'EXECUTE EVENT WIPE'}
                            </button>
                        </div>
                    </div>
                </div>

                {/* MODULE 2: DELETE DISTRICT */}
                <div className="bg-white rounded-3xl shadow-xl border-t-8 border-red-600 overflow-hidden flex flex-col">
                    <div className="p-6 bg-red-50 border-b border-red-100">
                        <h3 className="text-lg font-black text-red-900 uppercase">District Master Purge</h3>
                        <p className="text-[10px] font-bold text-red-700 uppercase">Permanently remove all delegates from a specific district</p>
                    </div>
                    <div className="p-8 flex-1 space-y-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase">Target District</label>
                            <select 
                                className="w-full p-4 border-2 rounded-xl bg-gray-50 font-black text-blue-900 uppercase"
                                value={selectedDistrict}
                                onChange={e => { setSelectedDistrict(e.target.value); setDistrictBackupReady(false); setDistrictConfirmText(''); }}
                                disabled={loading}
                            >
                                <option value="">-- Select District --</option>
                                {settings?.districts.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                        </div>

                        {/* STEP 1 */}
                        <div className="space-y-2">
                            <label className="text-[10px] font-black text-gray-500 uppercase flex items-center gap-2">
                                <span className="bg-gray-200 w-5 h-5 rounded-full flex items-center justify-center">1</span> 
                                Export District List
                            </label>
                            <button 
                                onClick={prepareDistrictBackup}
                                disabled={loading || !selectedDistrict}
                                className="w-full py-4 bg-slate-800 text-white font-black rounded-xl uppercase text-xs tracking-widest hover:bg-black transition-all disabled:opacity-30"
                            >
                                {districtBackupReady ? '✅ List Exported' : 'Backup District Records'}
                            </button>
                        </div>

                        {/* STEP 2 */}
                        <div className={`space-y-4 transition-all duration-500 ${districtBackupReady ? 'opacity-100 scale-100' : 'opacity-20 scale-95 pointer-events-none'}`}>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black text-red-600 uppercase flex items-center gap-2">
                                    <span className="bg-red-100 w-5 h-5 rounded-full flex items-center justify-center">2</span> 
                                    Type "DELETE {selectedDistrict.toUpperCase()}"
                                </label>
                                <input 
                                    className="w-full p-4 border-2 border-red-100 rounded-xl bg-red-50/30 font-black text-center text-red-600 focus:ring-4 focus:ring-red-500 outline-none"
                                    value={districtConfirmText}
                                    onChange={e => setDistrictConfirmText(e.target.value)}
                                    placeholder="Enter text..."
                                />
                            </div>
                            <button 
                                onClick={handleDeleteDistrict}
                                disabled={loading || districtConfirmText !== `DELETE ${selectedDistrict.toUpperCase()}`}
                                className="w-full py-5 bg-red-600 text-white font-black rounded-xl uppercase text-sm tracking-[0.2em] shadow-2xl hover:bg-red-700 disabled:opacity-10"
                            >
                                {loading ? 'DELETING...' : `PURGE ${selectedDistrict.toUpperCase()}`}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* NUCLEAR OPTION: GLOBAL SYSTEM RESET */}
            <div className="bg-black text-white p-12 rounded-[3rem] shadow-2xl border-8 border-red-900 flex flex-col items-center text-center space-y-6 mt-12">
                <div className="text-6xl">☢️</div>
                <h2 className="text-4xl font-black uppercase tracking-tighter">Master Global Purge</h2>
                <p className="text-sm font-bold text-red-500 uppercase max-w-xl">This action will completely empty the database of all delegates, check-ins, and financial history across all events. Only system settings will remain.</p>
                
                {!isGlobalUnlocked ? (
                    <button 
                        onClick={() => setIsGlobalUnlocked(true)}
                        className="px-12 py-4 bg-red-600 hover:bg-red-700 text-white font-black rounded-full uppercase text-xs tracking-widest transition-all shadow-xl"
                    >
                        Unlock Global Reset Function
                    </button>
                ) : (
                    <div className="w-full max-w-md space-y-4 animate-in fade-in zoom-in">
                        <input 
                            className="w-full p-4 bg-zinc-900 border-2 border-red-900 rounded-2xl font-black text-center text-red-500 outline-none uppercase"
                            placeholder="Type: ERASE ALL SYSTEM DATA"
                            value={globalConfirmText}
                            onChange={e => setGlobalConfirmText(e.target.value)}
                        />
                        <div className="flex gap-4">
                            <button onClick={() => setIsGlobalUnlocked(false)} className="flex-1 py-4 bg-zinc-800 text-gray-400 font-black rounded-2xl uppercase text-xs">Abort</button>
                            <button 
                                onClick={handleGlobalPurge}
                                disabled={loading || globalConfirmText !== 'ERASE ALL SYSTEM DATA'}
                                className="flex-[2] py-4 bg-red-600 text-white font-black rounded-2xl uppercase text-xs tracking-widest shadow-red-500/50 shadow-lg disabled:opacity-20"
                            >
                                {loading ? 'WIPING SYSTEM...' : 'CONFIRM NUCLEAR RESET'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataModule;
