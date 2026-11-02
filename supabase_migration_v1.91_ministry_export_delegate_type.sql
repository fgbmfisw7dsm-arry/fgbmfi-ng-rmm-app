-- ============================================================================
-- v1.91 — get_ministry_export_data: expose DELEGATE_TYPE on session responses
-- ----------------------------------------------------------------------------
-- PROBLEM
--   The Reports Center → "Sessions Report" tab renders, for every session and
--   every alter-call type (FT / SLV / MI / HGB), an "Individual Records" table
--   whose columns are S/N, Name, District, Chapter, Phone, Email, Rank, Office
--   and **Type**. The Type cell reads `r.delegate_type`, but the RPC's
--   `responses` projection never selected it:
--
--       d.first_name, d.last_name, d.district, d.chapter, d.phone,
--       d.email, d.rank, d.office          <-- no d.delegate_type
--
--   So `delegate_type` was always undefined and the column rendered "-"
--   (and the CSV export wrote "-" too). This is a long-standing gap, not a
--   regression from v1.88 — v1.88 only added `email` to the same projection.
--
-- WHAT CHANGES
--   ONE column added to the `responses` sub-select:
--       d.first_name, d.last_name, d.district, d.chapter, d.phone,
--       d.email, d.rank, d.office, d.delegate_type
--
-- WHAT DOES **NOT** CHANGE
--   * Signature: get_ministry_export_data(p_event_id UUID) -> JSON
--   * LANGUAGE plpgsql, SECURITY DEFINER, SET search_path
--   * Pass-4 caller-scope hardening (caller_full_scope / current_user_region /
--     current_user_district / district_key + the '__NONE__' fail-closed branch)
--   * The five returned JSON keys: responses, summaries, voiceDistribution,
--     attendance, attendanceManual
--   * Everything from v1.88 (d.email stays)
--
-- SAFETY
--   * Idempotent CREATE OR REPLACE; additive only (no table DDL, no data
--     mutation, no RLS change).
--   * The client is forward/backward compatible: ReportsPage resolves the cell
--     via `r.delegate_type || <delegate_id lookup from attendedDelegates> || '-'`,
--     so deploying the frontend before this migration still shows real values
--     for delegates with an arrival record.
--
-- DEPLOY ORDER
--   Run this in the Supabase SQL editor first, then deploy the frontend
--   (frontend-first is also safe via the fallback map).
-- ============================================================================

CREATE OR REPLACE FUNCTION get_ministry_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    responses_json JSON := '[]'::JSON;
    summaries_json JSON := '[]'::JSON;
    vd_json JSON := '[]'::JSON;
    attendance_json JSON := '[]'::JSON;
    attendance_manual_json JSON := '[]'::JSON;
    v_scope_region TEXT := NULL;
    v_scope_district TEXT := NULL;
BEGIN
  IF NOT caller_full_scope() THEN
    IF current_user_region() IS NOT NULL THEN
      v_scope_region := district_key(current_user_region());
    ELSIF current_user_district() IS NOT NULL THEN
      v_scope_district := district_key(current_user_district());
    ELSE
      v_scope_district := '__NONE__';
    END IF;
  END IF;

    IF v_scope_district IS DISTINCT FROM '__NONE__' THEN
      SELECT COALESCE(json_agg(r), '[]'::JSON) INTO responses_json
      FROM (
          SELECT sr.*,
              d.first_name, d.last_name, d.district, d.chapter, d.phone, d.email, d.rank, d.office, d.delegate_type,
              (d.first_name || ' ' || d.last_name) AS delegate_name,
              s.title AS session_title
          FROM session_responses sr
          JOIN delegates d ON sr.delegate_id = d.delegate_id
          JOIN sessions s ON sr.session_id = s.session_id
          WHERE sr.event_id = p_event_id
            AND (v_scope_region IS NULL AND v_scope_district IS NULL
                 OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
                 OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
          ORDER BY sr.recorded_at DESC
      ) r;
    END IF;

    SELECT COALESCE(json_agg(s), '[]'::JSON) INTO summaries_json
    FROM (
        SELECT srs.*, s.title AS session_title
        FROM session_response_summaries srs
        JOIN sessions s ON srs.session_id = s.session_id
        WHERE srs.event_id = p_event_id
        ORDER BY srs.entered_at DESC
    ) s;
    SELECT COALESCE(json_agg(v), '[]'::JSON) INTO vd_json
    FROM (
        SELECT svd.*, s.title AS session_title
        FROM session_voice_distribution svd
        JOIN sessions s ON svd.session_id = s.session_id
        WHERE svd.event_id = p_event_id
        ORDER BY svd.updated_at DESC
    ) v;
    SELECT COALESCE(json_agg(am), '[]'::JSON) INTO attendance_manual_json
    FROM (
        SELECT sam.*, s.title AS session_title
        FROM session_attendance_manual sam
        JOIN sessions s ON sam.session_id = s.session_id
        WHERE sam.event_id = p_event_id
        ORDER BY sam.updated_at DESC
    ) am;
    SELECT COALESCE(json_agg(a), '[]'::JSON) INTO attendance_json
    FROM (
        SELECT
            s.session_id,
            s.title AS session_title,
            COUNT(DISTINCT c.delegate_id) AS attendance
        FROM sessions s
        LEFT JOIN checkins c ON c.session_id = s.session_id AND c.event_id = p_event_id
        LEFT JOIN delegates d ON d.delegate_id = c.delegate_id
        WHERE s.event_id = p_event_id
          AND (v_scope_region IS NULL AND v_scope_district IS NULL
               OR (v_scope_region IS NOT NULL AND district_key(d.district) LIKE v_scope_region || '%')
               OR (v_scope_district IS NOT NULL AND district_key(d.district) = v_scope_district))
        GROUP BY s.session_id, s.title, s.start_time
        ORDER BY s.start_time
    ) a;
    RETURN json_build_object(
        'responses', responses_json,
        'summaries', summaries_json,
        'voiceDistribution', vd_json,
        'attendance', attendance_json,
        'attendanceManual', attendance_manual_json
    );
END;
$function$;

-- Re-assert the grant surface (unchanged semantics).
REVOKE ALL ON FUNCTION public.get_ministry_export_data(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ministry_export_data(UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_ministry_export_data(UUID) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.get_ministry_export_data(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION (read-only — run after applying)
-- ============================================================================
-- SELECT prosrc LIKE '%d.email, d.rank, d.office, d.delegate_type%' AS type_exposed,
--        prosrc LIKE '%caller_full_scope%'                        AS scope_intact,
--        prosrc LIKE '%__NONE__%'                                 AS fail_closed
-- FROM pg_proc WHERE proname = 'get_ministry_export_data';
-- -- expect: true | true | true
--
-- Spot-check the payload:
-- SELECT (get_ministry_export_data('<EVENT_UUID>'))->'responses'->0->>'delegate_type';
-- -- expect: Member / Free Guest / Dependant-Adult / ...  (not null)
-- ============================================================================
