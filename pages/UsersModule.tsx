import { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { User, UserRole, SystemSettings } from '../types';

const UsersModule = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [form, setForm] = useState({ email: '', password: '', role: UserRole.REGISTRAR, district: '' });
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [config, setSettings] = useState<SystemSettings | null>(null);
    const [resettingId, setResettingId] = useState<string | null>(null);
    const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string } | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const data = await db.getUsers();
            setUsers(data || []);
        } catch (e) {
            console.error("User list refresh failed", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { 
        load(); 
        db.getSettings().then(setSettings); 
    }, []);

    const handleAction = async () => {
        setStatus(null);

        if (!form.email || form.email.trim().length < 3) {
            setStatus({ type: 'error', msg: "Please enter a valid username." });
            return;
        }

        if (form.role === UserRole.REGISTRAR && !form.district) {
            setStatus({ type: 'error', msg: "Registrar accounts must be assigned to a district." });
            return;
        }

        if (!editingUserId && (!form.password || form.password.length < 6)) {
            setStatus({ type: 'error', msg: "Password must be at least 6 characters." });
            return;
        }

        setLoading(true);
        setStatus({ type: 'info', msg: "Syncing with Auth Service..." });

        try {
            if (editingUserId) {
                await db.updateUser(editingUserId, { 
                    role: form.role, 
                    district: form.role === UserRole.REGISTRAR ? form.district : '' 
                });
                setStatus({ type: 'success', msg: "Account updated successfully." });
            } else {
                const res = await db.createUser(form, form.password);
                if (res && res.error) throw new Error(res.error);
                setStatus({ type: 'success', msg: `Account ${form.email} created. You can now login.` });
            }
            
            setEditingUserId(null);
            setForm({ email: '', password: '', role: UserRole.REGISTRAR, district: '' });
            await load();
        } catch(e:any) { 
            console.error("User Action Error:", e);
            setStatus({ 
                type: 'error', 
                msg: e.message || "An unexpected database error occurred." 
            }); 
        } finally {
            setLoading(false);
        }
    };

    const startEditing = (u: User) => {
        setEditingUserId(u.id);
        setForm({
            email: u.email,
            password: '', 
            role: u.role,
            district: u.district || ''
        });
        setStatus(null);
        setConfirmDeleteUserId(null);
        setResettingId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEditing = () => {
        setEditingUserId(null);
        setForm({ email: '', password: '', role: UserRole.REGISTRAR, district: '' });
        setStatus(null);
    };

    const savePassword = async (userId: string) => {
        if (!newPassword || newPassword.trim().length < 6) {
            setStatus({ type: 'error', msg: "New password must be at least 6 characters." });
            return;
        }
        setLoading(true);
        setStatus({ type: 'info', msg: "Updating security credentials..." });
        try {
            await db.resetUserPassword(userId, newPassword);
            setStatus({ type: 'success', msg: "Password updated successfully." });
            setResettingId(null); 
            setNewPassword('');
        } catch (e: any) {
            setStatus({ type: 'error', msg: "Password update failed: " + e.message });
        } finally {
            setLoading(false);
        }
    };

    const executeDelete = async (u: User) => {
        setConfirmDeleteUserId(null);
        setDeletingUserId(u.id);
        setStatus({ type: 'info', msg: `Deactivating account for ${u.email}...` });
        try {
            await db.deleteUser(u.id);
            setStatus({ type: 'success', msg: "Account permanently removed from cloud registry." });
            await load();
        } catch (e: any) {
            console.error("Delete failed", e);
            setStatus({ type: 'error', msg: "Deletion failed: " + (e.message || "Access Denied") });
        } finally {
            setDeletingUserId(null);
        }
    };
    
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-8 rounded-2xl shadow-sm border h-fit md:sticky md:top-4 z-10">
                <div className="flex justify-between items-center mb-6 border-b pb-2">
                    <h3 className="font-black text-blue-900 uppercase text-xs tracking-widest">
                        {editingUserId ? 'Modify Credentials' : 'New User Setup'}
                    </h3>
                </div>

                {status && (
                    <div className={`mb-4 p-4 rounded-xl text-[10px] font-black uppercase tracking-tight border animate-in fade-in slide-in-from-top-1 ${
                        status.type === 'error' ? 'bg-red-50 border-red-100 text-red-600' : 
                        status.type === 'success' ? 'bg-green-50 border-green-100 text-green-600' : 
                        'bg-blue-50 border-blue-100 text-blue-600'
                    }`}>
                        {status.msg}
                    </div>
                )}
                
                <div className="space-y-4">
                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Login Username</label>
                        <input 
                            type="text" 
                            className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50 transition-all" 
                            placeholder="e.g. jdoe_registrar" 
                            value={form.email} 
                            onChange={e => setForm({...form, email: e.target.value})} 
                            disabled={!!editingUserId || loading} 
                        />
                    </div>
                    
                    {!editingUserId && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Initial Password</label>
                            <input 
                                type="password" 
                                className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none transition-all" 
                                placeholder="••••••••" 
                                value={form.password} 
                                onChange={e => setForm({...form, password: e.target.value})} 
                                disabled={loading}
                            />
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Assign System Role</label>
                        <select 
                            className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-sm uppercase outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" 
                            value={form.role} 
                            onChange={e => setForm({...form, role: e.target.value as any, district: e.target.value === UserRole.REGISTRAR ? form.district : ''})}
                            disabled={loading}
                        >
                            <option value={UserRole.REGISTRAR}>District Registrar</option>
                            <option value={UserRole.FINANCE}>Finance Admin</option>
                            <option value={UserRole.ADMIN}>System Admin</option>
                        </select>
                    </div>

                    {form.role === UserRole.REGISTRAR && (
                        <div className="space-y-1 animate-in slide-in-from-top-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">District Scope</label>
                            <select 
                                className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-xs uppercase outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" 
                                value={form.district} 
                                onChange={e => setForm({...form, district: e.target.value})}
                                disabled={loading}
                            >
                                <option value="">Select District...</option>
                                {config?.districts.map(d => <option key={d} value={d}>{d}</option>)}
                                {form.district && !config?.districts.includes(form.district) && (
                                    <option value={form.district}>{form.district} (Un-normalized)</option>
                                )}
                            </select>
                        </div>
                    )}

                    <div className="flex flex-col gap-3 pt-4">
                        <button 
                            type="button"
                            onClick={handleAction}
                            disabled={loading}
                            className="w-full py-5 bg-blue-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-xl shadow-blue-100 hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {loading ? 'Processing...' : (editingUserId ? 'Update Profile' : 'Generate Account')}
                        </button>
                        {editingUserId && (
                            <button 
                                type="button" 
                                onClick={cancelEditing} 
                                disabled={loading}
                                className="w-full py-4 bg-gray-100 text-gray-600 rounded-2xl font-black uppercase text-xs disabled:opacity-50 transition-all"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="md:col-span-2 space-y-4 pb-20">
                <div className="flex justify-between items-center px-2 mb-2">
                    <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-[0.2em]">Live Account Registry</h3>
                    <button onClick={load} disabled={loading} className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 flex items-center gap-1">
                        <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Refresh
                    </button>
                </div>
                
                {users.length === 0 && !loading ? (
                    <div className="p-20 text-center bg-white rounded-[2rem] border-2 border-dashed text-gray-300 font-black uppercase text-xs tracking-widest">No verified accounts found</div>
                ) : users.map(u => {
                    const isEditing = editingUserId === u.id;
                    const isResetting = resettingId === u.id;
                    const isConfirming = confirmDeleteUserId === u.id;
                    const isDeleting = deletingUserId === u.id;

                    return (
                        <div key={u.id} className={`bg-white p-6 rounded-2xl border transition-all relative overflow-hidden group ${isEditing ? 'ring-2 ring-blue-500 shadow-xl z-20' : isConfirming ? 'bg-red-50 border-red-200' : 'shadow-sm border-gray-100'}`}>
                            <div className="flex flex-col sm:flex-row justify-between items-center gap-4 relative z-10">
                                <div className="w-full">
                                    <div className="flex items-center gap-3 mb-1">
                                        <span className="font-black text-blue-900 uppercase text-lg tracking-tight">{u.email}</span>
                                        <span className={`px-2.5 py-1 rounded-lg font-black uppercase text-[8px] tracking-widest shadow-sm ${u.role === 'finance' ? 'bg-purple-600 text-white' : u.role === 'admin' ? 'bg-blue-900 text-white' : 'bg-slate-500 text-white'}`}>
                                            {u.role.toUpperCase()}
                                        </span>
                                    </div>
                                    {u.district && (
                                        <p className="text-blue-500 font-black uppercase text-[10px] tracking-widest">
                                            {u.district} District Jurisdiction
                                        </p>
                                    )}
                                </div>

                                <div className="flex gap-2 items-center w-full sm:w-auto justify-end">
                                     {isResetting ? (
                                        <div className="flex items-center gap-2 bg-slate-900 p-2 rounded-xl shadow-xl animate-in slide-in-from-right-2">
                                            <input 
                                                autoFocus
                                                type="text" 
                                                className="bg-white border-0 rounded-lg p-2 w-32 text-xs font-bold text-slate-900" 
                                                placeholder="New Password" 
                                                value={newPassword} 
                                                onChange={e => setNewPassword(e.target.value)} 
                                                disabled={loading}
                                            />
                                            <button onClick={() => savePassword(u.id)} disabled={loading} className="bg-green-600 text-white text-[9px] px-3 py-2 rounded-lg font-black uppercase active:scale-95">Save</button>
                                            <button onClick={() => setResettingId(null)} disabled={loading} className="text-white text-[9px] px-2 font-black uppercase">X</button>
                                        </div>
                                     ) : isConfirming ? (
                                        <div className="flex gap-2 animate-in slide-in-from-right-2">
                                            <button 
                                                onClick={() => executeDelete(u)} 
                                                disabled={loading} 
                                                className="bg-red-600 text-white px-5 py-2.5 rounded-xl font-black uppercase text-[10px] shadow-lg active:scale-95 transition-all"
                                            >
                                                Yes, Delete
                                            </button>
                                            <button 
                                                onClick={() => setConfirmDeleteUserId(null)} 
                                                disabled={loading} 
                                                className="bg-slate-800 text-white px-5 py-2.5 rounded-xl font-black uppercase text-[10px] active:scale-95 transition-all"
                                            >
                                                No
                                            </button>
                                        </div>
                                     ) : (
                                        <div className="flex gap-2 opacity-100">
                                            <button 
                                                onClick={() => startEditing(u)} 
                                                disabled={loading || isDeleting} 
                                                className="flex items-center gap-1.5 text-blue-600 font-black uppercase text-[9px] border border-blue-100 px-4 py-2.5 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 protocol 1.1 2.828 0 114 4L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                Edit
                                            </button>
                                            <button 
                                                onClick={() => { setResettingId(u.id); setConfirmDeleteUserId(null); }} 
                                                disabled={loading || isDeleting} 
                                                className="flex items-center gap-1.5 text-orange-600 font-black uppercase text-[9px] border border-orange-100 px-4 py-2.5 rounded-xl hover:bg-orange-600 hover:text-white transition-all shadow-sm"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                                                Pass
                                            </button>
                                            <button 
                                                onClick={() => { setConfirmDeleteUserId(u.id); setResettingId(null); setEditingUserId(null); }} 
                                                disabled={loading || isDeleting} 
                                                className="flex items-center gap-1.5 text-red-500 font-black uppercase text-[9px] border border-red-100 px-4 py-2.5 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-sm"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                {isDeleting ? '...' : 'Delete'}
                                            </button>
                                        </div>
                                     )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default UsersModule;