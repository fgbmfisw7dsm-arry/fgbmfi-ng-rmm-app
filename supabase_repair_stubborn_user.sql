-- ============================================================
-- FGBMFI Nigeria EMS — One-Shot Repair for Stubborn Users
-- Date: 2026-08-01
--
-- USE THIS ONLY IF supabase_migration_2026_08_fix_auth_row_integrity.sql
-- LEFT SOME USERS WITH has_email_identity = false.
--
-- This script does the most aggressive possible repair for a specific
-- user. It will:
--   1. Show all identities (all providers) for the user
--   2. Show all identities with the same provider_id across all users
--   3. Delete ALL email identities with that provider_id (destructive
--      across all users)
--   4. Insert a fresh identity for the user
--
-- BEFORE RUNNING: replace 'n_reg@fgbmfi.ng' below with the actual
-- email of the stuck user.
-- ============================================================

-- ===== STEP 1: DIAGNOSTIC (run this first, separately) =====
-- Uncomment to run just the diagnostic:
-- SELECT '--- ALL identities for stuck user ---' AS section;
-- SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
-- FROM auth.identities i
-- JOIN auth.users u ON u.email = 'n_reg@fgbmfi.ng'
-- WHERE i.user_id = u.id
-- ORDER BY i.provider, i.provider_id;
--
-- SELECT '--- ALL identities with this provider_id across all users ---' AS section;
-- SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
-- FROM auth.identities i
-- WHERE i.provider = 'email' AND i.provider_id = 'n_reg@fgbmfi.ng'
-- ORDER BY i.user_id;

-- ===== STEP 2: AGGRESSIVE REPAIR (run if diagnostic shows conflicts) =====
DO $$
DECLARE
    v_user_id      UUID;
    v_email        TEXT := 'n_reg@fgbmfi.ng';  -- ← CHANGE THIS
    v_provider_id  TEXT;
    v_deleted      INT;
    v_inserted_id  UUID;
BEGIN
    -- Find the user
    SELECT id INTO v_user_id FROM auth.users WHERE email = v_email;
    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No user found with email=%', v_email;
        RETURN;
    END IF;
    RAISE NOTICE 'Repairing user id=%, email=%', v_user_id, v_email;

    -- Determine provider_id
    IF v_email LIKE '%@%' THEN
        v_provider_id := v_email;
    ELSE
        v_provider_id := v_email || '@fgbmfi.ng';
    END IF;
    RAISE NOTICE '  provider_id=%', v_provider_id;

    -- Delete ALL email identities with this provider_id (any user_id)
    DELETE FROM auth.identities
    WHERE provider = 'email' AND provider_id = v_provider_id;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RAISE NOTICE '  Deleted % email identity(ies) with provider_id=%', v_deleted, v_provider_id;

    -- Insert fresh identity
    v_inserted_id := gen_random_uuid();
    INSERT INTO auth.identities (
        id, user_id, identity_data, provider, provider_id,
        last_sign_in_at, created_at, updated_at
    ) VALUES (
        v_inserted_id, v_user_id,
        jsonb_build_object('sub', v_user_id, 'email', v_provider_id),
        'email', v_provider_id,
        NOW(), NOW(), NOW()
    );
    RAISE NOTICE '  INSERTED new identity id=%', v_inserted_id;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'REPAIR FAILED: % (SQLSTATE=%)', SQLERRM, SQLSTATE;
END $$;

-- ===== STEP 3: VERIFY =====
SELECT id, email, has_email_identity
FROM v_auth_integrity_check
WHERE email = 'n_reg@fgbmfi.ng'  -- ← CHANGE THIS to match
   OR has_email_identity = false;
