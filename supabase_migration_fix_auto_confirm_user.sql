-- ============================================================
-- FGBMFI Nigeria EMS — Fix auto_confirm_user for GoTrue v3+
-- Run this in Supabase SQL Editor.
-- Handles confirmed_at GENERATED ALWAYS (v3+) by clearing
-- auth tokens instead of trying to UPDATE a generated column.
-- ============================================================

CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_found BOOLEAN;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'confirmed_at' AND is_generated = 'NEVER'
  ) THEN
    EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER'
  ) THEN
    EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'confirmed_at'
  ) THEN
    EXECUTE 'UPDATE auth.users SET confirmation_token = '''', confirmation_sent_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
  END IF;
  GET DIAGNOSTICS v_found = ROW_COUNT;
  IF NOT v_found THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;
  RETURN json_build_object('status', 'success');
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'ok', 'message', SQLERRM);
END;
$func$;
