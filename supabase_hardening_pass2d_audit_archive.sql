-- ============================================================================
-- FGBMFI EMS — SECURITY HARDENING PASS 2D (audit log retention / archive)
-- Automatically archives audit_log rows older than 180 days into an immutable
-- audit_log_archive table, weekly via pg_cron. Permanent trail, lean live table.
--
-- PREREQUISITE (dashboard step — I cannot enable extensions from here):
--   Supabase Dashboard → Database → Extensions → enable "pg_cron".
--   After enabling, run this file. It is idempotent (safe to re-run).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Archive table (immutable copy of audit_log, no sequence, no RLS write path)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log_archive (
    id              BIGINT PRIMARY KEY,
    event_id        UUID,
    action_type     TEXT NOT NULL,
    performed_by    UUID NOT NULL,
    performer_email TEXT,
    target_type     TEXT,
    target_id       TEXT,
    summary         TEXT NOT NULL,
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_archive_created ON audit_log_archive(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_archive_event ON audit_log_archive(event_id, created_at DESC);

-- Admin read-only, no authenticated insert/delete → append-only from the app.
ALTER TABLE audit_log_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "archive_select_admin" ON audit_log_archive;
CREATE POLICY "archive_select_admin" ON audit_log_archive
    FOR SELECT TO authenticated
    USING (is_admin_user());

-- ----------------------------------------------------------------------------
-- 2. Retained-live window: keep the most recent 180 days in audit_log,
--    archive the rest. Adjust the interval here if you want a different window.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 3. pg_cron weekly job (idempotent schedule management).
--    Runs every Saturday 03:00 UTC. The job command MUST be a single statement
--    (cron.schedule rejects multi-statement strings), so archive + delete are
--    performed inside one DO block. Each execution is atomic in one transaction.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    v_job_id BIGINT;
BEGIN
    SELECT jobid INTO v_job_id
    FROM cron.job
    WHERE jobname = 'audit-archive-weekly'
    LIMIT 1;

    IF v_job_id IS NOT NULL THEN
        PERFORM cron.unschedule(v_job_id);
    END IF;

    PERFORM cron.schedule(
        'audit-archive-weekly',           -- unique job name
        '0 3 * * 6',                      -- cron expr: Saturday 03:00 UTC
        'DO $cron$
         BEGIN
           INSERT INTO audit_log_archive
           SELECT * FROM audit_log
           WHERE created_at < NOW() - interval ''180 days'';
           DELETE FROM audit_log
           WHERE created_at < NOW() - interval ''180 days'';
         END
         $cron$'
    );
END $$;

-- ----------------------------------------------------------------------------
-- 4. Verification queries
-- ----------------------------------------------------------------------------

-- 4a. Confirm the cron job exists
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'audit-archive-weekly';

-- 4b. Archive table exists with the expected shape
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'audit_log_archive'
ORDER BY ordinal_position;

-- 4c. Any rows archived so far?
SELECT COUNT(*) AS archived_rows FROM public.audit_log_archive;

-- 4d. Live audit_log oldest row age (to confirm the window is active)
SELECT NOW() - MAX(created_at) AS oldest_record_age, COUNT(*) AS live_rows
FROM public.audit_log;