-- =============================================================================
-- FGBMFI-EMS — Offline cache / queue hardening (v1.86) — SINGLE FILE
-- -----------------------------------------------------------------------------
-- Complements the on-device encryption/expiry work:
--   1. checkins / session_responses INSERT policies now require the delegate to
--      belong to the event, the session to belong to the event, the caller's
--      district/region scope, and checked_in_by/recorded_by = auth.uid().
--   2. flush_checkins / flush_session_responses ignore any client-supplied
--      registrar_id for authorization (auth.uid() wins), validate event/delegate
--      /session consistency, and clamp client timestamps so a tampered queue
--      cannot backdate or future-date attendance.
--
-- The functions remain SECURITY INVOKER: the caller's RLS still governs every
-- read/write. The only change is that malformed queue items now fail closed
-- instead of being trusted.
--
-- Idempotent: safe to re-run. Deploy BEFORE the frontend.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. checkins INSERT — event/scope consistency + no registrar spoofing
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "checkins_admin_registrar_insert" ON checkins;
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
    (
      is_admin_user()
      OR is_event_admin_user()
      OR is_registrar_user()
      OR is_national_role_user()
    )
    AND checked_in_by::text = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM delegates d
      WHERE d.delegate_id = checkins.delegate_id
        AND d.event_id = checkins.event_id
        AND (
          is_admin_user()
          OR is_event_admin_user()
          OR is_national_role_user()
          OR (current_user_district() IS NOT NULL AND d.district ILIKE current_user_district())
          OR (current_user_region() IS NOT NULL AND d.district ILIKE current_user_region() || '%')
        )
    )
    AND (
      checkins.session_id IS NULL
      OR EXISTS (
        SELECT 1 FROM sessions s
        WHERE s.session_id = checkins.session_id
          AND s.event_id = checkins.event_id
      )
    )
);

-- ---------------------------------------------------------------------------
-- 2. session_responses INSERT — same consistency + no registrar spoofing
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "sr_insert" ON session_responses;
CREATE POLICY "sr_insert" ON session_responses FOR INSERT TO authenticated WITH CHECK (
    (
      is_admin_user()
      OR is_event_admin_user()
      OR is_registrar_user()
      OR is_national_role_user()
    )
    AND recorded_by::text = auth.uid()::text
    AND EXISTS (
      SELECT 1 FROM delegates d
      WHERE d.delegate_id = session_responses.delegate_id
        AND d.event_id = session_responses.event_id
        AND (
          is_admin_user()
          OR is_event_admin_user()
          OR is_national_role_user()
          OR (current_user_district() IS NOT NULL AND d.district ILIKE current_user_district())
          OR (current_user_region() IS NOT NULL AND d.district ILIKE current_user_region() || '%')
        )
    )
    AND EXISTS (
      SELECT 1 FROM sessions s
      WHERE s.session_id = session_responses.session_id
        AND s.event_id = session_responses.event_id
    )
);

-- ---------------------------------------------------------------------------
-- 3. flush_checkins — owner from auth.uid(), consistency checks, timestamp clamp
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION flush_checkins(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_item          JSONB;
    v_item_id       TEXT;
    v_event_id      UUID;
    v_delegate_id   UUID;
    v_session_id    UUID;
    v_registrar     UUID;
    v_checked_at    TIMESTAMPTZ;
    v_active        BOOLEAN;
    v_cached_event  UUID := NULL;
    v_cached_active BOOLEAN := TRUE;
    v_has_arrival   BOOLEAN;
    v_inserted      INT;
    v_audit         BOOLEAN := TRUE;
    v_name          TEXT;
    v_district      TEXT;
    v_chapter       TEXT;
    v_results       JSONB := '[]'::jsonb;
BEGIN
    SELECT audit_enabled INTO v_audit FROM system_settings LIMIT 1;
    IF v_audit IS NULL THEN v_audit := TRUE; END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
    LOOP
        v_item_id := v_item->>'id';

        BEGIN
            v_event_id    := NULLIF(v_item->>'event_id', '')::uuid;
            v_delegate_id := NULLIF(v_item->>'delegate_id', '')::uuid;
            v_session_id  := NULLIF(v_item->>'session_id', '')::uuid;
            -- auth.uid() always wins for authenticated callers. The payload
            -- fallback only exists for service_role/manual recovery.
            v_registrar   := COALESCE(auth.uid(), NULLIF(v_item->>'registrar_id', '')::uuid);
            v_checked_at  := NULLIF(v_item->>'checked_in_at', '')::timestamptz;

            IF v_event_id IS NULL OR v_delegate_id IS NULL OR v_registrar IS NULL THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Invalid queue item');
                CONTINUE;
            END IF;

            -- Never trust a client-supplied timestamp outside a sane window.
            v_checked_at := LEAST(COALESCE(v_checked_at, NOW()), NOW() + INTERVAL '5 minutes');
            v_checked_at := GREATEST(v_checked_at, NOW() - INTERVAL '30 days');

            IF v_cached_event IS DISTINCT FROM v_event_id THEN
                SELECT is_active INTO v_active FROM events WHERE event_id = v_event_id;
                v_cached_event := v_event_id;
                v_cached_active := v_active;
            END IF;

            IF v_cached_active IS NULL THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Event not found');
                CONTINUE;
            END IF;

            IF v_cached_active IS NOT TRUE THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'locked', 'message', 'Event is read-only');
                CONTINUE;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM delegates
                WHERE delegate_id = v_delegate_id
                  AND event_id = v_event_id
            ) THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Delegate does not belong to this event');
                CONTINUE;
            END IF;

            IF v_session_id IS NOT NULL AND NOT EXISTS (
                SELECT 1 FROM sessions
                WHERE session_id = v_session_id
                  AND event_id = v_event_id
            ) THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Session does not belong to this event');
                CONTINUE;
            END IF;

            IF v_session_id IS NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM checkins
                    WHERE event_id = v_event_id
                      AND delegate_id = v_delegate_id
                      AND session_id IS NULL
                ) INTO v_has_arrival;
                IF v_has_arrival THEN
                    v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'already', 'message', 'Already Checked-in');
                    CONTINUE;
                END IF;
            ELSE
                SELECT EXISTS (
                    SELECT 1 FROM checkins
                    WHERE event_id = v_event_id
                      AND delegate_id = v_delegate_id
                      AND session_id IS NULL
                ) INTO v_has_arrival;
                IF NOT v_has_arrival THEN
                    INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by, checked_in_at)
                    VALUES (v_event_id, v_delegate_id, NULL, v_registrar::text, v_checked_at)
                    ON CONFLICT DO NOTHING;
                END IF;
            END IF;

            INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by, checked_in_at)
            VALUES (v_event_id, v_delegate_id, v_session_id, v_registrar::text, v_checked_at)
            ON CONFLICT DO NOTHING;

            GET DIAGNOSTICS v_inserted = ROW_COUNT;

            IF v_inserted > 0 AND v_audit THEN
                SELECT first_name || ' ' || last_name, district, chapter
                  INTO v_name, v_district, v_chapter
                FROM delegates
                WHERE delegate_id = v_delegate_id;

                INSERT INTO audit_log (
                    event_id, action_type, performed_by, performer_email,
                    target_type, target_id, summary, metadata
                ) VALUES (
                    v_event_id,
                    CASE WHEN v_session_id IS NULL THEN 'checkin_arrival' ELSE 'checkin_session' END,
                    v_registrar,
                    (SELECT email FROM app_users WHERE id = auth.uid()),
                    'checkin',
                    v_delegate_id::text,
                    (CASE WHEN v_session_id IS NULL THEN 'Arrival' ELSE 'Session Attendance' END)
                        || ': ' || COALESCE(v_name, v_delegate_id::text)
                        || ' (' || COALESCE(v_district, '?') || ' ' || COALESCE(v_chapter, '') || ')',
                    jsonb_build_object('session_id', v_session_id, 'offline_queue', true)
                );
            END IF;

            v_results := v_results || jsonb_build_object(
                'id', v_item_id,
                'status', CASE WHEN v_inserted > 0 THEN 'ok' ELSE 'already' END,
                'message', CASE WHEN v_inserted > 0 THEN 'Verified' ELSE 'Already Checked-in' END
            );
        EXCEPTION WHEN OTHERS THEN
            v_results := v_results || jsonb_build_object(
                'id', v_item_id, 'status', 'error', 'message', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object('results', v_results);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. flush_session_responses — owner from auth.uid(), consistency checks
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION flush_session_responses(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_item          JSONB;
    v_item_id       TEXT;
    v_event_id      UUID;
    v_delegate_id   UUID;
    v_session_id    UUID;
    v_registrar     UUID;
    v_type          TEXT;
    v_active        BOOLEAN;
    v_cached_event  UUID := NULL;
    v_cached_active BOOLEAN := TRUE;
    v_has_arrival   BOOLEAN;
    v_has_session   BOOLEAN;
    v_inserted      INT;
    v_audit         BOOLEAN := TRUE;
    v_name          TEXT;
    v_sess_title    TEXT;
    v_results       JSONB := '[]'::jsonb;
BEGIN
    SELECT audit_enabled INTO v_audit FROM system_settings LIMIT 1;
    IF v_audit IS NULL THEN v_audit := TRUE; END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
    LOOP
        v_item_id := v_item->>'id';

        BEGIN
            v_event_id    := NULLIF(v_item->>'event_id', '')::uuid;
            v_delegate_id := NULLIF(v_item->>'delegate_id', '')::uuid;
            v_session_id  := NULLIF(v_item->>'session_id', '')::uuid;
            v_registrar   := COALESCE(auth.uid(), NULLIF(v_item->>'registrar_id', '')::uuid);
            v_type        := UPPER(TRIM(COALESCE(v_item->>'response_type', '')));

            IF v_event_id IS NULL OR v_delegate_id IS NULL OR v_session_id IS NULL OR v_registrar IS NULL THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Invalid queue item');
                CONTINUE;
            END IF;

            IF v_type NOT IN ('FT', 'SLV', 'HGB', 'MI') THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Invalid response type');
                CONTINUE;
            END IF;

            IF v_cached_event IS DISTINCT FROM v_event_id THEN
                SELECT is_active INTO v_active FROM events WHERE event_id = v_event_id;
                v_cached_event := v_event_id;
                v_cached_active := v_active;
            END IF;

            IF v_cached_active IS NULL THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Event not found');
                CONTINUE;
            END IF;

            IF v_cached_active IS NOT TRUE THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'locked', 'message', 'Event is read-only');
                CONTINUE;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM delegates
                WHERE delegate_id = v_delegate_id
                  AND event_id = v_event_id
            ) THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Delegate does not belong to this event');
                CONTINUE;
            END IF;

            IF NOT EXISTS (
                SELECT 1 FROM sessions
                WHERE session_id = v_session_id
                  AND event_id = v_event_id
            ) THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Session does not belong to this event');
                CONTINUE;
            END IF;

            SELECT EXISTS (
                SELECT 1 FROM checkins
                WHERE event_id = v_event_id
                  AND delegate_id = v_delegate_id
                  AND session_id IS NULL
            ) INTO v_has_arrival;
            IF NOT v_has_arrival THEN
                INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
                VALUES (v_event_id, v_delegate_id, NULL, v_registrar::text)
                ON CONFLICT DO NOTHING;
            END IF;

            SELECT EXISTS (
                SELECT 1 FROM checkins
                WHERE event_id = v_event_id
                  AND delegate_id = v_delegate_id
                  AND session_id = v_session_id
            ) INTO v_has_session;
            IF NOT v_has_session THEN
                INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by)
                VALUES (v_event_id, v_delegate_id, v_session_id, v_registrar::text)
                ON CONFLICT DO NOTHING;
            END IF;

            INSERT INTO session_responses (
                event_id, delegate_id, session_id, response_type, recorded_by
            ) VALUES (
                v_event_id, v_delegate_id, v_session_id, v_type, v_registrar
            )
            ON CONFLICT DO NOTHING;

            GET DIAGNOSTICS v_inserted = ROW_COUNT;

            IF v_inserted > 0 AND v_audit THEN
                SELECT first_name || ' ' || last_name INTO v_name
                FROM delegates WHERE delegate_id = v_delegate_id;
                SELECT title INTO v_sess_title
                FROM sessions WHERE session_id = v_session_id;

                INSERT INTO audit_log (
                    event_id, action_type, performed_by, performer_email,
                    target_type, target_id, summary, metadata
                ) VALUES (
                    v_event_id,
                    'session_call_' || lower(v_type),
                    v_registrar,
                    (SELECT email FROM app_users WHERE id = auth.uid()),
                    'session_response',
                    v_delegate_id::text,
                    v_type || ': ' || COALESCE(v_name, v_delegate_id::text)
                        || ' (' || COALESCE(v_sess_title, v_session_id::text) || ')',
                    jsonb_build_object('session_id', v_session_id, 'response_type', v_type, 'offline_queue', true)
                );
            END IF;

            v_results := v_results || jsonb_build_object(
                'id', v_item_id,
                'status', CASE WHEN v_inserted > 0 THEN 'ok' ELSE 'already' END,
                'message', CASE WHEN v_inserted > 0 THEN 'Recorded' ELSE 'Already Recorded' END
            );
        EXCEPTION WHEN OTHERS THEN
            v_results := v_results || jsonb_build_object(
                'id', v_item_id, 'status', 'error', 'message', SQLERRM
            );
        END;
    END LOOP;

    RETURN jsonb_build_object('results', v_results);
END;
$fn$;

REVOKE ALL ON FUNCTION flush_checkins(JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION flush_session_responses(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flush_checkins(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION flush_session_responses(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
