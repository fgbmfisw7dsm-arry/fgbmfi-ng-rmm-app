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
-- After running this, reload the app. If the Master List still shows the amber
-- "Slow mode" banner, the self-check at the bottom prints which migration is
-- still missing (see the NOTICE output in the SQL editor).

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

-- 3) Self-check (read-only): reports whether the Master List RPCs are deployed
--    and current. Nothing is created or dropped here.
DO $$
DECLARE
  v_pag_sig TEXT;
  v_districts_count INT;
BEGIN
  SELECT pg_get_function_identity_arguments(p.oid)
    INTO v_pag_sig
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_paginated_delegates'
  ORDER BY p.oid DESC
  LIMIT 1;

  IF v_pag_sig IS NULL THEN
    RAISE NOTICE 'MISSING: get_paginated_delegates() — apply supabase_migration_v1.92_master_list_date_range_bulk_delete.sql, then v1.93_delegate_activity_date.sql, then v1.94_import_batches.sql.';
  ELSE
    RAISE NOTICE 'OK: get_paginated_delegates(%):', v_pag_sig;
    IF v_pag_sig NOT LIKE '%p_date_basis%' THEN
      RAISE NOTICE 'OUTDATED: get_paginated_delegates is missing p_date_basis — apply supabase_migration_v1.93_delegate_activity_date.sql (then v1.94).';
    END IF;
    IF v_pag_sig NOT LIKE '%p_import_id%' THEN
      RAISE NOTICE 'OUTDATED: get_paginated_delegates is missing p_import_id — apply supabase_migration_v1.94_import_batches.sql.';
    END IF;
  END IF;

  SELECT count(*) INTO v_districts_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'get_district_aggregate_counts';

  IF v_districts_count = 0 THEN
    RAISE NOTICE 'MISSING: get_district_aggregate_counts() — apply supabase_migration_district_counts_rpc.sql.';
  ELSE
    RAISE NOTICE 'OK: get_district_aggregate_counts() is deployed.';
  END IF;
END $$;

-- 4) Ask PostgREST to pick up the new indexes immediately.
NOTIFY pgrst, 'reload schema';
