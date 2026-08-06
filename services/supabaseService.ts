
import { supabase, supabaseUrl, supabaseAnonKey } from './supabaseClient';
import { User, UserRole, Delegate, Event, Session, SystemSettings, CheckInResult, Pledge, FinancialEntry, DashboardStats, CheckIn, FinancialType, SessionResponse, SessionResponseSummary, VoiceDistribution, SessionMinistryDashboard, MinistryExportData, SessionResponseType, BadgeBatch, BadgePrintLog, BadgeFilter, BadgeSortField, BadgeLayout, BatchStatus, BadgePrintAction, RESPONSE_TYPE_LABELS } from '../types';
import { generateCodeFromId, generateQrHash } from './utils';
import { createClient } from '@supabase/supabase-js';

/**
 * Normalizes email for transmission. 
 */
const normalizeEmail = (val?: string) => (val || '').trim().toLowerCase();
const isValidEmail = (val?: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(val));
const normalize = (val?: string) => (val || '').replace(/\s+/g, ' ').trim();

const resolveBadgeFileName = (batch: { batch_id: string; pdf_url?: string | null }): string => {
    if (batch.pdf_url) {
        try {
            const last = batch.pdf_url.split('/').pop();
            if (last) return decodeURIComponent(last);
        } catch {}
    }
    return `badge-batch-${batch.batch_id}.pdf`;
};

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

const handleRpcResponse = (res: any, operationName: string) => {
    handleSupabaseError(res);
    const data = res.data;
    if (data && typeof data === 'object' && data.error) {
        console.error(`RPC ${operationName} Error:`, data.error);
        throw new Error(data.error);
    }
    return data;
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
    getOrCreateProfile: async (authId: string, email: string, metadata?: { role?: string; app_metadata?: { role?: string }; user_metadata?: { role?: string } }): Promise<User> => {
        let profile: any = null;
        let rpcError: any = null;
        try {
            console.log('[auth.getOrCreateProfile] Step A: get_my_profile for authId=', authId);
            try {
                const rpcResult = await supabase.rpc('get_my_profile');
                profile = rpcResult.data;
                rpcError = rpcResult.error;
            } catch (rpcThrown: any) {
                console.error('[auth.getOrCreateProfile] Step A rpc THREW:', rpcThrown);
                rpcError = rpcThrown;
            }
            console.log('[auth.getOrCreateProfile] Step A result:', {
                profile,
                profileType: typeof profile,
                isArray: Array.isArray(profile),
                hasError: !!rpcError,
                errorMsg: rpcError?.message,
                errorCode: rpcError?.code,
                errorFull: rpcError
            });

            // Handle the case where profile is a stringified JSON (Supabase sometimes returns this)
            let parsedProfile: any = profile;
            if (typeof parsedProfile === 'string') {
                try {
                    parsedProfile = JSON.parse(parsedProfile);
                    console.log('[auth.getOrCreateProfile] Step A: parsed stringified JSON, now =', parsedProfile);
                } catch (parseErr) {
                    console.error('[auth.getOrCreateProfile] Step A: failed to parse stringified JSON', parseErr);
                }
            }

            // Handle the case where profile is an array (Supabase sometimes wraps in array)
            if (Array.isArray(parsedProfile) && parsedProfile.length > 0) {
                parsedProfile = parsedProfile[0];
                console.log('[auth.getOrCreateProfile] Step A: unwrapped array, now =', parsedProfile);
            }

            if (parsedProfile && typeof parsedProfile === 'object' && !rpcError) {
                if (parsedProfile.is_active === false) {
                    throw new Error("ACCOUNT_DEACTIVATED: Your account has been deactivated. Please contact your administrator.");
                }
                return parsedProfile as User;
            }

            console.log('[auth.getOrCreateProfile] Step B: no profile, checking tombstone');
            const { data: tombstone } = await supabase.from('deleted_users').select('id').eq('id', authId).maybeSingle();
            if (tombstone) {
                throw new Error("ACCOUNT_DELETED: Your account has been permanently removed. Please contact your administrator.");
            }

            let role = metadata?.app_metadata?.role || metadata?.user_metadata?.role || metadata?.role || 'registrar';
            console.log('[auth.getOrCreateProfile] Step C: role from metadata=', role);
            if (role === 'registrar') {
                try {
                    const { data: authRole } = await supabase.rpc('get_auth_user_role');
                    if (authRole && typeof authRole === 'string') {
                        role = authRole;
                        console.log('[auth.getOrCreateProfile] Step C: role from get_auth_user_role=', role);
                    }
                } catch (rpcErr: any) {
                    console.warn('[auth.getOrCreateProfile] get_auth_user_role failed:', rpcErr?.message);
                }
            }

            const ALLOWED_ROLES = new Set([
                'national_admin', 'regional_admin', 'district_admin', 'admin',
                'national_registrar', 'regional_registrar', 'district_registrar', 'registrar',
                'finance'
            ]);
            if (!ALLOWED_ROLES.has(role)) {
                console.warn(`[auth.getOrCreateProfile] Role "${role}" is not in the allowed set; falling back to "registrar"`);
                role = 'registrar';
            }

            console.log('[auth.getOrCreateProfile] Step D: upserting app_users with role=', role);
            const { data: newProfile, error: createError } = await supabase
                .from('app_users')
                .upsert({ id: authId, email: normalizeEmail(email), is_active: true, role }, { onConflict: 'id' })
                .select().single();

            if (createError) {
                const ce: any = createError;
                console.error('[auth.getOrCreateProfile] Step D upsert failed:', ce);
                const ceMessage = ce?.message || ce?.error_description || ce?.hint || ce?.details || JSON.stringify(ce) || 'unknown error';
                throw new Error(`Failed to create app_users profile: ${ceMessage} (code=${ce?.code || 'unknown'})`);
            }
            if (!newProfile) {
                console.error('[auth.getOrCreateProfile] Step D upsert returned no data');
                throw new Error('Failed to create app_users profile: upsert returned no data (likely RLS policy blocked the write)');
            }
            console.log('[auth.getOrCreateProfile] Step D: upsert succeeded, newProfile=', newProfile);
            return newProfile as User;
        } catch (err) {
            if ((err as any)?.message?.startsWith?.('ACCOUNT_DEACTIVATED')) throw err;
            if ((err as any)?.message?.startsWith?.('ACCOUNT_DELETED')) throw err;
            throw err;
        }
    },

    login: async (email: string, password: string): Promise<User | null> => {
        const normalizedEmail = normalizeEmail(email);
        try {
            console.log('[auth.login] Step 1: signInWithPassword for', normalizedEmail);
            const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
                email: normalizedEmail,
                password
            });

            if (authError) {
                const authErr: any = authError as any;
                console.error('[auth.login] signInWithPassword error:', {
                    message: authErr.message,
                    name: authErr.name,
                    status: authErr.status,
                    code: authErr.code,
                    details: authErr.details,
                    hint: authErr.hint,
                    full: authErr
                });
                const status = Number(authErr.status) || 0;
                if (authErr.name === 'AuthRetryableFetchError' || status >= 500) {
                    const goTrueDetail = [authErr.code, authErr.message, authErr.details, authErr.hint].filter(Boolean).join(' | ');
                    let diagnosticHint = '';
                    try {
                        const d = await auth.diagnoseLoginFailure(normalizedEmail, password);
                        if (d) diagnosticHint = ` — ${d}`;
                    } catch {}
                    const serverErr = new Error(
                        `Authentication service temporarily unavailable (HTTP ${status || 'unknown'})${goTrueDetail ? ` [GoTrue: ${goTrueDetail}]` : ''}.${diagnosticHint} Please retry.`
                    );
                    (serverErr as any).status = status;
                    throw serverErr;
                }
                if (authErr.message && authErr.message.includes('Invalid login credentials')) {
                    const hint = await auth.diagnoseLoginFailure(normalizedEmail, password);
                    throw new Error(hint);
                }
                const err = new Error(authErr.message || "Authentication service unavailable");
                (err as any).status = status;
                (err as any).code = authErr.code;
                throw err;
            }

            if (!authData.user) {
                console.warn('[auth.login] signInWithPassword returned no user');
                return null;
            }
            console.log('[auth.login] Step 2: signIn OK, user.id=', authData.user.id);

            console.log('[auth.login] Step 3: getOrCreateProfile');
            const profile = await auth.getOrCreateProfile(authData.user.id, authData.user.email || email, { app_metadata: authData.user.app_metadata, user_metadata: authData.user.user_metadata });
            console.log('[auth.login] Step 4: profile loaded, role=', profile?.role);
            return profile;
        } catch (e: any) {
            const msg = e?.message;
            const code = e?.code || e?.status;
            const details = e?.details || e?.hint;
            const eName = e?.name;
            const eStack = e?.stack;
            // Try multiple serialization strategies
            let serialized = '';
            try { serialized = JSON.stringify(e, Object.getOwnPropertyNames(e || {})); } catch {}
            console.error('[auth.login] FATAL:', {
                message: msg,
                name: eName,
                code,
                details,
                stack: eStack,
                serialized,
                e_type: typeof e,
                e_isArray: Array.isArray(e),
                e_isError: e instanceof Error,
                e_constructor: e?.constructor?.name,
                e_stringified: String(e),
                full: e
            });
            if (!msg || msg === '{}' || msg === 'null' || msg === '[object Object]') {
                const diagnostic = `name=${eName || 'unknown'}, code=${code || 'unknown'}, details=${details || 'none'}, type=${typeof e}, ctor=${e?.constructor?.name || 'unknown'}, stringified=${String(e)?.slice(0, 200)}`;
                throw new Error(`Authentication service returned an unexpected response. The user account may be incomplete. (${diagnostic})`);
            }
            throw e;
        }
    },

    diagnoseLoginFailure: async (email: string, password?: string): Promise<string> => {
        try {
            const { data: diag, error } = await supabase.rpc('check_login_account', {
                p_email: normalizeEmail(email),
                p_password: password || null
            });
            if (error || !diag) {
                console.warn('[diagnoseLoginFailure] RPC failed:', error?.message || 'no data');
                return "Login Failed: Invalid email or password. Please check for typos and try again.";
            }
            const d = diag as any;
            const costInfo = d.bcrypt_cost != null ? ` [bcrypt cost: ${d.bcrypt_cost}${d.bcrypt_cost < 10 ? ' — REQUIRES ≥ 10' : ''}]` : '';
            if (d.email_format_valid === false) {
                return `This account uses an invalid email format.${costInfo} Please contact your administrator to correct the account email (e.g. officer@fgbmfi.ng).`;
            }
            if (d.account_exists === false) {
                return "Account not found for this email. Please ask your administrator to create the account.";
            }
            if (d.password_matches === false) {
                return `Login Failed: Invalid email or password.${costInfo} Please check for typos and try again.`;
            }
            if (d.is_active === false) {
                return "This account has been deactivated. Please contact your administrator to reactivate it.";
            }
            if (d.confirmed === false) {
                return `This account is not confirmed.${costInfo} Please contact your administrator to re-run the auth integrity fix migration.`;
            }
            if (d.has_identity === false) {
                return `This account is missing its login identity record.${costInfo} Please contact your administrator to re-run the auth integrity fix migration.`;
            }
            if (d.bcrypt_cost != null && d.bcrypt_cost < 10) {
                return `bcrypt cost is ${d.bcrypt_cost} — GoTrue requires >= 10. The password hash is too weak. This account must be re-created or its password reset via admin UI.`;
            }
            return d.recommendation || "Login Failed: Invalid email or password. Please check for typos and try again.";
        } catch (e: any) {
            console.warn('[diagnoseLoginFailure] exception:', e?.message);
            return "Login Failed: Invalid email or password. Please check for typos and try again.";
        }
    },
};

let auditEnabled = true;

export const setAuditEnabled = (enabled: boolean) => { auditEnabled = enabled; };

const updateAuditSyncCache = (settings: SystemSettings) => {
    if (settings?.audit_enabled !== undefined) auditEnabled = settings.audit_enabled;
    else auditEnabled = true;
};

const recordAuditLog = (
    eventId: string,
    actionType: string,
    summary: string,
    performer: User | null,
    targetType?: string,
    targetId?: string,
    metadata?: Record<string, any>
) => {
    if (!auditEnabled) return;
    const effectiveEventId = eventId || null;
    (async () => {
        let pid = performer?.id;
        let pemail = performer?.email;
        if (!pid) {
            const { data } = await supabase.auth.getUser();
            pid = data.user?.id;
            pemail = data.user?.email;
            if (!pid) return;
        }
        await supabase.from('audit_log').insert({
            event_id: effectiveEventId,
            action_type: actionType,
            performed_by: pid,
            performer_email: pemail || null,
            target_type: targetType || null,
            target_id: targetId || null,
            summary,
            metadata: metadata || {}
        });
    })().catch(() => {});
};

export const db = {
    getEvents: async (): Promise<Event[]> =>
        handleSupabaseError(await supabase.from('events').select('*').order('start_date', { ascending: false })),

    createEvent: async (event: Omit<Event, 'event_id'>): Promise<Event> => {
        const result = handleSupabaseError(await supabase.from('events').insert(event).select().single());
        recordAuditLog(result.event_id, 'event_create', `Event created: ${result.name}`, null, 'event', result.event_id);
        return result;
    },

    updateEvent: async (id: string, updates: Partial<Event>): Promise<Event> => {
        const result = handleSupabaseError(await supabase.from('events').update(updates).eq('event_id', id).select().single());
        recordAuditLog(id, 'event_update', `Event updated: ${result.name}`, null, 'event', id, { changes: Object.keys(updates) });
        return result;
    },

    deleteEvent: async (id: string) => {
        const { data: ev } = await supabase.from('events').select('name').eq('event_id', id).maybeSingle();
        const result = handleSupabaseError(await supabase.from('events').delete().eq('event_id', id));
        recordAuditLog(id, 'event_delete', `Event deleted: ${ev?.name || id}`, null, 'event', id);
        return result;
    },

    getSessions: async (eventId: string): Promise<Session[]> => {
        if (!eventId) return [];
        const { data } = await supabase.from('sessions').select('*').eq('event_id', eventId).order('start_time');
        return data || [];
    },

    createSession: async (session: Omit<Session, 'session_id'>) => {
        await ensureEventActive(session.event_id);
        const payload = {
            ...session,
            start_time: session.start_time ? new Date(session.start_time).toISOString() : session.start_time,
            end_time: session.end_time ? new Date(session.end_time).toISOString() : session.end_time,
        };
        return handleSupabaseError(await supabase.from('sessions').insert(payload).select().single());
    },

    updateSession: async (id: string, updates: Partial<Session>) => {
        const { data: existing } = await supabase.from('sessions').select('event_id').eq('session_id', id).single();
        if (existing) await ensureEventActive(existing.event_id);
        const payload: any = { ...updates };
        if (updates.start_time) payload.start_time = new Date(updates.start_time).toISOString();
        if (updates.end_time) payload.end_time = new Date(updates.end_time).toISOString();
        return handleSupabaseError(await supabase.from('sessions').update(payload).eq('session_id', id).select().single());
    },

    deleteSession: async (id: string) => {
        const { data: existing } = await supabase.from('sessions').select('event_id').eq('session_id', id).single();
        if (existing) await ensureEventActive(existing.event_id);
        return handleSupabaseError(await supabase.from('sessions').delete().eq('session_id', id));
    },

    getChapters: async (district?: string) => {
        let q = supabase.from('chapters').select('*', { count: 'exact' }).order('chapter_name').limit(5000);
        if (district) q = q.eq('district', district);
        const { data } = await q;
        return data || [];
    },

    importChapters: async (chapters: { district: string; chapter_code?: string; chapter_name: string; state?: string; city?: string; meeting_day?: string }[]): Promise<{ inserted: number; errors: string[] }> => {
        const BATCH_SIZE = 500;
        let inserted = 0;
        const errors: string[] = [];
        for (let i = 0; i < chapters.length; i += BATCH_SIZE) {
            const batch = chapters.slice(i, i + BATCH_SIZE).map(c => ({
                district: c.district,
                chapter_code: c.chapter_code || null,
                chapter_name: c.chapter_name,
                state: c.state || null,
                city: c.city || null,
                meeting_day: c.meeting_day || null,
            }));
            const { data, error } = await supabase.from('chapters').upsert(batch, { onConflict: 'chapter_code' });
            if (error) {
                console.warn(`Chapters batch ${i} failed, falling back to row-by-row:`, error.message);
                for (const rec of batch) {
                    const { error: singleErr } = await supabase.from('chapters').upsert(rec, { onConflict: 'chapter_code' });
                    if (singleErr) {
                        errors.push(singleErr.message);
                    } else {
                        inserted++;
                    }
                }
            } else {
                inserted += (data?.length || batch.length);
            }
        }
        return { inserted, errors };
    },

    getSettings: async (): Promise<SystemSettings> => {
        const defaultData = { titles: ['Mr', 'Mrs', 'Ms', 'Chief', 'Dr', 'Prof', 'Engr', 'Elder'], districts: ['North Central 1', 'North Central 2', 'North Central 3', 'North Central 4', 'North Central 5', 'North East 1', 'North East 2', 'North West 1', 'North West 2', 'North West 3', 'South East 1', 'South East 2', 'South East 3', 'South South 1', 'South South 2', 'South South 3', 'South South 4', 'South West 1', 'South West 2', 'South West 3', 'South West 4', 'South West 5', 'South West 6', 'South West 7', 'SOUTH WEST 8'], ranks: [], offices: [], regions: [], delegate_types: ['Member', 'National Guest', 'Free Guest', 'Dependant-Adult', 'Dependant-Teen', 'Dependant-Children', 'International'] };
        const { data, error } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        if (error) throw error;
        const settings = data || defaultData;
        try {
            const { data: chapterDistricts } = await supabase.from('chapters').select('district');
            if (chapterDistricts?.length) {
                const chapterDistSet = new Set((chapterDistricts as any[]).map(c => c.district));
                const merged = [...new Set([...(settings.districts || []), ...chapterDistSet])].sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
                settings.districts = merged;
            }
        } catch { /* chapters table may not exist yet */ }
        if (settings.audit_enabled === undefined) settings.audit_enabled = true;
        updateAuditSyncCache(settings);
        return settings;
    },

    updateSettings: async (settings: SystemSettings, field?: keyof SystemSettings): Promise<SystemSettings> => {
        const { data: current } = await supabase.from('system_settings').select('*').limit(1).maybeSingle();
        let payload: any = field ? { [field]: settings[field] } : settings;
        if (current) {
            const { data, error } = await supabase.from('system_settings').update(payload).eq('id', current.id).select().single();
            if (error) throw error;
            if (!field || field === 'audit_enabled') updateAuditSyncCache(data);
            return data;
        } else {
            const { data, error } = await supabase.from('system_settings').insert(payload).select().single();
            if (error) throw error;
            if (!field || field === 'audit_enabled') updateAuditSyncCache(data);
            return data;
        }
    },

    getUsers: async (): Promise<User[]> => 
        handleSupabaseError(await supabase.from('app_users').select('*')),

    createUser: async (user: Omit<User, 'id'>, password: string) => {
        const email = normalizeEmail(user.email);
        if (!isValidEmail(email)) {
            throw new Error("Email must be a full address (e.g. officer@fgbmfi.ng)");
        }
        const role = user.role.toLowerCase();
        const district = user.district || null;
        const region = user.region || null;

        const tempClient = createClient(supabaseUrl, supabaseAnonKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
            email,
            password,
            options: { data: { role, district, region } }
        });

        if (signUpError) {
            const msg = signUpError.message || 'signUp failed';
            if (msg.includes('already registered') || msg.includes('already exists') || msg.includes('duplicate')) {
                throw new Error(`A user with email "${email}" already exists.`);
            }
            throw new Error(`Account creation failed: ${msg}`);
        }
        if (!signUpData.user) {
            throw new Error('Account creation failed: no user returned from Supabase Auth.');
        }

        const newUserId = signUpData.user.id;

        const { data: confirmData, error: confirmError } = await supabase.rpc('confirm_user_by_email', {
            p_email: email
        });

        if (confirmError) {
            console.warn('[createUser] confirm_user_by_email RPC failed:', confirmError.message);
        }
        if (confirmData && (confirmData as any).status === 'error') {
            console.warn('[createUser] confirm_user_by_email returned error:', (confirmData as any).error);
        }

        const { error: insertError } = await supabase.from('app_users').upsert({
            id: newUserId,
            email,
            role,
            district,
            region,
            is_active: true
        }, { onConflict: 'id' });

        if (insertError) {
            console.error('[createUser] app_users upsert failed:', insertError.message);
            throw new Error(`Account was created in Auth but profile could not be saved: ${insertError.message}. Please have an administrator check the app_users table.`);
        }

        // Use empty string for system-level audit (event_id is nullable)
        recordAuditLog('', 'user_create', `User created: ${email} (${role})`, null, 'user', newUserId, { role, district, region });
        return { status: 'success', id: newUserId, email };
    },

    updateUser: async (userId: string, updates: Partial<User>) => {
        const clean = { ...updates };
        if (clean.district === '') delete clean.district;
        if (clean.region === '') delete clean.region;
        const result = handleSupabaseError(await supabase.from('app_users').update(clean).eq('id', userId).select().single());
        recordAuditLog('', 'user_update', `User updated: ${result.email || userId}`, null, 'user', userId, { changes: Object.keys(clean) });
        return result;
    },

    deleteUser: async (userId: string) => {
        const { data: usr } = await supabase.from('app_users').select('email').eq('id', userId).maybeSingle();
        const result = handleRpcResponse(await supabase.rpc('delete_app_user', { user_id_to_delete: userId }), 'delete_app_user');
        recordAuditLog('', 'user_delete', `User deleted: ${usr?.email || userId}`, null, 'user', userId);
        return result;
    },

    resetUserPassword: async (userId: string, newPassword: string) => 
        handleRpcResponse(await supabase.rpc('reset_user_password', { user_id: userId, new_password: newPassword }), 'reset_user_password'),

    deactivateUser: async (userId: string) => 
        handleRpcResponse(await supabase.rpc('deactivate_app_user', { user_id: userId }), 'deactivate_app_user'),

    reactivateUser: async (userId: string) => 
        handleRpcResponse(await supabase.rpc('reactivate_app_user', { user_id: userId }), 'reactivate_app_user'),

    bulkDeactivateEventUsers: async () => 
        handleRpcResponse(await supabase.rpc('deactivate_all_event_users'), 'deactivate_all_event_users'),

    searchDelegates: async (query: string, eventId: string, district?: string, sessionId?: string, region?: string): Promise<(Delegate & { checkedIn: boolean, code?: string })[]> => {
        if (!eventId) return [];
        let q = supabase.from('delegates').select('*').eq('event_id', eventId);
        if (region) {
            q = q.ilike('district', `${normalize(region)}%`);
        } else if (district) {
            q = q.ilike('district', normalize(district));
        }
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

    getAllDelegates: async (eventId?: string): Promise<Delegate[]> => {
        const results: Delegate[] = [];
        let page = 1;
        const pageSize = 500;
        while (true) {
            const { data } = await supabase.rpc('get_paginated_delegates', {
                p_page: page, p_page_size: pageSize,
                p_search: null, p_district: null,
                p_event_id: eventId || null,
            });
            const parsed = data as any;
            if (!parsed?.data || parsed.data.length === 0) break;
            results.push(...parsed.data);
            if (parsed.data.length < pageSize) break;
            page++;
        }
        return results;
    },

    getPaginatedDelegates: async (page: number = 1, pageSize: number = 50, search?: string, district?: string, region?: string, eventId?: string): Promise<{ data: Delegate[]; total: number; page: number; pageSize: number; totalPages: number }> => {
        if (!eventId) {
            console.warn('[getPaginatedDelegates] BLOCKED: no eventId provided, returning empty');
            return { data: [], total: 0, page, pageSize, totalPages: 0 };
        }

        let result: { data: Delegate[]; total: number; page: number; pageSize: number; totalPages: number };

        try {
            const { data, error } = await supabase.rpc('get_paginated_delegates', {
                p_page: page, p_page_size: pageSize,
                p_search: search || null, p_district: district || null,
                p_region: region || null,
                p_event_id: eventId || null,
            });
            if (!error && data) {
                result = data as any;
                console.log('[getPaginatedDelegates] RPC success, eventId:', eventId, 'returned:', result.data?.length, 'delegates, total:', result.total);
            } else {
                throw error || new Error('RPC empty');
            }
        } catch (e) {
            console.log('[getPaginatedDelegates] RPC failed, using fallback. eventId:', eventId, 'error:', (e as any)?.message);

            let q = supabase.from('delegates').select('*', { count: 'exact' });
            if (eventId) q = q.eq('event_id', eventId);
            if (search) q = q.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
            if (region) {
                q = q.ilike('district', `${normalize(region)}%`);
            } else if (district) {
                q = q.ilike('district', normalize(district));
            }
            const from = (page - 1) * pageSize;
            const { data: rows, count, error } = await q.order('first_name').range(from, from + pageSize - 1);
            if (error) throw error;
            result = {
                data: (rows || []) as Delegate[],
                total: count || 0,
                page,
                pageSize,
                totalPages: Math.ceil((count || 0) / pageSize),
            };
        }

        if (eventId && result.data && result.data.length > 0) {
            const filtered = result.data.filter(d => d.event_id === eventId);
            if (filtered.length !== result.data.length) {
                console.warn('[getPaginatedDelegates] POST-FILTER: stripped', result.data.length - filtered.length, 'delegates from other events. eventId:', eventId);
                result.data = filtered;
                result.total = filtered.length;
                result.totalPages = Math.ceil(filtered.length / pageSize);
            }
        }

        return result;
    },

    updateDelegate: async (id: string, updates: Partial<Delegate>) => {
        const { name_display, delegate_id, created_at, ...validUpdates } = updates as any;
        const result = handleSupabaseError(await supabase.from('delegates').update({
            ...validUpdates,
            district: normalize(validUpdates.district),
            chapter: normalize(validUpdates.chapter)
        }).eq('delegate_id', id).select().single());
        const changes = Object.keys(validUpdates).filter(k => validUpdates[k] !== undefined);
        recordAuditLog(result.event_id, 'delegate_update', `Delegate updated: ${result.first_name} ${result.last_name}`, null, 'delegate', id, { changes });
        return result;
    },

    // Fix: Corrected variable name mismatch from event_id to eventId
    checkInDelegate: async (eventId: string, delegateId: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        if (!delegateId) return { success: false, message: 'Invalid delegate ID.' };
        return withRetry(async () => {
        await ensureEventActive(eventId);
        const safeSessionId = sessionId || null;
        const { data: del } = await supabase.from('delegates').select('qr_hash, delegate_id, first_name, last_name, district, chapter').eq('delegate_id', delegateId).maybeSingle();

        if (safeSessionId) {
            const { data: arrival } = await supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).is('session_id', null).maybeSingle();
            if (!arrival) {
                const { error: arrivalErr } = await supabase.from('checkins').insert({ event_id: eventId, delegate_id: delegateId, session_id: null, checked_in_by: registrar.id });
                if (arrivalErr && !arrivalErr.message?.includes('duplicate') && arrivalErr.code !== '23505') throw arrivalErr;
            }
        }

        const isNewCheckin: boolean = await supabase.from('checkins').select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).eq('session_id', safeSessionId as any).maybeSingle()
            .then(({ data }) => !data);
        if (!isNewCheckin) {
            const code = generateCodeFromId(delegateId, eventId);
            return { success: true, message: 'Verified', code, delegate: { delegate_id: delegateId, qr_hash: del?.qr_hash || '', first_name: del?.first_name || '', last_name: del?.last_name || '' } as any };
        }
        const { error } = await supabase.from('checkins').insert({ event_id: eventId, delegate_id: delegateId, session_id: safeSessionId, checked_in_by: registrar.id });
        if (error && error.code !== '23505' && !error.message?.includes('duplicate')) throw error;

        const label = safeSessionId ? 'Session Attendance' : 'Arrival';
        const detail = del ? `${del.first_name} ${del.last_name} (${del.district || '?'} ${del.chapter || ''})`.trim() : delegateId;
        recordAuditLog(eventId, safeSessionId ? 'checkin_session' : 'checkin_arrival', `${label}: ${detail}`, registrar, 'checkin', delegateId, { session_id: safeSessionId });

        const code = generateCodeFromId(delegateId, eventId);
        return { success: true, message: 'Verified', code, delegate: { delegate_id: delegateId, qr_hash: del?.qr_hash || '', first_name: del?.first_name || '', last_name: del?.last_name || '' } as any };
        });
    },

    checkInByCode: async (eventId: string, code: string, registrar: User, sessionId?: string): Promise<CheckInResult> => {
        await ensureEventActive(eventId);
        code = code.trim();
        
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
            
            const extractFromFields = (fields: string[]): Record<string, string> | null => {
                const result: Record<string, string> = {};
                
                const idField = fields.find(f => f.length >= 20 && /[A-Z0-9]{20,}/i.test(f));
                if (idField) {
                    const m = idField.match(/[A-Z0-9]{20,}/i);
                    if (m) result['delegate_id'] = m[0];
                }
                
                const nameField = fields.find(f => {
                    const clean = f.replace(/^null\s*/i, '').trim();
                    return clean.includes(' ') && !/^[A-Z0-9_]+$/.test(clean);
                });
                if (nameField) {
                    let clean = nameField.replace(/^null\s*null\s*/i, '').replace(/^null\s*/i, '').trim();
                    const parts = clean.split(/\s+/);
                    if (parts[0].endsWith('.')) result['title'] = parts.shift()!;
                    if (parts.length >= 2) {
                        result['first_name'] = parts.slice(0, -1).join(' ');
                        result['last_name'] = parts[parts.length - 1];
                    } else if (parts.length === 1) {
                        result['first_name'] = parts[0];
                    }
                }
                
                const nonIdNameTypeFields = fields.filter(f => f !== idField && f !== nameField && !/^[A-Z][A-Z_]{3,}$/.test(f));
                if (nonIdNameTypeFields.length >= 1) result['district'] = nonIdNameTypeFields[0];
                if (nonIdNameTypeFields.length >= 2) result['chapter'] = nonIdNameTypeFields[1];
                
                const typeField = fields.find(f => /^[A-Z][A-Z_]{3,}$/.test(f));
                if (typeField) result['delegate_type'] = typeField;
                
                if (result['delegate_id'] && result['first_name'] && result['last_name']) return result;
                return null;
            };
            
            const csvFields = raw.split(',').map(f => f.trim()).filter(f => f.length > 0 && !/^null$/i.test(f));
            if (csvFields.length >= 3) {
                const parsed = extractFromFields(csvFields);
                if (parsed) return parsed;
            }
            
            const lines = raw.split(/[\r\n]+/).map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length >= 1) {
                const parsed = extractFromFields(lines);
                if (parsed) return parsed;
            }
            
            return null;
        };
        
        const parsedData = parseQRData(code);
        const lookupId = parsedData?.['delegate_id'] || parsedData?.['external_id'] || code;
        
        // Pass 1: UUID QR hash lookup (internal QR codes, use raw code when no extracted ID)
        if (code.length > 10 && code === lookupId) {
            const { data: match } = await supabase.from('delegates').select('delegate_id').eq('event_id', eventId).eq('qr_hash', code).maybeSingle();
            if (match && match.delegate_id) return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
        }
        
        // Pass 2: External ID lookup (use extracted delegate ID, matches subsequent scans)
        if (lookupId.length > 4) {
            const { data: extMatch } = await supabase.from('delegates').select('delegate_id').eq('event_id', eventId).eq('external_id', lookupId).maybeSingle();
            if (extMatch && extMatch.delegate_id) return db.checkInDelegate(eventId, extMatch.delegate_id, registrar, sessionId);
        }
        
        // Pass 3: Delegate ID lookup
        if (lookupId.length > 4 && lookupId !== code) {
            const { data: idMatch } = await supabase.from('delegates').select('delegate_id').eq('event_id', eventId).eq('delegate_id', lookupId).maybeSingle();
            if (idMatch && idMatch.delegate_id) return db.checkInDelegate(eventId, idMatch.delegate_id, registrar, sessionId);
        }
        
        // Pass 4: 4-digit deterministic code fallback (legacy)
        if (code.length <= 10) {
            const { data: delegates } = await supabase.from('delegates').select('delegate_id, district').eq('event_id', eventId).limit(5000);
            const match = delegates?.find(d => generateCodeFromId(d.delegate_id, eventId) === code);
            if (match && match.delegate_id) return db.checkInDelegate(eventId, match.delegate_id, registrar, sessionId);
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
        if (!delegate.event_id) throw new Error('registerDelegate requires event_id');
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
        const externalIdValue = parsedData['delegate_id'] || parsedData['external_id'] || scannedCode;

        if (externalIdValue) {
            const { data: existing } = await supabase.from('delegates').select('*').eq('external_id', externalIdValue).eq('event_id', eventId).maybeSingle();
            if (existing) return existing;
        }

        if (parsedData['first_name'] && parsedData['last_name'] && parsedData['phone']) {
            const fname = normalize(parsedData['first_name']);
            const lname = normalize(parsedData['last_name']);
            const phone = parsedData['phone'].replace(/\s+/g, '');
            const { data: nameMatch } = await supabase.from('delegates').select('*').eq('event_id', eventId).ilike('first_name', fname).ilike('last_name', lname).eq('phone', phone).limit(1).maybeSingle();
            if (nameMatch) return nameMatch;
        }

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
            external_id: externalIdValue,
            qr_hash: generateQrHash(),
            registration_source: 'qr_scan' as const
        };
        const { data, error } = await supabase.from('delegates').insert(record).select().single();
        if (error) throw error;
        return data;
    },

    importDelegates: async (csv: string, eventId?: string, onProgress?: (inserted: number, skipped: number, total: number) => void): Promise<{ inserted: number; skipped: number }> => {
        if (!eventId) throw new Error('importDelegates requires eventId');
        const lines = csv.trim().split('\n').map(l => l.split(',').map(p => p.trim())).filter(p => p.length >= 3);
        const BATCH_SIZE = 500;
        let inserted = 0;
        let skipped = 0;

        for (let i = 0; i < lines.length; i += BATCH_SIZE) {
            const batch = lines.slice(i, i + BATCH_SIZE);
            const payload = batch.map(p => ({
                external_id: p[0],
                title: p[0],
                first_name: p[1],
                last_name: p[2],
                district: p[3],
                chapter: p[4],
                phone: p[5],
                email: p[6],
                rank: p[7] || 'CP',
                office: p[8] || 'OTHER',
                delegate_type: p[9] || 'Member',
                qr_hash: generateQrHash(),
                event_id: eventId,
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

    getStats: async (eventId: string, district?: string, region?: string): Promise<DashboardStats> => {
        if (!eventId) {
            console.warn('[getStats] BLOCKED: no eventId provided, returning empty stats');
            return { totalDelegates: 0, totalCheckIns: 0, totalArrivals: 0, totalSessionAttendance: 0, totalFinancials: 0, checkInsByRank: {}, checkInsByDistrict: {}, recentActivity: [] };
        }

        try {
            const { data, error } = await supabase.rpc('get_event_dashboard_stats', {
                p_event_id: eventId,
                p_district: district || null,
                p_region: region || null,
            });
            if (!error && data && typeof data.totalArrivals === 'number' && typeof data.totalSessionAttendance === 'number') {
                console.log('[getStats] RPC success, totalDelegates:', data.totalDelegates, 'totalArrivals:', data.totalArrivals);
                if (data.totalArrivals > data.totalDelegates) {
                    console.warn('[getStats] DIAGNOSTIC: arrivals exceed delegates — data-integrity gap detected. totalArrivals:', data.totalArrivals, 'totalDelegates:', data.totalDelegates, 'eventId:', eventId);
                }
                return data as DashboardStats;
            }
        } catch {}

        console.log('[getStats] RPC failed or missing fields, using client fallback. eventId:', eventId);

        const regionPrefix = region ? `${normalize(region).toUpperCase()}%` : null;
        const filter = region ? null : (district ? normalize(district).toUpperCase() : null);
        let delegatesQuery = supabase.from('delegates').select('*', { count: 'exact', head: true }).eq('event_id', eventId);
        if (regionPrefix) delegatesQuery = delegatesQuery.ilike('district', regionPrefix);
        else if (filter) delegatesQuery = delegatesQuery.ilike('district', filter);
        const { count: totalDelegatesCount } = await delegatesQuery;

        const rankCounts: Record<string, number> = {};
        const districtCounts: Record<string, number> = {};
        const seenIdentities = new Set<string>();
        const arrivalIdentities = new Set<string>();
        let totalSessionAttendance = 0;
        const recentActivity: CheckIn[] = [];
        let from = 0;

        while (true) {
            const { data, error } = await supabase.from('checkins').select('*, delegates(*)').eq('event_id', eventId).order('checked_in_at', { ascending: false }).range(from, from + 999);
            if (error || !data || data.length === 0) break;
            data.forEach(c => {
                if (!c.delegates) return;
                const d = c.delegates;
                const districtNorm = normalize(d.district).toUpperCase();
                if (regionPrefix) {
                    if (!districtNorm.startsWith(regionPrefix.replace('%', ''))) return;
                } else if (filter && districtNorm !== filter) return;
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
                if (!c.session_id && !arrivalIdentities.has(identityKey)) {
                    arrivalIdentities.add(identityKey);
                }
                if (c.session_id) {
                    totalSessionAttendance++;
                }
            });
            if (data.length < 1000) break;
            from += 1000;
        }

        let financialsSum = 0;
        const { data: financials } = await supabase.from('financial_entries').select('amount').eq('event_id', eventId);
        financialsSum = financials?.reduce((s, f) => s + (Number(f.amount) || 0), 0) || 0;

        const stats: DashboardStats = { totalDelegates: totalDelegatesCount || 0, totalCheckIns: seenIdentities.size, totalArrivals: arrivalIdentities.size, totalSessionAttendance, totalFinancials: financialsSum, checkInsByRank: rankCounts, checkInsByDistrict: districtCounts, recentActivity: recentActivity };

        if (stats.totalArrivals > stats.totalDelegates) {
            console.warn('[getStats] DIAGNOSTIC (fallback): arrivals exceed delegates — data-integrity gap detected. totalArrivals:', stats.totalArrivals, 'totalDelegates:', stats.totalDelegates, 'eventId:', eventId);
        }

        return stats;
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
                if (eventIdFilter) {
                    q = q.eq('event_id', eventIdFilter);
                }
                if (table === 'checkins') q = q.order('checked_in_at', { ascending: true });
                const { data, error } = await q;
                if (error || !data || data.length === 0) break;
                results = [...results, ...data];
                if (data.length < 1000) break;
                from += 1000;
            }
            return results;
        };
        const [d, c, f, p] = await Promise.all([ fetchAll('delegates', eventId), fetchAll('checkins', eventId), fetchAll('financial_entries', eventId), fetchAll('pledges', eventId) ]);
        return { delegates: d, checkins: c, financials: f, pledges: p };
    },

    searchPledges: async (query: string, eventId: string, district?: string, region?: string): Promise<Pledge[]> => {
        let q = supabase.from('pledges').select('*').eq('event_id', eventId);
        if (region) {
            q = q.ilike('district', `${normalize(region)}%`);
        } else if (district) {
            q = q.ilike('district', normalize(district));
        }
        if (query) q = q.ilike('donor_name', `%${query}%`);
        const { data } = await q.limit(500);
        return data || [];
    },

    addFinancialEntry: async (entry: Partial<FinancialEntry>) => {
        if (entry.event_id) await ensureEventActive(entry.event_id);
        const result = handleSupabaseError(await supabase.from('financial_entries').insert(entry).select().single());
        const typeLabel = entry.type === FinancialType.OFFERING ? 'Offering' : 'Pledge Redemption';
        recordAuditLog(result.event_id, `financial_${entry.type?.toLowerCase() || 'entry'}`, `${typeLabel}: ${result.payer_name || 'N/A'} — ₦${Number(result.amount).toLocaleString()}`, null, 'financial', result.id);
        return result;
    },

    createPledge: async (pledge: Partial<Pledge>) => {
        if (pledge.event_id) await ensureEventActive(pledge.event_id);
        const result = handleSupabaseError(await supabase.from('pledges').insert(pledge).select().single());
        recordAuditLog(result.event_id, 'pledge_create', `Pledge: ${result.donor_name} — ₦${Number(result.amount_pledged).toLocaleString()}`, null, 'pledge', result.id);
        return result;
    },

    clearEventData: async (eventId: string) => { 
        await ensureEventActive(eventId);
        await supabase.from('checkins').delete().eq('event_id', eventId); 
        await supabase.from('financial_entries').delete().eq('event_id', eventId); 
        await supabase.from('pledges').delete().eq('event_id', eventId); 
        recordAuditLog(eventId, 'event_clear_data', 'All checkins, financials, and pledges cleared', null, 'event', eventId);
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
    },

    recordSessionResponse: async (eventId: string, delegateId: string, sessionId: string, responseType: SessionResponseType, registrar: User): Promise<{ success: boolean; message: string }> => {
        if (!delegateId) return { success: false, message: 'Invalid delegate ID.' };
        return withRetry(async () => {
            await ensureEventActive(eventId);

            const { data: arrival } = await supabase.from('checkins')
                .select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).is('session_id', null).maybeSingle();
            if (!arrival) {
                const { error: arrivalErr } = await supabase.from('checkins').insert({
                    event_id: eventId, delegate_id: delegateId, session_id: null, checked_in_by: registrar.id
                });
                if (arrivalErr && !arrivalErr.message?.includes('duplicate')) throw arrivalErr;
            }

            const { data: sessionCheckin } = await supabase.from('checkins')
                .select('checkin_id').eq('event_id', eventId).eq('delegate_id', delegateId).eq('session_id', sessionId).maybeSingle();
            if (!sessionCheckin) {
                const { error: sessionErr } = await supabase.from('checkins').insert({
                    event_id: eventId, delegate_id: delegateId, session_id: sessionId, checked_in_by: registrar.id
                });
                if (sessionErr && !sessionErr.message?.includes('duplicate') && sessionErr.code !== '23505') throw sessionErr;
            }

            const { data: existing } = await supabase.from('session_responses')
                .select('response_id')
                .eq('event_id', eventId).eq('delegate_id', delegateId)
                .eq('session_id', sessionId).eq('response_type', responseType)
                .maybeSingle();
            if (existing) {
                return { success: false, message: 'Already recorded' };
            }

            const { error } = await supabase.from('session_responses').insert({
                event_id: eventId, delegate_id: delegateId, session_id: sessionId,
                response_type: responseType, recorded_by: registrar.id
            });
            if (error) {
                if (error.message?.includes('duplicate') || error.code === '23505') {
                    return { success: false, message: 'Already recorded' };
                }
                throw error;
            }

            const { data: audDel } = await supabase.from('delegates').select('first_name, last_name, district, chapter').eq('delegate_id', delegateId).maybeSingle();
            const audName = audDel ? `${audDel.first_name} ${audDel.last_name}` : delegateId;
            const { data: audSess } = await supabase.from('sessions').select('title').eq('session_id', sessionId).maybeSingle();
            recordAuditLog(eventId, `session_call_${responseType.toLowerCase()}`, `${RESPONSE_TYPE_LABELS[responseType]}: ${audName} (${audSess?.title || sessionId})`, registrar, 'session_response', delegateId, { session_id: sessionId, response_type: responseType });

            return { success: true, message: 'Saved' };
        });
    },

    getSessionResponses: async (sessionId: string, responseType?: SessionResponseType): Promise<SessionResponse[]> => {
        let q = supabase.from('session_responses')
            .select('*, delegates(first_name, last_name, district, chapter, phone, rank, office)')
            .eq('session_id', sessionId)
            .order('recorded_at', { ascending: false })
            .limit(500);
        if (responseType) q = q.eq('response_type', responseType);
        const { data, error } = await q;
        if (error) throw error;
        return (data || []).map((r: any) => ({
            ...r,
            first_name: r.delegates?.first_name,
            last_name: r.delegates?.last_name,
            district: r.delegates?.district,
            chapter: r.delegates?.chapter,
            phone: r.delegates?.phone,
            rank: r.delegates?.rank,
            office: r.delegates?.office,
            delegate_name: r.delegates ? `${r.delegates.first_name} ${r.delegates.last_name}` : '',
        }));
    },

    recordSessionResponseSummary: async (eventId: string, sessionId: string, responseType: SessionResponseType, totalCount: number, registrar: User): Promise<SessionResponseSummary> => {
        await ensureEventActive(eventId);
        const { data, error } = await supabase.from('session_response_summaries')
            .upsert({
                event_id: eventId, session_id: sessionId, response_type: responseType,
                total_count: totalCount, entered_by: registrar.id
            }, { onConflict: 'session_id,response_type' })
            .select().single();
        if (error) throw error;
        recordAuditLog(eventId, `session_summary_${responseType.toLowerCase()}`, `${RESPONSE_TYPE_LABELS[responseType]} summary: ${totalCount} (${sessionId})`, registrar, 'session_response_summary', sessionId, { response_type: responseType, total_count: totalCount });
        return data as SessionResponseSummary;
    },

    getSessionResponseSummaries: async (sessionId: string): Promise<SessionResponseSummary[]> => {
        const { data, error } = await supabase.from('session_response_summaries')
            .select('*').eq('session_id', sessionId);
        if (error) throw error;
        return (data || []) as SessionResponseSummary[];
    },

    recordVoiceDistribution: async (eventId: string, sessionId: string, total: number, registrar: User): Promise<VoiceDistribution> => {
        await ensureEventActive(eventId);
        const { data, error } = await supabase.from('session_voice_distribution')
            .upsert({
                event_id: eventId, session_id: sessionId, total_distributed: total, updated_by: registrar.id
            }, { onConflict: 'session_id' })
            .select().single();
        if (error) throw error;
        const { data: audSess } = await supabase.from('sessions').select('title').eq('session_id', sessionId).maybeSingle();
        recordAuditLog(eventId, 'voice_distribution', `Voice Distribution: ${total} distributed (${audSess?.title || sessionId})`, registrar, 'session', sessionId, { total });
        return data as VoiceDistribution;
    },

    getVoiceDistribution: async (sessionId: string): Promise<VoiceDistribution | null> => {
        const { data, error } = await supabase.from('session_voice_distribution')
            .select('*').eq('session_id', sessionId).maybeSingle();
        if (error) throw error;
        return (data || null) as VoiceDistribution | null;
    },

    getSessionMinistryDashboard: async (eventId: string): Promise<SessionMinistryDashboard[]> => {
        try {
            const { data, error } = await supabase.rpc('get_session_ministry_stats', { p_event_id: eventId });
            if (!error && data) {
                const rows: SessionMinistryDashboard[] = Array.isArray(data) && data.length > 0
                    ? data.map((r: any) => ({
                        session_id: r.session_id,
                        session_title: r.session_title,
                        start_time: r.start_time,
                        end_time: r.end_time,
                        attendance: Number(r.attendance) || 0,
                        ft_count: Number(r.ft_count) || 0,
                        slv_count: Number(r.slv_count) || 0,
                        hgb_count: Number(r.hgb_count) || 0,
                        mi_count: Number(r.mi_count) || 0,
                        ft_summary: Number(r.ft_summary) || 0,
                        slv_summary: Number(r.slv_summary) || 0,
                        hgb_summary: Number(r.hgb_summary) || 0,
                        mi_summary: Number(r.mi_summary) || 0,
                        voice_distribution: Number(r.voice_distribution) || 0,
                    }))
                    : [];
                return rows;
            }
        } catch {}

        const { data: sessions } = await supabase.from('sessions').select('*').eq('event_id', eventId).order('start_time');
        if (!sessions?.length) return [];

        const sessionIds = sessions.map(s => s.session_id);
        const { data: checkins } = await supabase.from('checkins').select('delegate_id, session_id').eq('event_id', eventId).in('session_id', sessionIds).not('session_id', 'is', null);
        const { data: responses } = await supabase.from('session_responses').select('*').eq('event_id', eventId).in('session_id', sessionIds);
        const { data: summaries } = await supabase.from('session_response_summaries').select('*').eq('event_id', eventId).in('session_id', sessionIds);
        const { data: vdEntries } = await supabase.from('session_voice_distribution').select('*').eq('event_id', eventId).in('session_id', sessionIds);

        return sessions.map(s => {
            const resp = (responses || []).filter(r => r.session_id === s.session_id);
            const sum = (summaries || []).filter(r => r.session_id === s.session_id);
            const vd = (vdEntries || []).find(v => v.session_id === s.session_id);
            const att = new Set((checkins || []).filter(c => c.session_id === s.session_id).map(c => c.delegate_id));
            return {
                session_id: s.session_id,
                session_title: s.title,
                start_time: s.start_time,
                end_time: s.end_time,
                attendance: att.size,
                ft_count: resp.filter(r => r.response_type === 'FT').length,
                slv_count: resp.filter(r => r.response_type === 'SLV').length,
                hgb_count: resp.filter(r => r.response_type === 'HGB').length,
                mi_count: resp.filter(r => r.response_type === 'MI').length,
                ft_summary: sum.filter(r => r.response_type === 'FT').reduce((a, x) => a + (x.total_count || 0), 0),
                slv_summary: sum.filter(r => r.response_type === 'SLV').reduce((a, x) => a + (x.total_count || 0), 0),
                hgb_summary: sum.filter(r => r.response_type === 'HGB').reduce((a, x) => a + (x.total_count || 0), 0),
                mi_summary: sum.filter(r => r.response_type === 'MI').reduce((a, x) => a + (x.total_count || 0), 0),
                voice_distribution: vd?.total_distributed || 0,
            } as SessionMinistryDashboard;
        });
    },

    getSessionResponseIds: async (eventId: string, sessionId: string, responseType: SessionResponseType): Promise<Set<string>> => {
        const { data, error } = await supabase.from('session_responses')
            .select('delegate_id')
            .eq('event_id', eventId)
            .eq('session_id', sessionId)
            .eq('response_type', responseType);
        if (error) return new Set();
        return new Set((data || []).map(r => r.delegate_id));
    },

    getMinistryDataForExport: async (eventId: string): Promise<MinistryExportData> => {
        let rpcResponses: any[] = [];
        let rpcSummaries: any[] = [];
        let rpcVD: any[] = [];

        try {
            const { data, error } = await supabase.rpc('get_ministry_export_data', { p_event_id: eventId });
            if (!error && data) {
                const d = data as any;
                rpcResponses = Array.isArray(d.responses) ? d.responses : [];
                rpcSummaries = Array.isArray(d.summaries) ? d.summaries : [];
                rpcVD = Array.isArray(d.voiceDistribution) ? d.voiceDistribution : [];
            }
        } catch {}

        const { data: sessions } = await supabase.from('sessions').select('*').eq('event_id', eventId);
        const sessionIds = (sessions || []).map(s => s.session_id);
        if (!sessionIds.length) return { responses: [], summaries: [], voiceDistribution: [], attendance: [] };

        if (!rpcResponses.length) {
            const { data: responses } = await supabase.from('session_responses')
                .select('*, delegates(first_name, last_name, district, chapter, phone, rank, office)')
                .eq('event_id', eventId).in('session_id', sessionIds).order('recorded_at', { ascending: false });
            const sessionMap = new Map((sessions || []).map(s => [s.session_id, s.title]));
            rpcResponses = (responses || []).map((r: any) => ({
                ...r,
                first_name: r.delegates?.first_name,
                last_name: r.delegates?.last_name,
                district: r.delegates?.district,
                chapter: r.delegates?.chapter,
                phone: r.delegates?.phone,
                rank: r.delegates?.rank,
                office: r.delegates?.office,
                delegate_name: r.delegates ? `${r.delegates.first_name} ${r.delegates.last_name}` : '',
                session_title: sessionMap.get(r.session_id) || '',
            }));
        }
        if (!rpcSummaries.length) {
            const { data: summaries } = await supabase.from('session_response_summaries')
                .select('*').eq('event_id', eventId).in('session_id', sessionIds);
            const sessionMap = new Map((sessions || []).map(s => [s.session_id, s.title]));
            rpcSummaries = (summaries || []).map((s: any) => ({ ...s, session_title: sessionMap.get(s.session_id) || '' }));
        }
        if (!rpcVD.length) {
            const { data: vd } = await supabase.from('session_voice_distribution')
                .select('*').eq('event_id', eventId).in('session_id', sessionIds);
            const sessionMap = new Map((sessions || []).map(s => [s.session_id, s.title]));
            rpcVD = (vd || []).map((v: any) => ({ ...v, session_title: sessionMap.get(v.session_id) || '' }));
        }

        const { data: ck } = await supabase.from('checkins')
            .select('delegate_id, session_id').eq('event_id', eventId).in('session_id', sessionIds).not('session_id', 'is', null);

        const attendance = (sessions || []).map(s => ({
            session_id: s.session_id,
            session_title: s.title,
            attendance: new Set((ck || []).filter(c => c.session_id === s.session_id).map(c => c.delegate_id)).size,
        }));

        return {
            responses: rpcResponses,
            summaries: rpcSummaries,
            voiceDistribution: rpcVD,
            attendance,
        };
    },

    getBadgeBatches: async (eventId: string): Promise<BadgeBatch[]> => {
        const { data, error } = await supabase.from('badge_batches')
            .select('*')
            .eq('event_id', eventId)
            .order('batch_number', { ascending: false });
        if (error) return [];
        return (data || []) as BadgeBatch[];
    },

    deleteBadgeBatch: async (batchId: string): Promise<boolean> => {
        const { data: batch } = await supabase.from('badge_batches').select('batch_id, pdf_url').eq('batch_id', batchId).maybeSingle();
        if (batch) {
            await supabase.storage.from('badge-pdfs').remove([resolveBadgeFileName(batch)]);
            await supabase.from('badge_print_logs').delete().eq('batch_id', batchId);
        }
        const { error } = await supabase.from('badge_batches').delete().eq('batch_id', batchId);
        return !error;
    },

    deleteBadgeBatches: async (ids: string[]): Promise<{ deleted: number }> => {
        if (!ids.length) return { deleted: 0 };
        const { data: rows } = await supabase.from('badge_batches').select('batch_id, pdf_url').in('batch_id', ids);
        for (const r of (rows || [])) {
            await supabase.storage.from('badge-pdfs').remove([resolveBadgeFileName(r)]);
        }
        await supabase.from('badge_print_logs').delete().in('batch_id', ids);
        const { error } = await supabase.from('badge_batches').delete().in('batch_id', ids);
        return { deleted: error ? 0 : ids.length };
    },

    getBadgePDFBlob: async (batch: BadgeBatch): Promise<{ blob: Blob; fileName: string } | null> => {
        const fileName = resolveBadgeFileName(batch);
        const { data, error } = await supabase.storage.from('badge-pdfs').download(fileName);
        if (error || !data) return null;
        return { blob: data, fileName };
    },

    deleteBadgePrintLogs: async (ids: string[]): Promise<boolean> => {
        if (!ids.length) return true;
        const { error } = await supabase.from('badge_print_logs').delete().in('log_id', ids);
        return !error;
    },

    clearBadgePrintLogs: async (eventId: string): Promise<boolean> => {
        const { error } = await supabase.from('badge_print_logs').delete().eq('event_id', eventId);
        return !error;
    },

    listBadgePDFs: async (): Promise<{ name: string; size: number; created_at: string; batchId: string | null }[]> => {
        const { data, error } = await supabase.storage.from('badge-pdfs').list();
        if (error || !data) return [];
        return data.map(f => ({
            name: f.name,
            size: f.metadata?.size || 0,
            created_at: f.created_at || '',
            batchId: f.name.replace('badge-batch-', '').replace('.pdf', ''),
        }));
    },

    deleteStorageFile: async (fileName: string): Promise<boolean> => {
        const { error } = await supabase.storage.from('badge-pdfs').remove([fileName]);
        return !error;
    },

    createBadgeBatch: async (batch: Omit<BadgeBatch, 'batch_id' | 'created_at' | 'generated_at' | 'pdf_url'>): Promise<BadgeBatch> => {
        const nextNum = await supabase.rpc('get_next_batch_number', { p_event_id: batch.event_id });
        handleSupabaseError(nextNum, 'Failed to get batch number');
        const batchNumber = nextNum.data || 1;
        const { data, error } = await supabase.from('badge_batches')
            .insert({ ...batch, batch_number: batchNumber, status: batch.status || 'pending' })
            .select('*')
            .single();
        handleSupabaseError({ data, error }, 'Failed to create badge batch');
        return data as BadgeBatch;
    },

    updateBadgeBatchStatus: async (batchId: string, status: BatchStatus, pdfUrl?: string): Promise<void> => {
        const updates: Record<string, unknown> = { status };
        if (status === 'ready' && pdfUrl) {
            updates.pdf_url = pdfUrl;
            updates.generated_at = new Date().toISOString();
        }
        const { error } = await supabase.from('badge_batches')
            .update(updates)
            .eq('batch_id', batchId);
        handleSupabaseError({ data: null, error }, 'Failed to update batch status');
    },

    getBadgePrintLogs: async (eventId: string, delegateId?: string): Promise<BadgePrintLog[]> => {
        let query = supabase.from('badge_print_logs')
            .select('*, delegates(first_name, last_name)')
            .eq('event_id', eventId)
            .order('created_at', { ascending: false })
            .limit(500);
        if (delegateId) query = query.eq('delegate_id', delegateId);
        const { data, error } = await query;
        if (error) return [];
        return (data || []).map((r: any) => ({
            ...r,
            delegate_name: r.delegates ? `${r.delegates.first_name} ${r.delegates.last_name}` : '',
        }));
    },

    createBadgePrintLog: async (log: Omit<BadgePrintLog, 'log_id' | 'created_at'>): Promise<void> => {
        const { error } = await supabase.from('badge_print_logs').insert(log);
        handleSupabaseError({ data: null, error }, 'Failed to create print log');
    },

    createBadgePrintLogsBatch: async (logs: Omit<BadgePrintLog, 'log_id' | 'created_at'>[]): Promise<void> => {
        for (let i = 0; i < logs.length; i += 500) {
            const chunk = logs.slice(i, i + 500);
            const { error } = await supabase.from('badge_print_logs').insert(chunk);
            handleSupabaseError({ data: null, error }, 'Failed to batch-create print logs');
        }
    },

    getDistinctDelegateDistricts: async (eventId: string): Promise<string[]> => {
        if (!eventId) return [];
        const { data } = await supabase.from('delegates')
            .select('district')
            .eq('event_id', eventId)
            .not('district', 'is', null)
            .order('district');
        return [...new Set((data || []).map(d => d.district))];
    },

    getFilteredDelegates: async (
        eventId: string,
        filters: BadgeFilter,
        sortBy: BadgeSortField = 'surname',
        limit: number = 500,
        offset: number = 0
    ): Promise<Delegate[]> => {
        if (!eventId) return [];
        let q = supabase.from('delegates').select('*').eq('event_id', eventId);

        if (filters.selectedIds?.length) {
            q = q.in('delegate_id', filters.selectedIds);
        } else {
            if (filters.district) q = q.ilike('district', `%${normalize(filters.district)}%`);
            if (filters.chapter) q = q.ilike('chapter', `%${normalize(filters.chapter)}%`);
            if (filters.delegateType) q = q.eq('delegate_type', filters.delegateType);
            if (filters.surnameFrom) q = q.gte('last_name', filters.surnameFrom);
            if (filters.surnameTo) q = q.lte('last_name', filters.surnameTo);
            if (filters.delegateNumberFrom) q = q.gte('external_id', filters.delegateNumberFrom);
            if (filters.delegateNumberTo) q = q.lte('external_id', filters.delegateNumberTo);

            if (filters.registrationStatus === 'checked_in') {
                const { data: checkedInIds } = await supabase.from('checkins')
                    .select('delegate_id').eq('event_id', eventId);
                const ids = (checkedInIds || []).map(c => c.delegate_id);
                if (ids.length) q = q.in('delegate_id', ids);
                else return [];
            } else if (filters.registrationStatus === 'not_checked_in') {
                const { data: checkedInIds } = await supabase.from('checkins')
                    .select('delegate_id').eq('event_id', eventId);
                const ids = (checkedInIds || []).map(c => c.delegate_id);
                if (ids.length) q = q.not('delegate_id', 'in', `(${ids.join(',')})`);
            }
        }

        const sortCol = sortBy === 'delegate_number' ? 'external_id' :
            sortBy === 'surname' ? 'last_name' :
            sortBy === 'category' ? 'delegate_type' :
            sortBy === 'registration_date' ? 'created_at' : sortBy;

        const { data, error } = await q.order(sortCol, { ascending: true }).range(offset, offset + limit - 1);
        if (error) return [];
        return (data || []) as Delegate[];
    },

    getFilteredDelegateCount: async (eventId: string, filters: BadgeFilter): Promise<number> => {
        if (!eventId) return 0;
        if (filters.selectedIds?.length) return filters.selectedIds.length;

        if (!filters.district && !filters.chapter && !filters.delegateType &&
            !filters.surnameFrom && !filters.surnameTo &&
            !filters.delegateNumberFrom && !filters.delegateNumberTo &&
            filters.registrationStatus !== 'checked_in' && filters.registrationStatus !== 'not_checked_in') {
            return 0;
        }

        let q = supabase.from('delegates').select('delegate_id', { count: 'exact' }).eq('event_id', eventId);

        if (filters.district) q = q.ilike('district', `%${normalize(filters.district)}%`);
        if (filters.chapter) q = q.ilike('chapter', `%${normalize(filters.chapter)}%`);
        if (filters.delegateType) q = q.eq('delegate_type', filters.delegateType);
        if (filters.surnameFrom) q = q.gte('last_name', filters.surnameFrom);
        if (filters.surnameTo) q = q.lte('last_name', filters.surnameTo);
        if (filters.delegateNumberFrom) q = q.gte('external_id', filters.delegateNumberFrom);
        if (filters.delegateNumberTo) q = q.lte('external_id', filters.delegateNumberTo);

        if (filters.registrationStatus === 'checked_in') {
            const { data: checkedInIds } = await supabase.from('checkins')
                .select('delegate_id').eq('event_id', eventId);
            const ids = (checkedInIds || []).map(c => c.delegate_id);
            if (ids.length) q = q.in('delegate_id', ids);
            else return 0;
        } else if (filters.registrationStatus === 'not_checked_in') {
            const { data: checkedInIds } = await supabase.from('checkins')
                .select('delegate_id').eq('event_id', eventId);
            const ids = (checkedInIds || []).map(c => c.delegate_id);
            if (ids.length) q = q.not('delegate_id', 'in', `(${ids.join(',')})`);
        }

        const { count, error } = await q.limit(0);
        console.log('[getFilteredDelegateCount]', { filters, count, error: error?.message });
        if (error) return 0;
        return count || 0;
    },

    uploadBadgePDF: async (batchId: string, pdfBytes: Uint8Array, customFileName?: string): Promise<string> => {
        const fileName = customFileName || `badge-batch-${batchId}.pdf`;
        const bucketName = 'badge-pdfs';

        try {
            const { data: buckets } = await supabase.storage.listBuckets();
            const bucketExists = (buckets || []).some(b => b.name === bucketName);
            if (!bucketExists) {
                await supabase.storage.createBucket(bucketName, { public: false });
            }
        } catch {}

        const { data, error } = await supabase.storage
            .from(bucketName)
            .upload(fileName, pdfBytes, {
                contentType: 'application/pdf',
                upsert: true,
            });
        handleSupabaseError({ data, error }, 'Failed to upload badge PDF');

        const { data: urlData } = supabase.storage.from(bucketName).getPublicUrl(fileName);
        return urlData.publicUrl;
    },
};