-- ============================================================
-- FGBMFI Nigeria EMS — Auth RPC Bugfix Migration
-- Try this first. If it fails, use the alternative below.
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

DROP FUNCTION IF EXISTS auto_confirm_user(UUID);

-- Single-line body avoids any CRLF/quoting issues in Supabase Editor
CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ BEGIN UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()), updated_at = NOW() WHERE id = user_id; IF NOT FOUND THEN RETURN json_build_object('status', 'error', 'message', 'User not found'); END IF; RETURN json_build_object('status', 'success'); END; $func$;

-- ============================================================
-- ALTERNATIVE (if the above fails with "column does not exist"):
-- Use this if your Supabase project uses GoTrue v3 where
-- email_confirmed_at was renamed to confirmed_at.
-- ============================================================
-- DROP FUNCTION IF EXISTS auto_confirm_user(UUID);
-- CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID) RETURNS JSON LANGUAGE plpgsql SECURITY DEFINER AS $func$ BEGIN UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, NOW()), updated_at = NOW() WHERE id = user_id; IF NOT FOUND THEN RETURN json_build_object('status', 'error', 'message', 'User not found'); END IF; RETURN json_build_object('status', 'success'); END; $func$;
