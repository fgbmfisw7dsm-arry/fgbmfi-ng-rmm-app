-- ============================================================
-- REPAIR: Sprint 14b v3 — Unlock All Existing Users (cost 6 → 10)
-- ============================================================
-- RUN THE ENTIRE SCRIPT and share ALL output (probe_hash,
-- rehash_result, verify counts, sample).
-- If you only run the last query, nothing will be rehashed.
-- ============================================================

SET search_path = public, extensions;

-- 1) PROBE: does crypt() work in this session?
--    Expect a 60-char hash starting with $2a$10$.
SELECT crypt('probe', '$2a$10$abcdefghijklmnopqrstuv') AS probe_hash;

-- 2) REHASH every user to bcrypt cost 10 with a deterministic temp password.
--    SECURITY DEFINER + SET search_path guarantees pgcrypto resolves.
CREATE OR REPLACE FUNCTION public.rehash_all_users_cost10()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE v_count INT;
BEGIN
    UPDATE auth.users
    SET encrypted_password = crypt(
            'FGB@' || substr(md5(COALESCE(NULLIF(lower(email), ''), 'user'))::text, 1, 8) || '!26',
            '$2a$10$' || substring(
                translate(encode(decode(md5(random()::text), 'hex'), 'base64'), '+/', './'), 1, 22)),
        updated_at = NOW()
    WHERE encrypted_password IS NOT NULL;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN json_build_object('status', 'ok', 'rows_updated', v_count);
END $fn$;

SELECT public.rehash_all_users_cost10() AS rehash_result;

-- 3) VERIFY (same run, right after the rehash)
SELECT COUNT(*) AS users_still_cost_lt_10,
       COUNT(*) FILTER (WHERE substring(encrypted_password from '\$2[aby]\$(\d+)')::int >= 10) AS users_cost_ge_10,
       COUNT(*) FILTER (WHERE encrypted_password IS NOT NULL) AS total_with_hash
FROM auth.users;

-- 4) SAMPLE of the new hashes (eyeball the cost + prefix)
SELECT email,
       substring(encrypted_password from '\$2[aby]\$(\d+)')::int AS cost,
       left(encrypted_password, 15) AS hash_prefix
FROM auth.users
WHERE encrypted_password IS NOT NULL
ORDER BY created_at DESC NULLS LAST
LIMIT 10;

DROP FUNCTION IF EXISTS public.rehash_all_users_cost10();
