-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 5c: update_auth_user_email ambiguity fix
-- ----------------------------------------------------------------------------
-- Hotfix for: `column reference "user_id" is ambiguous` when editing a login
-- email in User Management.
--
-- Root cause: the function parameter is named `user_id` (matches the pre-5b
-- signature). In the direct `UPDATE auth.identities ... WHERE user_id = v_uid`
-- statement, the unqualified `user_id` is ambiguous between the plpgsql
-- variable and the `auth.identities.user_id` column, so PostgreSQL aborts at
-- runtime (the earlier `email_change_token` failure masked this because that
-- UPDATE executed first).
--
-- Fix: qualify the column references on the identity update
-- (`auth.identities.user_id`, `auth.identities.provider`). The RPC signature,
-- argument names, grants and frontend call site are UNCHANGED — the same
-- deployed client keeps working, so this is a SQL-only redeploy.
--
-- All pass-5b behaviour preserved (admin gate, normalize/validate, duplicate
-- checks, column-guarded confirmation + token clears, identities/app_users
-- sync, immediate new-email login). Idempotent.
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

  UPDATE auth.users SET email = v_email, updated_at = NOW() WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
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

  -- Column-qualified on purpose: the plpgsql variable `user_id` and the column
  -- `auth.identities.user_id` share a name — an unqualified reference is ambiguous.
  UPDATE auth.identities SET
    provider_id = v_email,
    identity_data = identity_data || jsonb_build_object('email', v_email, 'sub', v_uid::text),
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

-- Verify: do $$ begin perform update_auth_user_email('00000000-0000-0000-0000-000000000000', 'test@example.com'); end $$;
--         (expect the JSON error result, NOT an ambiguous-column exception)