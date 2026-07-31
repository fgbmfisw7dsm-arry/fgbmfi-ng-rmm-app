-- ============================================================
-- FGBMFI Nigeria EMS — Fix: Force User Confirmation After signUp
-- Run this in Supabase SQL Editor.
--
-- GoTrue checks BOTH confirmed_at AND email_confirmed_at for IsConfirmed().
-- If confirmed_at is GENERATED ALWAYS (v3+), we confirm via email_confirmed_at.
-- ============================================================

-- 1. update auto_confirm_user: try email_confirmed_at FIRST, then confirmed_at
CREATE OR REPLACE FUNCTION auto_confirm_user(user_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  v_confirmed BOOLEAN := false;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER'
  ) THEN
    EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
    v_confirmed := true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'confirmed_at' AND is_generated = 'NEVER'
  ) THEN
    EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1' USING user_id;
    v_confirmed := true;
  END IF;

  EXECUTE 'UPDATE auth.users SET confirmation_token = '''', confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()), recovery_token = '''', email_change_token = '''', email_change = '''', updated_at = NOW() WHERE id = $1' USING user_id;

  RETURN json_build_object('status', 'success', 'confirmed', v_confirmed);
EXCEPTION WHEN OTHERS THEN
  RETURN json_build_object('status', 'ok', 'message', SQLERRM);
END;
$func$;

-- 2. Ensure update_auth_user_email exists (may have been created in Sprint 8.5)
CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
BEGIN
  UPDATE auth.users SET
    email = new_email,
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()),
    confirmation_token = '',
    recovery_token = '',
    email_change_token = '',
    email_change = '',
    updated_at = NOW()
  WHERE id = user_id;

  IF NOT FOUND THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

  RETURN json_build_object('status', 'success');
END;
$func$;
