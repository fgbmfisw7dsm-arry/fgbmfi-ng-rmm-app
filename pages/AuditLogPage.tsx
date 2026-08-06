import React, { useState, useEffect, useContext } from 'react';
import { supabase } from '../services/supabaseClient';
import { AuditLog } from '../types';
import { AppContext } from '../context/AppContext';

const AuditLogPage = () => {
    const { activeEventId } = useContext(AppContext);
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loading, setLoading] = useState(true);
    const [actionFilter, setActionFilter] = useState('');
    const [systemOnly, setSystemOnly] = useState(false);
    const [error, setError] = useState('');

    const fetchLogs = async () => {
        setLoading(true);
        setError('');
        try {
            let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
            if (!systemOnly && activeEventId) {
                q = q.eq('event_id', activeEventId);
            }
            if (systemOnly) {
                q = q.is('event_id', null);
            }
            if (actionFilter) {
                q = q.eq('action_type', actionFilter);
            }
            const { data, error: fetchErr } = await q;
            if (fetchErr) throw fetchErr;
            setLogs(data || []);
        } catch (e: any) {
            setError(e.message || 'Failed to load audit log.');
            setLogs([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchLogs(); }, [activeEventId, systemOnly, actionFilter]);

    const distinctActions = ['', 'checkin_arrival', 'checkin_session', 'session_call_ft', 'session_call_slv', 'session_call_mi', 'session_call_hgb', 'session_summary_ft', 'session_summary_slv', 'session_summary_mi', 'session_summary_hgb', 'voice_distribution', 'financial_offering', 'financial_pledge_redemption', 'pledge_create', 'delegate_update', 'event_create', 'event_update', 'event_delete', 'event_clear_data', 'user_create', 'user_update', 'user_delete'];

    const formatAction = (action: string) => action.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    const timeAgo = (ts: string) => {
        const diff = Date.now() - new Date(ts).getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return `${mins}m ago`;
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return `${hrs}h ago`;
        return `${Math.floor(hrs / 24)}d ago`;
    };

    return (
        <div className="space-y-6 max-w-6xl mx-auto pb-32">
            <div className="bg-white p-8 rounded-3xl shadow-sm border flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                    <h2 className="text-2xl font-black uppercase tracking-tight text-blue-900 leading-none">Audit Log</h2>
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-2">
                        Track all registrar & admin operations across the system.
                    </p>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    <select
                        className="p-2.5 border-2 border-gray-100 rounded-xl font-bold text-xs bg-gray-50"
                        value={actionFilter}
                        onChange={e => setActionFilter(e.target.value)}
                    >
                        <option value="">All Actions</option>
                        {distinctActions.filter(Boolean).map(a => (
                            <option key={a} value={a}>{formatAction(a)}</option>
                        ))}
                    </select>
                    <label className="flex items-center gap-2 text-xs font-bold text-gray-500 uppercase cursor-pointer" title="User create/update/delete — these are not scoped to a specific event">
                        <input type="checkbox" checked={systemOnly} onChange={e => setSystemOnly(e.target.checked)} className="rounded" />
                        User &amp; System Events
                    </label>
                    <button onClick={fetchLogs} disabled={loading} className="px-4 py-2 bg-blue-900 text-white rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-800 transition-all">
                        {loading ? 'Loading...' : 'Refresh'}
                    </button>
                </div>
            </div>

            {error && <div className="bg-red-50 text-red-700 p-4 rounded-xl font-bold text-xs uppercase">{error}</div>}

            <div className="bg-white rounded-3xl border shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                        <thead className="bg-slate-50 border-b uppercase font-black text-gray-400 text-[10px]">
                            <tr>
                                <th className="p-3">Time</th>
                                <th className="p-3">Action</th>
                                <th className="p-3">Summary</th>
                                <th className="p-3">Performed By</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {logs.map(log => (
                                <tr key={log.id} className="hover:bg-blue-50/30 transition-colors">
                                    <td className="p-3 font-mono text-gray-500 whitespace-nowrap">{timeAgo(log.created_at)}</td>
                                    <td className="p-3">
                                        <span className="px-2 py-0.5 rounded-full font-bold uppercase text-[9px] bg-blue-50 text-blue-800">
                                            {formatAction(log.action_type)}
                                        </span>
                                    </td>
                                    <td className="p-3 font-bold text-gray-700">{log.summary}</td>
                                    <td className="p-3 text-gray-500">{log.performer_email || log.performed_by?.slice(0, 8) || '-'}</td>
                                </tr>
                            ))}
                            {logs.length === 0 && !loading && (
                                <tr>
                                    <td colSpan={4} className="p-12 text-center text-gray-300 italic font-bold text-[10px] uppercase tracking-widest">
                                        No audit entries found for the selected filters.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-5 text-[10px] text-blue-800 space-y-1">
                <p className="font-black uppercase tracking-widest">High-Volume Assurance</p>
                <p>Each audit entry is a fire-and-forget async insert — it never blocks the user's operation. At scale (1000+ check-ins/minute), entries simply queue and write asynchronously.</p>
                <p>When <span className="font-bold">audit is OFF</span> (System Setup), the audit function returns at the first line — <span className="font-bold">zero overhead</span>. Toggle off during high-traffic sessions if needed.</p>
            </div>
        </div>
    );
};

export default AuditLogPage;
