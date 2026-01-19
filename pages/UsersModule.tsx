
import { useState, useEffect } from 'react';
import { db } from '../services/supabaseService';
import { User, UserRole, SystemSettings } from '../types';

const UsersModule = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [form, setForm] = useState({ email: '', password: '', role: UserRole.REGISTRAR, district: '' });
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [config, setSettings] = useState<SystemSettings | null>(null);
    const [resettingId, setResettingId] = useState<string | null>(null);
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

    const handleDelete = async (user: User) => {
        if (!window.confirm(`Permanently revoke access for ${user.email}? This action wipes all auth credentials.`)) return;
        
        setLoading(true);
        setStatus({ type: 'info', msg: "Deactivating account..." });
        try {
            await db.deleteUser(user.id);
            setStatus({ type: 'success', msg: "Account permanently removed." });
            await load();
        } catch (e: any) {
            console.error("Delete failed", e);
            setStatus({ type: 'error', msg: "Deletion failed." });
        } finally {
            setLoading(false);
        }
    };
    
    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-white p-6 rounded-2xl shadow-sm border h-fit">
                <div className="flex justify-between items-center mb-6 border-b pb-2">
                    <h3 className="font-black text-blue-900 uppercase text-xs tracking-widest">
                        {editingUserId ? 'Edit Account' : 'New User Setup'}
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
                        <label className="text-[10px] font-black text-gray-400 uppercase">Login Username</label>
                        <input 
                            type="text" 
                            className="w-full p-3 border rounded-xl bg-gray-50 font-bold focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50" 
                            placeholder="e.g. jdoe_registrar" 
                            value={form.email} 
                            onChange={e => setForm({...form, email: e.target.value})} 
                            disabled={!!editingUserId || loading} 
                        />
                    </div>
                    
                    {!editingUserId && (
                        <div className="space-y-1">
                            <label className="text-[10px] font-black text-gray-400 uppercase">Initial Password</label>
                            <input 
                                type="password" 
                                className="w-full p-3 border rounded-xl bg-gray-50 font-bold focus:ring-2 focus:ring-blue-500 outline-none" 
                                placeholder="••••••••" 
                                value={form.password} 
                                onChange={e => setForm({...form, password: e.target.value})} 
                                disabled={loading}
                            />
                        </div>
                    )}

                    <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase">Assign Role</label>
                        <select 
                            className="w-full p-3 border rounded-xl bg-gray-50 font-bold" 
                            value={form.role} 
                            onChange={e => setForm({...form, role: e.target.value as any, district: e.target.value === UserRole.REGISTRAR ? form.district : ''})}
                            disabled={loading}
                        >
                            <option value={UserRole.REGISTRAR}>District Registrar</option>
                            <option value={UserRole.FINANCE}>Finance Admin (Regional)</option>
                            <option value={UserRole.ADMIN}>Regional Admin (Full Access)</option>
                        </select>
                    </div>

                    {form.role === UserRole.REGISTRAR && (
                        <div className="space-y-1 animate-in slide-in-from-top-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase">District Scope</label>
                            <select 
                                className="w-full p-3 border rounded-xl bg-gray-50 font-bold text-sm" 
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

                    <div className="flex flex-col gap-2 pt-4">
                        <button 
                            type="button"
                            onClick={handleAction}
                            disabled={loading}
                            className="w-full py-4 bg-blue-600 text-white rounded-xl font-black uppercase text-xs tracking-widest shadow-lg hover:bg-blue-700 transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {loading ? 'WAIT...' : (editingUserId ? 'Apply Update' : 'Generate Account')}
                        </button>
                        {editingUserId && (
                            <button 
                                type="button" 
                                onClick={cancelEditing} 
                                disabled={loading}
                                className="w-full py-3 bg-gray-100 text-gray-600 rounded-xl font-black uppercase text-xs disabled:opacity-50"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <div className="md:col-span-2 space-y-3">
                <div className="flex justify-between items-center px-2 mb-2">
                    <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-widest">Active System Accounts</h3>
                    <button onClick={load} disabled={loading} className="text-[10px] font-bold text-blue-600 uppercase">Refresh List</button>
                </div>
                
                {users.length === 0 ? (
                    <div className="p-10 text-center bg-white rounded-2xl border border-dashed text-gray-400 font-bold uppercase text-xs">No accounts found.</div>
                ) : users.map(u => (
                    <div key={u.id} className={`bg-white p-4 rounded-xl border flex flex-col sm:flex-row justify-between items-center text-sm gap-4 transition-all ${editingUserId === u.id ? 'ring-2 ring-blue-500 shadow-md' : 'shadow-sm'}`}>
                        <div className="w-full">
                            <span className="font-black text-blue-900 uppercase block sm:inline">{u.email}</span>
                            <span className={`px-2 py-0.5 rounded ml-2 font-bold uppercase text-[9px] ${u.role === 'finance' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-500'}`}>
                                {u.role.toUpperCase()}
                            </span>
                            {u.district && (
                                <span className="text-blue-500 font-black ml-2 uppercase text-[10px] block sm:inline">
                                    • {u.district}
                                </span>
                            )}
                        </div>
                        <div className="flex gap-3 items-center w-full sm:w-auto justify-end">
                             {resettingId === u.id ? (
                                <div className="flex items-center gap-1 bg-gray-100 p-1.5 rounded-xl border">
                                    <input 
                                        type="text" 
                                        className="border rounded-lg p-2 w-32 text-xs font-bold" 
                                        placeholder="New Pass" 
                                        value={newPassword} 
                                        onChange={e => setNewPassword(e.target.value)} 
                                        disabled={loading}
                                    />
                                    <button onClick={() => savePassword(u.id)} disabled={loading} className="bg-green-600 text-white text-[9px] px-3 py-2 rounded-lg font-black uppercase">Save</button>
                                    <button onClick={() => setResettingId(null)} disabled={loading} className="bg-gray-400 text-white text-[9px] px-3 py-2 rounded-lg font-black uppercase">X</button>
                                </div>
                             ) : (
                                <>
                                    <button onClick={() => startEditing(u)} disabled={loading} className="text-blue-600 font-black uppercase text-[9px] border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-600 hover:text-white transition-all">Edit</button>
                                    <button onClick={() => setResettingId(u.id)} disabled={loading} className="text-orange-600 font-black uppercase text-[9px] border border-orange-200 px-3 py-1.5 rounded-lg hover:bg-orange-600 hover:text-white transition-all">Pass</button>
                                    <button onClick={() => handleDelete(u)} disabled={loading} className="text-red-600 font-black uppercase text-[9px] border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-600 hover:text-white transition-all">Del</button>
                                </>
                             )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default UsersModule;
