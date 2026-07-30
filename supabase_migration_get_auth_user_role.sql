-- Sprint 8.5: Add get_auth_user_role RPC (role recovery fallback)
-- Run this in Supabase SQL Editor if not already applied

CREATE OR REPLACE FUNCTION get_auth_user_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT raw_app_meta_data->>'role' FROM auth.users WHERE id = auth.uid();
$$;
