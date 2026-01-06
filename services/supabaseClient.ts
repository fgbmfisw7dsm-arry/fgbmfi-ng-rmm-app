
import { createClient } from '@supabase/supabase-js';

// =================================================================================
// PROJECT CONFIGURATION
// =================================================================================
// Your Supabase URL (Correct)
const supabaseUrl = 'https://qtlxhozqskisgwazuksb.supabase.co';

/**
 * ATTENTION: The key below starts with 'sb_publishable'. 
 * THIS IS A STRIPE KEY, NOT A SUPABASE KEY.
 * You must replace this with your Supabase 'anon' 'public' key 
 * found in Project Settings > API.
 */
const supabaseAnonKey = 'sb_publishable_NxbCRVjZ8B_SbTXLMZ50UQ_VVQMgpwY';

export const isSupabaseConfigured = !!supabaseUrl && !!supabaseAnonKey;

// Detects if the user has accidentally provided a Stripe key instead of a Supabase key.
export const isStripeKeyDetected = supabaseAnonKey?.startsWith('sb_publishable');

// Initialize and export the Supabase client.
// Note: If isStripeKeyDetected is true, queries to .from() will fail with "schema" errors.
export const supabase = createClient(supabaseUrl, supabaseAnonKey);
