-- ============================================================================
-- v1.89e — DELEGATE PROTECTED-COLUMN GUARD (S5)
-- ----------------------------------------------------------------------------
-- PROBLEM
--   delegates_update_scoped (supabase_schema.sql:2183) scopes UPDATE by DISTRICT
--   only — never by COLUMN. Any district-scoped account can therefore rewrite
--   the identity/routing/payment columns of any delegate in their district:
--
--     qr_hash            -> point a badge at another delegate (check someone in
--                           as a different person, or hijack a badge QR)
--     external_id        -> swap the printed Reg ID
--     payment_amount /   -> zero out or inflate recorded registration fees
--     payment_reference
--     delegate_type      -> reclassify a paid delegate as a free guest
--     reg_type /         -> rewrite the portal / manual / EMS provenance
--     registration_source
--     district           -> re-file another district's delegate into their own
--     event_id           -> move a delegate across events
--
-- FIX
--   A BEFORE UPDATE trigger rejects changes to those columns unless the caller
--   is admin or event_admin. Contact/demographic fields (title, first_name,
--   last_name, chapter, office, rank, phone, email, room_number) stay editable
--   as before, so ordinary corrections are unaffected.
--
-- SAFETY / NON-DISRUPTION
--   * auth.uid() IS NULL  -> trusted server context (service_role, SQL editor,
--     scheduled jobs). Maintenance and data migrations are NOT blocked.
--   * is_admin_user() / is_event_admin_user() -> allowed (covers every existing
--     legitimate flow: Master List inline edit, Import & gap-fill merge,
--     reconcile, repair-names, harmonize-districts, renameDistrict cascade).
--   * Derived identity keys (title_key / name_first_key / name_last_key /
--     phone_normalized) are deliberately NOT guarded — they are maintained by
--     trg_delegates_identity_norm and recompute on any rename.
--   * INSERT and DELETE are untouched (registrar inserts, QR quick-register,
--     bulk import, admin deletes all behave exactly as today).
--
-- Idempotent. Safe to re-run.
-- ROLLBACK: DROP TRIGGER IF EXISTS trg_delegates_guard_critical ON delegates;
-- ============================================================================

CREATE OR REPLACE FUNCTION public.delegates_guard_critical_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- No JWT => service_role / SQL editor / server-side maintenance. Trusted.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF is_admin_user() OR is_event_admin_user() THEN
    RETURN NEW;
  END IF;

  IF NEW.qr_hash             IS DISTINCT FROM OLD.qr_hash
  OR NEW.external_id         IS DISTINCT FROM OLD.external_id
  OR NEW.payment_amount      IS DISTINCT FROM OLD.payment_amount
  OR NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference
  OR NEW.delegate_type       IS DISTINCT FROM OLD.delegate_type
  OR NEW.reg_type            IS DISTINCT FROM OLD.reg_type
  OR NEW.registration_source IS DISTINCT FROM OLD.registration_source
  OR NEW.event_id            IS DISTINCT FROM OLD.event_id
  OR NEW.district            IS DISTINCT FROM OLD.district
  THEN
    RAISE EXCEPTION
      'PROTECTED_FIELDS: identity, routing, payment or delegate-type fields can only be changed by an administrator.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delegates_guard_critical ON public.delegates;
CREATE TRIGGER trg_delegates_guard_critical
BEFORE UPDATE ON public.delegates
FOR EACH ROW
EXECUTE FUNCTION public.delegates_guard_critical_columns();

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- 1. Trigger present:
--    SELECT tgname, pg_get_triggerdef(oid)
--    FROM pg_trigger WHERE tgrelid = 'public.delegates'::regclass AND NOT tgisinternal;
--
-- 2. Negative test (run as a district registrar through the app, NOT the SQL
--    editor — the editor has no auth.uid() and is intentionally exempt):
--    attempt to change qr_hash on a delegate in that district -> expect
--      "PROTECTED_FIELDS: ...".
--
-- 3. Positive test (admin): Master List inline edit of a phone number and a
--    chapter must still save normally.
--
-- 4. Regression sweep after deploy: District Harmonize, Rename District,
--    Import (merge/gap-fill), Reconcile Portal CSV, Repair Imported Names —
--    all must complete without the PROTECTED_FIELDS error.
-- ============================================================================
