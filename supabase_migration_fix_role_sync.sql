-- ============================================================================
-- FGBMFI EMS — FIX: role edits must sync app_users AND auth.users metadata
-- Root cause: db.updateUser updated app_users.role but NOT auth.users metadata,
-- so login/profile flows reading GoTrue role (get_auth_user_role, session
-- user_metadata, check_login_account) saw a stale role.
--
-- Adds update_app_user_role(user_id, new_role): atomically sets the role in
-- BOTH app_users and auth.users (raw_user_meta_data + raw_app_meta_data), so
-- every role source agrees. Also backfills any already-diverged users.
--
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. RPC: update role in app_users + auth.users metadata
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_app_user_role(user_id uuid, new_role text)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    v_sanitized TEXT;
    v_email TEXT;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
    END IF;

    v_sanitized := CASE
        WHEN new_role IN ('national_admin','regional_admin','district_admin','executive_admin','admin',
                          'national_registrar','regional_registrar','district_registrar','registrar',
                          'finance','event_admin')
        THEN new_role
        ELSE 'registrar'
    END;

    SELECT email INTO v_email FROM public.app_users WHERE id = user_id;
    IF NOT FOUND THEN
        RETURN json_build_object('status', 'error', 'error', 'User not found');
    END IF;

    -- Primary source of truth: app_users
    UPDATE public.app_users SET role = v_sanitized WHERE id = user_id;

    -- Mirror into GoTrue metadata so every consumer agrees
    UPDATE auth.users
    SET raw_user_meta_data = COALESCE(COALESCE(raw_user_meta_data, '{}'::jsonb), '{}'::jsonb) || jsonb_build_object('role', v_sanitized),
        raw_app_meta_data = COALESCE(COALESCE(raw_app_meta_data, '{}'::jsonb), '{}'::jsonb) || jsonb_build_object('role', v_sanitized),
        updated_at = NOW()
    WHERE id = user_id;

    RETURN json_build_object('status', 'success', 'id', user_id, 'role', v_sanitized, 'email', v_email);
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('status', 'error', 'error', SQLERRM, 'detail', SQLSTATE);
END;
$function$;

-- Function grants: authenticated (admin callers) + service_role; revoke anon/PUBLIC
REVOKE ALL ON FUNCTION public.update_app_user_role(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_app_user_role(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_app_user_role(uuid, text) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.update_app_user_role(uuid, text) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.update_app_user_role(uuid, text) TO service_role;

-- ----------------------------------------------------------------------------
-- 2. Backfill: sync any app_users.role that differs from auth.users metadata
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r record;
    v_sanitized TEXT;
BEGIN
    FOR r IN
        SELECT au.id, au.role, u.email,
               (u.raw_user_meta_data->>'role') AS meta_user_role,
               (u.raw_app_meta_data->>'role') AS meta_app_role
        FROM public.app_users au
        LEFT JOIN auth.users u ON u.id = au.id
        WHERE u.id IS NOT NULL
    LOOP
        v_sanitized := CASE
            WHEN r.role IN ('national_admin','regional_admin','district_admin','executive_admin','admin',
                            'national_registrar','regional_registrar','district_registrar','registrar',
                            'finance','event_admin')
            THEN r.role
            ELSE 'registrar'
        END;

        IF COALESCE(r.meta_user_role, '') <> v_sanitized OR COALESCE(r.meta_app_role, '') <> v_sanitized THEN
            UPDATE auth.users
            SET raw_user_meta_data = COALESCE(COALESCE(raw_user_meta_data, '{}'::jsonb), '{}'::jsonb) || jsonb_build_object('role', v_sanitized),
                raw_app_meta_data = COALESCE(COALESCE(raw_app_meta_data, '{}'::jsonb), '{}'::jsonb) || jsonb_build_object('role', v_sanitized),
                updated_at = NOW()
            WHERE id = r.id;
            RAISE NOTICE 'Synced auth.users role for %: % -> %', r.email, COALESCE(r.meta_user_role, r.meta_app_role, 'NULL'), v_sanitized;
        END IF;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3. VERIFICATION
-- ----------------------------------------------------------------------------
SELECT au.email, au.role AS app_users_role,
       (u.raw_user_meta_data->>'role') AS meta_user_role,
       (u.raw_app_meta_data->>'role') AS meta_app_role,
       CASE WHEN au.role = (u.raw_user_meta_data->>'role')
            AND au.role = (u.raw_app_meta_data->>'role') THEN 'SYNCED' ELSE 'MISMATCH' END AS state
FROM public.app_users au
LEFT JOIN auth.users u ON u.id = au.id
WHERE u.id IS NOT NULL
ORDER BY au.email;