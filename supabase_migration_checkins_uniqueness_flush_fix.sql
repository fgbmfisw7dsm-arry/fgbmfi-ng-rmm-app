-- =============================================================================
-- FGBMFI-EMS — Check-ins uniqueness + offline flush fix (v1.82-fix5) — SINGLE FILE
-- -----------------------------------------------------------------------------
-- Run this ONE file in the Supabase SQL editor. It fixes the root cause of
-- "already-checked-in delegates re-appearing in the Live Attendance Feed after an
-- offline sync":
--
--   The live `checkins` table had ONLY a NON-partial unique index
--   (event_id, delegate_id, session_id). Postgres treats NULL session_id as
--   distinct, so that index CANNOT block duplicate ARRIVAL rows. The offline
--   batch flush inserted arrivals with ON CONFLICT DO NOTHING, found no
--   conflicting index, and inserted a duplicate stamped NOW(); the dashboard
--   feed (DISTINCT ON delegate SELECT latest) then re-surfaced the delegate.
--
-- This file:
--   1. Backs up the existing duplicate arrival rows.
--   2. Deletes them (keeps the EARLIEST checked_in_at per delegate).
--   3. Creates the missing PARTIAL unique indexes (arrival + session).
--   4. Replaces flush_checkins() with a hardened body that (a) pre-checks the
--      arrival case and returns 'already' WITHOUT inserting (idempotent even if
--      a constraint is ever missing), and (b) persists the ORIGINAL scan time.
--
-- Wrapped in one transaction: if any step fails (e.g. a stray duplicate), the
-- whole thing rolls back — no half-done state. Idempotent: safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Back up duplicate ARRIVAL rows (regenerated on every run — re-runs are safe)
--    Keeps the earliest checked_in_at per (event_id, delegate_id); rn > 1 are
--    the duplicates to remove. Deterministic enumeration (per §35 lesson).
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.checkins_dupes_backup;
CREATE TABLE public.checkins_dupes_backup AS
SELECT c.*
FROM checkins c
JOIN (
    SELECT checkin_id,
           ROW_NUMBER() OVER (
               PARTITION BY event_id, delegate_id
               ORDER BY checked_in_at ASC, checkin_id ASC
           ) AS rn
    FROM checkins
    WHERE session_id IS NULL
) r ON r.checkin_id = c.checkin_id AND r.rn > 1;

-- Keep the backup private (no policies => no PostgREST/anon access).
ALTER TABLE public.checkins_dupes_backup ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Delete ONLY the backed-up duplicate ids
-- ---------------------------------------------------------------------------
DELETE FROM checkins c
USING public.checkins_dupes_backup b
WHERE c.checkin_id = b.checkin_id;

-- ---------------------------------------------------------------------------
-- 3. The missing partial unique indexes (arrival is the essential one)
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_event_delegate_arrival_unique
    ON checkins(event_id, delegate_id) WHERE session_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_event_delegate_session_unique
    ON checkins(event_id, delegate_id, session_id) WHERE session_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Hardened flush_checkins (arrival pre-check + original scan time)
--    SECURITY INVOKER — caller RLS governs. Per-item error isolation.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION flush_checkins(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
    v_item         JSONB;
    v_item_id      TEXT;
    v_event_id     UUID;
    v_delegate_id  UUID;
    v_session_id   UUID;
    v_registrar    UUID;
    v_checked_at   TIMESTAMPTZ;
    v_active       BOOLEAN;
    v_cached_event UUID := NULL;
    v_cached_active BOOLEAN := TRUE;
    v_has_arrival  BOOLEAN;
    v_inserted     INT;
    v_audit        BOOLEAN := TRUE;
    v_name         TEXT;
    v_district     TEXT;
    v_chapter      TEXT;
    v_results      JSONB := '[]'::jsonb;
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
            v_registrar   := NULLIF(v_item->>'registrar_id', '')::uuid;
            v_checked_at  := NULLIF(v_item->>'checked_in_at', '')::timestamptz;

            IF v_event_id IS NULL OR v_delegate_id IS NULL THEN
                v_results := v_results || jsonb_build_object('id', v_item_id, 'status', 'error', 'message', 'Invalid queue item');
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

            -- Arrival item: explicit pre-check so an already-checked-in delegate
            -- is reported as 'already' and NEVER inserts (idempotent by design).
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
                -- Session item: ensure the arrival tier exists first.
                SELECT EXISTS (
                    SELECT 1 FROM checkins
                    WHERE event_id = v_event_id
                      AND delegate_id = v_delegate_id
                      AND session_id IS NULL
                ) INTO v_has_arrival;
                IF NOT v_has_arrival THEN
                    INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by, checked_in_at)
                    VALUES (v_event_id, v_delegate_id, NULL, COALESCE(v_registrar, auth.uid()), COALESCE(v_checked_at, NOW()))
                    ON CONFLICT DO NOTHING;
                END IF;
            END IF;

            INSERT INTO checkins (event_id, delegate_id, session_id, checked_in_by, checked_in_at)
            VALUES (v_event_id, v_delegate_id, v_session_id, COALESCE(v_registrar, auth.uid()), COALESCE(v_checked_at, NOW()))
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
                    COALESCE(v_registrar, auth.uid()),
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

REVOKE ALL ON FUNCTION flush_checkins(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION flush_checkins(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;

-- =============================================================================
-- Optional verification (read-only — run separately after COMMIT):
--   SELECT indexname FROM pg_indexes WHERE tablename='checkins' ORDER BY 1;
--     -- expect idx_checkins_event_delegate_arrival_unique + ..._session_unique
--   SELECT event_id, delegate_id, COUNT(*) FROM checkins
--     WHERE session_id IS NULL GROUP BY 1,2 HAVING COUNT(*)>1;   -- expect 0 rows
--   SELECT prosrc LIKE '%EXISTS%' AS precheck_deployed
--     FROM pg_proc WHERE proname='flush_checkins';              -- expect true
-- =============================================================================
