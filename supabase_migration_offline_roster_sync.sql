-- =============================================================================
-- FGBMFI-EMS — Offline Roster Delta Sync Support
-- -----------------------------------------------------------------------------
-- Adds `delegates.updated_at` (maintained by trigger), an (event_id, updated_at)
-- index, and a backfill so the offline roster can fetch only rows changed since
-- the last sync instead of re-downloading the whole event on every login/reload.
--
-- Deletions are NOT captured (no tombstones); the client performs a periodic
-- full reconcile (default 24h / explicit Refresh) to evict removed delegates.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE delegates
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

UPDATE delegates
   SET updated_at = COALESCE(updated_at, created_at, NOW())
 WHERE updated_at IS NULL;

CREATE OR REPLACE FUNCTION touch_delegates_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $fn$
BEGIN
    NEW.updated_at := NOW();
    RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_delegates_updated_at ON delegates;
CREATE TRIGGER trg_delegates_updated_at
    BEFORE UPDATE ON delegates
    FOR EACH ROW
    EXECUTE FUNCTION touch_delegates_updated_at();

CREATE INDEX IF NOT EXISTS idx_delegates_event_updated
    ON delegates(event_id, updated_at);

NOTIFY pgrst, 'reload schema';
