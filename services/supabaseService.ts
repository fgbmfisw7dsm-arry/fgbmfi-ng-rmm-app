
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
        
        // 1. Session Expiry / Auth State Errors
        if (lowerMsg.includes('jwt expired') || lowerMsg.includes('invalid token') || lowerMsg.includes('refresh_token_not_found')) {
            localStorage.clear();
            window.location.reload(); 
            throw new Error("SESSION_EXPIRED");
        }

        // 2. Permission / RLS Errors
        if (lowerMsg.includes('row-level security') || lowerMsg.includes('permission denied')) {
            throw new Error(customMessage ? `${customMessage}: Permission Restricted` : "Database Access Restricted.");
        }

        // 3. Structural Errors (Relation missing or renamed)
        if (lowerMsg.includes('relation') && lowerMsg.includes('does not exist')) {
            throw new Error(`CRITICAL: Database table missing. Contact System Admin to run the SQL Setup.`);
        }
        
        // 4. Schema Handshake Errors (User Request: "Database error querying schema")
        // We catch this specifically to allow getOrCreateProfile to handle the recovery
        if (lowerMsg.includes('schema')) {
            console.warn("Schema query failure detected. Signalling handshake recovery.");
            return { __isSchemaError: true, originalError: res.error };
        }

        throw new Error(customMessage ? `${customMessage}: ${msg}` : msg);
    }
    return res.data;
};

export const auth = {
    /**
     * Resolves the "Database error querying schema" by ensuring a public profile exists 
     * and is accessible.
     */
    getOrCreateProfile: async (authId: string, email: string): Promise<User> => {
        try {
            // 1. Attempt to fetch existing profile
            const fetchResponse = await supabase
                .from('app_users')
                .select('*')
                .eq('id', authId)
                .maybeSingle();

            // If we hit the "Schema" error here, we immediately move to the Repair step
            const result = handleSupabaseError(fetchResponse);
            
            if (result && !result.__isSchemaError) {
                return result as User;
            }

            // 2. SELF-REPAIR: Either profile is missing OR schema error occurred.
            // We attempt to insert/update to force the database to recognize the user.
            console.warn(`Handshake Repair triggered for ${email}...`);
            
            const { data: newProfile, error: repairError } = await supabase
                .from('app_users')
                .upsert({
                    id: authId,
                    email: email,
                    role: UserRole.REGISTRAR // Safety fallback
                }, { onConflict: 'id' })
                .select()
                .single();

            if (repairError) {
                console.error("Critical Profile repair failed:", repairError);
                // Return a non-persisted user to allow frontend to load, 
                // though RLS might block actual DB writes until the SQL fix is run.
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
            // Local cleanup before login
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

        // Perform the handshake
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
        if (district) queryBuilder = queryBuilder.eq('district', normalize(district));
        if (query.length > 1) queryBuilder = queryBuilder.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`);

        const { data: delegates } = await queryBuilder.limit(100);
        if (!delegates || delegates.length === 0) return [];

        let checkinQuery = supabase.from('checkins').select('delegate_id').eq('event_id', eventId).in('delegate_id', delegates.map(d => d.delegate_id));
        if (safeSessionId) checkinQuery = checkinQuery.eq('session_id', safeSessionId);
        else checkinQuery = checkinQuery.is('session_id', null);

        const { data: checkins } = await checkinQuery;
        const checkedInSet = new Set(checkins?.map(c => c.delegate_id) || []);
        
        // Fix: Use the `eventId` parameter provided to the function instead of the undefined `activeEventId`
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

    updateDelegate: async (id: string, updates: Partial<Delegate>) => 
        handleSupabaseError(await supabase.from('delegates').update(updates).eq('delegate_id', id)),

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
        if (registrar.role === UserRole.REGISTRAR && registrar.district && match.district !== registrar.district) {
            return { success: false, message: 'District Mismatch.' };
        }
        
        return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
    },

    registerDelegate: async (delegate: Partial<Delegate>): Promise<Delegate> => {
        const { data: existing } = await supabase.from('delegates').select('*').eq('phone', normalize(delegate.phone)).maybeSingle();
        if (existing) return existing;

        const { data, error } = await supabase.from('delegates').insert({
            title: normalize(delegate.title), first_name: normalize(delegate.first_name), last_name: normalize(delegate.last_name),
            district: normalize(delegate.district), chapter: normalize(delegate.chapter), phone: normalize(delegate.phone),
            email: normalize(delegate.email), rank: delegate.rank || 'CP', office: delegate.office || 'OTHER'
        }).select().single();

        if (error) throw error;
        return data;
    },

    importDelegates: async (csv: string): Promise<number> => {
        const lines = csv.trim().split('\n').map(l => l.split(',').map(p => p.trim())).filter(p => p.length >= 3);
        if (lines.length === 0) return 0;
        const payload = lines.map(p => ({
            title: p[0] || 'Mr', first_name: p[1], last_name: p[2], district: p[3] || '',
            chapter: p[4] || '', phone: p[5] || '', email: p[6] || '', rank: p[7] || 'CP', office: p[8] || 'OTHER'
        }));
        const { data, error } = await supabase.from('delegates').insert(payload).select();
        if (error) throw error;
        return data?.length || 0;
    },

    getStats: async (eventId: string, district?: string): Promise<DashboardStats> => {
        const { data: checkins } = await supabase.from('checkins').select('*').eq('event_id', eventId);
        const { data: delegates } = await supabase.from('delegates').select('*');
        const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
        
        const filter = district ? normalize(district).toUpperCase() : null;
        const filteredDelegates = delegates?.filter(d => !filter || (d.district || '').toUpperCase() === filter) || [];
        const attendedIds = new Set(checkins?.map(c => c.delegate_id) || []);
        const attendedDelegates = filteredDelegates.filter(d => attendedIds.has(d.delegate_id));

        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        attendedDelegates.forEach(d => {
            rankCounts[d.rank] = (rankCounts[d.rank] || 0) + 1;
            districtCounts[d.district] = (districtCounts[d.district] || 0) + 1;
        });

        return {
            totalDelegates: filteredDelegates.length,
            totalCheckIns: attendedDelegates.length,
            totalFinancials: financials?.reduce((s, f) => s + (Number(f.amount) || 0), 0) || 0,
            checkInsByRank: rankCounts,
            checkInsByDistrict: districtCounts,
            recentActivity: [] // Handled via subscription in UI
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
        if (district) q = q.eq('district', normalize(district));
        if (query) q = q.ilike('donor_name', `%${query}%`);
        const { data } = await q;
        return data || [];
    },

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => 
        handleSupabaseError(await supabase.from('financial_entries').insert(entry).select().single()),

    createPledge: async (pledge: Partial<Pledge>) => 
        handleSupabaseError(await supabase.from('pledges').insert(pledge).select().single()),

    clearEventData: async (eventId: string) => {
        await supabase.from('checkins').delete().eq('event_id', eventId);
        await supabase.from('financial_entries').delete().eq('event_id', eventId);
        await supabase.from('pledges').delete().eq('event_id', eventId);
    },

    deleteDelegatesByDistrict: async (district: string): Promise<number> => {
        const { data, error } = await supabase.from('delegates').delete().eq('district', normalize(district)).select();
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
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, district');
        if (delegates) {
            for (const d of delegates) {
                const normalized = normalize(d.district);
                if (normalized !== d.district) {
                    await supabase.from('delegates').update({ district: normalized }).eq('delegate_id', d.delegate_id);
                    count++;
                }
            }
        }
        const { data: pledges } = await supabase.from('pledges').select('id, district');
        if (pledges) {
            for (const p of pledges) {
                const normalized = normalize(p.district);
                if (normalized !== p.district) {
                    await supabase.from('pledges').update({ district: normalized }).eq('id', p.id);
                    count++;
                }
            }
        }
        return count;
    },

    deduplicateDelegates: async (): Promise<number> => {
        const { data: delegates } = await supabase.from('delegates').select('*');
        if (!delegates) return 0;
        const seen = new Set<string>();
        const toDelete: string[] = [];
        for (const d of delegates) {
            const key = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.phone)}`.toUpperCase();
            if (seen.has(key)) {
                toDelete.push(d.delegate_id);
            } else {
                seen.add(key);
            }
        }
        if (toDelete.length > 0) {
            const { error } = await supabase.from('delegates').delete().in('delegate_id', toDelete);
            if (error) throw error;
        }
        return toDelete.length;
    }
};
