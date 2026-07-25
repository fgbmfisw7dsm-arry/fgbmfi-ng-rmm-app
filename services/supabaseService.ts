
import { supabase } from './supabaseClient';
import { User, UserRole, Delegate, Event, Session, SystemSettings, CheckInResult, Pledge, FinancialEntry, DashboardStats, CheckIn, FinancialType } from '../types';
import { generateCodeFromId, generateQrHash } from './utils';

/**
 * Normalizes email for transmission. 
 */
const normalizeEmail = (val?: string) => (val || '').trim().toLowerCase();
const normalize = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();

const handleSupabaseError = (res: any, customMessage?: string) => {
    if (res.error) {
        console.error("Supabase Database Error:", res.error);
        const msg = res.error.message || "Unknown Database Error";
        
        if (msg.includes('Failed to fetch') || msg.toLowerCase().includes('network error')) {
            throw new Error("Connection failed. Check your data signal.");
        }

        if (msg.includes('jwt expired') || msg.includes('invalid token')) {
            localStorage.clear();
            window.location.reload(); 
            throw new Error("SESSION_EXPIRED");
        }
        throw new Error(customMessage ? `${customMessage}: ${msg}` : msg);
    }
    return res.data;
};

// Lifecycle Guard: Checks if an event is active before allowing writes

const withRetry = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: any;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (e.message === 'SESSION_EXPIRED' || e.message?.startsWith('EVENT_LOCKED')) throw e;
      if (attempt < maxRetries && (e.message?.includes('Connection failed') || e.message?.includes('network error') || e.message?.includes('Failed to fetch'))) {
        await new Promise(resolve => setTimeout(resolve, baseDelay * attempt));
        continue;
      }
      throw e;
    }
  }
  throw lastError;
};
const ensureEventActive = async (eventId: string) => {
    const { data, error } = await supabase.from('events').select('is_active').eq('event_id', eventId).single();
    if (error) {
        console.warn("Lifecycle guard check failed (likely column missing):", error);
        return; 
    }
    if (data && data.is_active === false) {
        throw new Error("EVENT_LOCKED: This event is currently inactive (Read-Only).");
    }
};

export const auth = {
    getOrCreateProfile: async (authId: string, email: string): Promise<User> => {
        try {
            const { data, error } = await supabase.from('app_users').select('*').eq('id', authId).maybeSingle();
            if (data) return data as User;

            const { data: newProfile, error: createError } = await supabase
                .from('app_users')
                .upsert({ id: authId, email: normalizeEmail(email), role: UserRole.REGISTRAR }, { onConflict: 'id' })
                .select().single();

            if (createError) throw createError;
            return newProfile as User;
        } catch (err) {
            return { id: authId, email: normalizeEmail(email), role: UserRole.REGISTRAR };
        }
    },

    login: async (email: string, password: string): Promise<User | null> => {
        try {
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ 
                email: normalizeEmail(email), 
                password 
            });
            
            if (authError) {
                if (authError.message.includes('Invalid login credentials')) throw new Error("INVALID_CREDENTIALS");
                throw new Error(authError.message);
            }
            
            if (!authData.user) return null;
            return await auth.getOrCreateProfile(authData.user.id, authData.user.email || email);
        } catch (e: any) {
            throw e;
        }
    }
};

export const db = {
    getEvents: async (): Promise<Event[]> => 
        handleSupabaseError(await supabase.from('events').select('*').order('start_date', { ascending: false })),

    createEvent: async (event: Omit<Event, 'event_id'>) => 
        handleSupabaseError(await supabase.from('events').insert({ ...event, is_active: true }).select().single()),

    updateEvent: async (id: string, updates: Partial<Event>) => {
        console.log(`DB-SERVICE: Executing Update for Event ${id}`, updates);
        // We perform the update without .select() first to ensure we aren't blocked by SELECT RLS policies
        const { error } = await supabase.from('events').update(updates).eq('event_id', id);
        if (error) {
            console.error("Supabase Update Failed:", error);
            throw error;
        }
        return { event_id: id, ...updates };
    },

    deleteEvent: async (id: string) => 
        handleSupabaseError(await supabase.from('events').delete().eq('event_id', id)),

    getSessions: async (eventId: string): Promise<Session[]> => {
        if (!eventId) return [];
        const { data } = await supabase.from('sessions').select('*').eq('event_id', eventId).order('start_time');
        return data || [];
    },

    createSession: async (session: Omit<Session, 'session_id'>) => {
        await ensureEventActive(session.event_id);
        return handleSupabaseError(await supabase.from('sessions').insert(session).select().single());
    },

    updateSession: async (id: string, updates: Partial<Session>) => {
        const { data: existing } = await supabase.from('sessions').select('event_id').eq('session_id', id).single();
        if (existing) await ensureEventActive(existing.event_id);
        return handleSupabaseError(await supabase.from('sessions').update(updates).eq('session_id', id).select().single());
    },

    deleteSession: async (id: string) => {
        const { data: existing } = await supabase.from('sessions').select('event_id').eq('session_id', id).single();
        if (existing) await ensureEventActive(existing.event_id);
        return handleSupabaseError(await supabase.from('sessions').delete().eq('session_id', id));
    },

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
        handleSupabaseError(await supabase.rpc('create_app_user', { email: normalizeEmail(user.email), password, role: user.role.toLowerCase(), district: user.district })),

    updateUser: async (userId: string, updates: Partial<User>) => 
        handleSupabaseError(await supabase.from('app_users').update(updates).eq('id', userId).select().single()),

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
        return delegates.map(d => ({ ...d, checkedIn: checkedInSet.has(d.delegate_id), qr_hash: d.qr_hash || '', code: d.code || generateCodeFromId(d.delegate_id, eventId) }));
    },

    getAllDelegates: async (): Promise<Delegate[]> => {
        const results: Delegate[] = [];
        let page = 1;
        const pageSize = 500;
        while (true) {
            const { data } = await supabase.rpc('get_paginated_delegates', {
                p_page: page, p_page_size: pageSize,
                p_search: null, p_district: null,
            });
            const parsed = data as any;
            if (!parsed?.data || parsed.data.length === 0) break;
            results.push(...parsed.data);
            if (parsed.data.length < pageSize) break;
            page++;
        }
        return results;
    },

    getPaginatedDelegates: async (page: number = 1, pageSize: number = 50, search?: string, district?: string): Promise<{ data: Delegate[]; total: number; page: number; pageSize: number; totalPages: number }> => {
        try {
            const { data, error } = await supabase.rpc('get_paginated_delegates', {
                p_page: page, p_page_size: pageSize,
                p_search: search || null, p_district: district || null,
            });
            if (!error && data) return data as any;
        } catch {}

        let q = supabase.from('delegates').select('*', { count: 'exact' });
        if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
        if (district) q = q.ilike('district', normalize(district));
        const from = (page - 1) * pageSize;
        const { data: rows, count, error } = await q.order('first_name').range(from, from + pageSize - 1);
        if (error) throw error;
        return {
            data: (rows || []) as Delegate[],
            total: count || 0,
            page,
            pageSize,
            totalPages: Math.ceil((count || 0) / pageSize),
        };
    },

    updateDelegate: async (id: string, updates: Partial<Delegate>) => {
        const { name_display, delegate_id, created_at, ...validUpdates } = updates as any;
        return handleSupabaseError(await supabase.from('delegates').update({
            ...validUpdates,
            district: normalize(validUpdates.district),
            chapter: normalize(validUpdates.chapter)
        }).eq('delegate_id', id).select().single());
    },

    // Fix: Corrected variable name mismatch from event_id to eventId
    checkInDelegate: async (eventId: string, delegateId: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        return withRetry(async () => {
        await ensureEventActive(eventId);
        const safeSessionId = sessionId || null;
        const { data: existing } = await supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).eq('session_id', safeSessionId as any).maybeSingle();
        if (existing) {
            // Fetch the delegate's qr_hash for the response
            const { data: del } = await supabase.from('delegates').select('qr_hash').eq('delegate_id', delegateId).maybeSingle();
            return { success: true, message: 'Already Verified', code: generateCodeFromId(delegateId, eventId), delegate: { qr_hash: del?.qr_hash || '' } as any };
        }
        const { error } = await supabase.from('checkins').insert({ event_id: eventId, delegate_id: delegateId, session_id: safeSessionId, checked_in_by: registrar.id });
        if (error) throw error;
        const { data: del } = await supabase.from('delegates').select('qr_hash').eq('delegate_id', delegateId).maybeSingle();
        return { success: true, message: 'Verified', code: generateCodeFromId(delegateId, eventId), delegate: { qr_hash: del?.qr_hash || '' } as any };
        });
    },

    checkInByCode: async (eventId: string, code: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        await ensureEventActive(eventId);
        
        const parseQRData = (raw: string): Record<string, string> | null => {
            try {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    const result: Record<string, string> = {};
                    for (const [k, v] of Object.entries(parsed)) {
                        if (typeof v === 'string') result[k] = v;
                    }
                    return Object.keys(result).length > 0 ? result : null;
                }
            } catch {}
            
            const lines = raw.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length < 4) return null;
            
            const lastIdx = <T>(arr: T[], fn: (item: T, i: number) => boolean): number => {
                for (let i = arr.length - 1; i >= 0; i--) { if (fn(arr[i], i)) return i; }
                return -1;
            };
            const idIdx = lastIdx(lines, (l: string) => l.length >= 20);
            const typeIdx = lastIdx(lines, (l: string) => /^[A-Z][A-Z_]{3,}$/.test(l));
            
            if (idIdx < 0) return null;
            
            const result: Record<string, string> = {};
            result['delegate_id'] = lines[idIdx];
            if (typeIdx >= 0) result['delegate_type'] = lines[typeIdx];
            
            const others = lines.filter((_: string, i: number) => i !== idIdx && i !== typeIdx);
            
            const nameIdx = others.findIndex((l: string) => /\.\s/.test(l) || l.split(/\s+/).length >= 2);
            if (nameIdx >= 0) {
                const parts = others[nameIdx].split(/\s+/);
                if (parts[0].endsWith('.')) {
                    result['title'] = parts.shift()!;
                }
                if (parts.length >= 2) {
                    result['first_name'] = parts.slice(0, -1).join(' ');
                    result['last_name'] = parts[parts.length - 1];
                }
                others.splice(nameIdx, 1);
            }
            
            if (others.length >= 1) result['district'] = others[0];
            if (others.length >= 2) result['chapter'] = others[1];
            
            if (result['delegate_id'] && result['first_name'] && result['last_name'] && result['district']) {
                return result;
            }
            return null;
        };
        
        const parsedData = parseQRData(code);
        const lookupId = parsedData?.['delegate_id'] || parsedData?.['external_id'] || code;
        
        // Pass 1: UUID QR hash lookup (internal QR codes, use raw code)
        if (code.length > 10 && code !== lookupId) {
            const { data: match } = await supabase.from('delegates').select('delegate_id').eq('qr_hash', code).maybeSingle();
            if (match) return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
        }
        
        // Pass 2: External ID lookup (use extracted delegate ID, matches subsequent scans)
        if (lookupId.length > 4) {
            const { data: extMatch } = await supabase.from('delegates').select('delegate_id').eq('external_id', lookupId).maybeSingle();
            if (extMatch) return db.checkInDelegate(eventId, extMatch.delegate_id, registrar, sessionId);
        }
        
        // Pass 3: Delegate ID lookup
        if (lookupId.length > 4 && lookupId !== code) {
            const { data: idMatch } = await supabase.from('delegates').select('delegate_id').eq('delegate_id', lookupId).maybeSingle();
            if (idMatch) return db.checkInDelegate(eventId, idMatch.delegate_id, registrar, sessionId);
        }
        
        // Pass 4: 4-digit deterministic code fallback (legacy)
        if (code.length <= 10) {
            const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').limit(5000);
            const match = delegates?.find(d => generateCodeFromId(d.delegate_id, eventId) === code);
            if (match) return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
        }
        
        // Not found — return parsed data for confirmation form
        if (parsedData && parsedData['first_name'] && parsedData['last_name'] && parsedData['district']) {
            return { success: false, message: 'Confirm delegate details below.', needsRegistration: true, scannedCode: lookupId, parsedData };
        }
        
        if (lookupId.length > 4) {
            return { success: false, message: 'Delegate not found.', needsRegistration: true, scannedCode: lookupId, parsedData };
        }
        
        return { success: false, message: 'Invalid code.' };
    },

    registerDelegate: async (delegate: Partial<Delegate>): Promise<Delegate> => {
        const { data, error } = await supabase.from('delegates').insert({
            ...delegate,
            qr_hash: delegate.qr_hash || generateQrHash(),
            external_id: delegate.external_id || delegate.delegate_id,
            registration_source: delegate.registration_source || 'manual'
        }).select().single();
        if (error) throw error;
        return data;
    },

    registerDelegateFromQR: async (eventId: string, scannedCode: string, parsedData: Record<string, string>): Promise<Delegate> => {
        const record = {
            title: parsedData['title'] || '',
            first_name: parsedData['first_name'] || '',
            last_name: parsedData['last_name'] || '',
            district: parsedData['district'] || '',
            chapter: parsedData['chapter'] || '',
            phone: parsedData['phone'] || '',
            email: parsedData['email'] || '',
            rank: parsedData['rank'] || 'CP',
            office: parsedData['office'] || 'OTHER',
            room_number: parsedData['room_number'] || '',
            event_id: eventId,
            external_id: parsedData['delegate_id'] || parsedData['external_id'] || scannedCode,
            qr_hash: generateQrHash(),
            registration_source: 'qr_scan' as const
        };
        const { data, error } = await supabase.from('delegates').insert(record).select().single();
        if (error) throw error;
        return data;
    },

    importDelegates: async (csv: string, eventId?: string, onProgress?: (inserted: number, skipped: number, total: number) => void): Promise<{ inserted: number; skipped: number }> => {
        const lines = csv.trim().split('\n').map(l => l.split(',').map(p => p.trim())).filter(p => p.length >= 3);
        const BATCH_SIZE = 500;
        let inserted = 0;
        let skipped = 0;

        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            const batch = lines.slice(i, i + BATCH_SIZE);
            const payload = batch.map(p => ({
                title: p[0],
                first_name: p[1],
                last_name: p[2],
                district: p[3],
                chapter: p[4],
                phone: p[5],
                email: p[6],
                rank: p[7] || 'CP',
                office: p[8] || 'OTHER',
                qr_hash: generateQrHash(),
                event_id: eventId || null,
                registration_source: 'import'
            }));

            // Try the RPC first (server-side dedup, faster)
            try {
                const { data, error } = await supabase.rpc('import_delegates_batch', {
                    p_delegates: JSON.parse(JSON.stringify(payload))
                });
                if (error) throw error;
                inserted += data?.inserted || 0;
                skipped += data?.skipped || 0;
            } catch {
                // Fallback: direct insert with individual error handling
                for (const rec of payload) {
                    try {
                        const { error } = await supabase.from('delegates').insert(rec);
                        if (error) {
                            if (error.message?.includes('duplicate')) {
                                skipped++;
                            } else {
                                throw error;
                            }
                        } else {
                            inserted++;
                        }
                    } catch {
                        skipped++;
                    }
                }
            }

            if (onProgress) onProgress(inserted, skipped, lines.length);
        }

        return { inserted, skipped };
    },

    getStats: async (eventId: string, district?: string): Promise<DashboardStats> => {
        try {
            const { data, error } = await supabase.rpc('get_event_dashboard_stats', {
                p_event_id: eventId,
                p_district: district || null,
            });
            if (!error && data) return data as DashboardStats;
        } catch {}

        const filter = district ? normalize(district).toUpperCase() : null;
        let delegatesQuery = supabase.from('delegates').select('*', { count: 'exact', head: true });
        if (filter) delegatesQuery = delegatesQuery.ilike('district', filter);
        const { count: totalDelegatesCount } = await delegatesQuery;

        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        const seenIdentities = new Set<string>();
        const recentActivity: CheckIn[] = [];
        let from = 0;

        while (true) {
            const { data, error } = await supabase.from('checkins').select('*, delegates(*)').eq('event_id', eventId).order('checked_in_at', { ascending: false }).range(from, from + 999);
            if (error || !data || data.length === 0) break;
            data.forEach(c => {
                if (!c.delegates) return;
                const d = c.delegates;
                if (filter && normalize(d.district).toUpperCase() !== filter) return;
                const identityKey = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.district)}|${normalize(d.rank)}`.toUpperCase();
                if (!seenIdentities.has(identityKey)) {
                    seenIdentities.add(identityKey);
                    rankCounts[d.rank || 'OTHER'] = (rankCounts[d.rank || 'OTHER'] || 0) + 1;
                    districtCounts[d.district || 'UNKNOWN'] = (districtCounts[d.district || 'UNKNOWN'] || 0) + 1;
                    if (recentActivity.length < 10) {
                        recentActivity.push({
                            checkin_id: c.checkin_id, event_id: c.event_id, delegate_id: c.delegate_id, session_id: c.session_id, checked_in_at: c.checked_in_at, checked_in_by: c.checked_in_by,
                            delegate_name: `${d.first_name} ${d.last_name}`, district: d.district || 'Unknown', rank: d.rank || '-', office: d.office || '-'
                        });
                    }
                }
            });
            if (data.length < 1000) break;
            from += 1000;
        }

        let financialsSum = 0;
        const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
        financialsSum = financials?.reduce((s, f) => s + (Number(f.amount) || 0), 0) || 0;

        return { totalDelegates: totalDelegatesCount || 0, totalCheckIns: seenIdentities.size, totalFinancials: financialsSum, checkInsByRank: rankCounts, checkInsByDistrict: districtCounts, recentActivity: recentActivity };
    },

    getAllDataForExport: async (eventId: string): Promise<any> => {
        try {
            const { data, error } = await supabase.rpc('get_event_export_data', { p_event_id: eventId });
            if (!error && data) return data as any;
        } catch {}

        const fetchAll = async (table: string, eventIdFilter?: string) => {
            let results: any[] = [];
            let from = 0;
            while (true) {
                let q = supabase.from(table).select('*').range(from, from + 999);
                if (eventIdFilter) q = q.eq('event_id', eventIdFilter);
                if (table === 'checkins') q = q.order('checked_in_at', { ascending: true });
                const { data, error } = await q;
                if (error || !data || data.length === 0) break;
                results = [...results, ...data];
                if (data.length < 1000) break;
                from += 1000;
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

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => {
        if (entry.event_id) await ensureEventActive(entry.event_id);
        return handleSupabaseError(await supabase.from('financial_entries').insert(entry).select().single());
    },

    createPledge: async (pledge: Partial<Pledge>) => {
        if (pledge.event_id) await ensureEventActive(pledge.event_id);
        return handleSupabaseError(await supabase.from('pledges').insert(pledge).select().single());
    },

    clearEventData: async (eventId: string) => { 
        await ensureEventActive(eventId);
        await supabase.from('checkins').delete().eq('event_id', eventId); 
        await supabase.from('financial_entries').delete().eq('event_id', eventId); 
        await supabase.from('pledges').delete().eq('event_id', eventId); 
    },

    deleteDelegatesByDistrict: async (district: string) => { const { data } = await supabase.from('delegates').delete().ilike('district', normalize(district)).select(); return data?.length || 0; },
    deleteDelegatesByScope: async (scope: string) => { if (scope === 'all') { await supabase.from('checkins').delete().neq('checkin_id', '0'); await supabase.from('delegates').delete().neq('delegate_id', '0'); } },
    
    harmonizeDistricts: async () => {
        const { data: settings } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        if (!settings) return 0;
        const official = (settings.districts || []).map(d => normalize(d));
        const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').limit(5000);
        let count = 0;
        for (const d of (delegates || [])) {
            const matched = official.find(o => o.toUpperCase() === (d.district || '').trim().toUpperCase());
            if (matched && matched !== d.district) {
                await supabase.from('delegates').update({ district: matched }).eq('delegate_id', d.delegate_id);
                count++;
            }
        }
        return count;
    },
    
    deduplicateDelegates: async () => {
        const { data } = await supabase.from('delegates').select('*').limit(5000);
        if (!data) return 0;
        const seen = new Set();
        const dups = [];
        for (const d of data) {
            const key = `${normalize(d.first_name)}|${normalize(d.last_name)}|${normalize(d.phone)}`.toUpperCase();
            if (seen.has(key)) dups.push(d.delegate_id); else seen.add(key);
        }
        if (dups.length > 0) await supabase.from('delegates').delete().in('delegate_id', dups);
        return dups.length;
    },

    regenerateQrHash: async (delegateId: string): Promise<string> => {
        const newHash = generateQrHash();
        const { error } = await supabase.from('delegates').update({ qr_hash: newHash }).eq('delegate_id', delegateId);
        if (error) throw error;
        return newHash;
    }
};