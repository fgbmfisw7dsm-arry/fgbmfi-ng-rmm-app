-- ============================================================================
-- v1.89c — STORAGE POLICY HARDENING: badge-pdfs bucket (S3)
-- ----------------------------------------------------------------------------
-- PROBLEM
--   supabase_migration_sprint16_badge_storage_fix.sql created four policies on
--   storage.objects, all `TO authenticated` with only `bucket_id = 'badge-pdfs'`
--   as the predicate — no role check at all:
--
--       auth_select_badge_pdfs  SELECT  USING (bucket_id = 'badge-pdfs')
--       auth_insert_badge_pdfs  INSERT  WITH CHECK (bucket_id = 'badge-pdfs')
--       auth_update_badge_pdfs  UPDATE  USING/WITH CHECK (bucket_id = ...)
--       auth_delete_badge_pdfs  DELETE  USING (bucket_id = 'badge-pdfs')
--
--   Any authenticated account — including a door registrar or a finance user —
--   could therefore delete every generated badge PDF (or upload arbitrary
--   objects into the bucket). A destructive operation on production data
--   sitting behind nothing but "is signed in".
--
-- FIX
--   Keep SELECT as-is (badge PDFs are operational documents that authorized
--   staff may download; tightening it adds risk with no proportionate gain).
--   Gate INSERT / UPDATE / DELETE on the existing SECURITY DEFINER helpers
--   is_admin_user() / is_event_admin_user().
--
-- BEHAVIOUR IMPACT FOR LEGITIMATE USERS: none.
--   uploadBadgePDF  -> BadgePrintingModule   (route ADMIN_AND_EVENT_ADMIN)
--   getBadgePDFBlob -> BadgePrintingModule   (route ADMIN_AND_EVENT_ADMIN)
--   listBadgePDFs   -> StorageModule         (route admin only)
--   deleteStorageFile -> StorageModule       (route admin only)
--   Every caller already holds admin or event_admin.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

-- Keep the bucket private (idempotent no-op if it already is).
INSERT INTO storage.buckets (id, name, public)
VALUES ('badge-pdfs', 'badge-pdfs', false)
ON CONFLICT (id) DO NOTHING;

-- Rebuild the write policies with a role predicate.
DROP POLICY IF EXISTS "auth_insert_badge_pdfs" ON storage.objects;
DROP POLICY IF EXISTS "auth_update_badge_pdfs" ON storage.objects;
DROP POLICY IF EXISTS "auth_delete_badge_pdfs" ON storage.objects;

CREATE POLICY "auth_insert_badge_pdfs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'badge-pdfs' AND (is_admin_user() OR is_event_admin_user()));

CREATE POLICY "auth_update_badge_pdfs"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'badge-pdfs' AND (is_admin_user() OR is_event_admin_user()))
WITH CHECK (bucket_id = 'badge-pdfs' AND (is_admin_user() OR is_event_admin_user()));

CREATE POLICY "auth_delete_badge_pdfs"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'badge-pdfs' AND (is_admin_user() OR is_event_admin_user()));

-- SELECT deliberately unchanged: re-asserted here only for completeness.
DROP POLICY IF EXISTS "auth_select_badge_pdfs" ON storage.objects;
CREATE POLICY "auth_select_badge_pdfs"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'badge-pdfs');

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- SELECT policyname, cmd, roles::text, qual, with_check
-- FROM pg_policies
-- WHERE schemaname = 'storage' AND tablename = 'objects'
--   AND policyname LIKE '%badge_pdfs%'
-- ORDER BY policyname;
-- -- expect: INSERT/UPDATE/DELETE rows contain is_admin_user()
-- ============================================================================
