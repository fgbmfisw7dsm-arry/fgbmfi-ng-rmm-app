-- ============================================================
-- FGBMFI Nigeria EMS — Comprehensive Auth State Diagnostic
-- Date: 2026-08-01
--
-- Run this in the Supabase SQL Editor as the postgres role.
-- Shows the COMPLETE state of the auth system for all users.
-- ============================================================

-- 1. All users in auth.users with their key fields
SELECT '--- §1: auth.users (all key fields) ---' AS section;
SELECT id, email,
       (aud = 'authenticated') AS has_aud,
       (instance_id IS NOT NULL) AS has_instance_id,
       (role IS NOT NULL) AS has_role,
       (email_confirmed_at IS NOT NULL) AS has_email_confirmed_at,
       (confirmed_at IS NOT NULL) AS has_confirmed_at,
       (encrypted_password IS NOT NULL) AS has_password,
       created_at
FROM auth.users
ORDER BY email;

-- 2. All identities in auth.identities
SELECT '--- §2: auth.identities (all rows) ---' AS section;
SELECT i.id, i.user_id, u.email AS user_email, i.provider, i.provider_id, i.created_at
FROM auth.identities i
LEFT JOIN auth.users u ON u.id = i.user_id
ORDER BY i.provider, i.provider_id, i.user_id;

-- 3. Duplicate identities (same provider+provider_id for multiple users)
SELECT '--- §3: Duplicate identities (same provider+provider_id) ---' AS section;
SELECT provider, provider_id, COUNT(*) AS user_count, array_agg(user_id::text) AS user_ids
FROM auth.identities
WHERE provider = 'email'
GROUP BY provider, provider_id
HAVING COUNT(*) > 1
ORDER BY user_count DESC;

-- 4. Users without any email identity
SELECT '--- §4: Users without email identity ---' AS section;
SELECT u.id, u.email
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
ORDER BY u.email;

-- 5. Users with email identity but no app_users row
SELECT '--- §5: Users with email identity but no app_users row ---' AS section;
SELECT u.id, u.email, u.encrypted_password IS NOT NULL AS has_password
FROM auth.users u
WHERE EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
  AND NOT EXISTS (SELECT 1 FROM public.app_users a WHERE a.id = u.id)
ORDER BY u.email;

-- 6. Users with app_users row but no email identity
SELECT '--- §6: Users with app_users row but no email identity ---' AS section;
SELECT u.id, u.email, a.role, a.is_active
FROM auth.users u
JOIN public.app_users a ON a.id = u.id
WHERE NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider = 'email')
ORDER BY u.email;

-- 7. The integrity view
SELECT '--- §7: v_auth_integrity_check ---' AS section;
SELECT id, email, has_aud, has_instance_id, has_role, is_confirmed, has_password, has_email_identity
FROM v_auth_integrity_check
ORDER BY (CASE WHEN NOT has_aud OR NOT has_instance_id OR NOT has_role OR NOT is_confirmed OR NOT has_password OR NOT has_email_identity THEN 0 ELSE 1 END), email;

-- 8. Test the get_my_profile function for each user
SELECT '--- §8: get_my_profile simulated lookup ---' AS section;
SELECT u.id, u.email,
       (SELECT row_to_json(t) FROM public.app_users t WHERE t.id = u.id) AS profile_for_user,
       (SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = u.id) AS raw_app_meta_role
FROM auth.users u
ORDER BY u.email;

-- 9. Check the live create_app_user function signature (handles missing variants)
-- Use pg_get_function_arguments(oid) to avoid ::regprocedure type cast issues.
SELECT '--- §9: create_app_user function signature ---' AS section;
SELECT
    COALESCE(
        (SELECT pg_get_function_arguments(p.oid)
         FROM pg_proc p
         WHERE p.proname = 'create_app_user' AND p.pronargs = 5
         LIMIT 1),
        '(5-arg variant not deployed)'
    ) AS signature_5arg,
    COALESCE(
        (SELECT pg_get_function_arguments(p.oid)
         FROM pg_proc p
         WHERE p.proname = 'create_app_user' AND p.pronargs = 4
         LIMIT 1),
        '(4-arg variant not deployed)'
    ) AS signature_4arg,
    COALESCE(
        (SELECT string_agg(p.pronargs::text || '-arg: ' || pg_get_function_arguments(p.oid), '; ' ORDER BY p.pronargs)
         FROM pg_proc p
         WHERE p.proname = 'create_app_user'),
        '(no create_app_user variants found)'
    ) AS all_variants;

-- 10. Check the live get_my_profile function (handles missing function)
SELECT '--- §10: get_my_profile function source ---' AS section;
SELECT
    COALESCE(
        (SELECT pg_get_functiondef(p.oid)
         FROM pg_proc p
         WHERE p.proname = 'get_my_profile'
         LIMIT 1),
        '(get_my_profile function not deployed)'
    ) AS function_def;

-- 11. List all create_app_user variants with their definitions
SELECT '--- §11: All create_app_user variants ---' AS section;
SELECT p.pronargs AS num_args,
       pg_get_function_arguments(p.oid) AS args,
       pg_get_functiondef(p.oid) AS full_def
FROM pg_proc p
WHERE p.proname = 'create_app_user'
ORDER BY p.pronargs;
