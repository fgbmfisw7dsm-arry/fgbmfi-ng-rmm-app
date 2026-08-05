import { useState, useEffect, useContext } from 'react';
import { db } from '../services/supabaseService';
import { User, UserRole, SystemSettings, isRegistrarRole, isAdminRole, isRegionalRole, isDistrictRole, isNationalRole } from '../types';
import { AppContext } from '../context/AppContext';

const UsersModule = () => {
    const { user } = useContext(AppContext);
    const isAdmin = isAdminRole((user?.role || '').toLowerCase());

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

    const [users, setUsers] = useState<User[]>([]);
    const [form, setForm] = useState({ email: '', password: '', role: '' as string, district: '', region: '' });
    const [editingUserId, setEditingUserId] = useState<string | null>(null);
    const [config, setSettings] = useState<SystemSettings | null>(null);
    const [resettingId, setResettingId] = useState<string | null>(null);
    const [confirmDeleteUserId, setConfirmDeleteUserId] = useState<string | null>(null);
    const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info', msg: string } | null>(null);
    const [togglingId, setTogglingId] = useState<string | null>(null);
    const [bulkDeactivating, setBulkDeactivating] = useState(false);
    const [activeFilter, setActiveFilter] = useState<'all' | 'active' | 'inactive'>('all');

    const needsDistrict = (r: string) => isDistrictRole(r);
    const needsRegion = (r: string) => isRegionalRole(r);

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

        if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
            setStatus({ type: 'error', msg: "Please enter a valid email address, e.g. officer@fgbmfi.ng" });
            return;
        }

        if (!form.role) {
            setStatus({ type: 'error', msg: "Please select a system role." });
            return;
        }

        if (needsDistrict(form.role) && !form.district) {
            setStatus({ type: 'error', msg: "District roles must be assigned to a district." });
            return;
        }

        if (needsRegion(form.role) && !form.region) {
            setStatus({ type: 'error', msg: "Regional roles must be assigned to a region." });
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
                    district: needsDistrict(form.role) ? form.district : '',
                    region: needsRegion(form.role) ? form.region : ''
                });
                setStatus({ type: 'success', msg: "Account updated successfully." });
            } else {
                const res = await db.createUser(form, form.password);
                if (res && res.error) throw new Error(res.error);
                setStatus({ type: 'success', msg: `Account ${form.email} created. User can login with this email.` });
            }
            
            setEditingUserId(null);
            setForm({ email: '', password: '', role: '', district: '', region: '' });
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
        const role = (u.role || '').toLowerCase();
        setEditingUserId(u.id);
        setForm({
            email: u.email,
            password: '',
            role: u.role,
            district: isDistrictRole(role) ? (u.district || '') : '',
            region: isRegionalRole(role) ? (u.region || '') : ''
        });
        setStatus(null);
        setConfirmDeleteUserId(null);
        setResettingId(null);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const cancelEditing = () => {
        setEditingUserId(null);
        setForm({ email: '', password: '', role: UserRole.REGISTRAR, district: '', region: '' });
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
        setStatus({ type: 'info', msg: `Removing account for ${u.email}...` });
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

    const toggleActive = async (u: User) => {
        setTogglingId(u.id);
        try {
            if (u.is_active !== false) {
                await db.deactivateUser(u.id);
                setStatus({ type: 'success', msg: `${u.email} deactivated. Login access revoked.` });
            } else {
                await db.reactivateUser(u.id);
                setStatus({ type: 'success', msg: `${u.email} reactivated. Login access restored.` });
            }
            await load();
        } catch (e: any) {
            setStatus({ type: 'error', msg: e.message || "Operation failed" });
        } finally {
            setTogglingId(null);
        }
    };

    const handleBulkDeactivate = async () => {
        if (!window.confirm("This will DEACTIVATE all non-admin accounts (registrars, finance). Admin accounts will NOT be affected. These users will be unable to login until reactivated. Proceed?")) return;
        setBulkDeactivating(true);
        setStatus({ type: 'info', msg: "Bulk deactivating non-admin accounts..." });
        try {
            const res = await db.bulkDeactivateEventUsers();
            setStatus({ type: 'success', msg: `Bulk deactivation complete. ${res?.deactivated_count || 'All non-admin'} accounts deactivated. Remember to reset passwords before next event.` });
            await load();
        } catch (e: any) {
            setStatus({ type: 'error', msg: 'Bulk deactivation failed: ' + e.message });
        } finally {
            setBulkDeactivating(false);
        }
    };

    const filteredUsers = users.filter(u => {
        if (activeFilter === 'active') return u.is_active !== false;
        if (activeFilter === 'inactive') return u.is_active === false;
        return true;
    });

    const activeCount = users.filter(u => u.is_active !== false).length;
    const inactiveCount = users.filter(u => u.is_active === false).length;
    
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
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Login Email</label>
                        <input 
                            type="text" 
                            className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-bold focus:ring-4 focus:ring-blue-500/10 focus:bg-white focus:border-blue-500 outline-none disabled:opacity-50 transition-all" 
                            placeholder="e.g. officer@fgbmfi.ng" 
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
                            onChange={e => setForm({...form, role: e.target.value as any, district: needsDistrict(e.target.value) ? form.district : '', region: needsRegion(e.target.value) ? form.region : ''})}
                            disabled={loading}
                        >
                            <option value="" disabled>-- Select Role --</option>
                            <option value={UserRole.NATIONAL_ADMIN}>National Admin</option>
                            <option value={UserRole.REGIONAL_ADMIN}>Regional Admin</option>
                            <option value={UserRole.DISTRICT_ADMIN}>District Admin</option>
                            <option value={UserRole.ADMIN}>System Admin (Legacy)</option>
                            <option value={UserRole.NATIONAL_REGISTRAR}>National Registrar</option>
                            <option value={UserRole.REGIONAL_REGISTRAR}>Regional Registrar</option>
                            <option value={UserRole.DISTRICT_REGISTRAR}>District Registrar</option>
                            <option value={UserRole.REGISTRAR}>Registrar (Legacy)</option>
                            <option value={UserRole.FINANCE}>Finance Admin</option>
                        </select>
                    </div>

                    {needsDistrict(form.role) && (
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

                    {needsRegion(form.role) && (
                        <div className="space-y-1 animate-in slide-in-from-top-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Region Scope</label>
                            <select 
                                className="w-full p-4 border-2 border-gray-100 rounded-2xl bg-gray-50 font-black text-xs uppercase outline-none focus:ring-4 focus:ring-blue-500/10 transition-all" 
                                value={form.region} 
                                onChange={e => setForm({...form, region: e.target.value})}
                                disabled={loading}
                            >
                                <option value="">Select Region...</option>
                                {config?.regions.map(r => <option key={r} value={r}>{r}</option>)}
                                {form.region && !config?.regions.includes(form.region) && (
                                    <option value={form.region}>{form.region} (Custom)</option>
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

                <div className="mt-8 pt-6 border-t border-gray-100">
                    <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-[0.2em] mb-4">Post-Event Cleanup</h3>
                    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                        <p className="text-[10px] font-bold text-amber-800 uppercase leading-relaxed">
                            Deactivate all non-admin accounts after an event. Admins are excluded. Reset passwords separately before the next event.
                        </p>
                        <div className="flex gap-2 text-[9px] font-bold text-amber-600 uppercase">
                            <span className="bg-amber-100 px-2 py-0.5 rounded-lg">Active: {activeCount}</span>
                            <span className="bg-amber-100 px-2 py-0.5 rounded-lg">Inactive: {inactiveCount}</span>
                        </div>
                        <button
                            type="button"
                            onClick={handleBulkDeactivate}
                            disabled={bulkDeactivating || loading}
                            className="w-full py-3 bg-amber-600 text-white rounded-xl font-black uppercase text-[9px] tracking-widest hover:bg-amber-700 transition-all active:scale-[0.98] disabled:opacity-50"
                        >
                            {bulkDeactivating ? 'Processing...' : 'Deactivate All Non-Admin'}
                        </button>
                    </div>
                </div>
            </div>

            <div className="md:col-span-2 space-y-4 pb-20">
                <div className="flex justify-between items-center px-2 mb-2">
                    <div className="flex items-center gap-3">
                        <h3 className="font-black text-[10px] text-gray-400 uppercase tracking-[0.2em]">Live Account Registry</h3>
                        <div className="flex gap-1 bg-gray-100 rounded-xl p-1">
                            {(['all', 'active', 'inactive'] as const).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setActiveFilter(f)}
                                    className={`px-3 py-1 rounded-lg font-black uppercase text-[8px] tracking-wider transition-all ${
                                        activeFilter === f ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                                    }`}
                                >
                                    {f === 'all' ? `All (${users.length})` : f === 'active' ? `Active (${activeCount})` : `Inactive (${inactiveCount})`}
                                </button>
                            ))}
                        </div>
                    </div>
                    <button onClick={load} disabled={loading} className="text-[10px] font-black text-blue-600 uppercase tracking-widest hover:text-blue-800 flex items-center gap-1">
                        <svg className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                        Refresh
                    </button>
                </div>
                
                {filteredUsers.length === 0 && !loading ? (
                    <div className="p-20 text-center bg-white rounded-[2rem] border-2 border-dashed text-gray-300 font-black uppercase text-xs tracking-widest">
                        {activeFilter === 'inactive' ? 'No inactive accounts' : activeFilter === 'active' ? 'All accounts are inactive' : 'No verified accounts found'}
                    </div>
                ) : filteredUsers.map(u => {
                    const isEditing = editingUserId === u.id;
                    const isResetting = resettingId === u.id;
                    const isConfirming = confirmDeleteUserId === u.id;
                    const isDeleting = deletingUserId === u.id;
                    const isToggling = togglingId === u.id;
                    const isInactive = u.is_active === false;

                    return (
                        <div key={u.id} className={`bg-white p-6 rounded-2xl border transition-all relative overflow-hidden group ${isEditing ? 'ring-2 ring-blue-500 shadow-xl z-20' : isConfirming ? 'bg-red-50 border-red-200' : isInactive ? 'bg-gray-50 border-gray-200 opacity-75' : 'shadow-sm border-gray-100'}`}>
                            {isInactive && (
                                <div className="absolute top-0 right-0 bg-red-500 text-white px-3 py-1 rounded-bl-xl font-black uppercase text-[8px] tracking-widest">Inactive</div>
                            )}
                            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 relative z-10">
                                <div className="min-w-0 flex-1 w-full">
                                    <div className="flex items-center gap-3 mb-1 flex-wrap">
                                        <span className={`font-black uppercase text-lg tracking-tight truncate max-w-[320px] ${isInactive ? 'text-gray-400 line-through' : 'text-blue-900'}`} title={u.email}>{u.email}</span>
                                        <span className={`px-2.5 py-1 rounded-lg font-black uppercase text-[8px] tracking-widest shadow-sm ${u.role === UserRole.NATIONAL_ADMIN ? 'bg-blue-900 text-white' : u.role === UserRole.REGIONAL_ADMIN ? 'bg-blue-700 text-white' : u.role === UserRole.DISTRICT_ADMIN ? 'bg-blue-500 text-white' : u.role === 'admin' ? 'bg-blue-900 text-white' : u.role === 'finance' ? 'bg-purple-600 text-white' : 'bg-slate-500 text-white'}`}>
                                            {u.role === UserRole.NATIONAL_ADMIN ? 'Nat. Admin' : u.role === UserRole.REGIONAL_ADMIN ? 'Reg. Admin' : u.role === UserRole.DISTRICT_ADMIN ? 'Dist. Admin' : u.role === UserRole.NATIONAL_REGISTRAR ? 'Nat. Reg' : u.role === UserRole.REGIONAL_REGISTRAR ? 'Reg. Reg' : u.role === UserRole.DISTRICT_REGISTRAR ? 'Dist. Reg' : u.role === UserRole.ADMIN ? 'Sys Admin' : u.role === UserRole.REGISTRAR ? 'Registrar' : u.role.toUpperCase()}
                                        </span>
                                        {isInactive && (
                                            <span className="px-2 py-0.5 bg-red-100 text-red-600 rounded-md font-black uppercase text-[7px] tracking-wider">Deactivated</span>
                                        )}
                                    </div>
                                    {u.district && isDistrictRole((u.role || '').toLowerCase()) && (
                                        <p className="text-blue-500 font-black uppercase text-[10px] tracking-widest">
                                            {u.district} District Jurisdiction
                                        </p>
                                    )}
                                    {u.region && isRegionalRole((u.role || '').toLowerCase()) && (
                                        <p className="text-emerald-600 font-black uppercase text-[10px] tracking-widest">
                                            {u.region} Region Jurisdiction
                                        </p>
                                    )}
                                </div>

                                <div className="flex gap-2 items-center w-full sm:w-auto justify-end flex-shrink-0 flex-wrap">
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
                                                Yes, Remove
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
                                                onClick={() => toggleActive(u)}
                                                disabled={loading || isDeleting || isToggling}
                                                title={isInactive ? 'Reactivate account' : 'Deactivate account'}
                                                className={`flex items-center gap-1.5 font-black uppercase text-[9px] border px-4 py-2.5 rounded-xl transition-all shadow-sm ${
                                                    isInactive 
                                                        ? 'text-green-600 border-green-100 hover:bg-green-600 hover:text-white' 
                                                        : 'text-amber-600 border-amber-100 hover:bg-amber-600 hover:text-white'
                                                }`}
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    {isInactive 
                                                        ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                                        : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M18.364 5.636a9 9 0 010 12.728M5.636 18.364a9 9 0 010-12.728M12 8v4m0 4h.01" />
                                                    }
                                                </svg>
                                                {isToggling ? '...' : isInactive ? 'Activate' : 'Deactivate'}
                                            </button>
                                            <button 
                                                onClick={() => { setConfirmDeleteUserId(u.id); setResettingId(null); setEditingUserId(null); }} 
                                                disabled={loading || isDeleting} 
                                                className="flex items-center gap-1.5 text-red-500 font-black uppercase text-[9px] border border-red-100 px-4 py-2.5 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-sm"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                {isDeleting ? '...' : 'Remove'}
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