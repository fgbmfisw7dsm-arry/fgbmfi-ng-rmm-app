-- ============================================================
-- FGBMFI Nigeria EMS — Sprint 10: Session Ministry Tracking
-- Adds tables for session response capture (FT, SLV, MI, HGB)
-- and Voice Distribution (VD) aggregate tracking.
-- Run this ENTIRE block in the Supabase SQL Editor.
-- ============================================================

-- 1. SESSION RESPONSES (individual QR-scanned records)
CREATE TABLE IF NOT EXISTS session_responses (
    response_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    delegate_id UUID NOT NULL REFERENCES delegates(delegate_id) ON DELETE CASCADE,
    session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    response_type TEXT NOT NULL CHECK (response_type IN ('FT','SLV','HGB','MI')),
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    recorded_by UUID
);

-- One delegate per response_type per session (can respond to multiple types)
CREATE UNIQUE INDEX IF NOT EXISTS idx_sr_unique
    ON session_responses(delegate_id, session_id, response_type);
CREATE INDEX IF NOT EXISTS idx_sr_event_session
    ON session_responses(event_id, session_id);
CREATE INDEX IF NOT EXISTS idx_sr_session_type
    ON session_responses(session_id, response_type);
CREATE INDEX IF NOT EXISTS idx_sr_delegate
    ON session_responses(delegate_id);

-- 2. SESSION RESPONSE SUMMARIES (manual bulk totals for open-air sessions)
CREATE TABLE IF NOT EXISTS session_response_summaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    response_type TEXT NOT NULL CHECK (response_type IN ('FT','SLV','HGB','MI')),
    total_count INTEGER NOT NULL CHECK (total_count >= 0),
    entered_by UUID,
    entered_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, response_type)
);

CREATE INDEX IF NOT EXISTS idx_srs_event_session
    ON session_response_summaries(event_id, session_id);

-- 3. VOICE DISTRIBUTION (always aggregate — per session)
CREATE TABLE IF NOT EXISTS session_voice_distribution (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_id UUID NOT NULL REFERENCES events(event_id) ON DELETE CASCADE,
    session_id UUID NOT NULL UNIQUE REFERENCES sessions(session_id) ON DELETE CASCADE,
    total_distributed INTEGER NOT NULL DEFAULT 0 CHECK (total_distributed >= 0),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID
);

CREATE INDEX IF NOT EXISTS idx_svd_event_session
    ON session_voice_distribution(event_id, session_id);

-- 4. RLS — Enable on new tables
ALTER TABLE session_responses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_response_summaries  ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_voice_distribution  ENABLE ROW LEVEL SECURITY;

-- 5. RLS POLICIES

-- session_responses: all authenticated can read; admin+registrar can insert
DROP POLICY IF EXISTS "sr_select" ON session_responses;
CREATE POLICY "sr_select" ON session_responses
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "sr_insert" ON session_responses;
CREATE POLICY "sr_insert" ON session_responses
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

DROP POLICY IF EXISTS "sr_delete" ON session_responses;
CREATE POLICY "sr_delete" ON session_responses
    FOR DELETE TO authenticated USING (is_admin_user());

-- session_response_summaries: same pattern
DROP POLICY IF EXISTS "srs_select" ON session_response_summaries;
CREATE POLICY "srs_select" ON session_response_summaries
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "srs_insert" ON session_response_summaries;
CREATE POLICY "srs_insert" ON session_response_summaries
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

DROP POLICY IF EXISTS "srs_update" ON session_response_summaries;
CREATE POLICY "srs_update" ON session_response_summaries
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "srs_delete" ON session_response_summaries;
CREATE POLICY "srs_delete" ON session_response_summaries
    FOR DELETE TO authenticated USING (is_admin_user());

-- session_voice_distribution: same pattern
DROP POLICY IF EXISTS "svd_select" ON session_voice_distribution;
CREATE POLICY "svd_select" ON session_voice_distribution
    FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "svd_insert" ON session_voice_distribution;
CREATE POLICY "svd_insert" ON session_voice_distribution
    FOR INSERT TO authenticated
    WITH CHECK (
        is_admin_user() OR EXISTS (
            SELECT 1 FROM app_users WHERE id = auth.uid()
            AND role IN ('national_registrar','regional_registrar','district_registrar','registrar')
            AND (is_active IS NULL OR is_active = true)
        )
    );

DROP POLICY IF EXISTS "svd_update" ON session_voice_distribution;
CREATE POLICY "svd_update" ON session_voice_distribution
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "svd_delete" ON session_voice_distribution;
CREATE POLICY "svd_delete" ON session_voice_distribution
    FOR DELETE TO authenticated USING (is_admin_user());

-- 6. RPC: get_session_ministry_stats — per-session aggregate dashboard
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

-- 7. RPC: get_ministry_export_data — for Reports tab
CREATE OR REPLACE FUNCTION get_ministry_export_data(p_event_id UUID)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
    responses_json JSON;
    summaries_json JSON;
    vd_json JSON;
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

    RETURN json_build_object(
        'responses', responses_json,
        'summaries', summaries_json,
        'voiceDistribution', vd_json
    );
END;
$func$;
