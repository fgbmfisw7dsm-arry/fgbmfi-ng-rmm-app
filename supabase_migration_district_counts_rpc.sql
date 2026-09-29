-- =============================================================================
-- FGBMFI-EMS — District Aggregate Counts RPC (v1.66)
-- -----------------------------------------------------------------------------
-- Collapses the Master List "All Official Districts" load path. Previously
-- getDistrictsWithDelegates scaNNed EVERY delegate in the event client-side
-- (1000 rows/page pagination loop, ~20+ HTTPS round-trips at 20K delegates) to
-- count per-district totals. THIS RPC aggregates server-side with a single
-- GROUP BY and returns { district, delegate_type, count } for the v1.50 label
-- routing map (delegate_type is kept so guest/International rows map to the
-- configured guest district label).
--   • SECURITY INVOKER — caller RLS applies (delegates.select_all is already
--     authenticated-wide, so behaviour is unchanged).
--   • Optional p_reg_type mirrors the reg_type server-side filter (portal/web/
--     ems/manual) so the source-filtered Master List view also collapses to 1.
-- Setup: DEPLOY THIS MIGRATION FIRST. Client falls back to the paginated loop
-- if the function is missing or errors (idempotent, non-breaking).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_district_aggregate_counts(
    p_event_id UUID,
    p_reg_type TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
    v_counts JSON;
BEGIN
    SELECT COALESCE(json_agg(row_json), '[]'::JSON) INTO v_counts
    FROM (
        SELECT
            lower(regexp_replace(btrim(district), '\s+', ' ', 'g')) AS district,
            delegate_type,
            count(*) AS total
        FROM delegates
        WHERE event_id = p_event_id
          AND district IS NOT NULL
          AND btrim(district) <> ''
          AND (
            p_reg_type IS NULL
            OR p_reg_type NOT IN ('portal', 'web', 'ems', 'manual')
            OR (p_reg_type = 'portal' AND reg_type = 'portal')
            OR (p_reg_type = 'web'    AND reg_type = 'web')
            OR (p_reg_type = 'ems'    AND reg_type = 'ems')
            OR (p_reg_type = 'manual' AND COALESCE(reg_type, 'manual') NOT IN ('portal', 'web', 'ems'))
          )
        GROUP BY lower(regexp_replace(btrim(district), '\s+', ' ', 'g')), delegate_type
    ) row_json;

    RETURN v_counts;
END;
$fn$;

-- Revoke anon/public; grant only to authenticated + service_role (hardening parity)
REVOKE ALL ON FUNCTION public.get_district_aggregate_counts(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_district_aggregate_counts(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_district_aggregate_counts(uuid, text) IS
'FGBMFI-EMS single-RTT per-district delegate counts (event-scoped, optional reg_type filter). Replaces the client 1000-row pagination loop in getDistrictsWithDelegates.';