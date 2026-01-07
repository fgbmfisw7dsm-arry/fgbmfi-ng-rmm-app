
import { supabase } from './supabaseClient';
import { User, UserRole, Delegate, Event, Session, SystemSettings, CheckInResult, Pledge, FinancialEntry, DashboardStats, CheckIn, FinancialType } from '../types';
import { generateCodeFromId } from './utils';

/**
 * Normalizes input by trimming whitespace. 
 * Removed .toLowerCase() to support non-email based usernames that may be case sensitive.
 */
const normalize = (val?: string) => (val || '').trim();

const handleSupabaseError = (res: { error: any, data: any }, customMessage?: string) => {
    if (res.error) {
        console.error("Supabase Error Context:", res.error);
        const detail = res.error.details || "";
        const hint = res.error.hint || "";
        const msg = `${res.error.message} ${detail} ${hint}`.trim();
        
        // SESSION TIMEOUT & CORRUPTION DETECTION
        const lowerMsg = msg.toLowerCase();
        if (lowerMsg.includes('jwt expired') || lowerMsg.includes('invalid token') || lowerMsg.includes('refresh_token_not_found')) {
            console.warn("Auth Session Corrupted. Triggering local cleanup.");
            localStorage.clear();
            window.location.reload(); // Force full reload to reset state
            throw new Error("SESSION_CORRUPTED");
        }

        if (lowerMsg.includes('row-level security') || lowerMsg.includes('permission denied')) {
            throw new Error(customMessage ? `${customMessage}: Access Denied (Check Roles & Permissions)` : "Access Denied: You do not have permission for this database operation.");
        }
        
        throw new Error(customMessage ? `${customMessage}: ${msg}` : msg);
    }
    return res.data;
};

export const auth = {
    login: async (email: string, password: string): Promise<User | null> => {
        // DEFENSIVE: Clear any local session ghosts before attempting a new sign-in
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch (e) {
            console.warn("Pre-login cleanup skipped:", e);
        }

        const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
            email: normalize(email), 
            password 
        });

        if (authError) {
            console.error("Auth Login Error:", authError);
            throw new Error(authError.message);
        }

        if (!authData.user) return null;

        try {
            const { data: appUser, error: profileError } = await supabase
                .from('app_users')
                .select('*')
                .eq('id', authData.user.id)
                .single();

            if (profileError) {
                // Return a basic object if the app_users record is missing but auth succeeded
                return {
                    id: authData.user.id,
                    email: authData.user.email || email,
                    role: UserRole.ADMIN 
                };
            }

            return appUser as User;
        } catch (fetchErr: any) {
            return {
                id: authData.user.id,
                email: authData.user.email || email,
                role: UserRole.ADMIN
            };
        }
    },
    logout: async () => {
        try { 
            await supabase.auth.signOut(); 
            localStorage.clear();
        } catch (e) {}
    }
};

export const db = {
    getEvents: async (): Promise<Event[]> => 
        handleSupabaseError(await supabase.from('events').select('*').order('start_date', { ascending: false })),

    createEvent: async (event: Omit<Event, 'event_id'>) => 
        handleSupabaseError(await supabase.from('events').insert(event).select().single()),

    updateEvent: async (id: string, updates: Partial<Event>) => 
        handleSupabaseError(await supabase.from('events').update(updates).eq('event_id', id)),

    deleteEvent: async (id: string) => 
        handleSupabaseError(await supabase.from('events').delete().eq('event_id', id)),

    getSessions: async (eventId: string): Promise<Session[]> => {
        if (!eventId) return [];
        const { data } = await supabase.from('sessions').select('*').eq('event_id', eventId).order('start_time');
        return data || [];
    },

    createSession: async (session: Omit<Session, 'session_id'>) => 
        handleSupabaseError(await supabase.from('sessions').insert(session).select().single()),

    updateSession: async (id: string, updates: Partial<Session>) => 
        handleSupabaseError(await supabase.from('sessions').update(updates).eq('session_id', id)),

    deleteSession: async (id: string) => 
        handleSupabaseError(await supabase.from('sessions').delete().eq('session_id', id)),

    getSettings: async (): Promise<SystemSettings> => 
        handleSupabaseError(await supabase.from('system_settings').select('*').limit(1).single()),

    updateSettings: async (settings: SystemSettings) => 
        handleSupabaseError(await supabase.from('system_settings').upsert(settings)),
    
    getUsers: async (): Promise<User[]> => 
        handleSupabaseError(await supabase.from('app_users').select('*')),

    createUser: async (user: Omit<User, 'id'>, password: string) => {
        const payloadRole = (user.role || '').toLowerCase();
        const payloadDistrict = (payloadRole === 'registrar') ? normalize(user.district) : null;
        const payloadEmail = normalize(user.email);

        const { data, error } = await supabase.rpc('create_app_user', { 
            email: payloadEmail, 
            password, 
            role: payloadRole, 
            district: payloadDistrict 
        });

        if (error) throw new Error(`Database rejected call: ${error.message}`);
        if (data && data.error) throw new Error(data.error);
        return data;
    },

    updateUser: async (userId: string, updates: Partial<User>) => {
        const payload: any = {};
        if (updates.role) {
            payload.role = updates.role.toLowerCase();
            if (payload.role !== UserRole.REGISTRAR) payload.district = null;
            else if (updates.district) payload.district = normalize(updates.district);
        } else if (updates.hasOwnProperty('district')) {
            payload.district = normalize(updates.district);
        }

        const { error } = await supabase.from('app_users').update(payload).eq('id', userId);
        if (error) handleSupabaseError({ data: null, error }, "Account update failed");
        return true;
    },

    deleteUser: async (userId: string) => 
        handleSupabaseError(await supabase.rpc('delete_app_user', { user_id_to_delete: userId })),

    resetUserPassword: async (userId: string, newPassword: string) => 
        handleSupabaseError(await supabase.rpc('reset_user_password', { user_id: userId, new_password: newPassword })),

    searchDelegates: async (query: string, eventId: string, district?: string, sessionId?: string): Promise<(Delegate & { checkedIn: boolean, code?: string })[]> => {
        if (!eventId) return [];
        const safeSessionId = (sessionId && sessionId.trim() !== "") ? sessionId : null;
        let queryBuilder = supabase.from('delegates').select('*');
        
        // Aggressive District Filtering
        if (district && district.trim() !== "") {
            queryBuilder = queryBuilder.eq('district', normalize(district));
        }

        if (query && query.length > 1) {
            queryBuilder = queryBuilder.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`);
        }

        const { data: delegates, error: delError } = await queryBuilder.limit(100);
        if (delError || !delegates) return [];

        const delegateIds = delegates.map(d => d.delegate_id);
        if (delegateIds.length === 0) return [];

        let checkinQuery = supabase.from('checkins').select('delegate_id').eq('event_id', eventId).in('delegate_id', delegateIds);
        if (safeSessionId) checkinQuery = checkinQuery.eq('session_id', safeSessionId);
        else checkinQuery = checkinQuery.is('session_id', null);

        const { data: checkins } = await checkinQuery;
        const checkedInSet = new Set(checkins?.map(c => c.delegate_id) || []);
        
        return delegates.map(d => ({ 
            ...d, 
            checkedIn: checkedInSet.has(d.delegate_id),
            code: generateCodeFromId(d.delegate_id, eventId)
        }));
    },

    getAllDelegates: async (): Promise<Delegate[]> => {
        const { data } = await supabase.from('delegates').select('*').order('first_name');
        return data || [];
    },

    updateDelegate: async (id: string, updates: Partial<Delegate>) => 
        handleSupabaseError(await supabase.from('delegates').update(updates).eq('delegate_id', id)),

    checkInDelegate: async (eventId: string, delegateId: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        if (!eventId || !delegateId) throw new Error("Context required.");
        const safeSessionId = (sessionId && sessionId.trim() !== "") ? sessionId : null;
        const code = generateCodeFromId(delegateId, eventId);

        let existingQuery = supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId);
        if (safeSessionId) existingQuery = existingQuery.eq('session_id', safeSessionId);
        else existingQuery = existingQuery.is('session_id', null);
        
        const { data: existing } = await existingQuery.maybeSingle();
        if (existing) return { success: true, message: 'Already Verified', code };

        const { error: insertError } = await supabase.from('checkins').insert({
            event_id: eventId, 
            delegate_id: delegateId, 
            session_id: safeSessionId,
            checked_in_by: registrar.id, 
            checked_in_at: new Date().toISOString()
        });

        if (insertError) {
            return handleSupabaseError({ data: null, error: insertError }, "Verification Rejected");
        }
        return { success: true, message: 'Verification Confirmed', code };
    },

    checkInByCode: async (eventId: string, code: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        if (!eventId || !code) throw new Error("Context Required");
        if (!sessionId || sessionId.trim() === "") throw new Error("Fast Check-in restricted to sessions.");

        const isScopedRegistrar = (registrar.role || '').toLowerCase() === UserRole.REGISTRAR && registrar.district;
        const districtFilter = isScopedRegistrar ? normalize(registrar.district) : undefined;
        
        let qb = supabase.from('delegates').select('delegate_id');
        if (districtFilter) qb = qb.eq('district', districtFilter);
        
        const { data: delegates, error } = await qb;
        if (error || !delegates) throw new Error("Database Access Error.");
        
        const match = delegates.find(d => generateCodeFromId(d.delegate_id, eventId) === code);
        if (!match) return { success: false, message: 'Invalid code or district unauthorized.' };
        
        return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
    },

    registerDelegate: async (delegate: Partial<Delegate>): Promise<Delegate> => {
        const phone = normalize(delegate.phone);
        if (!phone) throw new Error("Phone number required.");
        const { data: existing } = await supabase.from('delegates').select('*').eq('phone', phone).maybeSingle();
        if (existing) return existing as Delegate;

        const payload = {
            title: normalize(delegate.title), 
            first_name: normalize(delegate.first_name), 
            last_name: normalize(delegate.last_name),
            district: normalize(delegate.district), 
            chapter: normalize(delegate.chapter), 
            phone: phone,
            email: normalize(delegate.email), 
            rank: normalize(delegate.rank) || 'CP', 
            office: normalize(delegate.office) || 'OTHER'
        };
        const { data, error } = await supabase.from('delegates').insert(payload).select().single();
        if (error) return handleSupabaseError({ data: null, error }, "Delegate Registration Failed");
        return data as Delegate;
    },

    importDelegates: async (csv: string): Promise<number> => {
        const lines = csv.trim().split('\n');
        const delegatesToInsert = lines.map(line => {
            const parts = line.split(',').map(p => p.trim());
            if (parts.length < 3) return null;
            return {
                title: parts[0] || 'Mr', first_name: parts[1] || '', last_name: parts[2] || '',
                district: normalize(parts[3] || ''), chapter: parts[4] || '', phone: parts[5] || '',
                email: parts[6] || '', rank: parts[7] || 'CP', office: parts[8] || 'OTHER'
            };
        }).filter(Boolean);
        if (delegatesToInsert.length === 0) return 0;
        const { data, error } = await supabase.from('delegates').insert(delegatesToInsert).select();
        if (error) throw error;
        return data?.length || 0;
    },

    harmonizeDistricts: async (): Promise<number> => {
        const { data: delegates, error: fetchError } = await supabase.from('delegates').select('delegate_id, district');
        if (fetchError) throw fetchError;
        
        const updates = (delegates || [])
            .filter(d => d.district !== normalize(d.district))
            .map(d => ({ delegate_id: d.delegate_id, district: normalize(d.district) }));

        if (updates.length === 0) return 0;

        // Optimized Sequential Update for Stability
        let count = 0;
        for (const update of updates) {
            const { error } = await supabase.from('delegates')
                .update({ district: update.district })
                .eq('delegate_id', update.delegate_id);
            if (!error) count++;
            else console.warn(`Harmonize skip ID ${update.delegate_id}: ${error.message}`);
        }
        return count;
    },

    deduplicateDelegates: async (): Promise<number> => {
        const { data: delegates, error: fetchError } = await supabase.from('delegates').select('delegate_id, first_name, last_name, phone');
        if (fetchError || !delegates) throw fetchError || new Error("Fetch failed");
        
        const seen = new Set<string>();
        const toDelete: string[] = [];
        
        delegates.forEach(d => {
            const key = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.phone)}`.toUpperCase();
            if (seen.has(key)) {
                toDelete.push(d.delegate_id);
            } else {
                seen.add(key);
            }
        });
        
        if (toDelete.length === 0) return 0;
        
        // Use batch delete via 'in' clause for speed
        const { data, error } = await supabase.from('delegates').delete().in('delegate_id', toDelete).select();
        if (error) throw handleSupabaseError({ data: null, error }, "Deduplication Failed");
        return data?.length || 0;
    },

    searchPledges: async (query: string, eventId: string, district?: string): Promise<Pledge[]> => {
        let qb = supabase.from('pledges').select('*').eq('event_id', eventId);
        if (district && district.trim() !== "") qb = qb.eq('district', normalize(district));
        if (query && query.trim().length > 1) qb = qb.ilike('donor_name', `%${query.trim()}%`);
        const { data } = await qb.limit(50);
        return data || [];
    },

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => 
        handleSupabaseError(await supabase.from('financial_entries').insert(entry)),

    createPledge: async (pledge: Partial<Pledge>) => 
        handleSupabaseError(await supabase.from('pledges').insert(pledge)),

    clearEventData: async (eventId: string) => {
        await handleSupabaseError(await supabase.from('checkins').delete().eq('event_id', eventId));
        await handleSupabaseError(await supabase.from('financial_entries').delete().eq('event_id', eventId));
        await handleSupabaseError(await supabase.from('pledges').delete().eq('event_id', eventId));
        return true;
    },

    deleteDelegatesByDistrict: async (district: string): Promise<number> => {
        const { data, error } = await supabase.from('delegates').delete().eq('district', normalize(district)).select();
        if (error) throw error;
        return data?.length || 0;
    },

    deleteDelegatesByScope: async (scope: 'all' | string): Promise<number> => {
        if (scope === 'all') {
            const { data, error } = await supabase.from('delegates').delete().not('delegate_id', 'is', null).select();
            if (error) throw error;
            return data?.length || 0;
        }
        return 0;
    },

    getStats: async (eventId: string, district?: string): Promise<DashboardStats> => {
        const { data: checkins } = await supabase.from('checkins').select('*').eq('event_id', eventId).order('checked_in_at', { ascending: false });
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, first_name, last_name, rank, district, office');
        const uniqueActivityMap = new Map();
        
        const normalizedFilter = district ? normalize(district).toUpperCase() : null;

        (checkins || []).forEach(c => {
            const d = delegates?.find(del => del.delegate_id === c.delegate_id);
            if (!d) return;
            
            const delDistrict = normalize(d.district).toUpperCase();
            if (normalizedFilter && delDistrict !== normalizedFilter) return;

            if (!uniqueActivityMap.has(c.delegate_id)) {
                uniqueActivityMap.set(c.delegate_id, { 
                    ...c, delegate_name: `${d.first_name} ${d.last_name}`,
                    district: d.district, rank: d.rank || '-',
                    office: d.office || '-'
                });
            }
        });
        const recent = Array.from(uniqueActivityMap.values()).slice(0, 10);
        let filteredDelegates = delegates || [];
        if (normalizedFilter) {
            filteredDelegates = filteredDelegates.filter(d => normalize(d.district).toUpperCase() === normalizedFilter);
        }

        const attendedIds = new Set((checkins || []).map(c => c.delegate_id));
        const attendedDelegates = filteredDelegates.filter(d => attendedIds.has(d.delegate_id));
        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        attendedDelegates.forEach(d => {
            rankCounts[d.rank || 'Unknown'] = (rankCounts[d.rank || 'Unknown'] || 0) + 1;
            districtCounts[d.district || 'Unknown'] = (districtCounts[d.district || 'Unknown'] || 0) + 1;
        });
        const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
        const totalFinancials = financials?.reduce((sum, f) => sum + (parseFloat(f.amount as any) || 0), 0) || 0;
        return { 
            totalDelegates: filteredDelegates.length, totalCheckIns: attendedDelegates.length, 
            totalFinancials, checkInsByRank: rankCounts, checkInsByDistrict: districtCounts, 
            recentActivity: recent as any 
        };
    },

    getAllDataForExport: async (eventId: string): Promise<any> => {
        const [d, c, f, p]: any[] = await Promise.all([
            supabase.from('delegates').select('*'), 
            supabase.from('checkins').select('*').eq('event_id', eventId), 
            supabase.from('financial_entries').select('*').eq('event_id', eventId), 
            supabase.from('pledges').select('*').eq('event_id', eventId)
        ]);
        return { delegates: d.data || [], checkins: c.data || [], financials: f.data || [], pledges: p.data || [] };
    }
};
