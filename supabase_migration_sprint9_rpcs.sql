-- ============================================================
-- FGBMFI Nigeria EMS — Sprint 9: RPC Additions & Bugfixes
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- 1. get_auth_user_role: Role recovery fallback for getOrCreateProfile
--    Reads role from auth.users.raw_app_meta_data when app_users row is missing.
--    Applied in: supabaseService.ts getOrCreateProfile() line 93-96
CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = auth.uid();
$$;

-- 2. update_auth_user_email: Overwrite auth.users.email after signUp()
--    Required for non-email usernames (e.g., n_reg) that GoTrue's signUp() rejects.
--    Also confirms the user (sets email_confirmed_at) to bypass confirmation flow.
--    Applied in: supabaseService.ts createUser() after successful signUp()
CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE auth.users SET
        email = new_email,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()),
        confirmation_token = '',
        recovery_token = '',
        email_change_token = '',
        email_change = ''
    WHERE id = user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('status', 'error', 'message', 'User not found');
    END IF;

    RETURN json_build_object('status', 'success');
END;
$$;
