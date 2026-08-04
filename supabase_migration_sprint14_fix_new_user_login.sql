-- ============================================================
-- MIGRATION: Sprint 14 — Fix New User Login (bcrypt cost 6→10)
-- ============================================================
-- 
-- ROOT CAUSE: PostgreSQL's gen_salt('bf') defaults to bcrypt
-- cost 6. GoTrue (Supabase Auth) generates and validates hashes
-- at bcrypt cost 10 (bcrypt.DefaultCost). During sign-in,
-- GoTrue compares the stored cost against PasswordMinBcryptCost
-- and rejects hashes below the minimum — surfacing as the
-- cryptic "unexpected response / account may be incomplete"
-- error with `stringified=Error: {}`.
--
-- Existing users created via GoTrue's signUp/admin API have
-- cost-10 hashes and log in fine. Every user created through
-- the app's create_app_user RPC carries a cost-6 hash and
-- cannot log in. Same for passwords reset via reset_user_password.
--
-- THIS MIGRATION:
--   1. Rewrites create_app_user to use gen_salt('bf', 10)
--   2. Rewrites reset_user_password to use gen_salt('bf', 10)
--   3. Enhances v_auth_integrity_check with bcrypt_cost column
--   4. Runs a REAL self-test that asserts stored bcrypt cost = 10
--      (the old test only checked columns, never hash cost)
--   5. Reports existing users with cost < 10 (need admin reset)
--
-- EXPECTED: Self-test PASSES. No existing hashes rewritten
-- (can't recover plaintext). Repair report shows which users
-- need a one-time admin password reset to become login-ready.
-- ============================================================

-- §1. DROP OLD FUNCTION SIGNATURES
-- ============================================================
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);

-- §2. REWRITE create_app_user (FULL COLUMN COVERAGE + COST 10)
-- ============================================================
CREATE OR REPLACE FUNCTION create_app_user(
    email TEXT, password TEXT, role TEXT,
    district TEXT DEFAULT NULL, region TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $func$
DECLARE
    new_user_id      UUID;
    v_instance_id    UUID;
    ins_cols         TEXT;
    ins_vals         TEXT;
    v_token_set      TEXT := '';
    confirm_ok       BOOLEAN := false;
    identities_ok    BOOLEAN := false;
    aud_set          BOOLEAN := false;
    instance_id_set  BOOLEAN := false;
    v_sanitized_role TEXT;
BEGIN
    new_user_id := gen_random_uuid();

    v_sanitized_role := CASE
        WHEN role IN ('national_admin','regional_admin','district_admin','admin',
                      'national_registrar','regional_registrar','district_registrar','registrar',
                      'finance')
        THEN role
        ELSE 'registrar'
    END;

    SELECT instance_id INTO v_instance_id
    FROM auth.users WHERE instance_id IS NOT NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1;
    instance_id_set := (v_instance_id IS NOT NULL);

    ins_cols := 'id, email, encrypted_password, created_at, updated_at, '
             || 'raw_app_meta_data, aud, role, instance_id';
    ins_vals := '$1, $2, crypt($3, gen_salt(''bf'', 10)), NOW(), NOW(), '
             || '$4, ''authenticated'', ''authenticated'', $5';

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', is_sso_user, is_anonymous';
        ins_vals := ins_vals || ', false, false';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'raw_user_meta_data' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', raw_user_meta_data';
        ins_vals := ins_vals || ', ''{}''::jsonb';
    END IF;

    IF v_instance_id IS NULL THEN
        ins_cols := REPLACE(ins_cols, ', instance_id', '');
        ins_vals := REPLACE(ins_vals, ', $5', '');
    END IF;

    BEGIN
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', v_sanitized_role, 'provider', 'email'),
                  v_instance_id;

        aud_set := true;

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id, 'email', email),
            'email', email, NOW(), NOW(), NOW()
        );

        identities_ok := true;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'auth' AND table_name = 'users'
                     AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
            EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                USING new_user_id;
            confirm_ok := true;
        END IF;

        IF NOT confirm_ok THEN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'auth' AND table_name = 'users'
                         AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
                EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                    USING new_user_id;
                confirm_ok := true;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
            v_token_set := v_token_set || 'confirmation_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
            v_token_set := v_token_set || 'recovery_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token') THEN
            v_token_set := v_token_set || 'email_change_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
            v_token_set := v_token_set || 'email_change = '''', ';
        END IF;
        v_token_set := v_token_set || 'updated_at = NOW()';
        EXECUTE 'UPDATE auth.users SET ' || v_token_set || ' WHERE id = $1' USING new_user_id;

        INSERT INTO public.app_users (id, email, role, district, region, is_active)
        VALUES (new_user_id, email, v_sanitized_role, district, region, true);
    EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object(
            'status', 'error',
            'error', SQLERRM,
            'detail', SQLSTATE
        );
    END;

    RETURN json_build_object(
        'status', 'success',
        'id', new_user_id,
        'aud_set', aud_set,
        'instance_id_set', instance_id_set,
        'confirmed', confirm_ok,
        'identities_inserted', identities_ok,
        'role_sanitized', v_sanitized_role
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'status', 'error',
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$func$;

-- §3. REWRITE reset_user_password (COST 10 + NEVER UN-CONFIRM)
-- ============================================================
CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, auth, public
AS $func$
DECLARE
    v_uid   UUID;
    v_found BOOLEAN;
BEGIN
    v_uid := user_id::uuid;
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, gen_salt('bf', 10)),
        updated_at = NOW()
    WHERE id = v_uid;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF NOT v_found THEN
        RETURN json_build_object('status', 'error', 'error', 'User not found');
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1 AND email_confirmed_at IS NULL'
            USING v_uid;
    END IF;
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
        EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, email_confirmed_at, NOW()) WHERE id = $1 AND confirmed_at IS NULL'
            USING v_uid;
    END IF;

    RETURN json_build_object('status', 'success', 'message', 'Password updated');
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('status', 'error', 'error', SQLERRM);
END;
$func$;

-- §4. ENHANCE v_auth_integrity_check WITH bcrypt_cost
-- ============================================================
DROP VIEW IF EXISTS v_auth_integrity_check;
CREATE VIEW v_auth_integrity_check AS
SELECT
  u.id,
  u.email,
  (u.aud = 'authenticated')                                        AS has_aud,
  (u.instance_id IS NOT NULL)                                      AS has_instance_id,
  (u.role IS NOT NULL)                                             AS has_role,
  (u.email_confirmed_at IS NOT NULL OR u.confirmed_at IS NOT NULL) AS is_confirmed,
  (u.encrypted_password IS NOT NULL)                               AS has_password,
  EXISTS (
    SELECT 1 FROM auth.identities i
    WHERE i.user_id = u.id AND i.provider = 'email'
  )                                                                AS has_email_identity,
  CASE WHEN u.encrypted_password IS NOT NULL
       THEN substring(u.encrypted_password from '\$2[aby]\$(\d+)')::int
       ELSE NULL
  END                                                              AS bcrypt_cost,
  u.created_at,
  u.updated_at
FROM auth.users u;

COMMENT ON VIEW v_auth_integrity_check IS
  'Audit view. A user is login-ready only when ALL flags are true AND bcrypt_cost >= 10. '
  'Query broken rows with: SELECT * FROM v_auth_integrity_check WHERE NOT has_aud OR NOT has_instance_id OR NOT is_confirmed OR NOT has_email_identity OR bcrypt_cost < 10;';

-- §5. REAL SELF-TEST (verifies bcrypt cost + password round-trip)
-- ============================================================
DO $$
DECLARE
    v_test_email TEXT := 'selftest_' || to_char(NOW(), 'YYYYMMDDHH24MISS') || '@fgbmfi.ng';
    v_result     JSON;
    v_user_id    UUID;
    v_aud_ok     BOOLEAN;
    v_conf_ok    BOOLEAN;
    v_id_ok      BOOLEAN;
    v_pwd_ok     BOOLEAN;
    v_cost       INT;
    v_pwd_match  BOOLEAN;
BEGIN
    RAISE NOTICE '=== SELF-TEST: creating test user % ===', v_test_email;
    v_result := create_app_user(v_test_email, 'selftest_password_123', 'registrar', NULL, NULL);

    IF (v_result->>'status') <> 'success' THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: create_app_user returned status=%, error=%, detail=%',
            v_result->>'status', v_result->>'error', v_result->>'detail';
    END IF;

    v_user_id := (v_result->>'id')::uuid;
    v_aud_ok  := (v_result->>'aud_set')::boolean;
    v_conf_ok := (v_result->>'confirmed')::boolean;
    v_id_ok   := (v_result->>'identities_inserted')::boolean;

    IF NOT v_aud_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: aud was not set on the new user';
    END IF;
    IF NOT v_conf_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: user was not auto-confirmed';
    END IF;
    IF NOT v_id_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: email identity was not inserted';
    END IF;

    SELECT (encrypted_password IS NOT NULL),
           substring(encrypted_password from '\$2[aby]\$(\d+)')::int
    INTO v_pwd_ok, v_cost
    FROM auth.users WHERE id = v_user_id;

    IF NOT v_pwd_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: encrypted_password was not set';
    END IF;

    IF v_cost IS NULL THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: could not extract bcrypt cost from stored hash';
    END IF;

    IF v_cost < 10 THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: bcrypt cost is % — GoTrue requires >= 10. This hash will be rejected at sign-in.', v_cost;
    END IF;

    RAISE NOTICE 'SELF-TEST: bcrypt cost confirmed as % (GoTrue requires >= 10)', v_cost;

    -- Prove the password round-trips: crypt('password', stored_hash) = stored_hash
    SELECT (encrypted_password = crypt('selftest_password_123', encrypted_password))
    INTO v_pwd_match
    FROM auth.users WHERE id = v_user_id;

    IF NOT v_pwd_match THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: password round-trip verification failed — stored hash does not match the supplied password';
    END IF;

    RAISE NOTICE 'SELF-TEST: password round-trip verification PASSED';

    IF NOT EXISTS (
        SELECT 1 FROM v_auth_integrity_check
        WHERE id = v_user_id
          AND has_aud AND has_instance_id AND has_role AND is_confirmed
          AND has_password AND has_email_identity
          AND bcrypt_cost >= 10
    ) THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: v_auth_integrity_check reports user is not login-ready';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM auth.identities
        WHERE user_id = v_user_id AND provider = 'email' AND provider_id = v_test_email
    ) THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: no auth.identities row with provider_id matching email';
    END IF;

    RAISE NOTICE 'SELF-TEST PASSED: user % is login-ready (bcrypt cost 10, all flags green)', v_test_email;

    DELETE FROM auth.identities WHERE user_id = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;
    DELETE FROM public.app_users WHERE id = v_user_id;
    RAISE NOTICE 'SELF-TEST: cleaned up test user %', v_test_email;
END $$;

-- §6. LEGACY REPAIR REPORT
-- ============================================================
RAISE NOTICE '=== LEGACY USER bcrypt COST AUDIT ===';

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM auth.users
    WHERE encrypted_password IS NOT NULL
      AND substring(encrypted_password from '\$2[aby]\$(\d+)')::int < 10;

    IF v_count > 0 THEN
        RAISE NOTICE 'WARNING: % user(s) have bcrypt cost < 10 and CANNOT LOG IN.', v_count;
        RAISE NOTICE 'For each user below, reset their password once via the admin UI (Admin → Users → Reset Password).';
        RAISE NOTICE 'After this migration, password resets use bcrypt cost 10.';
    ELSE
        RAISE NOTICE 'All existing users have bcrypt cost >= 10. No repair needed.';
    END IF;
END $$;

SELECT
    'Total auth.users'                  AS metric, COUNT(*)::TEXT AS value
FROM auth.users
UNION ALL
SELECT
    'Healthy (all flags true, cost >= 10)' AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE has_aud AND has_instance_id AND has_role AND is_confirmed
  AND has_password AND has_email_identity
  AND (bcrypt_cost IS NULL OR bcrypt_cost >= 10)
UNION ALL
SELECT
    'Broken (missing flag or cost < 10)'   AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity
           AND (bcrypt_cost IS NULL OR bcrypt_cost >= 10))
UNION ALL
SELECT
    'Users with bcrypt cost < 10 (needs reset)' AS metric, COUNT(*)::TEXT
FROM auth.users
WHERE encrypted_password IS NOT NULL
  AND substring(encrypted_password from '\$2[aby]\$(\d+)')::int < 10
UNION ALL
SELECT
    'Missing email identity'            AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE NOT has_email_identity;

-- List all broken users for triage:
SELECT id, email, has_aud, has_instance_id, has_role, is_confirmed,
       has_password, has_email_identity, bcrypt_cost
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity
           AND (bcrypt_cost IS NULL OR bcrypt_cost >= 10))
ORDER BY email;

-- List users needing password reset (bcrypt cost < 10):
SELECT id, email, substring(encrypted_password from '\$2[aby]\$(\d+)')::int AS bcrypt_cost,
       created_at
FROM auth.users
WHERE encrypted_password IS NOT NULL
  AND substring(encrypted_password from '\$2[aby]\$(\d+)')::int < 10
ORDER BY created_at DESC;

-- §7. COMPLETION
-- ============================================================
RAISE NOTICE '================================================';
RAISE NOTICE 'MIGRATION SPRINT 14 COMPLETE';
RAISE NOTICE 'create_app_user now uses bcrypt cost 10';
RAISE NOTICE 'reset_user_password now uses bcrypt cost 10';
RAISE NOTICE 'v_auth_integrity_check now includes bcrypt_cost';
RAISE NOTICE '------------------------------------------------';
RAISE NOTICE 'NEXT STEP: If the repair report shows users with';
RAISE NOTICE 'cost < 10, reset their passwords once via admin UI.';
RAISE NOTICE 'Then create a test user and verify login works.';
RAISE NOTICE '================================================';
