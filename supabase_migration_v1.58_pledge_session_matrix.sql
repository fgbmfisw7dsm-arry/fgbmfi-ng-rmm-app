-- ============================================================
-- MIGRATION: v1.58 — Pledge Event Session + Financial Matrix
-- ============================================================
-- Adds `pledges.session_id` so a pledge records the Event Session where
-- it was made, and redeems it through the Financial Matrix by session.
--
-- Parent choices (keep consistent with schema.sql):
--   financial_entries.session_id  → ON DELETE CASCADE (entry dies with session)
--   pledges.session_id            → ON DELETE SET NULL (pledge commitment survives;
--                                   its redemptions fall into the Master bucket)
--
-- No RPC changes: get_report_aggregates selects `*` from pledges, so the new
-- column flows through to the Reports page automatically.
-- ============================================================

-- 1. Column (idempotent)
ALTER TABLE public.pledges
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES sessions(session_id) ON DELETE SET NULL;

-- 2. Index for per-session pledge queries (mirrors idx_financials_event pattern)
CREATE INDEX IF NOT EXISTS idx_pledges_event_session
  ON public.pledges(event_id, session_id);

-- 3. Read-only verification (optional)
-- SELECT 'pledges.columns' AS check, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'pledges'
-- ORDER BY ordinal_position;