-- =============================================================================
-- FGBMFI-EMS — Single-RTT Delegate Registration + Arrival Check-in RPC (v1.66)
-- -----------------------------------------------------------------------------
-- Collapses the New Delegate form submit path (previously ~7–10 sequential
-- HTTPS round-trips per entry: restriction check + routing + dedup probes +
-- delegates INSERT + checkInDelegate guard/re-select/insert + audit) into ONE
-- server-side call. SAFE-BY-DESIGN:
--   • SECURITY INVOKER — the caller's own RLS governs every read/write
--     (identical privilege surface to today's client queries; the live
--     delegates_insert_scoped / checkins_admin_registrar_insert /
--     audit_log-insert policies all still apply verbatim).
--   • Mirrors db.registerDelegate 1:1: registrar free-guest restriction
--     (is_registrar_user + event_config), guest/type rroting via
--     get_delegate_type_district, phone normalization, identity dedup probes,
--     and the 23505 → duplicate handling.
--   • Mirrors checkInDelegate arrival: arrival checkins.insert with
--     ON CONFLICT on the partial unique index, "Already Checked-in" on
--     pre-existing arrival, and the audit_log row (action_type
--     'checkin_arrival', identical summary format via p_registrar_* params).
-- Setup: DEPLOY THIS MIGRATION FIRST, then the frontend wrapper. Rollback is
-- harmless: the client falls back to the classic TS path automatically.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.record_delegate_and_checkin(
    p_payload JSONB,
    p_event_id UUID,
    p_registrar_uid UUID DEFAULT NULL,
    p_registrar_email TEXT DEFAULT NULL,
    p_audit_enabled BOOLEAN DEFAULT true
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions
AS $fn$
DECLARE
    v_active BOOLEAN := false;
    v_restricted BOOLEAN := false;
    v_type TEXT;
    v_district TEXT;
    v_chapter TEXT;
    v_title TEXT;
    v_first TEXT;
    v_last TEXT;
    v_phone_norm TEXT;
    v_email TEXT;
    v_rank TEXT;
    v_office TEXT;
    v_source TEXT;
    v_qr_hash TEXT;
    v_external_id TEXT;
    v_paid_amount NUMERIC;
    v_paid_ref TEXT;
    v_dup_id UUID := NULL;
    v_delegate_id UUID := NULL;
    v_del RECORD;
    v_arr_cnt INT := 0;
    v_ins_cnt INT := 0;
    v_inserted BOOLEAN := false;
    v_already BOOLEAN := false;
    v_detail TEXT;
    v_delegate JSONB;
    v_checkin JSONB;
BEGIN
    -- 1) lifecycle guard (mirrors ensureEventActive)
    SELECT is_active INTO v_active FROM events WHERE event_id = p_event_id;
    IF v_active IS DISTINCT FROM TRUE THEN
        RETURN jsonb_build_object('ok', false, 'locked', true, 'message', 'EVENT_LOCKED: This event is currently inactive (Read-Only).')::json;
    END IF;

    p_payload := COALESCE(p_payload, '{}'::jsonb);
    v_type   := COALESCE(NULLIF(TRIM(p_payload->>'delegate_type'), ''), 'Member');
    v_title  := COALESCE(TRIM(p_payload->>'title'), '');
    v_first  := COALESCE(TRIM(p_payload->>'first_name'), '');
    v_last   := COALESCE(TRIM(p_payload->>'last_name'), '');
    v_district := COALESCE(TRIM(p_payload->>'district'), '');
    v_chapter  := COALESCE(TRIM(p_payload->>'chapter'), '');
    v_phone_norm := normalize_phone_sql(p_payload->>'phone');
    v_email  := COALESCE(LOWER(TRIM(p_payload->>'email')), '');
    v_rank   := COALESCE(NULLIF(TRIM(p_payload->>'rank'), ''), 'CP');
    v_office := COALESCE(NULLIF(TRIM(p_payload->>'office'), ''), 'OTHER');
    v_source := COALESCE(NULLIF(TRIM(p_payload->>'registration_source'), ''), 'EMS');
    v_qr_hash := COALESCE(NULLIF(TRIM(p_payload->>'qr_hash'), ''), gen_random_uuid()::TEXT);
    IF NULLIF(TRIM(p_payload->>'external_id'), '') IS NOT NULL THEN
        v_external_id := TRIM(p_payload->>'external_id');
    ELSE
        v_external_id := 'CON26' || to_char(now(), 'MMDDHH24MISS') || substr(md5(random()::text), 1, 10);
    END IF;
    v_paid_amount := NULLIF(p_payload->>'payment_amount', '')::NUMERIC;
    v_paid_ref := NULLIF(TRIM(p_payload->>'payment_reference'), '');

    IF v_first = '' OR v_last = '' OR v_district = '' THEN
        RETURN jsonb_build_object('ok', false, 'error', true, 'message', 'registerDelegate requires first_name, last_name and district.')::json;
    END IF;

    -- 2) registrar free-guest restriction (mirrors isRegistrarFreeGuestRestricted;
    --    is_registrar_user() excludes exec_registrar + admins, matching the JS gate)
    IF is_registrar_user() AND v_source IN ('manual', 'EMS') THEN
        SELECT COALESCE(COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true', false)
          INTO v_restricted FROM events e WHERE e.event_id = p_event_id;
    END IF;

    IF v_restricted AND UPPER(COALESCE(v_type, '')) <> 'FREE GUEST' THEN
        RETURN jsonb_build_object('ok', false, 'permission', true, 'message', 'PERMISSION: Registrar role restricted to Free Guest registrations for this event.')::json;
    END IF;

    IF v_restricted THEN
        v_type := 'Free Guest';
        v_district := COALESCE(get_delegate_type_district('Free Guest'), '');
        v_chapter := 'Guest';
        IF v_district = '' THEN
            RETURN jsonb_build_object('ok', false, 'error', true, 'message', 'Free Guest district not configured in System Setup.')::json;
        END IF;
    END IF;

    -- 3) guest/type district routing (mirrors isGuestRoutedType + typeLockedDistrict)
    IF v_type <> '' AND LOWER(v_type) <> 'member' AND LOWER(v_type) NOT LIKE 'dependant%' THEN
        v_district := COALESCE(get_delegate_type_district(v_type), CASE WHEN LOWER(v_type) = 'international' THEN 'International' ELSE 'Guest' END);
        v_chapter := 'Guest';
    END IF;

    -- 4) identity dedup probes (mirror registerDelegate phone / contact-less branches)
    IF NULLIF(v_phone_norm, '') IS NOT NULL THEN
        SELECT d.delegate_id INTO v_dup_id FROM delegates d
        WHERE d.event_id = p_event_id
          AND normalize_name_key(d.first_name) = normalize_name_key(v_first)
          AND normalize_name_key(d.last_name) = normalize_name_key(v_last)
          AND normalize_name_key(COALESCE(NULLIF(TRIM(d.title), ''), 'Mr')) = normalize_name_key(COALESCE(NULLIF(v_title, ''), 'Mr'))
          AND normalize_phone_sql(d.phone) = v_phone_norm
        LIMIT 1;
        IF v_dup_id IS NOT NULL THEN
            RETURN jsonb_build_object('ok', false, 'duplicate', true, 'message', 'A delegate with this name and phone already exists for this event.')::json;
        END IF;
    ELSIF NULLIF(v_email, '') IS NULL THEN
        SELECT d.delegate_id INTO v_dup_id FROM delegates d
        WHERE d.event_id = p_event_id
          AND normalize_name_key(d.first_name) = normalize_name_key(v_first)
          AND normalize_name_key(d.last_name) = normalize_name_key(v_last)
          AND normalize_name_key(COALESCE(NULLIF(TRIM(d.title), ''), 'Mr')) = normalize_name_key(COALESCE(NULLIF(v_title, ''), 'Mr'))
          AND (NULLIF(normalize_phone_sql(d.phone), '') IS NULL OR NULLIF(d.email, '') IS NULL)
        LIMIT 1;
        IF v_dup_id IS NOT NULL THEN
            RETURN jsonb_build_object('ok', false, 'duplicate', true, 'message', 'A contact-less delegate with this name already exists for this event.')::json;
        END IF;
    END IF;

    -- 5) INSERT delegate (reg_type 'ems' — the New Delegate form is EMS)
    BEGIN
        INSERT INTO delegates (
            title, first_name, last_name, district, chapter, phone, email,
            rank, office, delegate_type, qr_hash, event_id, external_id,
            registration_source, reg_type, payment_amount, payment_reference
        ) VALUES (
            v_title, v_first, v_last, v_district, v_chapter,
            v_phone_norm, v_email,
            v_rank, v_office, v_type, v_qr_hash, p_event_id, v_external_id,
            v_source, 'ems', v_paid_amount, v_paid_ref
        )
        RETURNING delegate_id INTO v_delegate_id;
    EXCEPTION WHEN unique_violation THEN
        SELECT d.delegate_id INTO v_dup_id FROM delegates d
        WHERE d.event_id = p_event_id
          AND normalize_name_key(d.first_name) = normalize_name_key(v_first)
          AND normalize_name_key(d.last_name) = normalize_name_key(v_last)
          AND COALESCE(d.phone_normalized, '') = COALESCE(v_phone_norm, '')
        LIMIT 1;
        IF v_dup_id IS NOT NULL THEN
            v_delegate_id := v_dup_id;
        END IF;
    END;

    IF v_delegate_id IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'duplicate', true, 'message', 'A delegate with this name and phone already exists for this event.')::json;
    END IF;

    -- 6) arrival check-in (mirrors checkInDelegate with no session)
    SELECT qr_hash, delegate_id, title, first_name, last_name, district, chapter, delegate_type, external_id
      INTO v_del FROM delegates WHERE delegate_id = v_delegate_id;

    SELECT count(*) INTO v_arr_cnt FROM checkins
    WHERE event_id = p_event_id AND delegate_id = v_delegate_id AND session_id IS NULL;

    IF v_arr_cnt = 0 THEN
        INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
        VALUES (p_event_id, v_delegate_id, NULL, p_registrar_uid)
        ON CONFLICT (event_id, delegate_id) WHERE session_id IS NULL DO NOTHING;
        GET DIAGNOSTICS v_ins_cnt = ROW_COUNT;
    END IF;
    v_inserted := v_ins_cnt > 0;
    v_already := v_arr_cnt > 0 AND NOT v_inserted;

    IF v_inserted AND p_audit_enabled THEN
        v_detail := trim(concat(v_del.first_name, ' ', v_del.last_name, ' (', COALESCE(v_del.district, '?'), ' ', COALESCE(v_del.chapter, ''), ')'));
        INSERT INTO audit_log (event_id, action_type, performed_by, performer_email, target_type, target_id, summary, metadata)
        VALUES (
            p_event_id, 'checkin_arrival', p_registrar_uid, p_registrar_email, 'checkin', v_delegate_id,
            'Arrival: ' || v_detail, jsonb_build_object('session_id', NULL)
        );
    END IF;

    v_delegate := jsonb_build_object(
        'delegate_id', v_del.delegate_id, 'qr_hash', v_del.qr_hash, 'title', v_del.title,
        'first_name', v_del.first_name, 'last_name', v_del.last_name, 'district', v_del.district,
        'chapter', v_del.chapter, 'delegate_type', v_del.delegate_type, 'external_id', v_del.external_id
    );
    v_checkin := jsonb_build_object(
        'ok', v_inserted OR v_already,
        'already_checked_in', v_already,
        'message', CASE WHEN v_inserted THEN 'Verified' WHEN v_already THEN 'Already Checked-in' ELSE 'Pending manual verify' END
    );

    RETURN json_build_object(
        'ok', true, 'delegate', v_delegate, 'checkin', v_checkin,
        'inserted', v_inserted, 'already_checked_in', v_already
    );
END;
$fn$;

-- Revoke anon/public; grant only to authenticated + service_role (hardening parity)
REVOKE ALL ON FUNCTION public.record_delegate_and_checkin(jsonb, uuid, uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.record_delegate_and_checkin(jsonb, uuid, uuid, text, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_delegate_and_checkin(jsonb, uuid, uuid, text, boolean) IS
'FGBMFI-EMS single-RTT delegate registration + arrival check-in. SECURITY INVOKER. Mirrors registerDelegate (restriction/routing/dedup, reg_type=ems) + checkInDelegate arrival (partial-unique ON CONFLICT, audit_log).';