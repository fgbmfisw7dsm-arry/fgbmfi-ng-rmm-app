-- RECOVERY: Fix bcrypt cost regression (2026-08-06)
-- PROBLEM: create_app_user and reset_user_password were reverted to gen_salt('bf')
--          which defaults to bcrypt cost 6. GoTrue (Supabase Auth) requires cost >= 10.
--          Users created since the regression CANNOT log in (HTTP 500).
--
-- DEPLOY ORDER (run both in the Supabase SQL Editor):
--   1. This file — re-deploys the cost-10 functions
--   2. Then reset passwords for any users created during the regression window
--
-- VERIFY AFTER DEPLOY:
--   SELECT * FROM v_auth_integrity_check WHERE bcrypt_cost < 10;
--   (should return zero rows)

-- ============================================================================
-- §1. RE-DEPLOY create_app_user WITH bcrypt cost 10
-- ============================================================================

CREATE OR REPLACE FUNCTION create_app_user(
    email TEXT,
    password TEXT,
    role TEXT,
    district TEXT DEFAULT NULL,
    region TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
    new_user_id      UUID;
    v_instance_id    UUID;
    v_sanitized_role TEXT;
    ins_cols         TEXT;
    ins_vals         TEXT;
    qry              TEXT;
    col_check        TEXT;
    aud_set          BOOLEAN;
    instance_id_set  BOOLEAN;
    confirmed        BOOLEAN;
    identities_inserted BOOLEAN;
BEGIN
    new_user_id := gen_random_uuid();

    -- Role sanitization
    SELECT CASE
        WHEN lower(role) IN ('admin','finance','registrar','reader','super_admin') THEN lower(role)
        WHEN lower(role) IN ('admin','administrator','system') THEN 'admin'
        WHEN lower(role) IN ('finance','financial','accountant','accounts','treasury','treasurer','bursar','auditor','audit','bookkeeper','bookkeeping') THEN 'finance'
        WHEN lower(role) IN ('registrar','register','registration','reg','officer','operator','clerk','secretary','events','event','event_admin','event_manager','event_lead','event_coordinator','ministry','field','missions','mission','mobilisation','mobilization','protocol','logistics','media','communications','welfare','hospitality','prayer','intercessor','medical','security','transport','decoration','sanitation','usher','choir','technical','tech','it','program','programs','programme','moderator','master_of_ceremony','mc','session_monitor','badge','printing') THEN 'registrar'
        ELSE 'registrar'
    END INTO v_sanitized_role;

    -- Get instance_id from an existing healthy user
    SELECT instance_id INTO v_instance_id
    FROM auth.users WHERE instance_id IS NOT NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1;
    instance_id_set := (v_instance_id IS NOT NULL);

    -- Build dynamic INSERT — KEY: bcrypt cost 10 via manual salt (NOT gen_salt('bf') which defaults to 6)
    ins_cols := 'id, email, encrypted_password, created_at, updated_at, '
             || 'raw_app_meta_data, aud, role, instance_id';
    ins_vals := '$1, $2, crypt($3, ''$2a$10$'' || substring(translate(encode(decode(md5(random()::text), ''hex''), ''base64''), ''+/'', ''./''), 1, 22)), NOW(), NOW(), '
             || '$4, ''authenticated'', ''authenticated'', $5';

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', is_sso_user, is_anonymous';
        ins_vals := ins_vals || ', false, false';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'phone' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', phone';
        ins_vals := ins_vals || ', NULL::text';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'email_change_token_new'
                 AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', email_change_token_new, email_change, recovery_token';
        ins_vals := ins_vals || ', NULL::text, NULL::text, NULL::text';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'banned_until'
                 AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', banned_until';
        ins_vals := ins_vals || ', NULL::timestamptz';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'reauthentication_token' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', reauthentication_token, reauthentication_sent_at';
        ins_vals := ins_vals || ', NULL::text, NULL::timestamptz';
    END IF;

    qry := 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')';
    EXECUTE qry
        USING new_user_id, email, password,
              jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
              v_instance_id;

    aud_set := TRUE;

    -- INSERT identity row
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (gen_random_uuid(), new_user_id, jsonb_build_object('sub', new_user_id::text, 'email', email), 'email', email, NOW(), NOW(), NOW());
    identities_inserted := TRUE;

    -- Confirm user via email_confirmed_at OR confirmed_at OR token-clear fallback
    confirmed := FALSE;
    BEGIN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW() WHERE id = $1' USING new_user_id;
        confirmed := TRUE;
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            EXECUTE 'UPDATE auth.users SET confirmed_at = NOW() WHERE id = $1' USING new_user_id;
            confirmed := TRUE;
        EXCEPTION WHEN OTHERS THEN
            BEGIN
                UPDATE auth.users
                SET raw_app_meta_data = raw_app_meta_data || '{"email_verified": true}'::jsonb
                WHERE id = new_user_id;
                confirmed := TRUE;
            EXCEPTION WHEN OTHERS THEN NULL;
            END;
        END;
    END;

    -- Insert into app_users
    INSERT INTO public.app_users (id, email, role, district, region, is_active)
    VALUES (new_user_id, email, v_sanitized_role, district, region, TRUE);

    RETURN json_build_object(
        'status', 'success',
        'id', new_user_id,
        'aud_set', aud_set,
        'instance_id_set', instance_id_set,
        'confirmed', confirmed,
        'identities_inserted', identities_inserted
    );
END;
$func$;

-- ============================================================================
-- §2. RE-DEPLOY reset_user_password WITH bcrypt cost 10
-- ============================================================================

CREATE OR REPLACE FUNCTION reset_user_password(
    user_id TEXT,
    new_password TEXT
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $func$
DECLARE
    v_uid   UUID;
    v_found BOOLEAN;
BEGIN
    v_uid := user_id::uuid;
    UPDATE auth.users
    SET encrypted_password = crypt(new_password, '$2a$10$' || substring(translate(encode(decode(md5(random()::text), 'hex'), 'base64'), '+/', './'), 1, 22)),
        updated_at = NOW()
    WHERE id = v_uid;
    GET DIAGNOSTICS v_found = ROW_COUNT;
    IF NOT v_found THEN
        RETURN json_build_object('status', 'error', 'error', 'User not found');
    END IF;

    -- Ensure confirmed
    BEGIN
        EXECUTE 'UPDATE auth.users SET email_confirmed_at = COALESCE(email_confirmed_at, NOW()) WHERE id = $1' USING v_uid;
    EXCEPTION WHEN OTHERS THEN
        BEGIN
            EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, NOW()) WHERE id = $1' USING v_uid;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
    END;

    RETURN json_build_object('status', 'success', 'id', v_uid::text);
END;
$func$;

-- ============================================================================
-- §3. AUDIT: List users with bcrypt cost < 10
-- ============================================================================

DO $$
DECLARE
    v_count INT;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM auth.users
    WHERE encrypted_password IS NOT NULL
      AND substring(encrypted_password FROM '\$2[aby]\$(\d+)')::INT < 10;

    IF v_count > 0 THEN
        RAISE NOTICE 'WARNING: % user(s) have bcrypt cost < 10 and CANNOT LOG IN.', v_count;
        RAISE NOTICE '';
        RAISE NOTICE 'These users (listed below) must have their passwords reset:';
        RAISE NOTICE 'Option A (per-user): Go to Admin > Users, find each user, click "Reset Password".';
        RAISE NOTICE 'Option B (bulk): Run the SQL at the bottom of this file to reset all affected users.';
    ELSE
        RAISE NOTICE 'All existing users have bcrypt cost >= 10. No repair needed.';
    END IF;
END;
$$;

-- List affected users for manual review
SELECT
    id,
    email,
    substring(encrypted_password FROM '\$2[aby]\$(\d+)')::INT AS bcrypt_cost,
    created_at
FROM auth.users
WHERE encrypted_password IS NOT NULL
  AND substring(encrypted_password FROM '\$2[aby]\$(\d+)')::INT < 10
ORDER BY created_at DESC;

-- ============================================================================
-- §4. SELF-TEST: Verify the fix works
-- ============================================================================

DO $$
DECLARE
    v_test_email TEXT;
    v_pwd_ok     BOOLEAN;
    v_cost       INT;
    v_user_id    UUID;
BEGIN
    v_test_email := 'selftest_bcrypt10_' || floor(random()*100000)::text || '@test.local';

    -- Create test user with cost-10 hash
    PERFORM create_app_user(v_test_email, 'selftest_password_123', 'admin');

    -- Verify the stored hash
    SELECT id, substring(encrypted_password FROM '\$2[aby]\$(\d+)')::INT
    INTO v_user_id, v_cost
    FROM auth.users WHERE email = v_test_email;

    IF v_cost IS NULL OR v_cost < 10 THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: bcrypt cost is % — GoTrue requires >= 10', v_cost;
    END IF;

    -- Prove password round-trips
    SELECT (encrypted_password = crypt('selftest_password_123', encrypted_password))
    INTO v_pwd_ok
    FROM auth.users WHERE id = v_user_id;

    IF NOT v_pwd_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: password does not verify';
    END IF;

    -- Cleanup
    DELETE FROM auth.identities WHERE user_id = v_user_id;
    DELETE FROM public.app_users WHERE id = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;

    RAISE NOTICE 'SELF-TEST PASSED: bcrypt cost 10 verified, password round-trips correctly';
END;
$$;

-- ============================================================================
-- §5. OPTIONAL: Bulk reset ALL affected users to a temporary password
--    UNCOMMENT this block if you want to bulk-fix all users at once.
--    IMPORTANT: This overwrites existing passwords with a TEMP one.
--    After running, distribute the new passwords to each affected user.
-- ============================================================================
/*
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT id, email
        FROM auth.users
        WHERE encrypted_password IS NOT NULL
          AND substring(encrypted_password FROM '\$2[aby]\$(\d+)')::INT < 10
    LOOP
        -- Resets password to the email prefix (before @) — change as needed
        PERFORM reset_user_password(r.id::text, split_part(r.email, '@', 1) || '_fgbmfi#1');
        RAISE NOTICE 'Reset password for: %', r.email;
    END LOOP;
    RAISE NOTICE 'Done. All users now have bcrypt cost 10 hashes.';
END;
$$;
*/
