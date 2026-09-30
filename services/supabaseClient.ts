import { createClient } from '@supabase/supabase-js';

// =================================================================================
// GLOBAL FETCH TIMEOUT (safety net)
// =================================================================================
// Prevents a stalled request (dead-zone mobile network, saturated connection pool,
// hung TLS handshake) from leaving a "SAVING..." button stuck silently for minutes.
// Callers that pass their own AbortSignal (e.g. image fetches with 5s timeouts)
// are not overridden.
const FETCH_TIMEOUT_MS = 25_000;
// Body-bearing requests (storage uploads of badge PDFs, multipart payloads) can
// legitimately take far longer than a plain JSON query on venue Wi-Fi — a 25s cap
// aborts them mid-flight (Firefox: "signal is aborted without reason").
const FETCH_TIMEOUT_MS_BODY = 120_000;
const _originalFetch = globalThis.fetch.bind(globalThis);
const abortWithReason = (controller: AbortController, ms: number) =>
  controller.abort(new DOMException(`Fetch timed out after ${ms}ms`, 'TimeoutError'));
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && init.signal) return _originalFetch(input, init);
    const controller = new AbortController();
    const timeoutMs = init && init.body != null ? FETCH_TIMEOUT_MS_BODY : FETCH_TIMEOUT_MS;
    const timer = setTimeout(() => abortWithReason(controller, timeoutMs), timeoutMs);
    return _originalFetch(input, init ? { ...init, signal: controller.signal } : { signal: controller.signal }).finally(() => clearTimeout(timer));
};

// =================================================================================
// PROJECT CONFIGURATION
// =================================================================================
// Env-first (Vite inlines VITE_* at build): VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY are expected on Vercel. The literals below remain as a
// non-breaking local-dev fallback only; do not treat them as the primary config.
const FALLBACK_URL = 'https://qtlxhozqskisgwazuksb.supabase.co';
const FALLBACK_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0bHhob3pxc2tpc2d3YXp1a3NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNTc4ODgsImV4cCI6MjA4MDkzMzg4OH0.Nrgxg3AEAktQpyay7yxMB0pW_eE1_Db4yHwCUjdbXo4';

const importMetaEnv = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};

export const supabaseUrl: string = (importMetaEnv.VITE_SUPABASE_URL || FALLBACK_URL).trim();
export const supabaseAnonKey: string = (importMetaEnv.VITE_SUPABASE_ANON_KEY || FALLBACK_ANON_KEY).trim();

// Validation Logic
export const isSupabaseConfigured = !!supabaseUrl && 
                                   !!supabaseAnonKey && 
                                   supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY_HERE_STARTING_WITH_eyJ';

// Diagnostic: Returns true only if a Stripe key (starts with 'sb_' or 'pk_') is detected
export const isStripeKeyDetected = supabaseAnonKey.startsWith('sb_') || supabaseAnonKey.startsWith('pk_'); 

// Initialize the client
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'fgbmfi_auth_token' 
  }
});