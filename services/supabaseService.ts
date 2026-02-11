import { supabase } from './supabaseClient';
import { User, UserRole, Delegate, Event, Session, SystemSettings, CheckInResult, Pledge, FinancialEntry, DashboardStats, CheckIn, FinancialType } from '../types';
import { generateCodeFromId } from './utils';

const normalize = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> => {
    return Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
    ]);
};

const handleSupabaseError = (res: any, customMessage?: string) => {
    if (res.error) {
        console.error("Supabase Internal Error:", res.error);
        const msg = res.error.message || "Unknown Database Error";
        if (msg.includes('jwt expired') || msg.includes('invalid token')) {
            localStorage.clear();
            window.location.reload(); 
            throw new Error("SESSION_EXPIRED");
        }
        throw new Error(customMessage ? `${customMessage}: ${msg}` : msg);
    }
    return res.data;
};

export const auth = {
    getOrCreateProfile: async (authId: string, email: string): Promise<User> => {
        try {
            const { data, error } = await supabase.from('app_users').select('*').eq('id', authId).maybeSingle();
            if (data) return data as User;

            const { data: newProfile, error: createError } = await supabase
                .from('app_users')
                .upsert({ id: authId, email, role: UserRole.REGISTRAR }, { onConflict: 'id' })
                .select().single();

            if (createError) throw createError;
            return newProfile as User;
        } catch (err) {
            return { id: authId, email, role: UserRole.REGISTRAR };
        }
    },

    login: async (email: string, password: string): Promise<User | null> => {
        const { data: authData, error: authError } = await withTimeout<any>(
            supabase.auth.signInWithPassword({ email: normalize(email), password }), 
            15000, 
            "Login Timeout"
        );
        if (authError) throw new Error(authError.message);
        if (!authData.user) return null;
        return await auth.getOrCreateProfile(authData.user.id, authData.user.email || email);
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
        return data || { titles: ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'], districts: [], ranks: [], offices: [], regions: [] };
    },

    updateSettings: async (settings: SystemSettings, field?: keyof SystemSettings): Promise<SystemSettings> => {
        const { data: current } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        let payload: any = field ? { [field]: settings[field] } : settings;
        if (current) {
            const { data, error } = await supabase.from('system_settings').update(payload).eq('id', current.id).select().single();
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

    createUser: async (user: Omit<User, 'id'>, password: string) => 
        handleSupabaseError(await supabase.rpc('create_app_user', { email: normalize(user.email), password, role: user.role.toLowerCase(), district: user.district })),

    updateUser: async (userId: string, updates: Partial<User>) => 
        handleSupabaseError(await supabase.from('app_users').update(updates).eq('id', userId)),

    deleteUser: async (userId: string) => 
        handleSupabaseError(await supabase.rpc('delete_app_user', { user_id_to_delete: userId })),

    resetUserPassword: async (userId: string, newPassword: string) => 
        handleSupabaseError(await supabase.rpc('reset_user_password', { user_id: userId, new_password: newPassword })),

    searchDelegates: async (query: string, eventId: string, district?: string, sessionId?: string): Promise<(Delegate & { checkedIn: boolean, code?: string })[]> => {
        if (!eventId) return [];
        let q = supabase.from('delegates').select('*');
        if (district) q = q.ilike('district', normalize(district));
        if (query.length > 1) q = q.or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,phone.ilike.%${query}%`);
        const { data: delegates, error } = await q.limit(100);
        if (error) throw error;
        if (!delegates || delegates.length === 0) return [];

        let cq = supabase.from('checkins').select('delegate_id').eq('event_id', eventId).in('delegate_id', delegates.map(d => d.delegate_id));
        if (sessionId) cq = cq.eq('session_id', sessionId);
        else cq = cq.is('session_id', null);
        const { data: checkins } = await cq;
        const checkedInSet = new Set(checkins?.map(c => c.delegate_id) || []);
        return delegates.map(d => ({ ...d, checkedIn: checkedInSet.has(d.delegate_id), code: d.code || generateCodeFromId(d.delegate_id, eventId) }));
    },

    getAllDelegates: async (): Promise<Delegate[]> => {
        let all: Delegate[] = [];
        let from = 0;
        while (true) {
            const { data, error } = await supabase.from('delegates').select('*').range(from, from + 999).order('created_at', { ascending: false });
            if (error || !data || data.length === 0) break;
            all = [...all, ...data];
            if (data.length < 1000) break;
            from += 1000;
            if (from > 40000) break;
        }
        return all;
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
        const safeSessionId = sessionId || null;
        const { data: existing } = await supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).eq('session_id', safeSessionId as any).maybeSingle();
        if (existing) return { success: true, message: 'Already Verified', code: generateCodeFromId(delegateId, eventId) };
        const { error } = await supabase.from('checkins').insert({ event_id: eventId, delegate_id: delegateId, session_id: safeSessionId, checked_in_by: registrar.id });
        if (error) throw error;
        return { success: true, message: 'Verified', code: generateCodeFromId(delegateId, eventId) };
    },

    checkInByCode: async (eventId: string, code: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').limit(5000);
        const match = delegates?.find(d => generateCodeFromId(d.delegate_id, eventId) === code);
        if (!match) return { success: false, message: 'Invalid code.' };
        return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
    },

    registerDelegate: async (delegate: Partial<Delegate>): Promise<Delegate> => {
        const { data, error } = await supabase.from('delegates').insert(delegate).select().single();
        if (error) throw error;
        return data;
    },

    importDelegates: async (csv: string): Promise<number> => {
        const lines = csv.trim().split('\n').map(l => l.split(',').map(p => p.trim())).filter(p => p.length >= 3);
        const payload = lines.map(p => ({ title: p[0], first_name: p[1], last_name: p[2], district: p[3], chapter: p[4], phone: p[5], email: p[6], rank: p[7] || 'CP', office: p[8] || 'OTHER' }));
        const { data, error } = await supabase.from('delegates').insert(payload).select();
        if (error) throw error;
        return data?.length || 0;
    },

    getStats: async (eventId: string, district?: string): Promise<DashboardStats> => {
        const filter = district ? normalize(district).toUpperCase() : null;
        
        // 1. Total Delegates Count (Scoped)
        let delegatesQuery = supabase.from('delegates').select('*', { count: 'exact', head: true });
        if (filter) delegatesQuery = delegatesQuery.ilike('district', filter);
        const { count: totalDelegatesCount } = await delegatesQuery;

        // 2. EXHAUSTIVE PAGINATED SCAN for Attendance & Chart Data
        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        
        // --- IDENTITY-BASED DEDUPLICATION (Aligned with Reports Matrix) ---
        // Instead of delegate_id, we use Name+District+Rank to define a unique person.
        const seenIdentities = new Set<string>();
        const recentActivity: CheckIn[] = [];
        let from = 0;

        while (true) {
            const { data, error } = await supabase.from('checkins')
                .select('*, delegates(*)')
                .eq('event_id', eventId)
                .order('checked_in_at', { ascending: false })
                .range(from, from + 999);

            if (error || !data || data.length === 0) break;

            data.forEach(c => {
                if (!c.delegates) return;
                const d = c.delegates;
                
                // Security/District filtering
                if (filter && normalize(d.district).toUpperCase() !== filter) return;
                
                // Generate Physical Identity Key
                const identityKey = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.district)}|${normalize(d.rank)}`.toUpperCase();
                
                // Only count the physical person once for headcounts and charts
                if (!seenIdentities.has(identityKey)) {
                    seenIdentities.add(identityKey);
                    
                    // Update Chart Accumulators based on the unique identity
                    const r = d.rank || 'OTHER';
                    const dist = d.district || 'UNKNOWN';
                    rankCounts[r] = (rankCounts[r] || 0) + 1;
                    districtCounts[dist] = (districtCounts[dist] || 0) + 1;

                    // Recent Activity (Individual Check-in transactions still appear here, but we limit to unique feed)
                    if (recentActivity.length < 10) {
                        recentActivity.push({
                            checkin_id: c.checkin_id, 
                            event_id: c.event_id, 
                            delegate_id: c.delegate_id, 
                            session_id: c.session_id, 
                            checked_in_at: c.checked_in_at, 
                            checked_in_by: c.checked_in_by,
                            delegate_name: `${d.first_name} ${d.last_name}`,
                            district: d.district || 'Unknown', 
                            rank: d.rank || '-', 
                            office: d.office || '-'
                        });
                    }
                }
            });

            if (data.length < 1000) break;
            from += 1000;
            if (from > 50000) break;
        }

        // 3. Total Financials (Scoped)
        let financialsSum = 0;
        if (filter) {
            const { data: distPledges } = await supabase.from('pledges').select('id').eq('event_id', eventId).ilike('district', filter);
            const pledgeIds = (distPledges || []).map(p => p.id);
            if (pledgeIds.length > 0) {
                const { data: distFinancials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId).in('pledge_id', pledgeIds);
                financialsSum = (distFinancials || []).reduce((s, f) => s + (Number(f.amount) || 0), 0);
            }
        } else {
            const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
            financialsSum = financials?.reduce((s, f) => s + (Number(f.amount) || 0), 0) || 0;
        }

        return {
            totalDelegates: totalDelegatesCount || 0,
            totalCheckIns: seenIdentities.size, // This now matches the unique headcount in reports
            totalFinancials: financialsSum,
            checkInsByRank: rankCounts,
            checkInsByDistrict: districtCounts,
            recentActivity: recentActivity
        };
    },

    getAllDataForExport: async (eventId: string): Promise<any> => {
        const fetchAll = async (table: string, eventIdFilter?: string) => {
            let results: any[] = [];
            let from = 0;
            while (true) {
                let q = supabase.from(table).select('*').range(from, from + 999);
                if (eventIdFilter) q = q.eq('event_id', eventIdFilter);
                if (table === 'checkins') q = q.order('checked_in_at', { ascending: false });
                const { data, error } = await q;
                if (error || !data || data.length === 0) break;
                results = [...results, ...data];
                if (data.length < 1000) break;
                from += 1000;
                if (from > 40000) break;
            }
            return results;
        };

        const [d, c, f, p] = await Promise.all([ fetchAll('delegates'), fetchAll('checkins', eventId), fetchAll('financial_entries', eventId), fetchAll('pledges', eventId) ]);
        return { delegates: d, checkins: c, financials: f, pledges: p };
    },

    searchPledges: async (query: string, eventId: string, district?: string): Promise<Pledge[]> => {
        let q = supabase.from('pledges').select('*').eq('event_id', eventId);
        if (district) q = q.ilike('district', normalize(district));
        if (query) q = q.ilike('donor_name', `%${query}%`);
        const { data } = await q.limit(500);
        return data || [];
    },

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => handleSupabaseError(await supabase.from('financial_entries').insert(entry).select().single()),
    createPledge: async (pledge: Partial<Pledge>) => handleSupabaseError(await supabase.from('pledges').insert(pledge).select().single()),
    clearEventData: async (eventId: string) => { await supabase.from('checkins').delete().eq('event_id', eventId); await supabase.from('financial_entries').delete().eq('event_id', eventId); await supabase.from('pledges').delete().eq('event_id', eventId); },
    deleteDelegatesByDistrict: async (district: string) => { const { data } = await supabase.from('delegates').delete().ilike('district', normalize(district)).select(); return data?.length || 0; },
    deleteDelegatesByScope: async (scope: string) => { if (scope === 'all') { await supabase.from('checkins').delete().neq('checkin_id', '0'); await supabase.from('delegates').delete().neq('delegate_id', '0'); } },
    
    harmonizeDistricts: async () => {
        const { data: settings } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        if (!settings) return 0;
        
        const official = (settings.districts || []).map(d => normalize(d));
        await supabase.from('system_settings').update({ districts: official }).eq('id', settings.id);
        
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').limit(10000);
        let count = 0;
        
        for (const d of (delegates || [])) {
            const currentDist = d.district || '';
            const normDist = normalize(currentDist);
            const matched = official.find(o => o.toUpperCase() === normDist.toUpperCase());
            if (matched && matched !== currentDist) {
                await supabase.from('delegates').update({ district: matched }).eq('delegate_id', d.delegate_id);
                count++;
            }
        }
        return count;
    },
    
    deduplicateDelegates: async () => {
        const { data } = await supabase.from('delegates').select('*').limit(10000);
        if (!data) return 0;
        const seen = new Set();
        const dups = [];
        for (const d of data) {
            const key = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.phone)}`.toUpperCase();
            if (seen.has(key)) dups.push(d.delegate_id);
            else seen.add(key);
        }
        if (dups.length > 0) await supabase.from('delegates').delete().in('delegate_id', dups);
        return dups.length;
    }
};