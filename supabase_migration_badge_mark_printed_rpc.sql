-- FGBMFI Nigeria EMS — Badge Batch Mark Printed RPC
-- Purpose: Mark a badge batch as printed atomically and scale-safely.
--
-- WHY: the client previously flagged 1000 delegates with a single
--   UPDATE ... .in('delegate_id', <1000 UUIDs>) — PostgREST serializes every
--   filter into the request URL (~38 KB web), and Supabase's gateway rejects
--   requests past ~32 KB with HTTP 400 "Bad Request". Batches of 250/500
--   (~9/19 KB) pass; 1000-badge batches fail. Moving the IN-list into a
--   server-side subquery eliminates the URL bloat entirely.
--
-- Behaviour:
--   1. Resolves the batch's event_id (strict event isolation — the affected
--      delegate set is derived from that batch's own records).
--   2. Sets badges.badge_printed=true / badge_printed_at=now() on every
--      delegate recorded in badge_print_logs for the batch.
--   3. Flips badge_batches.status to 'printed'.
--   4. Returns the number of delegates flagged.
--
-- Security: SECURITY DEFINER (mirrors import_delegates_batch_merge) with an
--   explicit admin/event_admin gate. The lifecycle guard (ensureEventActive)
--   remains a client-side pre-check in db.markBadgeBatchPrinted, consistent
--   with the rest of the service layer.
--
-- This migration is IDEMPOTENT (CREATE OR REPLACE FUNCTION).
-- Deploy: Run in Supabase SQL Editor (postgres role).

CREATE OR REPLACE FUNCTION public.mark_badge_batch_printed(p_batch_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_id UUID;
  v_marked INTEGER;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator or event administrator privileges required';
  END IF;

  SELECT b.event_id INTO v_event_id
  FROM badge_batches b
  WHERE b.batch_id = p_batch_id;

  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Badge batch not found.';
  END IF;

  UPDATE delegates d
  SET badge_printed = true,
      badge_printed_at = now()
  WHERE d.event_id = v_event_id
    AND d.delegate_id IN (
      SELECT l.delegate_id
      FROM badge_print_logs l
      WHERE l.batch_id = p_batch_id
    );

  GET DIAGNOSTICS v_marked = ROW_COUNT;

  UPDATE badge_batches b
  SET status = 'printed'
  WHERE b.batch_id = p_batch_id;

  RETURN v_marked;
END;
$$;