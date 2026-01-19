
import { supabase } from './supabaseClient';
import { User, UserRole, Delegate, Event, Session, SystemSettings, CheckInResult, Pledge, FinancialEntry, DashboardStats, CheckIn, FinancialType } from '../types';
import { generateCodeFromId } from './utils';

/**
 * Normalizes input by collapsing all whitespace into single spaces and trimming.
 */
const normalize = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();

/**
 * Helper to wrap promises with a timeout to prevent indefinite hangs.
 */
const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
    ]);
};

const handleSupabaseError = (res: any, customMessage?: string) => {
    if (res.error) {
        console.error("Supabase Internal Error:", res.error);
        const detail = res.error.details || "";
        const hint = res.error.hint || "";
        const msg = `${res.error.message} ${detail} ${hint}`.trim();
        const lowerMsg = msg.toLowerCase();
        
        if (lowerMsg.includes('jwt expired') || lowerMsg.includes('invalid token') || lowerMsg.includes('refresh_token_not_found')) {
            localStorage.clear();
            window.location.reload(); 
            throw new Error("SESSION_EXPIRED");
        }

        if (lowerMsg.includes('row-level security') || lowerMsg.includes('permission denied')) {
            throw new Error(customMessage ? `${customMessage}: Permission Restricted` : "Database Access Restricted.");
        }

        if (lowerMsg.includes('relation') && lowerMsg.includes('does not exist')) {
            throw new Error(`CRITICAL: Database table missing. Contact System Admin to run the SQL Setup.`);
        }
        
        if (lowerMsg.includes('schema')) {
            console.warn("Schema query failure detected. Signalling handshake recovery.");
            return { __isSchemaError: true, originalError: res.error };
        }

        throw new Error(customMessage ? `${customMessage}: ${msg}` : msg);
    }
    return res.data;
};

export const auth = {
    getOrCreateProfile: async (authId: string, email: string): Promise<User> => {
        try {
            const fetchResponse = await supabase
                .from('app_users')
                .select('*')
                .eq('id', authId)
                .maybeSingle();

            const result = handleSupabaseError(fetchResponse);
            
            if (result && !result.__isSchemaError) {
                return result as User;
            }

            console.warn(`Handshake Repair triggered for ${email}...`);
            
            const { data: newProfile, error: repairError } = await supabase
                .from('app_users')
                .upsert({
                    id: authId,
                    email: email,
                    role: UserRole.REGISTRAR 
                }, { onConflict: 'id' })
                .select()
                .single();

            if (repairError) {
                console.error("Critical Profile repair failed:", repairError);
                return { id: authId, email, role: UserRole.REGISTRAR };
            }

            return newProfile as User;
        } catch (err) {
            console.error("Fatal handshake error:", err);
            return { id: authId, email, role: UserRole.REGISTRAR };
        }
    },

    login: async (email: string, password: string): Promise<User | null> => {
        try {
            await supabase.auth.signOut({ scope: 'local' });
        } catch (e) {}

        const { data: authData, error: authError } = await withTimeout<any>(
            supabase.auth.signInWithPassword({ email: normalize(email), password }), 
            15000, 
            "Login Timeout: The Auth server is not responding."
        );

        if (authError) {
            console.error("Auth Failure:", authError);
            throw new Error(authError.message);
        }

        if (!authData.user) return null;

        return await auth.getOrCreateProfile(authData.user.id, authData.user.email || email);
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

    getSettings: async (): Promise<SystemSettings> => {
        const { data, error } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        if (error) throw error;
        return data || {
            titles: ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'],
            districts: [],
            ranks: [],
            offices: [],
            regions: []
        };
    },

    updateSettings: async (settings: SystemSettings, field?: keyof SystemSettings): Promise<SystemSettings> => {
        const { data: current } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        
        let payload: any = {};
        if (field) {
            payload[field] = Array.isArray(settings[field]) ? settings[field] : [];
        } else {
            payload = {
                titles: settings.titles, districts: settings.districts, 
                ranks: settings.ranks, offices: settings.offices, regions: settings.regions
            };
        }

        if (current) {
            const pkKey = Object.keys(current).find(k => k.toLowerCase().includes('id')) || 'id';
            const { data, error } = await supabase.from('system_settings').update(payload).eq(pkKey, current[pkKey]).select().single();
            if (error) throw error;
            return data;
        } else {
            const { data, error } = await supabase.from('system_settings').insert(payload).select().single();
            if (error) throw error;
            return data;
        }
    },
    
    getUsers: async (): Promise<User[]> => 
        handleSupabaseError(await supabase.from('app_users').select('*')),

    createUser: async (user: Omit<User, 'id'>, password: string) => {
        const { data, error } = await supabase.rpc('create_app_user', { 
            email: normalize(user.email), 
            password, 
            role: user.role.toLowerCase(), 
            district: (user.role === UserRole.REGISTRAR) ? normalize(user.district) : null 
        });

        if (error) {
            if (error.message.includes('gen_salt')) {
                throw new Error("SECURITY_CONFIG_ERROR: The 'pgcrypto' extension is missing or restricted. Run the SQL Fix script.");
            }
            throw new Error(`Account creation failed: ${error.message}`);
        }
        
        if (data && data.error) throw new Error(data.error);
        return data;
    },

    updateUser: async (userId: string, updates: Partial<User>) => {
        const payload: any = {};
        if (updates.role) {
            payload.role = updates.role.toLowerCase();
            payload.district = (payload.role === UserRole.REGISTRAR) ? normalize(updates.district) : null;
        } else if (updates.hasOwnProperty('district')) {
            payload.district = normalize(updates.district);
        }
        const { error } = await supabase.from('app_users').update(payload).eq('id', userId);
        if (error) throw error;
        return true;
    },

    deleteUser: async (userId: string) => 
        handleSupabaseError(await supabase.rpc('delete_app_user', { user_id_to_delete: userId })),

    resetUserPassword: async (userId: string, newPassword: string) => {
        const { data, error } = await supabase.rpc('reset_user_password', { user_id: userId, new_password: newPassword });
        if (error) {
            if (error.message.includes('gen_salt')) {
                throw new Error("CRYPTO_ERROR: Security function 'gen_salt' failed. Run the SQL Fix.");
            }
            throw error;
        }
        if (data && data.error) throw new Error(data.error);
        return data;
    },

    searchDelegates: async (query: string, eventId: string, district?: string, sessionId?: string): Promise<(Delegate & { checkedIn: boolean, code?: string })[]> => {
        if (!eventId) return [];
        const safeSessionId = (sessionId && sessionId.trim() !== "") ? sessionId : null;
        
        let queryBuilder = supabase.from('delegates').select('*');
        
        if (district) {
            const normalizedDistrict = normalize(district);
            queryBuilder = queryBuilder.ilike('district', normalizedDistrict);
        }

        if (query.length > 1) {
            queryBuilder = queryBuilder.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`);
        }

        const { data: delegates, error } = await queryBuilder.limit(100);
        if (error) throw error;
        if (!delegates || delegates.length === 0) return [];

        let checkinQuery = supabase.from('checkins').select('delegate_id').eq('event_id', eventId).in('delegate_id', delegates.map(d => d.delegate_id));
        if (safeSessionId) checkinQuery = checkinQuery.eq('session_id', safeSessionId);
        else checkinQuery = checkinQuery.is('session_id', null);

        const { data: checkins } = await checkinQuery;
        const checkedInSet = new Set(checkins?.map(c => c.delegate_id) || []);
        
        return delegates.map(d => ({ 
            ...d, 
            checkedIn: checkedInSet.has(d.delegate_id),
            code: d.code || generateCodeFromId(d.delegate_id, eventId)
        }));
    },

    getAllDelegates: async (): Promise<Delegate[]> => {
        const { data } = await supabase.from('delegates').select('*').order('first_name');
        return data || [];
    },

    updateDelegate: async (id: string, updates: Partial<Delegate>) => {
        const { name_display, delegate_id, created_at, ...validUpdates } = updates as any;
        return handleSupabaseError(await supabase.from('delegates').update({
            ...validUpdates,
            district: normalize(validUpdates.district),
            chapter: normalize(validUpdates.chapter)
        }).eq('delegate_id', id));
    },

    checkInDelegate: async (eventId: string, delegateId: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        const safeSessionId = (sessionId && sessionId.trim() !== "") ? sessionId : null;
        const code = generateCodeFromId(delegateId, eventId);

        let q = supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId);
        if (safeSessionId) q = q.eq('session_id', safeSessionId);
        else q = q.is('session_id', null);
        
        const { data: existing } = await q.maybeSingle();
        if (existing) return { success: true, message: 'Already Verified', code };

        const { error } = await supabase.from('checkins').insert({
            event_id: eventId, delegate_id: delegateId, session_id: safeSessionId,
            checked_in_by: registrar.id, checked_in_at: new Date().toISOString()
        });

        if (error) return handleSupabaseError({ error }, "Check-in Failed");
        return { success: true, message: 'Verified', code };
    },

    checkInByCode: async (eventId: string, code: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, district');
        const match = delegates?.find(d => generateCodeFromId(d.delegate_id, eventId) === code);
        
        if (!match) return { success: false, message: 'Invalid code.' };
        
        if (registrar.role === UserRole.REGISTRAR && registrar.district) {
            const regDist = normalize(registrar.district).toUpperCase();
            const delDist = normalize(match.district).toUpperCase();
            if (regDist !== delDist) {
                return { success: false, message: 'District Mismatch.' };
            }
        }
        
        return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
    },

    registerDelegate: async (delegate: Partial<Delegate>): Promise<Delegate> => {
        const phone = normalize(delegate.phone);
        const { data: existing } = await supabase.from('delegates').select('*').eq('phone', phone).maybeSingle();
        if (existing) return existing;

        const { data, error } = await supabase.from('delegates').insert({
            title: normalize(delegate.title), 
            first_name: normalize(delegate.first_name), 
            last_name: normalize(delegate.last_name),
            district: normalize(delegate.district), 
            chapter: normalize(delegate.chapter), 
            phone: phone,
            email: normalize(delegate.email), 
            rank: delegate.rank || 'CP', 
            office: delegate.office || 'OTHER'
        }).select().single();

        if (error) throw error;
        return data;
    },

    importDelegates: async (csv: string): Promise<number> => {
        const lines = csv.trim().split('\n').map(l => l.split(',').map(p => p.trim())).filter(p => p.length >= 3);
        if (lines.length === 0) return 0;
        
        const payload = lines.map(p => ({
            title: normalize(p[0] || 'Mr'), 
            first_name: normalize(p[1]), 
            last_name: normalize(p[2]), 
            district: normalize(p[3] || ''),
            chapter: normalize(p[4] || ''), 
            phone: normalize(p[5] || ''), 
            email: normalize(p[6] || ''), 
            rank: normalize(p[7] || 'CP'), 
            office: normalize(p[8] || 'OTHER')
        }));
        
        const { data, error } = await supabase.from('delegates').insert(payload).select();
        if (error) throw error;
        return data?.length || 0;
    },

    getStats: async (eventId: string, district?: string): Promise<DashboardStats> => {
        const { data: checkinsRaw } = await supabase
            .from('checkins')
            .select('*, delegates(*)')
            .eq('event_id', eventId)
            .is('session_id', null)
            .order('checked_in_at', { ascending: false });

        const { data: delegates } = await supabase.from('delegates').select('*');
        const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
        
        const filter = district ? normalize(district).toUpperCase() : null;
        const filteredDelegates = delegates?.filter(d => !filter || normalize(d.district).toUpperCase() === filter) || [];
        
        const recentActivity: CheckIn[] = (checkinsRaw || [])
            .filter(c => !filter || (c.delegates && normalize(c.delegates.district).toUpperCase() === filter))
            .slice(0, 15)
            .map(c => ({
                checkin_id: c.checkin_id,
                event_id: c.event_id,
                delegate_id: c.delegate_id,
                session_id: c.session_id,
                checked_in_at: c.checked_in_at,
                checked_in_by: c.checked_in_by,
                delegate_name: c.delegates ? `${c.delegates.first_name} ${c.delegates.last_name}` : 'Unknown',
                district: c.delegates?.district || 'Unknown',
                rank: c.delegates?.rank || '-',
                office: c.delegates?.office || '-'
            }));

        const attendedIds = new Set((checkinsRaw || []).map(c => c.delegate_id));
        const attendedDelegates = filteredDelegates.filter(d => attendedIds.has(d.delegate_id));

        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        attendedDelegates.forEach(d => {
            const r = normalize(d.rank);
            const dst = normalize(d.district);
            rankCounts[r] = (rankCounts[r] || 0) + 1;
            districtCounts[dst] = (districtCounts[dst] || 0) + 1;
        });

        return {
            totalDelegates: filteredDelegates.length,
            totalCheckIns: attendedDelegates.length,
            totalFinancials: financials?.reduce((s, f) => s + (Number(f.amount) || 0), 0) || 0,
            checkInsByRank: rankCounts,
            checkInsByDistrict: districtCounts,
            recentActivity
        };
    },

    getAllDataForExport: async (eventId: string): Promise<any> => {
        const [d, c, f, p] = await Promise.all([
            supabase.from('delegates').select('*'),
            supabase.from('checkins').select('*').eq('event_id', eventId),
            supabase.from('financial_entries').select('*').eq('event_id', eventId),
            supabase.from('pledges').select('*').eq('event_id', eventId)
        ]);
        return { delegates: d.data || [], checkins: c.data || [], financials: f.data || [], pledges: p.data || [] };
    },

    searchPledges: async (query: string, eventId: string, district?: string): Promise<Pledge[]> => {
        let q = supabase.from('pledges').select('*').eq('event_id', eventId);
        if (district) q = q.ilike('district', normalize(district));
        if (query) q = q.ilike('donor_name', `%${query}%`);
        const { data } = await q;
        return data || [];
    },

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => 
        handleSupabaseError(await supabase.from('financial_entries').insert(entry).select().single()),

    createPledge: async (pledge: Partial<Pledge>) => 
        handleSupabaseError(await supabase.from('pledges').insert({
            ...pledge,
            district: normalize(pledge.district),
            chapter: normalize(pledge.chapter)
        }).select().single()),

    clearEventData: async (eventId: string) => {
        await supabase.from('checkins').delete().eq('event_id', eventId);
        await supabase.from('financial_entries').delete().eq('event_id', eventId);
        await supabase.from('pledges').delete().eq('event_id', eventId);
    },

    deleteDelegatesByDistrict: async (district: string): Promise<number> => {
        const { data, error } = await supabase.from('delegates').delete().ilike('district', normalize(district)).select();
        if (error) throw error;
        return data?.length || 0;
    },

    deleteDelegatesByScope: async (scope: string) => {
        if (scope === 'all') {
            await supabase.from('checkins').delete().neq('checkin_id', '00000000-0000-0000-0000-000000000000');
            await supabase.from('delegates').delete().neq('delegate_id', '00000000-0000-0000-0000-000000000000');
        }
    },

    harmonizeDistricts: async (): Promise<number> => {
        let count = 0;
        const { data: settingsData } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        if (!settingsData) return 0;
        
        const officialDistrictsList = settingsData.districts || [];
        const cleanedOfficialList = officialDistrictsList.map(d => normalize(d));

        // SELF-HEAL: Ensure System Settings itself is cleaned first
        if (JSON.stringify(officialDistrictsList) !== JSON.stringify(cleanedOfficialList)) {
            await supabase.from('system_settings').update({ districts: cleanedOfficialList }).eq('id', settingsData.id);
        }

        const [delegatesRes, pledgesRes] = await Promise.all([
            supabase.from('delegates').select('delegate_id, district'),
            supabase.from('pledges').select('id, district')
        ]);
        
        const delegates = delegatesRes.data || [];
        const pledges = pledgesRes.data || [];

        for (const d of delegates) {
            const currentDist = d.district || '';
            const normalizedDist = normalize(currentDist);
            const matchedOfficial = cleanedOfficialList.find(o => o.toUpperCase() === normalizedDist.toUpperCase());
            const targetDist = matchedOfficial || normalizedDist;

            if (targetDist !== currentDist) {
                const { error } = await supabase.from('delegates').update({ district: targetDist }).eq('delegate_id', d.delegate_id);
                if (!error) count++;
            }
        }

        for (const p of pledges) {
            const currentDist = p.district || '';
            const normalizedDist = normalize(currentDist);
            const matchedOfficial = cleanedOfficialList.find(o => o.toUpperCase() === normalizedDist.toUpperCase());
            const targetDist = matchedOfficial || normalizedDist;

            if (targetDist !== currentDist) {
                const { error } = await supabase.from('pledges').update({ district: targetDist }).eq('id', p.id);
                if (!error) count++;
            }
        }
        return count;
    },

    deduplicateDelegates: async (): Promise<number> => {
        const { data: delegates } = await supabase.from('delegates').select('*');
        if (!delegates) return 0;
        const seenKeys = new Set<string>();
        const duplicatesToDelete: string[] = [];
        for (const d of delegates) {
            const uniquenessKey = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.phone)}`.toUpperCase();
            if (seenKeys.has(uniquenessKey)) {
                duplicatesToDelete.push(d.delegate_id);
            } else {
                seenKeys.add(uniquenessKey);
            }
        }
        if (duplicatesToDelete.length > 0) {
            const batchSize = 50;
            for (let i = 0; i < duplicatesToDelete.length; i += batchSize) {
                const batch = duplicatesToDelete.slice(i, i + batchSize);
                await supabase.from('delegates').delete().in('delegate_id', batch);
            }
        }
        return duplicatesToDelete.length;
    }
};
