-- ============================================================================
-- FGBMFI EMS — HARDENING PASS 5: admin-safe login-email change
-- ----------------------------------------------------------------------------
-- Replaces the LIVE unguarded update_auth_user_email RPC (SECURITY DEFINER +
-- EXECUTE granted to authenticated, NO admin check) which was an account-
-- takeover vector: any logged-in user could overwrite any account's login
-- email and then password-reset into it.
--
-- The replacement:
--   * admin-only (IF NOT is_admin_user() THEN RAISE)
--   * normalizes lower(trim(...)) + format validation
--   * rejects case-insensitive duplicates in auth.users AND app_users (excl. self)
--   * updates ALL login-critical surfaces in one transaction:
--       - auth.users.email  (+ ensure 'confirmed' so the NEW email + existing
--                            password log in immediately, no verification mail)
--       - auth.identities email-provider row (provider_id, identity_data.email,
--                            derived email column) -> no identity drift, so
--                            recovery/duplicate/identity lookups never break
--       - app_users.email   (keeps the UNIQUE profile row in sync)
--   * returns friendly errors (dup / user-not-found / invalid format)
--
-- Idempotent. Deploy in Supabase SQL Editor BEFORE the frontend that uses it.
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

  UPDATE auth.users SET
    email = v_email,
    email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
    confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()),
    confirmation_token = '',
    recovery_token = '',
    email_change_token = '',
    email_change = '',
    updated_at = NOW()
  WHERE id = v_uid;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated = 0 THEN
    RETURN json_build_object('status', 'error', 'message', 'User not found');
  END IF;

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

-- Verify: SELECT proname, prosrc FROM pg_proc WHERE proname = 'update_auth_user_email';
--         \df+ update_auth_user_email