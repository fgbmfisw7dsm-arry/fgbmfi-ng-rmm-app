-- ============================================================
-- Migration: Add uniqueness constraints for concurrent scanners
-- Prevents duplicate checkins and session_responses at scale
-- ============================================================

-- 1. Prevent duplicate checkins per (event, delegate, session)
--    Uses partial unique index for null session_id (arrival checkins)
--    since PostgreSQL treats NULL != NULL in unique constraints
CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_event_delegate_session_unique
  ON checkins(event_id, delegate_id, session_id)
  WHERE session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_checkins_event_delegate_arrival_unique
  ON checkins(event_id, delegate_id)
  WHERE session_id IS NULL;

-- 2. Prevent duplicate session responses per (event, delegate, session, type)
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_responses_delegate_session_unique
  ON session_responses(event_id, delegate_id, session_id, response_type);

-- 3. Index for getSessionResponseIds query performance
CREATE INDEX IF NOT EXISTS idx_session_responses_event_session_type
  ON session_responses(event_id, session_id, response_type);
