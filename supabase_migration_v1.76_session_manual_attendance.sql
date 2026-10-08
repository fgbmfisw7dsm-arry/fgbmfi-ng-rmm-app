-- ============================================================
-- FGBMFI Nigeria EMS — v1.76: Manual Session Total Attendance
-- Adds a per-session manually-entered attendance aggregate,
-- implemented like session_voice_distribution (one row/session).
-- Feeds the "Manual" / "Manual Total" columns + Summary Totals
-- in the Sessions Report.
-- Idempotent. Run ENTIRE block in the Supabase SQL Editor.
-- Deploy BEFORE the frontend.
-- ============================================================

-- 1. TABLE — manual total attendance (one aggregate row per session)
CREATE TABLE IF NOT EXISTS session_attendance_manual (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
    total_count INTEGER NOT NULL DEFAULT 0 CHECK (total_count >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_sam_event_session
    ON session_attendance_manual(event_id, session_id);

-- 2. RLS
ALTER TABLE session_attendance_manual ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sam_select" ON session_attendance_manual;
DROP POLICY IF EXISTS "sam_insert" ON session_attendance_manual;
DROP POLICY IF EXISTS "sam_update" ON session_attendance_manual;
DROP POLICY IF EXISTS "sam_delete" ON session_attendance_manual;

CREATE POLICY "sam_select" ON session_attendance_manual FOR SELECT TO authenticated USING (true);

CREATE POLICY "sam_insert" ON session_attendance_manual FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
             AND (is_active IS NULL OR is_active = true)));

CREATE POLICY "sam_update" ON session_attendance_manual FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
             AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
             AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
             AND (is_active IS NULL OR is_active = true)));

CREATE POLICY "sam_delete" ON session_attendance_manual FOR DELETE TO authenticated USING (is_admin_user());

-- 3. RPC: get_session_ministry_stats — add attendance_manual
CREATE OR REPLACE FUNCTION get_session_ministry_stats(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    result JSON;
BEGIN
    SELECT COALESCE(json_agg(session_data), '[]'::JSON) INTO result
    FROM (
        SELECT
            s.session_id,
            s.title AS session_title,
            s.start_time,
            s.end_time,
            COALESCE(att.attendance, 0) AS attendance,
            COALESCE(sam_data.attendance_manual, 0) AS attendance_manual,
            COALESCE(sr_data.ft_count, 0) AS ft_count,
            COALESCE(sr_data.slv_count, 0) AS slv_count,
            COALESCE(sr_data.hgb_count, 0) AS hgb_count,
            COALESCE(sr_data.mi_count, 0) AS mi_count,
            COALESCE(srs_data.ft_summary, 0) AS ft_summary,
            COALESCE(srs_data.slv_summary, 0) AS slv_summary,
            COALESCE(srs_data.hgb_summary, 0) AS hgb_summary,
            COALESCE(srs_data.mi_summary, 0) AS mi_summary,
            COALESCE(svd_data.voice_distribution, 0) AS voice_distribution
        FROM sessions s
        LEFT JOIN LATERAL (
            SELECT COUNT(DISTINCT c.delegate_id) AS attendance
            FROM checkins c
            WHERE c.session_id = s.session_id AND c.event_id = p_event_id
        ) att ON true
        LEFT JOIN LATERAL (
            SELECT sam.total_count AS attendance_manual
            FROM session_attendance_manual sam
            WHERE sam.session_id = s.session_id AND sam.event_id = p_event_id
        ) sam_data ON true
        LEFT JOIN LATERAL (
            SELECT
                COUNT(*) FILTER (WHERE sr.response_type = 'FT') AS ft_count,
                COUNT(*) FILTER (WHERE sr.response_type = 'SLV') AS slv_count,
                COUNT(*) FILTER (WHERE sr.response_type = 'HGB') AS hgb_count,
                COUNT(*) FILTER (WHERE sr.response_type = 'MI') AS mi_count
            FROM session_responses sr
            WHERE sr.session_id = s.session_id AND sr.event_id = p_event_id
        ) sr_data ON true
        LEFT JOIN LATERAL (
            SELECT
                COALESCE(SUM(srs.total_count) FILTER (WHERE srs.response_type = 'FT'), 0) AS ft_summary,
                COALESCE(SUM(srs.total_count) FILTER (WHERE srs.response_type = 'SLV'), 0) AS slv_summary,
                COALESCE(SUM(srs.total_count) FILTER (WHERE srs.response_type = 'HGB'), 0) AS hgb_summary,
                COALESCE(SUM(srs.total_count) FILTER (WHERE srs.response_type = 'MI'), 0) AS mi_summary
            FROM session_response_summaries srs
            WHERE srs.session_id = s.session_id AND srs.event_id = p_event_id
        ) srs_data ON true
        LEFT JOIN LATERAL (
            SELECT svd.total_distributed AS voice_distribution
            FROM session_voice_distribution svd
            WHERE svd.session_id = s.session_id AND svd.event_id = p_event_id
        ) svd_data ON true
        WHERE s.event_id = p_event_id
        ORDER BY s.start_time
    ) session_data;

    RETURN result;
END;
$func$;

-- 4. RPC: get_ministry_export_data — caller-scoped (pass 4) + attendanceManual
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
              d.first_name, d.last_name, d.district, d.chapter, d.phone, d.rank, d.office,
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

NOTIFY pgrst, 'reload schema';
