-- =============================================================================
-- FGBMFI-EMS — Single-RTT Check-In RPC (v1.54)
-- -----------------------------------------------------------------------------
-- Collapses the QR-scan hot path (which currently runs ~5–12 sequential HTTPS
-- round-trips per scan) into ONE server-side call. SAFE-BY-DESIGN:
--   • SECURITY INVOKER — the caller's own RLS governs every read/write
--     (identical privilege surface to today's client queries).
--   • Conservative resolution — identifier probes mirror client Pass 1–3
--     (qr_hash / external_id / delegate_id, event-scoped, first-row like
--     maybeSingle). Token probes (payload id / phone / email) resolve ONLY on
--     an EXACTLY-ONE row match; zero or multiple rows → `needs_parse`, and the
--     existing TS path (fuzzy family-aware match + needsRegistration §49) runs
--     unchanged. A wrong auto-check-in is therefore impossible.
--   • NO new identity logic — reuses existing columns/functions/indexes
--     (qr_hash, external_id, phone_normalized, normalize_phone_sql, email).
--   • Write semantics mirror checkInDelegate 1:1: arrival cascade for session
--     scans, duplicate detection, partial-unique-index ON CONFLICT, and the
--     audt_log row with identical action types/summary format.
-- Setup: DEPLOY THIS MIGRATION FIRST, then the frontend wrapper. Rollback is
-- harmless: the client falls back to the classic TS path automatically.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_in_by_code(
    p_event_id uuid,
    p_code text,
    p_session_id uuid DEFAULT NULL,
    p_registrar_uid uuid DEFAULT NULL,
    p_registrar_email text DEFAULT NULL,
    p_audit_enabled boolean DEFAULT true
)
RETURNS json
LANGUAGE plpgsql
SECURITY INVOKER
AS $fn$
DECLARE
    v_active boolean := false;
    v_resolved uuid := NULL;
    v_cnt integer;
    v_tok text[];
    v_phone_raw text;
    v_phone text;
    v_safe uuid;
    v_arr_cnt integer := 0;
    v_dup_cnt integer := 0;
    v_inserted boolean := false;
    v_del record;
    v_delegate jsonb;
    v_detail text;
BEGIN
    p_code := coalesce(trim(p_code), '');
    IF p_code = '' THEN
        RETURN jsonb_build_object('ok', false, 'needs_parse', true, 'message', 'Confirm delegate details below.')::json;
    END IF;
    v_safe := p_session_id;

    -- 1) lifecycle guard (mirrors ensureEventActive)
    SELECT is_active INTO v_active FROM events WHERE event_id = p_event_id;
    IF v_active IS DISTINCT FROM TRUE THEN
        RETURN jsonb_build_object('ok', false, 'locked', true, 'message', 'EVENT_LOCKED: This event is currently inactive (Read-Only).')::json;
    END IF;

    -- 2) identifier probes on the raw code (client Pass 1–3 parity)
    SELECT delegate_id INTO v_resolved
      FROM delegates WHERE event_id = p_event_id AND qr_hash = p_code LIMIT 1;
    IF v_resolved IS NULL THEN
        SELECT delegate_id INTO v_resolved
          FROM delegates WHERE event_id = p_event_id AND external_id = p_code LIMIT 1;
    END IF;
    IF v_resolved IS NULL THEN
        SELECT delegate_id INTO v_resolved
          FROM delegates WHERE event_id = p_event_id AND delegate_id::text = p_code LIMIT 1;
    END IF;

    -- 3a) id-token probe from payload (mirrors client extractFromFields idField)
    IF v_resolved IS NULL THEN
        FOR v_tok IN SELECT DISTINCT regexp_matches(p_code, '[A-Z0-9]{20,}', 'gi') ORDER BY 1 LIMIT 20 LOOP
            SELECT delegate_id INTO v_resolved
              FROM delegates WHERE event_id = p_event_id AND (external_id = v_tok[1] OR delegate_id::text = v_tok[1]) LIMIT 1;
            IF v_resolved IS NOT NULL THEN EXIT; END IF;
        END LOOP;
    END IF;

    -- 3b) phone-token probe — EXACTLY-ONE row rule
    IF v_resolved IS NULL THEN
        FOR v_tok IN SELECT DISTINCT regexp_matches(p_code, '[+()0-9][0-9() .-]{8,18}', 'g') ORDER BY 1 LIMIT 10 LOOP
            v_phone_raw := regexp_replace(v_tok[1], '[^0-9]', '', 'g');
            CONTINUE WHEN length(v_phone_raw) < 10 OR length(v_phone_raw) > 14;
            v_phone := normalize_phone_sql(v_phone_raw);
            SELECT count(*) INTO v_cnt FROM delegates WHERE event_id = p_event_id AND phone_normalized = v_phone;
            IF v_cnt = 1 THEN
                SELECT delegate_id INTO v_resolved FROM delegates WHERE event_id = p_event_id AND phone_normalized = v_phone;
                EXIT;
            ELSIF v_cnt > 1 THEN
                v_resolved := NULL; -- ambiguous (e.g. shared family phone) → needs_parse, TS disambiguates
                EXIT;
            END IF;
        END LOOP;
    END IF;

    -- 3c) email-token probe — EXACTLY-ONE row rule
    IF v_resolved IS NULL THEN
        FOR v_tok IN SELECT DISTINCT regexp_matches(p_code, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', 'gi') ORDER BY 1 LIMIT 10 LOOP
            SELECT count(*) INTO v_cnt FROM delegates WHERE event_id = p_event_id AND lower(email) = lower(v_tok[1]);
            IF v_cnt = 1 THEN
                SELECT delegate_id INTO v_resolved FROM delegates WHERE event_id = p_event_id AND lower(email) = lower(v_tok[1]);
                EXIT;
            ELSIF v_cnt > 1 THEN
                v_resolved := NULL;
                EXIT;
            END IF;
        END LOOP;
    END IF;

    IF v_resolved IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'needs_parse', true, 'message', 'Confirm delegate details below.')::json;
    END IF;

    -- 4) check-in write (mirrors checkInDelegate)
    SELECT qr_hash, delegate_id, title, first_name, last_name, district, chapter, delegate_type
      INTO v_del FROM delegates WHERE delegate_id = v_resolved;

    SELECT count(*) FILTER (WHERE session_id IS NULL),
           count(*) FILTER (WHERE session_id IS NOT DISTINCT FROM v_safe)
      INTO v_arr_cnt, v_dup_cnt
      FROM checkins WHERE event_id = p_event_id AND delegate_id = v_resolved;

    IF v_safe IS NOT NULL AND v_arr_cnt = 0 THEN
        INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
        VALUES (p_event_id, v_resolved, NULL, p_registrar_uid)
        ON CONFLICT (event_id, delegate_id) WHERE session_id IS NULL DO NOTHING;
    END IF;

    IF v_dup_cnt > 0 THEN
        v_delegate := jsonb_build_object(
            'delegate_id', v_del.delegate_id, 'qr_hash', v_del.qr_hash, 'title', v_del.title,
            'first_name', v_del.first_name, 'last_name', v_del.last_name, 'district', v_del.district,
            'chapter', v_del.chapter, 'delegate_type', v_del.delegate_type
        );
        RETURN jsonb_build_object('ok', true, 'already_checked_in', true, 'message', 'Already Checked-in', 'delegate', v_delegate)::json;
    END IF;

    IF v_safe IS NOT NULL THEN
        INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
        VALUES (p_event_id, v_resolved, v_safe, p_registrar_uid)
        ON CONFLICT (event_id, delegate_id, session_id) WHERE session_id IS NOT NULL DO NOTHING;
    ELSE
        INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
        VALUES (p_event_id, v_resolved, NULL, p_registrar_uid)
        ON CONFLICT (event_id, delegate_id) WHERE session_id IS NULL DO NOTHING;
    END IF;
    GET DIAGNOSTICS v_cnt = ROW_COUNT;
    v_inserted := v_cnt > 0;

    IF v_inserted AND p_audit_enabled THEN
        v_detail := trim(concat(v_del.first_name, ' ', v_del.last_name, ' (', coalesce(v_del.district, '?'), ' ', coalesce(v_del.chapter, ''), ')'));
        INSERT INTO audit_log (event_id, action_type, performed_by, performer_email, target_type, target_id, summary, metadata)
        VALUES (
            p_event_id,
            CASE WHEN v_safe IS NOT NULL THEN 'checkin_session' ELSE 'checkin_arrival' END,
            p_registrar_uid, p_registrar_email, 'checkin', v_resolved,
            CASE WHEN v_safe IS NOT NULL THEN 'Session Attendance: ' ELSE 'Arrival: ' END || v_detail,
            jsonb_build_object('session_id', p_session_id)
        );
    END IF;

    v_delegate := jsonb_build_object(
        'delegate_id', v_del.delegate_id, 'qr_hash', v_del.qr_hash, 'title', v_del.title,
        'first_name', v_del.first_name, 'last_name', v_del.last_name, 'district', v_del.district,
        'chapter', v_del.chapter, 'delegate_type', v_del.delegate_type
    );
    RETURN jsonb_build_object(
        'ok', true, 'already_checked_in', false,
        'message', CASE WHEN v_inserted THEN 'Verified' ELSE 'Already Checked-in' END,
        'delegate', v_delegate
    )::json;
END;
$fn$;

-- Revoke anon/public; grant only to authenticated + service_role (hardening parity)
REVOKE ALL ON FUNCTION public.check_in_by_code(uuid, text, uuid, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.check_in_by_code(uuid, text, uuid, uuid, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.check_in_by_code(uuid, text, uuid, uuid, text, boolean) IS
'FGBMFI-EMS single-RTT check-in. SECURITY INVOKER. Conservative resolution (exactly-one-row token matches only); needs_parse ⇒ client TS fallback. Mirrors checkInDelegate (arrival cascade, partial-unique ON CONFLICT, audit_log).';