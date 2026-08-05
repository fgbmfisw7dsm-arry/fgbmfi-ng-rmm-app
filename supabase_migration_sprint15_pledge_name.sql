-- ============================================================
-- MIGRATION: Sprint 15 — Pledge Name (per-event pledge categories)
-- ============================================================
-- Adds an optional `pledge_name` column to `pledges` so each pledge
-- can be tagged with a configured per-event category (e.g. "Building
-- Fund", "Convention Offering").
--
-- The list of pledge names per event is stored in the existing
-- `events.event_config` JSONB under the `pledge_names` key (string[]),
-- edited in EventsModule and consumed by the FinancialsPage dropdown.
-- No changes are required to the `events` table (JSONB already exists).
-- ============================================================

ALTER TABLE public.pledges
    ADD COLUMN IF NOT EXISTS pledge_name TEXT;

-- Keep schema.sql (fresh-project source) in sync.
-- This column is nullable and backward compatible: existing pledges
-- render with a blank/general pledge name.
