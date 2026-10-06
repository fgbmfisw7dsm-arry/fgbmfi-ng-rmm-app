-- ============================================================================
-- v1.74c — Search RPC guard / repair (read-mostly, idempotent)
-- ----------------------------------------------------------------------------
-- Purpose: make the v1.74b fix self-defending. Run any time (e.g. after a
-- fresh environment setup or a migration replay) to confirm the search RPC on
-- the live DB is the CORRECT single-statement body and there is exactly ONE
-- get_paginated_delegates overload.
--
--   * RAISES EXCEPTION (aborting) if search_delegates_v2 is missing OR still has
--     the broken two-statement `base` CTE body (which errors at runtime with
--     `relation "base" does not exist`). The message tells you to deploy
--     supabase_migration_search_v3b_fix_base_cte.sql.
--   * REPAIRS the stale 7-arg get_paginated_delegates overload if a migration
--     replay re-created it (drops it so only the 8-arg prefix version remains).
--   * Reloads the PostgREST schema cache.
--
-- Safe to run repeatedly; it never modifies a correct search_delegates_v2.
-- ============================================================================

DO $$
DECLARE
  v_body      text;
  v_overloads integer;
BEGIN
  -- 1) search_delegates_v2 must exist
  SELECT p.prosrc
    INTO v_body
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'search_delegates_v2'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_body IS NULL THEN
    RAISE EXCEPTION
      'GUARD FAILED: search_delegates_v2 is MISSING. Deploy supabase_migration_search_v3b_fix_base_cte.sql.';
  END IF;

  -- 2) The broken body referenced the `base` CTE from a second statement; the
  --    fixed body computes the page with row_number() inside a single statement.
  IF position('row_number() OVER' IN v_body) = 0 THEN
    RAISE EXCEPTION
      'GUARD FAILED: search_delegates_v2 still has the BROKEN body (runtime error: relation "base" does not exist). Deploy supabase_migration_search_v3b_fix_base_cte.sql.';
  END IF;

  -- 3) Exactly one get_paginated_delegates overload should exist (8-arg prefix).
  SELECT count(*)
    INTO v_overloads
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'get_paginated_delegates';

  IF v_overloads > 1 THEN
    DROP FUNCTION IF EXISTS get_paginated_delegates(integer, integer, text, text, text, uuid, text);
    SELECT count(*) INTO v_overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';
    RAISE WARNING 'GUARD: dropped stale 7-arg get_paginated_delegates overload; % overload(s) remain.', v_overloads;
  END IF;

  RAISE NOTICE 'GUARD OK: search_delegates_v2 has the single-statement body; get_paginated_delegates overloads = %', v_overloads;
END;
$$;

NOTIFY pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- Verification output (run the file — the SQL editor prints the last SELECT)
-- ---------------------------------------------------------------------------
SELECT
  (position('row_number() OVER' IN prosrc) > 0) AS base_fixed,
  length(prosrc)                                 AS body_len
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'search_delegates_v2';

SELECT count(*) AS get_paginated_overloads
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates';
