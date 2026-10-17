-- =============================================================================
-- FGBMFI-EMS — Live Event Pin (server-side global event context)
-- -----------------------------------------------------------------------------
-- Adds `system_settings.live_event_id` and an admin-only `set_live_event` RPC.
-- While a live event is pinned, every client forces that event as its active
-- context and the header event selector is locked. Admins unpin (or pin a
-- different event) from the UI. Pin is an operational context lock, NOT an
-- authorization boundary (RLS remains the security boundary).
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE system_settings
    ADD COLUMN IF NOT EXISTS live_event_id UUID REFERENCES events(event_id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION set_live_event(p_event_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
    v_uid   UUID := auth.uid();
    v_email TEXT;
    v_prev  UUID;
    v_name  TEXT;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: admin role required';
    END IF;

    SELECT live_event_id INTO v_prev
    FROM system_settings
    ORDER BY id
    LIMIT 1;

    IF p_event_id IS NOT NULL THEN
        SELECT name INTO v_name FROM events WHERE event_id = p_event_id;
        IF v_name IS NULL THEN
            RAISE EXCEPTION 'EVENT_NOT_FOUND';
        END IF;
    END IF;

    UPDATE system_settings
       SET live_event_id = p_event_id,
           updated_at = NOW();

    SELECT email INTO v_email FROM app_users WHERE id = v_uid;

    IF to_regclass('public.audit_log') IS NOT NULL THEN
        INSERT INTO audit_log (
            event_id, action_type, performed_by, performer_email,
            target_type, target_id, summary, metadata
        ) VALUES (
            p_event_id,
            CASE WHEN p_event_id IS NULL THEN 'live_event_unpin' ELSE 'live_event_pin' END,
            COALESCE(v_uid, '00000000-0000-0000-0000-000000000000'::uuid),
            v_email,
            'event',
            p_event_id::text,
            CASE
                WHEN p_event_id IS NULL THEN 'Live event unpinned'
                ELSE 'Live event set: ' || COALESCE(v_name, p_event_id::text)
            END,
            jsonb_build_object('previous_live_event_id', v_prev)
        );
    END IF;

    RETURN jsonb_build_object('ok', true, 'live_event_id', p_event_id);
END;
$fn$;

REVOKE ALL ON FUNCTION set_live_event(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_live_event(UUID) TO authenticated, service_role;

-- Publish system_settings so pin/unpin propagates without a reload. The client
-- also falls back to focus/online/periodic refresh if Realtime is unavailable.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
       AND NOT EXISTS (
           SELECT 1 FROM pg_publication_tables
           WHERE pubname = 'supabase_realtime'
             AND schemaname = 'public'
             AND tablename = 'system_settings'
       )
    THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE system_settings;
    END IF;
END $$;

NOTIFY pgrst, 'reload schema';
