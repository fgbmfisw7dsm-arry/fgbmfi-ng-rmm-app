import { createClient } from '@supabase/supabase-js';

// =================================================================================
// GLOBAL FETCH TIMEOUT (safety net)
// =================================================================================
// Prevents a stalled request (dead-zone mobile network, saturated connection pool,
// hung TLS handshake) from leaving a "SAVING..." button stuck silently for minutes.
// Callers that pass their own AbortSignal (e.g. image fetches with 5s timeouts)
// are not overridden.
const FETCH_TIMEOUT_MS = 25_000;
const _originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    if (init && init.signal) return _originalFetch(input, init);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    return _originalFetch(input, init ? { ...init, signal: controller.signal } : { signal: controller.signal }).finally(() => clearTimeout(timer));
};

// =================================================================================
// PROJECT CONFIGURATION
// =================================================================================
// Your specific Supabase Project URL
export const supabaseUrl = 'https://qtlxhozqskisgwazuksb.supabase.co';

/**
 * PROJECT API KEY:
 * Verified Supabase Anon Public Key (JWT).
 */
export const supabaseAnonKey: string = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF0bHhob3pxc2tpc2d3YXp1a3NiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUzNTc4ODgsImV4cCI6MjA4MDkzMzg4OH0.Nrgxg3AEAktQpyay7yxMB0pW_eE1_Db4yHwCUjdbXo4';

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