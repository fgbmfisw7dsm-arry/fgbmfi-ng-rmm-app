-- ============================================================
-- FGBMFI Nigeria EMS — Sprint 10a: Attendance Column + Renames
-- Updates get_session_ministry_stats RPC to include attendance.
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- Update RPC to include session attendance (checkins with matching session_id)
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

-- Update export RPC to include session attendance
CREATE OR REPLACE FUNCTION get_ministry_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    responses_json JSON;
    summaries_json JSON;
    vd_json JSON;
    attendance_json JSON;
BEGIN
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
        ORDER BY sr.recorded_at DESC
    ) r;

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

    SELECT COALESCE(json_agg(a), '[]'::JSON) INTO attendance_json
    FROM (
        SELECT
            s.session_id,
            s.title AS session_title,
            COUNT(DISTINCT c.delegate_id) AS attendance
        FROM sessions s
        LEFT JOIN checkins c ON c.session_id = s.session_id AND c.event_id = p_event_id
        WHERE s.event_id = p_event_id
        GROUP BY s.session_id, s.title, s.start_time
        ORDER BY s.start_time
    ) a;

    RETURN json_build_object(
        'responses', responses_json,
        'summaries', summaries_json,
        'voiceDistribution', vd_json,
        'attendance', attendance_json
    );
END;
$func$;
