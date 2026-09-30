-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 5d: update_auth_user_email generated-column fix
-- ----------------------------------------------------------------------------
-- Hotfix for: `column "email" can only be updated to DEFAULT` when editing a
-- login email in User Management.
--
-- Root cause: on current Supabase Auth the `auth.users.email` column is a
-- GENERATED ALWAYS column derived from `raw_user_meta_data ->> 'email'`, so a
-- plain `UPDATE ... SET email = $1` raises SQLSTATE 428C9 (only DEFAULT is
-- permitted). The pre-5c line `UPDATE auth.users SET email = v_email,
-- updated_at = NOW()` therefore aborts the RPC at runtime on newer Auth schemas.
--
-- Fix: the core write now
--   1) ALWAYS mirrors the new address into `raw_user_meta_data.email`
--      (COALESCE-guarded) — on generated-column schemas the `email` column
--      recomputes automatically;
--   2) additionally writes `email` DIRECTLY when the column is a plain
--      (non-generated) column, preserving older-schema behaviour.
-- updated_at is set on the matching branch. Everything else from pass 5c is
-- unchanged (admin gate, normalize/validate, duplicate checks, column-guarded
-- confirmation + token clears, identities + app_users sync).
--
-- RPC signature / arg names / grants unchanged -> SQL-only redeploy; the
-- deployed frontend keeps working.
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
  v_email_plain BOOLEAN;
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

  -- 1) Mirror into raw_user_meta_data (drives the generated 'email' column on
  --    current Supabase Auth). COALESCE so a NULL raw_user_meta_data can't
  --    erase the address.
  UPDATE auth.users SET
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', v_email)
  WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

  -- 2) Directly update 'email' when it's a plain column (legacy schemas); on
  --    generated-column schemas it recomputes from raw_user_meta_data.
  SELECT (is_generated = 'NEVER') INTO v_email_plain
  FROM information_schema.columns
  WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email';

  IF v_email_plain THEN
    EXECUTE 'UPDATE auth.users SET email = $1, updated_at = NOW() WHERE id = $2'
      USING v_email, v_uid;
  ELSE
    EXECUTE 'UPDATE auth.users SET updated_at = NOW() WHERE id = $1'
      USING v_uid;
  END IF;

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

  -- Column-qualified: the plpgsql variable `user_id` shares a name with the
  -- auth.identities.user_id column (pass-5c ambiguity fix).
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

-- Verify: SELECT column_name, is_generated FROM information_schema.columns
--         WHERE table_schema='auth' AND table_name='users' AND column_name='email';