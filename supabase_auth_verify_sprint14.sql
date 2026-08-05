-- ============================================================
-- AUTH VERIFICATION — Sprint 14 New-User Login (run in SQL Editor)
-- ============================================================
-- Goal: determine whether the Sprint 14 bcrypt cost-10 fix is live
-- and which users are login-ready. Copy the whole file into the
-- Supabase SQL Editor and run. Then share the OUTPUT section.
--
-- AFTER running this, do the Network-tab check:
--   DevTools → Network → filter "token" → log in with the failing
--   account → open /auth/v1/token?grant_type=password → note
--   Status Code and Response body.
-- ============================================================

-- 1. Integrity + bcrypt cost per user (newest first)
SELECT email, has_aud, has_instance_id, has_role, is_confirmed,
       has_password, has_email_identity, bcrypt_cost, created_at
FROM v_auth_integrity_check
ORDER BY created_at DESC
LIMIT 30;

-- 2. Only broken rows (missing flag or cost < 10)
SELECT email, has_aud, has_instance_id, has_role, is_confirmed,
       has_password, has_email_identity, bcrypt_cost
FROM v_auth_integrity_check
WHERE NOT (has_aud AND has_instance_id AND has_role AND is_confirmed
           AND has_password AND has_email_identity
           AND (bcrypt_cost IS NULL OR bcrypt_cost >= 10))
ORDER BY email;

-- 3. Live create_app_user definition — confirm the cost-10 manual salt '$2a$10$' is present
SELECT prosrc FROM pg_proc WHERE proname = 'create_app_user';

-- 4. Live reset_user_password definition — confirm cost-10 manual salt
SELECT prosrc FROM pg_proc WHERE proname = 'reset_user_password';

-- 5. GoTrue schema version (spot column-mismatch causes)
SELECT version, name FROM auth.schema_migrations ORDER BY version DESC LIMIT 5;

-- 6. v_auth_integrity_check exists?
SELECT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_auth_integrity_check'
) AS view_exists;
