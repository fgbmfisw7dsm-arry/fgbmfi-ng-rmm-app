-- ============================================================
-- FGBMFI Nigeria EMS — get_my_profile RPC
-- Run this in Supabase SQL Editor.
-- SECURITY DEFINER bypasses RLS so authenticated users can
-- always read their own app_users profile after login.
-- ============================================================

CREATE OR REPLACE FUNCTION get_my_profile()
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT row_to_json(t) FROM app_users t WHERE id = auth.uid();
$$;
