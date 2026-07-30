-- ============================================================
-- FGBMFI Nigeria EMS — Auth RPC Bugfix Migration
-- Adds: auto_confirm_user (confirm user after signUp)
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS auto_confirm_user(UUID);

CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
    UPDATE auth.users SET
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        updated_at = NOW()
    WHERE id = user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('status', 'error', 'message', 'User not found');
    END IF;

    RETURN json_build_object('status', 'success');
END;
$func$;
