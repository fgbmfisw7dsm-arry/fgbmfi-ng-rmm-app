import React, { useState, useEffect, useContext, useCallback } from 'react';
import { db } from '../services/supabaseService';
import { Event, Session, UserRole } from '../types';
import { AppContext } from '../context/AppContext';
import { isStripeKeyDetected } from '../services/supabaseClient';

const toDatetimeLocal = (utcStr?: string) => {
    if (!utcStr) return '';
    const d = new Date(utcStr);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const EventsModule = () => {
    const { refreshActiveEvent, refreshEvents, user, events } = useContext(AppContext);
    const [form, setForm] = useState<Partial<Event>>({ name: '', start_date: '', end_date: '', region: 'National', is_active: true });
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionForm, setSessionForm] = useState({ title: '', start_time: '', end_time: '' });
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [sessionEditForm, setSessionEditForm] = useState<Partial<Session>>({ title: '', start_time: '', end_time: '' });
    const [loading, setLoading] = useState(false);
    const [initialLoading, setInitialLoading] = useState(true);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<string | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [confirmDeleteSessionId, setConfirmDeleteSessionId] = useState<string | null>(null);
    const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error' | 'warning', text: string } | null>(null);

    // Robust Case-insensitive Admin Check
    const userRole = (user?.role || '').toLowerCase();
    const isAdmin = userRole === UserRole.NATIONAL_ADMIN || userRole === UserRole.REGIONAL_ADMIN || userRole === UserRole.ADMIN || userRole === 'admin' || userRole.includes('admin');

    // Force a data sync on mount to ensure catalogue is complete
    useEffect(() => {
        setInitialLoading(true);
        refreshEvents().finally(() => setInitialLoading(false));
    }, [refreshEvents]);

    useEffect(() => {
        if(expandedEventId) {
            db.getSessions(expandedEventId).then(setSessions);
            setSessionForm({ title: '', start_time: '', end_time: '' });
            setEditingSessionId(null);
            setConfirmDeleteSessionId(null);
        }
    }, [expandedEventId]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!isAdmin) {
            alert("PERMISSION DENIED: Only Admins can modify event configurations.");
            return;
        }
        setLoading(true);
        setStatusMsg(null);
        try { 
            if (editingEventId) {
                await db.updateEvent(editingEventId, form);
                setStatusMsg({ type: 'success', text: "Event Updated Successfully" });
            } else {
                await db.createEvent(form as any);
                setStatusMsg({ type: 'success', text: "Event Created Successfully" });
            }
            await refreshEvents(); 
            setForm({name:'', start_date:'', end_date:'', region:'National', is_active: true}); 
            setEditingEventId(null);
        } catch(e:any) { 
            setStatusMsg({ type: 'error', text: e.message });
        } finally { setLoading(false); }
    };
    
    const executeDelete = async (eventId: string, eventName: string) => {
        setConfirmDeleteId(null);
        setDeletingId(eventId);
        setStatusMsg(null);

        try {
            await db.deleteEvent(eventId);
            setStatusMsg({ type: 'success', text: `"${eventName}" and all records permanently removed.` });
            await refreshEvents(); 
        } catch (e: any) {
            console.error("Delete operation failed:", e);
            setStatusMsg({ 
                type: 'error', 
                text: "Delete Failed: " + (e.message || "Database integrity error.") 
            });
        } finally {
            setDeletingId(null);
        }
    };

    const toggleEventStatus = async (ev: Event) => {
        if (isStripeKeyDetected) {
            alert("CONFIGURATION ERROR: Key check failed.");
            return;
        }

        if (!isAdmin) {
            alert("PERMISSION DENIED: System Admin role required.");
            return;
        }

        const currentStatus = ev.is_active === false ? false : true;
        const newStatus = !currentStatus;
        
        setTogglingId(ev.event_id);
        setStatusMsg(null);

        try {
            await db.updateEvent(ev.event_id, { is_active: newStatus });
            // Refresh both the list and the active event selection
            await Promise.all([refreshEvents(), refreshActiveEvent()]);
            setStatusMsg({ type: 'success', text: `Event ${newStatus ? 'Activated' : 'Locked'} successfully.` });
        } catch (e: any) {
            setStatusMsg({ type: 'error', text: "Sync Failed: " + (e.message || "Database Error") });
        } finally {
            setTogglingId(null);
        }
    };

    const submitSession = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!expandedEventId) return;
        try {
            await db.createSession({ ...sessionForm, event_id: expandedEventId });
            setSessions(await db.getSessions(expandedEventId));
            setSessionForm({ title: '', start_time: '', end_time: '' });
        } catch(e:any) { alert(e.message); }
    };

    const handleSessionUpdate = async (sessionId: string) => {
        try {
            await db.updateSession(sessionId, sessionEditForm);
            setEditingSessionId(null);
            if (expandedEventId) {
                setSessions(await db.getSessions(expandedEventId));
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    const executeDeleteSession = async (sessionId: string, eventId: string) => {
        setConfirmDeleteSessionId(null);
        setDeletingSessionId(sessionId);
        try {
            await db.deleteSession(sessionId);
            const updated = await db.getSessions(eventId);
            setSessions(updated);
        } catch (e: any) {
            alert("Session Delete Failed: " + (e.message || "Database error"));
        } finally {
            setDeletingSessionId(null);
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Sidebar Form */}
            <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit md:sticky md:top-4 z-30">
                <div className="flex justify-between items-center mb-6 border-b pb-2">
                    <h3 className="font-black text-blue-900 uppercase text-xs tracking-widest">
                        {editingEventId ? 'Edit Event Config' : 'Create New Event'}
                    </h3>
                    <div className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${isAdmin ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'}`}>
                        {isAdmin ? 'Admin' : 'Restricted'}
                    </div>
                </div>
                
                <form onSubmit={submit} className="space-y-5">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase">Event Name</label>
                        <input required className="w-full p-3 border rounded-xl bg-gray-50 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="Event Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase">Start Date</label>
                            <input required type="date" className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-sm" value={form.start_date} onChange={e => setForm({...form, start_date: e.target.value})} />
                        </div>
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase">End Date</label>
                            <input required type="date" className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-sm" value={form.end_date} onChange={e => setForm({...form, end_date: e.target.value})} />
                        </div>
                    </div>

                    <div className="space-y-1 p-4 bg-gray-50 rounded-xl border border-gray-100">
                        <label className="text-[10px] font-black text-gray-400 uppercase block mb-2">Event Lifecycle</label>
                        <div className="flex items-center gap-3">
                            <select 
                                className={`flex-1 p-2 rounded-lg font-black text-xs uppercase border-2 transition-all ${form.is_active ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-red-50 text-red-700'}`}
                                value={form.is_active ? "true" : "false"}
                                onChange={e => setForm({...form, is_active: e.target.value === "true"})}
                            >
                                <option value="true">Live (Open)</option>
                                <option value="false">Locked (Final)</option>
                            </select>
                            {form.is_active ? (
                                <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse shadow-sm"></div>
                            ) : (
                                <div className="w-3 h-3 bg-red-500 rounded-full shadow-sm"></div>
                            )}
                        </div>
                    </div>

                    <div className="flex gap-2 pt-2">
                        <button type="submit" disabled={loading || !isAdmin} className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-blue-700 disabled:opacity-50">
                            {editingEventId ? 'Update' : 'Create'}
                        </button>
                        {editingEventId && (
                            <button type="button" onClick={() => { setEditingEventId(null); setForm({name:'', start_date:'', end_date:'', region:'National', is_active: true}); }} className="px-4 bg-gray-200 text-gray-600 rounded-xl font-black uppercase text-xs">Cancel</button>
                        )}
                    </div>
                </form>
            </div>

            {/* Catalog List */}
            <div className="md:col-span-2 space-y-4">
                {statusMsg && (
                    <div className={`p-4 rounded-xl border font-black uppercase text-[10px] tracking-widest animate-in slide-in-from-top-2 ${statusMsg.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
                        {statusMsg.text}
                    </div>
                )}
                
                <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-widest mb-2 px-2">Events Catalog</h3>
                
                {initialLoading ? (
                    <div className="p-20 text-center bg-white rounded-2xl border-2 border-dashed border-gray-100 flex flex-col items-center gap-4">
                        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                        <p className="text-gray-400 font-black uppercase text-xs tracking-widest">Synchronizing Event Catalog...</p>
                    </div>
                ) : events.length === 0 ? (
                    <div className="p-20 text-center bg-white rounded-2xl border-2 border-dashed border-gray-100">
                        <p className="text-gray-400 font-black uppercase text-xs tracking-widest">No event records found in database.</p>
                    </div>
                ) : events.map(ev => {
                    const isLocked = ev.is_active === false;
                    const isToggling = togglingId === ev.event_id;
                    const isDeleting = deletingId === ev.event_id;
                    const isConfirming = confirmDeleteId === ev.event_id;

                    return (
                        <div key={ev.event_id} className={`bg-white p-6 border-2 rounded-2xl shadow-sm hover:shadow-md transition-all relative overflow-hidden flex flex-col gap-4 ${isLocked ? 'border-red-100 bg-red-50/5' : 'border-gray-50'}`}>
                            {isLocked && !isConfirming && (
                                <div className="absolute inset-0 flex items-center justify-center opacity-[0.03] pointer-events-none select-none -rotate-12">
                                    <span className="text-7xl font-black uppercase tracking-tighter text-red-900">LOCKED</span>
                                </div>
                            )}

                            {/* DELETE CONFIRMATION OVERLAY */}
                            {isConfirming && (
                                <div className="absolute inset-0 z-50 bg-red-600 p-6 flex flex-col justify-center items-center text-center text-white animate-in fade-in duration-200">
                                    <p className="font-black uppercase text-xs tracking-widest mb-4">Confirm permanent deletion of "{ev.name}"?</p>
                                    <div className="flex gap-4">
                                        <button 
                                            type="button" 
                                            onClick={() => executeDelete(ev.event_id, ev.name)}
                                            className="px-8 py-3 bg-white text-red-600 rounded-xl font-black uppercase text-[10px] shadow-2xl active:scale-95"
                                        >
                                            YES, DELETE ALL DATA
                                        </button>
                                        <button 
                                            type="button" 
                                            onClick={() => setConfirmDeleteId(null)}
                                            className="px-8 py-3 bg-red-800 text-white rounded-xl font-black uppercase text-[10px] active:scale-95"
                                        >
                                            CANCEL
                                        </button>
                                    </div>
                                </div>
                            )}
                            
                            {/* Card Content Top Section */}
                            <div className="flex flex-col md:flex-row justify-between items-start gap-4 relative z-10">
                                 <div className="flex-1 w-full">
                                    <div className="flex items-center gap-3 mb-2 flex-wrap">
                                        <h4 className="font-black text-blue-900 uppercase tracking-tight text-xl break-words leading-tight">
                                            {ev.name || "Untitled Event"}
                                        </h4>
                                        <span className={`px-2 py-0.5 rounded-full text-[8px] font-black uppercase shadow-sm shrink-0 ${!isLocked ? 'bg-green-500 text-white' : 'bg-red-600 text-white'}`}>
                                            {!isLocked ? 'LIVE' : 'LOCKED'}
                                        </span>
                                    </div>
                                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest bg-gray-50 px-3 py-1.5 rounded-lg inline-block">
                                        {new Date(ev.start_date).toLocaleDateString()} — {new Date(ev.end_date).toLocaleDateString()}
                                    </p>
                                 </div>

                                 {/* Card Actions */}
                                 <div className="flex flex-wrap gap-2 justify-end shrink-0 w-full md:w-auto relative z-20">
                                    <button 
                                        type="button"
                                        onClick={() => setExpandedEventId(expandedEventId === ev.event_id ? null : ev.event_id)} 
                                        className={`px-4 py-2.5 rounded-lg text-[10px] font-black uppercase border transition-all ${expandedEventId === ev.event_id ? 'bg-blue-600 text-white border-blue-700' : 'bg-blue-50 text-blue-700 border-blue-100'}`}
                                    >
                                        Sessions
                                    </button>
                                    
                                    {isAdmin && (
                                        <button 
                                            type="button"
                                            onClick={() => toggleEventStatus(ev)} 
                                            disabled={isToggling || isDeleting}
                                            className={`px-4 py-2.5 rounded-lg text-[10px] font-black uppercase border transition-all disabled:opacity-50 ${!isLocked ? 'bg-white text-orange-600 border-orange-200' : 'bg-green-600 text-white border-green-700'}`}
                                        >
                                            {isToggling ? 'Syncing...' : (!isLocked ? 'Lock' : 'Unseal')}
                                        </button>
                                    )}

                                    <button 
                                        type="button"
                                        onClick={() => { setEditingEventId(ev.event_id); setForm({ ...ev }); window.scrollTo({ top: 0, behavior: 'smooth' }); }} 
                                        disabled={isDeleting || isToggling}
                                        className="px-4 py-2.5 bg-slate-50 text-slate-700 rounded-lg text-[10px] font-black uppercase border border-slate-200 disabled:opacity-50"
                                    >
                                        Edit
                                    </button>
                                    
                                    {isAdmin && (
                                        <button 
                                            type="button"
                                            onClick={() => setConfirmDeleteId(ev.event_id)} 
                                            disabled={isDeleting || isToggling}
                                            className="px-4 py-2.5 bg-red-50 text-red-700 rounded-lg text-[10px] font-black uppercase border border-red-100 hover:bg-red-600 hover:text-white transition-all disabled:opacity-50 shadow-sm"
                                        >
                                            {isDeleting ? 'Deleting...' : 'Delete'}
                                        </button>
                                    )}
                                 </div>
                            </div>

                            {/* Sessions Panel */}
                            {expandedEventId === ev.event_id && (
                                <div className="bg-gray-50/50 p-6 rounded-2xl mt-2 border border-dashed border-gray-200 relative z-40 animate-in slide-in-from-top-2">
                                    <div className="flex justify-between items-center mb-4">
                                        <h5 className="text-[10px] font-black uppercase text-gray-500 tracking-widest">Sessions Registry</h5>
                                        {isLocked && <span className="text-[8px] font-black text-red-500 uppercase bg-red-50 px-2 py-0.5 rounded border border-red-100">Read-Only View</span>}
                                    </div>
                                    
                                    <div className="space-y-2 mb-6">
                                        {sessions.length > 0 ? sessions.map(s => {
                                            const isConfirmingSession = confirmDeleteSessionId === s.session_id;
                                            const isDeletingThisSession = deletingSessionId === s.session_id;

                                            return (
                                                <div key={s.session_id} className="text-xs bg-white p-3 rounded-xl border flex justify-between items-center shadow-sm relative group">
                                                    {editingSessionId === s.session_id ? (
                                                        <div className="flex flex-wrap items-center gap-2 w-full">
                                                            <input className="flex-1 p-2 border rounded-lg font-bold" value={sessionEditForm.title} onChange={e => setSessionEditForm({...sessionEditForm, title: e.target.value})} />
                                                            <input type="datetime-local" className="p-2 border rounded-lg font-bold" value={toDatetimeLocal(sessionEditForm.start_time)} onChange={e => setSessionEditForm({...sessionEditForm, start_time: e.target.value})} />
                                                            <input type="datetime-local" className="p-2 border rounded-lg font-bold" value={toDatetimeLocal(sessionEditForm.end_time)} onChange={e => setSessionEditForm({...sessionEditForm, end_time: e.target.value})} />
                                                            <div className="flex gap-1">
                                                                <button type="button" onClick={() => handleSessionUpdate(s.session_id)} className="bg-green-600 text-white px-3 py-2 rounded-lg font-black uppercase text-[10px]">Save</button>
                                                                <button type="button" onClick={() => setEditingSessionId(null)} className="bg-gray-400 text-white px-3 py-2 rounded-lg font-black uppercase text-[10px]">Cancel</button>
                                                            </div>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="flex-1">
                                                                <span className="font-black text-gray-800 uppercase block">{s.title}</span>
                                                                <span className="text-[9px] text-gray-400 font-bold tracking-tight">
                                                                    {new Date(s.start_time).toLocaleString()} — {new Date(s.end_time).toLocaleString()}
                                                                </span>
                                                            </div>

                                                            {isConfirmingSession ? (
                                                                <div className="flex gap-2 animate-in slide-in-from-right-2">
                                                                    <button 
                                                                        type="button" 
                                                                        onClick={() => executeDeleteSession(s.session_id, ev.event_id)}
                                                                        className="bg-red-600 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[9px] shadow-sm active:scale-95"
                                                                    >
                                                                        Yes, Delete
                                                                    </button>
                                                                    <button 
                                                                        type="button" 
                                                                        onClick={() => setConfirmDeleteSessionId(null)}
                                                                        className="bg-gray-400 text-white px-3 py-1.5 rounded-lg font-black uppercase text-[9px] active:scale-95"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </div>
                                                            ) : (
                                                                <div className="flex gap-2 relative z-50">
                                                                    <button 
                                                                        type="button" 
                                                                        disabled={(isLocked && !isAdmin) || isDeleting} 
                                                                        onClick={() => { setEditingSessionId(s.session_id); setSessionEditForm({...s}); }} 
                                                                        className="text-blue-600 font-black uppercase text-[9px] border border-blue-100 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors disabled:opacity-30"
                                                                    >
                                                                        Edit
                                                                    </button>
                                                                    <button 
                                                                        type="button" 
                                                                        disabled={isDeleting || isDeletingThisSession} 
                                                                        onClick={() => setConfirmDeleteSessionId(s.session_id)} 
                                                                        className="text-red-500 font-black uppercase text-[9px] border border-red-100 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-30"
                                                                    >
                                                                        {isDeletingThisSession ? '...' : 'Delete'}
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        }) : <div className="p-10 text-center text-gray-400 font-bold italic text-xs">No sessions defined.</div>}
                                    </div>

                                    {!isLocked && !isDeleting && (
                                        <div className="border-t pt-4 bg-white/40 -mx-6 px-6 -mb-6 rounded-b-2xl">
                                            <h6 className="text-[9px] font-black uppercase text-gray-400 mb-3 tracking-widest">Register New Session</h6>
                                            <form onSubmit={submitSession} className="grid grid-cols-1 sm:grid-cols-4 gap-2 pb-4">
                                                <input required className="p-3 border rounded-xl text-xs font-bold bg-white" placeholder="Session Title" value={sessionForm.title} onChange={e => setSessionForm({...sessionForm, title: e.target.value})} />
                                                <input required type="datetime-local" className="p-3 border rounded-xl text-xs font-bold bg-white" value={sessionForm.start_time} onChange={e => setSessionForm({...sessionForm, start_time: e.target.value})} />
                                                <input required type="datetime-local" className="p-3 border rounded-xl text-xs font-bold bg-white" value={sessionForm.end_time} onChange={e => setSessionForm({...sessionForm, end_time: e.target.value})} />
                                                <button type="submit" className="bg-slate-900 text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md">Add</button>
                                            </form>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default EventsModule;