-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 5e: update_auth_user_email — no direct writes to
-- derived 'email' columns
-- ----------------------------------------------------------------------------
-- Hotfix for the PERSISTING `column "email" can only be updated to DEFAULT`
-- (SQLSTATE 428C9) even after pass 5d.
--
-- Root cause: current Supabase Auth makes BOTH `auth.users.email` AND the
-- derived `auth.identities.email` GENERATED ALWAYS columns. Pass 5d made the
-- auth.users write generated-safe, but it still issued a direct
-- `UPDATE auth.identities SET email = $1` (only existence-guarded, not
-- generated-aware) — on generated-column schemas that statement raises the
-- same 428C9 error.
--
-- Fix (definitive — no path can ever hit 428C9 on an email column):
--   1. `auth.users`      -> email is ALWAYS written as raw_user_meta_data.email
--      (the base JSONB that regenerates the derived column). A direct
--      `SET email = $1` is attempted ONLY inside a nested block that swallows
--      `generated_always` (428C9) so legacy plain-column schemas still get the
--      direct write and modern schemas silently skip it.
--   2. `auth.identities` -> email is ALWAYS written as identity_data.email
--      (jsonb_set). The direct `UPDATE auth.identities SET email = $1`
--      statement is REMOVED — the derived identities.email column recomputes
--      from identity_data, and GoTrue reads email from identity_data, so no
--      derived-column write is needed on any schema generation.
--
-- All pass-5d behaviour preserved: admin gate, normalize/validate, duplicate
-- checks, column-guarded confirmation + token clears, user-rows/chapters not
-- touched. RPC signature/args/grants unchanged -> SQL-only redeploy.
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

  -- 1) auth.users: ALWAYS mirror into raw_user_meta_data (regenerates the
  --    derived 'email' column on modern Auth). COALESCE so NULL can't erase it.
  UPDATE auth.users SET
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', v_email)
  WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

  -- Attempt a direct email write for LEGACY plain-column schemas; on modern
  -- schema generations the email column is GENERATED so this raises 428C9,
  -- which is swallowed (raw_user_meta_data already updated it).
  BEGIN
    EXECUTE 'UPDATE auth.users SET email = $1 WHERE id = $2' USING v_email, v_uid;
  EXCEPTION WHEN generated_always THEN
    NULL;
  END;
  EXECUTE 'UPDATE auth.users SET updated_at = NOW() WHERE id = $1' USING v_uid;

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

  -- 2) auth.identities: email is written through identity_data ONLY (jsonb_set)
  --    — the derived identities.email column recomputes on its own. No direct
  --    email-column write here (that was the pass-5d 428C9 source).
  UPDATE auth.identities SET
    provider_id = v_email,
    identity_data = jsonb_set(
      COALESCE(identity_data, '{}'::jsonb),
      '{email}',
      to_jsonb(v_email),
      true
    ) || jsonb_build_object('sub', v_uid::text),
    updated_at = NOW()
  WHERE auth.identities.user_id = v_uid AND auth.identities.provider = 'email';
  GET DIAGNOSTICS v_identity_synced = ROW_COUNT;

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

-- Verify which schema generation you're on (generated vs plain):
-- SELECT column_name, is_generated FROM information_schema.columns
-- WHERE table_schema='auth' AND table_name='users'  AND column_name IN ('email','email_confirmed_at');
-- SELECT column_name, is_generated FROM information_schema.columns
-- WHERE table_schema='auth' AND table_name='identities' AND column_name IN ('email','identity_data');
-- Then confirm the deployed function is the pass-5e body:
-- SELECT prosrc LIKE '%generated_always%' AS pass5e_deployed FROM pg_proc
-- WHERE proname = 'update_auth_user_email';        -- true = deployed