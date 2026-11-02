-- ============================================================================
-- v1.89f — chapters_select: restrict to authenticated (S6)
-- ----------------------------------------------------------------------------
-- PROBLEM
--   chapters_select was `FOR SELECT TO public USING (true)`, so the chapter
--   reference list (district -> chapter names) was readable by ANON — i.e. by
--   anyone holding the public anon key, with no login at all. Low sensitivity,
--   but it is the only table in the schema exposed to `public` and it leaks the
--   organisation's district/chapter inventory to unauthenticated callers.
--
-- FIX
--   Narrow the role from `public` to `authenticated`. Every screen that reads
--   chapters (Setup, New Delegate, Import) is behind ProtectedRoute, so signed-in
--   behaviour is unchanged.
--
-- Idempotent. Safe to re-run.
-- ============================================================================

DROP POLICY IF EXISTS "chapters_select" ON public.chapters;
CREATE POLICY "chapters_select"
ON public.chapters FOR SELECT
TO authenticated
USING (true);

-- ============================================================================
-- VERIFICATION (read-only)
-- ============================================================================
-- SELECT policyname, cmd, roles::text AS roles
-- FROM pg_policies WHERE schemaname = 'public' AND tablename = 'chapters'
-- ORDER BY policyname;
-- -- expect: chapters_select roles = {authenticated}   (NOT {public})
--
-- No table should be readable by `public`:
-- SELECT tablename, policyname, roles::text
-- FROM pg_policies
-- WHERE schemaname = 'public' AND 'public' = ANY (roles)
-- ORDER BY tablename;
-- -- expect: zero rows
-- ============================================================================
