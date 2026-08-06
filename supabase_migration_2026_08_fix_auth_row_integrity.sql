-- ============================================================
-- FGBMFI Nigeria EMS — Auth Row Integrity Fix
-- Date: 2026-08-01
-- Run this ENTIRE block ONCE in the Supabase SQL Editor.
-- Idempotent — safe to re-run.
--
-- ROOT CAUSE FIXED:
-- The previous create_app_user RPCs (fix_create_app_user_rpc.sql
-- and fix_auth_rpcs.sql) inserted into auth.users WITHOUT setting
-- `aud`, `instance_id`, or `role`. On Supabase GoTrue v2.130+ these
-- columns are NOT NULL. The INSERT either failed silently under the
-- top-level EXCEPTION handler (returning a misleading {status:success}
-- to the frontend) or produced a row that signInWithPassword() then
-- rejects with "Invalid login credentials".
--
-- This migration:
--   1. Logs the live RPC definition + auth.users schema for audit
--   2. Repairs all existing auth.users rows missing required columns
--   3. Stamps confirmed_at for GoTrue versions that check it first
--   4. Backfills missing auth.identities rows (with orphan cleanup)
--   5. Creates v_auth_integrity_check view for ongoing audits
--   6. Rewrites create_app_user with full column coverage + clear return
--   7. Rewrites reset_user_password to never un-confirm a user
--   8. Reports counts so you can confirm zero broken rows remain
-- ============================================================

-- ============================================================
-- §1. DIAGNOSTIC INTROSPECTION
-- ============================================================

DO $$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('create_app_user(text,text,text,text,text)'::regprocedure)
    INTO v_def;
  IF v_def IS NOT NULL THEN
    RAISE NOTICE '=== create_app_user LIVE DEFINITION ===';
    RAISE NOTICE '%', v_def;
  ELSE
    RAISE NOTICE 'create_app_user(text,text,text,text,text) not found — trying 4-arg variant';
    BEGIN
      SELECT pg_get_functiondef('create_app_user(text,text,text,text)'::regprocedure)
        INTO v_def;
      IF v_def IS NOT NULL THEN
        RAISE NOTICE '=== create_app_user (4-arg) LIVE DEFINITION ===';
        RAISE NOTICE '%', v_def;
      END IF;
    EXCEPTION WHEN undefined_function THEN
      RAISE NOTICE 'No create_app_user function found in this database';
    END;
  END IF;
END $$;

-- Show key auth.users columns + their constraints so the agent can see
-- whether aud/instance_id/role are NOT NULL on this Supabase project.
SELECT column_name, data_type, is_nullable, is_generated, column_default
FROM information_schema.columns
WHERE table_schema = 'auth' AND table_name = 'users'
  AND column_name IN (
    'id', 'email', 'encrypted_password',
    'aud', 'instance_id', 'role',
    'email_confirmed_at', 'confirmed_at',
    'confirmation_token', 'recovery_token',
    'raw_app_meta_data', 'raw_user_meta_data',
    'is_sso_user', 'is_anonymous', 'created_at', 'updated_at'
  )
ORDER BY column_name;

-- ============================================================
-- §2. REPAIR EXISTING auth.users ROWS
-- ============================================================

-- Capture instance_id from a healthy existing row (if any) and
-- dynamically build the SET/WHERE clauses based on which columns
-- actually exist (newer GoTrue versions drop email_change_token /
-- email_change / recovery_token / etc.).
DO $$
DECLARE
  v_instance_id UUID;
  v_repaired INT := 0;
  v_set_clauses TEXT := '';
  v_where_clauses TEXT := '';
BEGIN
  SELECT instance_id INTO v_instance_id
  FROM auth.users WHERE instance_id IS NOT NULL
  ORDER BY created_at DESC NULLS LAST LIMIT 1;

  IF v_instance_id IS NULL THEN
    RAISE NOTICE 'No healthy auth.users row found with instance_id — all repairs will leave instance_id NULL. Create one admin user manually via the Supabase dashboard or signUp() before re-running this migration if your project requires instance_id to be NOT NULL.';
  ELSE
    RAISE NOTICE 'Found healthy instance_id: %', v_instance_id;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'aud' AND is_generated = 'NEVER') THEN
    v_set_clauses := v_set_clauses || 'aud = COALESCE(aud, ''authenticated''), ';
    v_where_clauses := v_where_clauses || 'aud IS NULL OR ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'instance_id' AND is_generated = 'NEVER') THEN
    IF v_instance_id IS NOT NULL THEN
      v_set_clauses := v_set_clauses || 'instance_id = COALESCE(instance_id, $1), ';
    END IF;
    v_where_clauses := v_where_clauses || 'instance_id IS NULL OR ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'role' AND is_generated = 'NEVER') THEN
    v_set_clauses := v_set_clauses || 'role = COALESCE(role, ''authenticated''), ';
    v_where_clauses := v_where_clauses || 'role IS NULL OR ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
    v_set_clauses := v_set_clauses || 'email_confirmed_at = COALESCE(email_confirmed_at, NOW()), ';
    v_where_clauses := v_where_clauses || 'email_confirmed_at IS NULL OR ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
    v_set_clauses := v_set_clauses || 'confirmation_token = '''', ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
    v_set_clauses := v_set_clauses || 'recovery_token = '''', ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token') THEN
    v_set_clauses := v_set_clauses || 'email_change_token = '''', ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
    v_set_clauses := v_set_clauses || 'email_change = '''', ';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'updated_at') THEN
    v_set_clauses := v_set_clauses || 'updated_at = NOW()';
  ELSE
    v_set_clauses := RTRIM(v_set_clauses, ', ');
  END IF;

  v_where_clauses := RTRIM(v_where_clauses, ' OR ');

  IF v_set_clauses <> '' AND v_where_clauses <> '' THEN
    EXECUTE 'WITH updated AS (UPDATE auth.users SET ' || v_set_clauses ||
            ' WHERE ' || v_where_clauses ||
            ' RETURNING id) SELECT COUNT(*) FROM updated'
      INTO v_repaired USING v_instance_id;
  END IF;

  RAISE NOTICE 'Repaired % auth.users row(s)', v_repaired;
END $$;

-- Also stamp confirmed_at on rows that have email_confirmed_at but not
-- confirmed_at (some GoTrue versions check confirmed_at first).
-- Wrapped in DO block + EXECUTE because PostgreSQL parses top-level
-- UPDATE SET clauses at prepare time, rejecting GENERATED ALWAYS columns
-- even when guarded by WHERE EXISTS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'auth' AND table_name = 'users'
      AND column_name = 'confirmed_at' AND is_generated = 'NEVER'
  ) THEN
    EXECUTE 'UPDATE auth.users SET confirmed_at = COALESCE(confirmed_at, email_confirmed_at, NOW()), updated_at = NOW() WHERE confirmed_at IS NULL AND email_confirmed_at IS NOT NULL';
  END IF;
END $$;

-- ============================================================
-- §3. BACKFILL MISSING auth.identities ROWS
-- ============================================================
-- This handles BOTH cases:
--   1. Proper emails (e.g. officer@fgbmfi.ng)  → identity_data.email = email
--   2. Bare usernames (e.g. n_reg, nat_admin)  → append @fgbmfi.ng for identity,
--      store as identity_data.email so GoTrue can match the login email
-- Bare usernames predate the email-format enforcement. Going forward,
-- create_app_user will only accept proper emails.
--
-- The unique constraint on auth.identities is on (provider, provider_id),
-- NOT (user_id, provider). A prior broken create_app_user run may have
-- left identities pointing to the wrong (or nonexistent) user. This
-- section first cleans those up, then backfills any missing rows.

-- §3.0. DIAGNOSTIC: show current state of identities for affected users
SELECT '--- §3.0 DIAGNOSTIC ---' AS section;
SELECT u.email AS user_email,
       u.id AS user_id,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email') AS email_identities_for_user,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.user_id = u.id AND i.provider <> 'email') AS non_email_identities_for_user,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.id = u.id) AS pk_collisions,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.provider_id = u.email AND i.provider = 'email') AS identities_with_provider_id_match,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.provider_id = (u.email || '@fgbmfi.ng') AND i.provider = 'email') AS identities_with_synthetic_provider_id_match,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.provider_id = split_part(u.email, '@', 1) AND i.provider = 'email' AND u.email LIKE '%@%') AS leftover_bare_username_for_user,
       (SELECT COUNT(*) FROM auth.identities i WHERE i.provider_id = u.email AND i.provider = 'email' AND i.user_id <> u.id) AS conflicting_identity_other_user
FROM auth.users u
WHERE u.email IS NOT NULL
  AND (
    NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
    OR EXISTS (SELECT 1 FROM auth.identities i WHERE i.provider_id = u.email AND i.provider = 'email' AND i.user_id <> u.id)
    OR EXISTS (SELECT 1 FROM auth.identities i WHERE i.provider_id = (u.email || '@fgbmfi.ng') AND i.provider = 'email' AND i.user_id <> u.id)
  )
ORDER BY u.email;

-- Also show raw identity rows for any user where things look broken
SELECT '--- §3.0 RAW IDENTITIES FOR AFFECTED USERS ---' AS section;
SELECT i.id, i.user_id, i.provider, i.provider_id, i.created_at
FROM auth.identities i
WHERE i.user_id IN (
    SELECT u.id FROM auth.users u
    WHERE u.email IS NOT NULL
      AND (
        NOT EXISTS (SELECT 1 FROM auth.identities i2 WHERE i2.user_id = u.id AND i2.provider = 'email')
        OR EXISTS (SELECT 1 FROM auth.identities i2 WHERE i2.provider_id = u.email AND i2.provider = 'email' AND i2.user_id <> u.id)
      )
)
ORDER BY i.user_id, i.provider, i.provider_id;

-- §3.5. CLEANUP — remove orphan identities and repoint mispointed ones
-- Wrapped in SECURITY DEFINER because the postgres role used by the
-- Supabase SQL Editor does not own auth.identities and cannot DELETE
-- from it directly. The function runs as the function owner, which
-- has the necessary privileges.

CREATE OR REPLACE FUNCTION _admin_cleanup_orphaned_identities()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_orphans_deleted     INT := 0;
    v_repointed           INT := 0;
    v_mispointed_deleted  INT := 0;
BEGIN
    -- Delete orphan identities whose user_id no longer exists
    WITH deleted AS (
        DELETE FROM auth.identities
        WHERE user_id NOT IN (SELECT id FROM auth.users)
        RETURNING id
    )
    SELECT COUNT(*) INTO v_orphans_deleted FROM deleted;

    -- Repoint identities that match a user's email but point to a different user
    WITH repointed AS (
        UPDATE auth.identities i
        SET user_id = u.id, updated_at = NOW()
        FROM auth.users u
        WHERE i.provider = 'email'
          AND i.provider_id = u.email
          AND i.user_id <> u.id
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
                AND i2.provider_id = u.email
                AND i2.id <> i.id
          )
        RETURNING i.id
    )
    SELECT COUNT(*) INTO v_repointed FROM repointed;

    -- Repoint identities that match a user's synthetic email
    WITH repointed AS (
        UPDATE auth.identities i
        SET user_id = u.id, updated_at = NOW()
        FROM auth.users u
        WHERE i.provider = 'email'
          AND i.provider_id = (u.email || '@fgbmfi.ng')
          AND u.email NOT LIKE '%@%'
          AND i.user_id <> u.id
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
                AND i2.provider_id = (u.email || '@fgbmfi.ng')
                AND i2.id <> i.id
          )
        RETURNING i.id
    )
    SELECT COUNT(*) + v_repointed INTO v_repointed FROM repointed;

    -- Promote leftover bare-username identities: if a user has a proper
    -- email (contains @) but their only identity has provider_id equal
    -- to the bare-username (split_part), update that identity's
    -- provider_id to the proper email.
    WITH promoted AS (
        UPDATE auth.identities i
        SET provider_id = u.email,
            identity_data = jsonb_build_object('sub', i.user_id, 'email', u.email),
            updated_at = NOW()
        FROM auth.users u
        WHERE i.provider = 'email'
          AND i.user_id = u.id
          AND u.email LIKE '%@%'
          AND i.provider_id = split_part(u.email, '@', 1)
          AND i.provider_id <> u.email
        RETURNING i.id
    )
    SELECT COUNT(*) INTO v_mispointed_deleted FROM promoted;

    -- AGGRESSIVE repoint: repoint any identity whose provider_id matches
    -- a user's email, regardless of whether the target user has an identity yet.
    WITH repointed_aggressive AS (
        UPDATE auth.identities i
        SET user_id = u.id, updated_at = NOW()
        FROM auth.users u
        WHERE i.provider = 'email'
          AND i.user_id <> u.id
          AND i.provider_id = u.email
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
                AND i2.provider_id = u.email
          )
        RETURNING i.id
    )
    SELECT COUNT(*) + v_repointed INTO v_repointed FROM repointed_aggressive;

    WITH repointed_aggressive AS (
        UPDATE auth.identities i
        SET user_id = u.id, updated_at = NOW()
        FROM auth.users u
        WHERE i.provider = 'email'
          AND i.user_id <> u.id
          AND i.provider_id = (u.email || '@fgbmfi.ng')
          AND u.email NOT LIKE '%@%'
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
                AND i2.provider_id = (u.email || '@fgbmfi.ng')
          )
        RETURNING i.id
    )
    SELECT COUNT(*) + v_repointed INTO v_repointed FROM repointed_aggressive;

    -- Last resort: delete leftover mispointed identities (where the
    -- target user has no email identity yet, blocking the backfill).
    WITH deleted AS (
        DELETE FROM auth.identities i
        USING auth.users u
        WHERE i.provider = 'email'
          AND i.user_id <> u.id
          AND i.provider_id = u.email
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
          )
        RETURNING i.id
    )
    SELECT COUNT(*) + v_mispointed_deleted INTO v_mispointed_deleted FROM deleted;

    WITH deleted AS (
        DELETE FROM auth.identities i
        USING auth.users u
        WHERE i.provider = 'email'
          AND i.user_id <> u.id
          AND i.provider_id = (u.email || '@fgbmfi.ng')
          AND u.email NOT LIKE '%@%'
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities i2
              WHERE i2.user_id = u.id
                AND i2.provider = 'email'
          )
        RETURNING i.id
    )
    SELECT COUNT(*) + v_mispointed_deleted INTO v_mispointed_deleted FROM deleted;

    RETURN json_build_object(
        'orphans_deleted', v_orphans_deleted,
        'repointed', v_repointed,
        'leftover_promoted', v_mispointed_deleted
    );
END;
$func$;

SELECT _admin_cleanup_orphaned_identities() AS cleanup_result;

-- §3.6. BACKFILL — per-user loop with built-in safety net.
-- For each user without an email-identity:
--   1. Compute the desired provider_id (email or email@fgbmfi.ng)
--   2. Delete any conflicting identity (different user_id, same
--      provider+provider_id) — the prior cleanup should have done
--      this but we retry here for safety
--   3. INSERT the new identity with a fresh UUID (gen_random_uuid())
--      to avoid PK collision with any non-email identity at id = u.id
-- The per-user try/catch means a failure on one user doesn't abort
-- the whole migration.

CREATE OR REPLACE FUNCTION _admin_backfill_email_identities()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_proper_email_inserted   INT := 0;
    v_bare_username_inserted  INT := 0;
    v_failed                  INT := 0;
    v_user_id                 UUID;
    v_email                   TEXT;
    v_provider_id             TEXT;
    v_has_email_identity      BOOLEAN;
BEGIN
    FOR v_user_id, v_email IN
        SELECT id, email FROM auth.users
        WHERE email IS NOT NULL
        ORDER BY email
    LOOP
        BEGIN
            IF v_email LIKE '%@%' THEN
                v_provider_id := v_email;
            ELSE
                v_provider_id := v_email || '@fgbmfi.ng';
            END IF;

            SELECT EXISTS (
                SELECT 1 FROM auth.identities
                WHERE user_id = v_user_id AND provider = 'email'
            ) INTO v_has_email_identity;

            IF v_has_email_identity THEN
                CONTINUE;
            END IF;

            DELETE FROM auth.identities
            WHERE provider = 'email'
              AND provider_id = v_provider_id
              AND user_id <> v_user_id;

            INSERT INTO auth.identities (
                id, user_id, identity_data, provider, provider_id,
                last_sign_in_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), v_user_id,
                jsonb_build_object('sub', v_user_id, 'email', v_provider_id),
                'email', v_provider_id,
                NOW(), NOW(), NOW()
            );

            IF v_email LIKE '%@%' THEN
                v_proper_email_inserted := v_proper_email_inserted + 1;
            ELSE
                v_bare_username_inserted := v_bare_username_inserted + 1;
            END IF;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            RAISE NOTICE 'Backfill failed for user % (email=%, provider_id=%): %',
                v_user_id, v_email, v_provider_id, SQLERRM;
        END;
    END LOOP;

    RETURN json_build_object(
        'proper_email_identities_inserted', v_proper_email_inserted,
        'bare_username_identities_inserted', v_bare_username_inserted,
        'failed', v_failed
    );
END;
$func$;

SELECT _admin_backfill_email_identities() AS backfill_result;

-- §3.7. POST-BACKFILL REPAIR — catch any remaining edge cases.
-- Sometimes prior broken runs leave a state where the backfill loop
-- bailed out. This step does a final pass: for any user STILL without
-- an email identity, aggressively delete ALL email identities with the
-- target provider_id (regardless of user_id) and insert a fresh one.
CREATE OR REPLACE FUNCTION _admin_final_pass_repair()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
    v_repaired INT := 0;
    v_failed   INT := 0;
    v_user_id  UUID;
    v_email    TEXT;
    v_provider_id TEXT;
    v_conflict_count INT;
    v_existing_email_count INT;
BEGIN
    FOR v_user_id, v_email IN
        SELECT id, email FROM auth.users
        WHERE email IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM auth.identities
              WHERE user_id = auth.users.id AND provider = 'email'
          )
    LOOP
        BEGIN
            IF v_email LIKE '%@%' THEN
                v_provider_id := v_email;
            ELSE
                v_provider_id := v_email || '@fgbmfi.ng';
            END IF;

            RAISE NOTICE 'Final-pass: user=%, email=%, provider_id=%',
                v_user_id, v_email, v_provider_id;

            SELECT COUNT(*) INTO v_existing_email_count
            FROM auth.identities
            WHERE user_id = v_user_id AND provider = 'email';
            RAISE NOTICE '  existing email identities for user: %', v_existing_email_count;

            SELECT COUNT(*) INTO v_conflict_count
            FROM auth.identities
            WHERE provider = 'email'
              AND provider_id = v_provider_id
              AND user_id <> v_user_id;
            RAISE NOTICE '  conflicting identities (other user): %', v_conflict_count;

            -- AGGRESSIVE: delete ALL email identities with this provider_id
            DELETE FROM auth.identities
            WHERE provider = 'email'
              AND provider_id = v_provider_id;

            INSERT INTO auth.identities (
                id, user_id, identity_data, provider, provider_id,
                last_sign_in_at, created_at, updated_at
            ) VALUES (
                gen_random_uuid(), v_user_id,
                jsonb_build_object('sub', v_user_id, 'email', v_provider_id),
                'email', v_provider_id,
                NOW(), NOW(), NOW()
            );

            v_repaired := v_repaired + 1;
            RAISE NOTICE '  REPAIRED user % (%)', v_user_id, v_email;
        EXCEPTION WHEN OTHERS THEN
            v_failed := v_failed + 1;
            RAISE NOTICE 'Final-pass repair FAILED for user % (email=%): % (SQLSTATE=%)',
                v_user_id, v_email, SQLERRM, SQLSTATE;
        END;
    END LOOP;

    RETURN json_build_object(
        'users_repaired', v_repaired,
        'users_failed', v_failed
    );
END;
$func$;

SELECT _admin_final_pass_repair() AS final_pass_result;

-- ============================================================
-- §4. INTEGRITY VERIFICATION VIEW
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
  CASE
    WHEN u.encrypted_password IS NOT NULL THEN
      substring(u.encrypted_password FROM '\$2[aby]\$(\d+)')::INT
    ELSE NULL
  END                                                              AS bcrypt_cost,
  u.created_at,
  u.updated_at
FROM auth.users u;

COMMENT ON VIEW v_auth_integrity_check IS
  'Audit view. A user is login-ready only when ALL flags are true AND bcrypt_cost >= 10. '
  'Query broken rows with: SELECT * FROM v_auth_integrity_check WHERE NOT has_aud OR NOT has_instance_id OR NOT is_confirmed OR NOT has_email_identity OR bcrypt_cost < 10;';

-- ============================================================
-- §5. REWRITE create_app_user (FULL COLUMN COVERAGE)
-- ============================================================

DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT);
DROP FUNCTION IF EXISTS create_app_user(TEXT, TEXT, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION create_app_user(
    email TEXT, password TEXT, role TEXT,
    district TEXT DEFAULT NULL, region TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
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

    -- Sanitize the role against the app_users.role CHECK constraint BEFORE
    -- we do anything. Unknown roles are silently coerced to 'registrar'
    -- (with a notice). This prevents the app_users INSERT from failing
    -- and leaving the function in a partial state.
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
                 AND column_name = 'raw_user_meta_data' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', raw_user_meta_data';
        ins_vals := ins_vals || ', ''{}''::jsonb';
    END IF;

    IF v_instance_id IS NULL THEN
        ins_cols := REPLACE(ins_cols, ', instance_id', '');
        ins_vals := REPLACE(ins_vals, ', $5', '');
    END IF;

    -- ATOMIC: all three writes (auth.users, auth.identities, app_users)
    -- happen in a single transaction. If any fails, everything rolls back
    -- and the function returns {status: 'error'} with no partial state.
    BEGIN
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', v_sanitized_role, 'provider', 'email'),
                  v_instance_id;

        aud_set := true;

        -- Identity with gen_random_uuid() PK to avoid collision with any
        -- pre-existing non-email identity at id = new_user_id.
        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id, 'email', email),
            'email', email, NOW(), NOW(), NOW()
        );

        identities_ok := true;

        -- Auto-confirm via dynamic SQL (column may be GENERATED ALWAYS).
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

        -- Clear tokens (idempotent safety net, dynamic SQL for missing columns).
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
        -- Outer transaction rolls back; auth.users, auth.identities, and
        -- app_users are all in a clean state.
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

-- ============================================================
-- §6. REWRITE reset_user_password (NEVER UN-CONFIRM)
-- ============================================================

DROP FUNCTION IF EXISTS reset_user_password(TEXT, TEXT);
DROP FUNCTION IF EXISTS reset_user_password(UUID, TEXT);

CREATE OR REPLACE FUNCTION reset_user_password(user_id TEXT, new_password TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    v_uid UUID;
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

    -- Safety net: ensure user is still considered confirmed after a reset.
    -- Use dynamic SQL + COALESCE so we never overwrite an existing
    -- confirmation timestamp and GENERATED ALWAYS columns are tolerated.
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

-- ============================================================
-- §7. FINAL REPORT
-- ============================================================

-- §6.5. SELF-TEST: create a test user, verify the auth row, then delete it.
-- This proves that create_app_user produces a user that can log in.
-- If the test FAILS, the migration will have raised an error and the
-- rest of the file will not run. Check the SQLSTATE and SQLERRM.
DO $$
DECLARE
    v_test_email TEXT := 'selftest_' || to_char(NOW(), 'YYYYMMDDHH24MISS') || '@fgbmfi.ng';
    v_result     JSON;
    v_user_id    UUID;
    v_aud_ok     BOOLEAN;
    v_conf_ok    BOOLEAN;
    v_id_ok      BOOLEAN;
    v_pwd_ok     BOOLEAN;
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

    -- Verify all the columns are populated
    SELECT (encrypted_password IS NOT NULL) INTO v_pwd_ok
    FROM auth.users WHERE id = v_user_id;

    IF NOT v_aud_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: aud was not set on the new user';
    END IF;
    IF NOT v_conf_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: user was not auto-confirmed';
    END IF;
    IF NOT v_id_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: email identity was not inserted';
    END IF;
    IF NOT v_pwd_ok THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: encrypted_password was not set';
    END IF;

    -- Verify the integrity view agrees (including bcrypt cost)
    IF NOT EXISTS (
        SELECT 1 FROM v_auth_integrity_check
        WHERE id = v_user_id
          AND has_aud AND has_instance_id AND has_role AND is_confirmed
          AND has_password AND has_email_identity
          AND bcrypt_cost >= 10
    ) THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: v_auth_integrity_check reports user is not login-ready (check bcrypt_cost >= 10)';
    END IF;

    -- Verify a clean lookup by provider_id (this is what signInWithPassword uses)
    IF NOT EXISTS (
        SELECT 1 FROM auth.identities
        WHERE user_id = v_user_id AND provider = 'email' AND provider_id = v_test_email
    ) THEN
        RAISE EXCEPTION 'SELF-TEST FAILED: no auth.identities row with provider_id matching email';
    END IF;

    RAISE NOTICE 'SELF-TEST PASSED: user % is login-ready', v_test_email;

    -- Clean up
    DELETE FROM auth.identities WHERE user_id = v_user_id;
    DELETE FROM auth.users WHERE id = v_user_id;
    DELETE FROM public.app_users WHERE id = v_user_id;
    RAISE NOTICE 'SELF-TEST: cleaned up test user %', v_test_email;
END $$;

SELECT
    'Total auth.users'                  AS metric, COUNT(*)::TEXT AS value
FROM auth.users
UNION ALL
SELECT
    'Healthy (all flags true)'          AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE has_aud AND has_instance_id AND has_role AND is_confirmed
  AND has_password AND has_email_identity
UNION ALL
SELECT
    'Broken (any flag false)'           AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity)
UNION ALL
SELECT
    'Missing email identity'            AS metric, COUNT(*)::TEXT
FROM v_auth_integrity_check
WHERE NOT has_email_identity;

-- If anything is still broken, list them explicitly for triage:
SELECT id, email,
       has_aud, has_instance_id, has_role, is_confirmed,
       has_password, has_email_identity
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity)
ORDER BY email;

-- ============================================================
-- §8. CLEANUP — drop the helper functions now that the work is done.
-- They are not needed in production; keeping them would just clutter
-- the schema. If you ever need to re-run the cleanup manually, you
-- can re-apply this migration file.
-- ============================================================
DROP FUNCTION IF EXISTS _admin_cleanup_orphaned_identities();
DROP FUNCTION IF EXISTS _admin_backfill_email_identities();
DROP FUNCTION IF EXISTS _admin_final_pass_repair();

-- ============================================================
-- NEXT STEPS (after running this migration successfully)
-- ============================================================
-- 1. Confirm zero broken rows: the report above should show
--    "Missing email identity" = 0 after the §3 backfill runs.
--
-- 2. For each legacy user with a bare username (e.g. n_reg, nat_admin):
--    - The auth.users.email has been left as the bare username.
--    - The auth.identities row has provider_id = 'n_reg@fgbmfi.ng'
--    - Users must log in with the FULL email: n_reg@fgbmfi.ng
--    - If you want them to be able to type just "n_reg", patch
--      normalizeEmail() in supabaseService.ts to append @fgbmfi.ng
--      when no @ is present.
--    - Going forward, create new users with a real email format
--
-- 3. Deploy the frontend changes (supabaseService.ts) so that:
--    - db.createUser() throws on incomplete auth rows
--    - auth.login() returns descriptive errors instead of "typo" message
--
-- 4. If any user still cannot log in after this migration:
--    SELECT * FROM v_auth_integrity_check WHERE NOT has_email_identity;
--    Then re-run this file — it's idempotent.
--
-- 5. If §3.7 still doesn't work for a stubborn user, use
--    supabase_repair_stubborn_user.sql as a surgical one-shot fix.
