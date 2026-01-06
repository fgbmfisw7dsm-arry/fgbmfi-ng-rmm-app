
import React, { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { Event, Session } from '../types';

const EventsModule = () => {
    const [events, setEvents] = useState<Event[]>([]);
    const [form, setForm] = useState<Partial<Event>>({ name: '', start_date: '', end_date: '', region: 'National' });
    const [editingEventId, setEditingEventId] = useState<string | null>(null);
    const [expandedEventId, setExpandedEventId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [sessionForm, setSessionForm] = useState({ title: '', start_time: '', end_time: '' });
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [sessionEditForm, setSessionEditForm] = useState<Partial<Session>>({ title: '', start_time: '', end_time: '' });

    const loadEvents = () => db.getEvents().then(setEvents);
    useEffect(() => { loadEvents(); }, []);
    
    useEffect(() => {
        if(expandedEventId) {
            db.getSessions(expandedEventId).then(setSessions);
            setSessionForm({ title: '', start_time: '', end_time: '' });
            setEditingSessionId(null);
        }
    }, [expandedEventId]);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        try { 
            if (editingEventId) {
                await db.updateEvent(editingEventId, form);
                alert("Event Updated Successfully");
            } else {
                await db.createEvent(form as any);
                alert("Event Created Successfully");
            }
            loadEvents(); 
            setForm({name:'', start_date:'', end_date:'', region:'National'}); 
            setEditingEventId(null);
        } catch(e:any) { alert(e.message); }
    };
    
    const submitSession = async (e: React.FormEvent) => {
        e.preventDefault();
        if(!expandedEventId) return;
        try {
            await db.createSession({ ...sessionForm, event_id: expandedEventId });
            alert("Session Created");
            setSessions(await db.getSessions(expandedEventId));
            setSessionForm({ title: '', start_time: '', end_time: '' });
        } catch(e:any) { alert(e.message); }
    };

    const handleSessionUpdate = async (sessionId: string) => {
        try {
            await db.updateSession(sessionId, sessionEditForm);
            alert("Session Updated");
            setEditingSessionId(null);
            if (expandedEventId) {
                setSessions(await db.getSessions(expandedEventId));
            }
        } catch (e: any) {
            alert(e.message);
        }
    };

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit">
                <h3 className="font-black mb-6 text-blue-900 uppercase text-xs tracking-widest border-b pb-2">
                    {editingEventId ? 'Edit Event Details' : 'Create New Event'}
                </h3>
                <form onSubmit={submit} className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase">Event Name</label>
                        <input required className="w-full p-3 border rounded-xl bg-gray-50 font-bold focus:ring-2 focus:ring-blue-500 outline-none" placeholder="e.g. 2025 Regional Convention" value={form.name} onChange={e => setForm({...form, name: e.target.value})} />
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
                    <div className="flex gap-2 pt-2">
                        <button className="flex-1 py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-blue-700 transition-all">
                            {editingEventId ? 'Update Event' : 'Create Event'}
                        </button>
                        {editingEventId && (
                            <button type="button" onClick={() => { setEditingEventId(null); setForm({name:'', start_date:'', end_date:'', region:'National'}); }} className="px-4 bg-gray-200 text-gray-600 rounded-xl font-black uppercase text-xs">Cancel</button>
                        )}
                    </div>
                </form>
            </div>

            <div className="md:col-span-2 space-y-4">
                <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-widest mb-2 px-2">Active & Past Events</h3>
                {events.map(ev => (
                    <div key={ev.event_id} className="bg-white p-6 border rounded-2xl shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex justify-between items-start">
                             <div>
                                <h4 className="font-black text-blue-900 uppercase tracking-tight text-lg">{ev.name}</h4>
                                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">{new Date(ev.start_date).toLocaleDateString()} - {new Date(ev.end_date).toLocaleDateString()}</p>
                             </div>
                             <div className="flex gap-2">
                                <button onClick={() => setExpandedEventId(expandedEventId === ev.event_id ? null : ev.event_id)} className="px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-black uppercase border border-blue-100">Sessions</button>
                                <button onClick={() => { setEditingEventId(ev.event_id); setForm({ ...ev }); }} className="px-4 py-2 bg-green-50 text-green-700 rounded-lg text-[10px] font-black uppercase border border-green-100">Edit</button>
                                <button onClick={() => { if(confirm('Delete Event? This will remove all associated sessions.')) db.deleteEvent(ev.event_id).then(loadEvents); }} className="px-4 py-2 bg-red-50 text-red-700 rounded-lg text-[10px] font-black uppercase border border-red-100">Delete</button>
                             </div>
                        </div>

                        {expandedEventId === ev.event_id && (
                            <div className="bg-gray-50 p-6 rounded-2xl mt-4 border border-dashed border-gray-300">
                                <h5 className="text-[10px] font-black uppercase text-gray-500 mb-4 tracking-widest">Event Sessions</h5>
                                <div className="space-y-2 mb-6">
                                    {sessions.length > 0 ? sessions.map(s => (
                                        <div key={s.session_id} className="text-xs bg-white p-3 rounded-xl border flex justify-between items-center shadow-sm">
                                            {editingSessionId === s.session_id ? (
                                                <div className="flex flex-col sm:flex-row gap-2 w-full">
                                                    <input className="flex-1 p-2 border rounded-lg font-bold" value={sessionEditForm.title} onChange={e => setSessionEditForm({...sessionEditForm, title: e.target.value})} />
                                                    <input type="datetime-local" className="p-2 border rounded-lg font-bold" value={sessionEditForm.start_time?.substring(0, 16)} onChange={e => setSessionEditForm({...sessionEditForm, start_time: e.target.value})} />
                                                    <input type="datetime-local" className="p-2 border rounded-lg font-bold" value={sessionEditForm.end_time?.substring(0, 16)} onChange={e => setSessionEditForm({...sessionEditForm, end_time: e.target.value})} />
                                                    <div className="flex gap-1">
                                                        <button onClick={() => handleSessionUpdate(s.session_id)} className="bg-green-600 text-white px-3 py-2 rounded-lg font-black uppercase">Save</button>
                                                        <button onClick={() => setEditingSessionId(null)} className="bg-gray-400 text-white px-3 py-2 rounded-lg font-black uppercase">Cancel</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div>
                                                        <span className="font-black text-gray-800 uppercase block">{s.title}</span>
                                                        <span className="text-[9px] text-gray-400 font-bold">{new Date(s.start_time).toLocaleString()} - {new Date(s.end_time).toLocaleTimeString()}</span>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        <button onClick={() => { setEditingSessionId(s.session_id); setSessionEditForm({...s}); }} className="text-blue-600 font-black uppercase text-[9px] border border-blue-200 px-2 py-1 rounded hover:bg-blue-50">Edit</button>
                                                        <button onClick={() => { if(confirm('Delete Session?')) db.deleteSession(s.session_id).then(() => db.getSessions(ev.event_id).then(setSessions)); }} className="text-red-500 font-black uppercase text-[9px] border border-red-200 px-2 py-1 rounded hover:bg-red-50">Delete</button>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )) : <div className="p-4 text-center text-gray-400 font-bold italic text-xs">No sessions defined for this event yet.</div>}
                                </div>
                                <div className="border-t pt-4">
                                    <h6 className="text-[9px] font-black uppercase text-gray-400 mb-2">Add New Session</h6>
                                    <form onSubmit={submitSession} className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                                        <input required className="p-3 border rounded-xl text-xs font-bold sm:col-span-1" placeholder="Session Title" value={sessionForm.title} onChange={e => setSessionForm({...sessionForm, title: e.target.value})} />
                                        <input required type="datetime-local" className="p-3 border rounded-xl text-xs font-bold" value={sessionForm.start_time} onChange={e => setSessionForm({...sessionForm, start_time: e.target.value})} />
                                        <input required type="datetime-local" className="p-3 border rounded-xl text-xs font-bold" value={sessionForm.end_time} onChange={e => setSessionForm({...sessionForm, end_time: e.target.value})} />
                                        <button className="bg-slate-900 text-white p-3 rounded-xl text-[10px] font-black uppercase tracking-widest shadow-md">Add Session</button>
                                    </form>
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default EventsModule;
