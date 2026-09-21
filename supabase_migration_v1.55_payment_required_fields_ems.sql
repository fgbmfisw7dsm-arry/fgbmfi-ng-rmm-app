-- ============================================================================
-- EMS Registration Enhancements (v1.55)
--   1) Payment Amount + Payment Reference on delegates (additive, nullable).
--   2) registration_source CHECK widened to include 'EMS' (New Delegate form).
--   3) RLS delegates_insert_scoped treats 'EMS' exactly like 'manual'.
--
-- WHY: The New Delegate Entry form (EMS registration) now captures optional
-- registration payment details (amount + reference) and is tagged with
-- registration_source='EMS' so EMS-originated records are distinguishable from
-- bulk imports / portal / QR. Payment details exist ONLY on EMS rows.
--
-- NON-DISRUPTION: the two columns are additive NULL-able (existing rows
-- unaffected); the CHECK only ADDS a value; RLS behavior for 'manual',
-- 'import', 'qr_scan' and 'portal' is byte-identical to v1.50 — only the
-- registrar free-guest guard now also recognises 'EMS' as a manual-tier source.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- 1) Payment columns ---------------------------------------------------------
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS payment_amount NUMERIC(15,2);
ALTER TABLE delegates ADD COLUMN IF NOT EXISTS payment_reference TEXT;

-- 2) registration_source CHECK (add 'EMS') -----------------------------------
-- Drop ANY existing CHECK that constrains the registration_source column
-- (regardless of its auto-generated name — Postgres may name it
-- delegates_registration_source_check, delegates_registration_source_check1,
-- etc.), then re-create with the canonical name. Idempotent.
DO $$
DECLARE
  cons TEXT;
BEGIN
  FOR cons IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'delegates'::regclass
      AND con.contype = 'c'
      AND EXISTS (
        SELECT 1
        FROM unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = cols.attnum
        WHERE a.attname = 'registration_source'
      )
  LOOP
    EXECUTE format('ALTER TABLE delegates DROP CONSTRAINT %I', cons);
  END LOOP;
END $$;
ALTER TABLE delegates ADD CONSTRAINT delegates_registration_source_check
  CHECK (registration_source IN ('import', 'manual', 'qr_scan', 'portal', 'EMS'));

-- 3) RLS: delegates_insert_scoped (v1.50 policy + 'EMS' manual-tier) ---------
-- Reproduced verbatim from v1.50 except the two manual-source guards use
-- IN ('manual','EMS'). Free Guest / district scoping semantics unchanged.
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR (
    NOT (
      is_registrar_user()
      AND EXISTS (
        SELECT 1 FROM events e
        WHERE e.event_id = delegates.event_id
          AND COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true'
      )
      AND COALESCE(delegates.registration_source, 'manual') IN ('manual', 'EMS')
    )
    AND (district ~~* COALESCE(current_user_district(), ''::text)) AND (current_user_district() IS NOT NULL)
  )
  OR (
    is_registrar_user()
    AND EXISTS (
      SELECT 1 FROM events e
      WHERE e.event_id = delegates.event_id
        AND COALESCE(e.event_config->>'restrict_registrar_to_free_guest', 'false') = 'true'
    )
    AND COALESCE(delegates.registration_source, 'manual') IN ('manual', 'EMS')
    AND UPPER(COALESCE(delegates.delegate_type, '')) = 'FREE GUEST'
    AND delegates.district ILIKE COALESCE(get_delegate_type_district('Free Guest'), '')
  ));
