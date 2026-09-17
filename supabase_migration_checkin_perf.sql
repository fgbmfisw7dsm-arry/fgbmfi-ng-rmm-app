-- =============================================================================
-- FGBMFI-EMS — Check-In Performance Hardening (v1.53)
-- -----------------------------------------------------------------------------
-- Additive, idempotent. Supports the QR Pass-4 fuzzy identity fallback
-- (matchDelegateByIdentity → `.ilike('email', …)` in supabaseService.ts) so an
-- email-only match is an index probe instead of a full event scan at 25K rows.
-- No behavior change to any live module; safe to run at any time.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Supports ILIKE email lookups (used by the Pass-4 fuzzy matcher).
CREATE INDEX IF NOT EXISTS idx_delegates_email_trgm ON delegates USING gin (email gin_trgm_ops);

-- Supports exact lower(email) equality lookups for any future eq-on-lower path.
CREATE INDEX IF NOT EXISTS idx_delegates_email_lower ON delegates (lower(email)) WHERE email IS NOT NULL;