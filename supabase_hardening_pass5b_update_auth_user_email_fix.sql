-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 5b: update_auth_user_email column-guard fix
-- ----------------------------------------------------------------------------
-- Hotfix for: `column "email_change_token" of relation "users" does not exist`
-- when editing a login email in User Management.
--
-- Root cause: the pass-5 RPC cleared stale GoTrue auth state via a fixed SET
-- list that referenced `email_change_token` (a pre-modern column name). The
-- live `auth.users` schema (current GoTrue) uses `email_change_token_new`,
-- `email_change_token_current` and `email_change_confirm_status` instead, so
-- the entire UPDATE failed at runtime on every call.
--
-- Fix: the function now touches ONLY columns confirmed present via
-- information_schema guards (same defensive pattern as `confirm_user_by_email`),
-- and performs the core update (`email`, `updated_at`) first so a guarded
-- failure can never block the email change itself. All behaviour from pass 5 is
-- preserved: admin-only, normalize/validate, duplicate checks, identities sync,
-- app_users sync, immediate new-email login.
--
-- Idempotent. Run in Supabase SQL Editor; frontend needs NO change.
-- ============================================================================

CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
  v_uid UUID;
  v_email TEXT;
  v_taken BOOLEAN;
  v_updated INT := 0;
  v_identity_synced INT := 0;
  v_confirmed BOOLEAN := false;
BEGIN
  IF NOT is_admin_user() THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
  END IF;

  v_uid   := user_id;
  v_email := lower(trim(new_email));

  IF v_email = '' OR v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN
    RETURN json_build_object('status', 'error', 'message', 'Invalid email address');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM auth.users
    WHERE lower(trim(email)) = v_email AND id <> v_uid
  ) INTO v_taken;
  IF v_taken THEN
    RETURN json_build_object('status', 'error', 'message', 'Email already in use by another account');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE lower(trim(email)) = v_email AND id <> v_uid
  ) INTO v_taken;
  IF v_taken THEN
    RETURN json_build_object('status', 'error', 'message', 'Email already in use by another account');
  END IF;

  -- Core write first: the new address MUST land even if a token-clear guard
  -- would ever fail (it cannot now — all optional columns below are guarded).
  UPDATE auth.users SET email = v_email, updated_at = NOW() WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

  -- Keep the account confirmed for the new login address (single guarded path).
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users'
               AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
    EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1'
      USING v_uid;
    v_confirmed := true;
  END IF;
  IF NOT v_confirmed AND EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users'
               AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
    EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1'
      USING v_uid;
    v_confirmed := true;
  END IF;
  IF NOT v_confirmed THEN
    UPDATE auth.users
    SET raw_app_meta_data = raw_app_meta_data || '{"email_verified": true}'::jsonb
    WHERE id = v_uid;
  END IF;

  -- Clear any pending email-change / recovery state. EVERY column is guarded
  -- individually because the token-column surface differs across GoTrue schema
  -- versions (email_change_token vs email_change_token_new/current/confirm_status).
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
    EXECUTE 'UPDATE auth.users SET email_change = $1 WHERE id = $2' USING '', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token') THEN
    EXECUTE 'UPDATE auth.users SET email_change_token = $1 WHERE id = $2' USING '', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token_new') THEN
    EXECUTE 'UPDATE auth.users SET email_change_token_new = $1 WHERE id = $2' USING '', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token_current') THEN
    EXECUTE 'UPDATE auth.users SET email_change_token_current = $1 WHERE id = $2' USING '', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_confirm_status') THEN
    EXECUTE 'UPDATE auth.users SET email_change_confirm_status = 0 WHERE id = $1' USING v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
    EXECUTE 'UPDATE auth.users SET recovery_token = $1 WHERE id = $2' USING '', v_uid;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
    EXECUTE 'UPDATE auth.users SET confirmation_token = $1 WHERE id = $2' USING '', v_uid;
  END IF;

  -- Sync the email identity row so recovery/duplicate/identity lookups stay aligned.
  UPDATE auth.identities SET
    provider_id = v_email,
    identity_data = identity_data || jsonb_build_object('email', v_email, 'sub', v_uid::text),
    updated_at = NOW()
  WHERE user_id = v_uid AND provider = 'email';
  GET DIAGNOSTICS v_identity_synced = ROW_COUNT;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'auth' AND table_name = 'identities' AND column_name = 'email') THEN
    EXECUTE 'UPDATE auth.identities SET email = $1 WHERE user_id = $2 AND provider = ''email'''
      USING v_email, v_uid;
  END IF;

  UPDATE app_users SET email = v_email WHERE id = v_uid;

  RETURN json_build_object(
    'status', 'success',
    'email', v_email,
    'identity_synced', v_identity_synced > 0
  );
EXCEPTION WHEN unique_violation THEN
  RETURN json_build_object('status', 'error', 'message', 'Email already in use by another account');
WHEN OTHERS THEN
  RETURN json_build_object('status', 'error', 'message', SQLERRM);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_auth_user_email(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_auth_user_email(UUID, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.update_auth_user_email(UUID, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.update_auth_user_email(UUID, TEXT) TO service_role;

-- Verify: SELECT proname FROM pg_proc WHERE proname = 'update_auth_user_email';
--         SELECT column_name FROM information_schema.columns
--         WHERE table_schema='auth' AND table_name='users'
--         AND column_name IN ('email_change','email_change_token','email_change_token_new',
--                             'email_change_token_current','email_change_confirm_status',
--                             'recovery_token','confirmation_token') ORDER BY 1;