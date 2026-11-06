-- FGBMFI-EMS — Master List performance (v1.101)
--
-- Two additive indexes plus a read-only self-check for the RPCs the Master List
-- depends on. Safe to run more than once (idempotent); it changes no data.
--
-- Why:
--   * "All Districts" issues one get_paginated_delegates call per district and
--     get_district_aggregate_counts once. Without a district-scoped index every
--     call re-scans the event's rows.
--   * The RPCs filter on UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')),
--     so a plain column index cannot serve them — the expression index below
--     matches the predicate exactly.
--
-- How to read the result: the script ends with a SELECT, so the SQL editor shows
-- a small grid (NOT "no rows returned"). Read the `status` / `action` columns —
-- anything other than OK tells you exactly which migration is still missing.
-- Plain DDL above the SELECT returns no rows by design.

-- 1) Plain (event_id, district): equality filters (badge printing, roster,
--    district-scoped reads).
CREATE INDEX IF NOT EXISTS idx_delegates_event_district
  ON public.delegates (event_id, district);

-- 2) Expression index matching the Master List RPC predicate exactly.
CREATE INDEX IF NOT EXISTS idx_delegates_event_district_norm
  ON public.delegates (
    event_id,
    (UPPER(regexp_replace(TRIM(district), '\s+', ' ', 'g')))
  );

ANALYZE public.delegates;

-- 3) Ask PostgREST to pick up the new indexes immediately.
NOTIFY pgrst, 'reload schema';

-- 4) Read-only self-check. Returns one row per object so the editor shows a
--    result grid instead of "no rows returned".
WITH pag AS (
  -- pg_get_function_arguments (not the identity variant) is required here: the
  -- identity form omits argument NAMES, so `p_import_id` would never match.
  SELECT pg_get_function_arguments(p.oid) AS args
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates'
  ORDER BY p.oid DESC
  LIMIT 1
)
SELECT
  'get_paginated_delegates'::text AS object,
  COALESCE((SELECT args FROM pag), '(not deployed)') AS detail,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM pag) THEN 'MISSING'
    WHEN (SELECT args FROM pag) NOT LIKE '%p_date_basis%' THEN 'OUTDATED'
    WHEN (SELECT args FROM pag) NOT LIKE '%p_import_id%' THEN 'OUTDATED'
    ELSE 'OK'
  END AS status,
  CASE
    WHEN NOT EXISTS (SELECT 1 FROM pag)
      THEN 'Run supabase_migration_v1.92_master_list_date_range_bulk_delete.sql, then v1.93_delegate_activity_date.sql, then v1.94_import_batches.sql.'
    WHEN (SELECT args FROM pag) NOT LIKE '%p_date_basis%'
      THEN 'Run supabase_migration_v1.93_delegate_activity_date.sql, then v1.94_import_batches.sql.'
    WHEN (SELECT args FROM pag) NOT LIKE '%p_import_id%'
      THEN 'Run supabase_migration_v1.94_import_batches.sql.'
    ELSE 'No action needed.'
  END AS action

UNION ALL

SELECT
  'get_district_aggregate_counts'::text,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_district_aggregate_counts'
  ) THEN 'deployed' ELSE '(not deployed)' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_district_aggregate_counts'
  ) THEN 'OK' ELSE 'MISSING' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'get_district_aggregate_counts'
  ) THEN 'No action needed.' ELSE 'Run supabase_migration_district_counts_rpc.sql.' END

UNION ALL

SELECT
  'index idx_delegates_event_district'::text,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_district'
  ) THEN 'present' ELSE '(missing)' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_district'
  ) THEN 'OK' ELSE 'MISSING' END,
  'Re-run this script.'::text

UNION ALL

SELECT
  'index idx_delegates_event_district_norm'::text,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_district_norm'
  ) THEN 'present' ELSE '(missing)' END,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_delegates_event_district_norm'
  ) THEN 'OK' ELSE 'MISSING' END,
  'Re-run this script.'::text;
