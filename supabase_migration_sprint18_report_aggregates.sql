-- ============================================================
-- MIGRATION: Sprint 18 — Report Aggregates RPC (25K-scale reports)
-- ============================================================
-- Adds `get_report_aggregates(p_event_id, p_session_id)` which computes
-- report data server-side so the Reports page no longer loads the full
-- delegates + checkins tables into the browser.
--
-- Returns:
--   attendedDelegates — delegates with an arrival (or the given session)
--                       checkin, joined with their check-in time.
--   sessionAttendance — per-session attendance counts (event-wide).
--   financials        — all financial_entries for the event.
--   pledges           — all pledges for the event.
--
-- `financials` and `pledges` are small relative to delegates; only the
-- attended subset is returned for delegates (never the full roster).
-- ============================================================

CREATE OR REPLACE FUNCTION get_report_aggregates(p_event_id UUID, p_session_id UUID DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $func$
DECLARE
  attended_json JSON;
  session_attendance_json JSON;
  financials_json JSON;
  pledges_json JSON;
BEGIN
  SELECT COALESCE(json_agg(d), '[]'::JSON) INTO attended_json
  FROM (
    SELECT d.delegate_id, d.title, d.first_name, d.last_name, d.chapter, d.district,
           d.email, d.phone, d.rank, d.office, d.delegate_type, d.room_number, c.checked_in_at
    FROM delegates d
    JOIN checkins c ON c.delegate_id = d.delegate_id AND c.event_id = d.event_id
    WHERE d.event_id = p_event_id
      AND ((p_session_id IS NULL AND c.session_id IS NULL)
           OR (p_session_id IS NOT NULL AND c.session_id = p_session_id))
    ORDER BY d.chapter, d.last_name, d.first_name
  ) d;

  SELECT COALESCE(json_agg(sa), '[]'::JSON) INTO session_attendance_json
  FROM (
    SELECT session_id, COUNT(*) AS attendance
    FROM checkins
    WHERE event_id = p_event_id AND session_id IS NOT NULL
    GROUP BY session_id
  ) sa;

  SELECT COALESCE(json_agg(f), '[]'::JSON) INTO financials_json
  FROM (SELECT * FROM financial_entries WHERE event_id = p_event_id ORDER BY created_at) f;

  SELECT COALESCE(json_agg(p), '[]'::JSON) INTO pledges_json
  FROM (SELECT * FROM pledges WHERE event_id = p_event_id ORDER BY created_at) p;

  RETURN json_build_object(
    'attendedDelegates', attended_json,
    'sessionAttendance', session_attendance_json,
    'financials', financials_json,
    'pledges', pledges_json
  );
END;
$func$;
