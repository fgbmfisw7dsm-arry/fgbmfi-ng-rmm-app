-- ============================================================================
-- v1.59 — record_financial_entry RPC (single-round-trip financial write)
-- ----------------------------------------------------------------------------
-- PURPOSE: Collapse the "Record Offering" / "Pledge Redemption" write path
-- (previously guard SELECT + INSERT + audit = 2-3 sequential HTTPS round trips,
-- each of which could silently stall and dead-click the page) into ONE server
-- call that bundles the event-active guard + idempotent INSERT.
--
-- IDEMPOTENCY: the caller supplies p_entry_id (client crypto.randomUUID()).
-- ON CONFLICT (entry_id) DO NOTHING means a response-lost retry of a save that
-- ALREADY committed returns the existing row instead of creating a duplicate.
--
-- SECURITY: SECURITY INVOKER — the caller's RLS governs every table access,
-- identical privilege surface to today's direct client queries (financials
-- write stays admin / event_admin / finance only).
--
-- Deploy order: run this FIRST in the Supabase SQL editor, then deploy the
-- frontend. The client falls back to the classic insert automatically when the
-- function is missing, so frontend-first deployment is non-breaking too.
-- Idempotent — safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_financial_entry(
    p_event_id UUID,
    p_entry_type TEXT,
    p_amount DECIMAL,
    p_payment_mode TEXT DEFAULT NULL,
    p_session_id UUID DEFAULT NULL,
    p_remarks TEXT DEFAULT NULL,
    p_pledge_id UUID DEFAULT NULL,
    p_payer_name TEXT DEFAULT NULL,
    p_entry_id UUID DEFAULT NULL
)
RETURNS SETOF public.financial_entries
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
    v_entry_id UUID := COALESCE(p_entry_id, gen_random_uuid());
    v_is_active BOOLEAN;
    v_row_count INT;
    v_row public.financial_entries%ROWTYPE;
BEGIN
    IF p_event_id IS NULL THEN
        RAISE EXCEPTION 'Missing event_id';
    END IF;
    IF p_entry_type IS NULL OR p_amount IS NULL THEN
        RAISE EXCEPTION 'Missing entry type or amount';
    END IF;

    SELECT is_active INTO v_is_active FROM public.events WHERE event_id = p_event_id;

    IF v_is_active IS NULL THEN
        RAISE EXCEPTION 'EVENT_NOT_FOUND';
    END IF;
    IF v_is_active = false THEN
        RAISE EXCEPTION 'EVENT_LOCKED: This event is currently inactive (Read-Only).';
    END IF;

    INSERT INTO public.financial_entries (entry_id, event_id, session_id, pledge_id, amount, type, payer_name, payment_mode, remarks)
    VALUES (v_entry_id, p_event_id, p_session_id, p_pledge_id, p_amount, p_entry_type, p_payer_name, p_payment_mode, p_remarks)
    ON CONFLICT (entry_id) DO NOTHING;

    GET DIAGNOSTICS v_row_count = ROW_COUNT;

    SELECT * INTO v_row FROM public.financial_entries WHERE entry_id = v_entry_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'financial_entries conflict but row missing for entry_id=%', v_entry_id;
    END IF;
    RETURN NEXT v_row;
END;
$$;

-- Restrict EXECUTE: authenticated + service_role only (no anon/public).
REVOKE ALL ON FUNCTION public.record_financial_entry(UUID, TEXT, DECIMAL, TEXT, UUID, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_financial_entry(UUID, TEXT, DECIMAL, TEXT, UUID, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;