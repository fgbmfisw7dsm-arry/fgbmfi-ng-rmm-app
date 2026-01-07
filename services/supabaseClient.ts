
import { createClient } from '@supabase/supabase-js';

// =================================================================================
// PROJECT CONFIGURATION
// =================================================================================
const supabaseUrl = 'https://qtlxhozqskisgwazuksb.supabase.co';

/**
 * PROJECT API KEY:
 * Provided by user. Verified as the 'Legacy anon publishable' key.
 * Used for frontend access in regional deployment environments.
 */
const supabaseAnonKey = 'sb_publishable_NxbCRVjZ8B_SbTXLMZ50UQ_VVQMgpwY';

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

// Flag for diagnostic UI feedback
export const isStripeKeyDetected = false; 

// Initialize and export the Supabase client with hardened settings for mobile browsers.
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'fgbmfi_auth_token' // Explicit storage key for better isolation
  }
});
