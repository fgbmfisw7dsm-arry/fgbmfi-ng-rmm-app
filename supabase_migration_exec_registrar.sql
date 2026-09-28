-- ============================================================================
-- FGBMFI EMS — EXEC REGISTRAR ROLE
-- Exec Registrar = same access as NATIONAL REGISTRAR (registrar tier, national
-- scope = unscoped), PLUS:
--   * registers ALL delegate types from the New Delegate Entry form (bypasses
--     the per-event Free-Guest restriction that constrains registrar-tier roles);
--   * prints INDIVIDUAL badges (A6 desk printing) and marks delegates printed.
-- NOT an admin role — no Events/Users/Setup/Data/Storage/Audit/MasterList/Import
-- and NO batch Badge Printing (that stays admin + event_admin).
--
--   * is_admin_user() MUST NOT include exec_registrar.
--   * delegates_insert_scoped branch 1 grants unrestricted inserts (any type,
--     any district) — the "register all delegate types" requirement.
--   * Registrar WRITE policies (check-ins, session ministry, badge print logs)
--     are extended with exec_registrar — identical write surface to national
--     registrar.
--   * Delegates UPDATE is NOT granted broadly; the mark_delegate_badge_printed
--     RPC (SECURITY DEFINER) is the only badge-flag write Exec Registrar gets.
--
-- Idempotent (DROP POLICY IF EXISTS / CREATE OR REPLACE). Run in Supabase SQL
-- Editor BEFORE the frontend (frontend inserts roles/policies that depend on these).
-- ============================================================================

-- 1. Role CHECK constraint: allow exec_registrar
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (
  role IN (
    'national_admin','regional_admin','district_admin','executive_admin','admin',
    'national_registrar','regional_registrar','district_registrar','registrar',
    'exec_registrar','finance','event_admin'
  )
);

-- 2. Helper: is the current user an Exec Registrar (active-guarded)
CREATE OR REPLACE FUNCTION is_exec_registrar_user()
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM app_users
    WHERE id = auth.uid()
      AND role = 'exec_registrar'
      AND (is_active IS NULL OR is_active = true)
  );
$function$;

-- 3. update_app_user_role: accept exec_registrar in the sanitized role list
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
                          'exec_registrar','finance','event_admin')
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

-- 4. create_app_user (legacy recovery): accept exec_registrar in the sanitized list
CREATE OR REPLACE FUNCTION create_app_user(email TEXT, password TEXT, role TEXT, district TEXT DEFAULT NULL, region TEXT DEFAULT NULL)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $function$
DECLARE
    new_user_id      UUID;
    v_instance_id    UUID;
    ins_cols         TEXT;
    ins_vals         TEXT;
    v_token_set      TEXT := '';
    confirm_ok       BOOLEAN := false;
    identities_ok    BOOLEAN := false;
    aud_set          BOOLEAN := false;
    instance_id_set  BOOLEAN := false;
    v_sanitized_role TEXT;
BEGIN
    IF NOT is_admin_user() THEN
        RAISE EXCEPTION 'FORBIDDEN: administrator privileges required';
    END IF;

    new_user_id := gen_random_uuid();

    v_sanitized_role := CASE
        WHEN role IN ('national_admin','regional_admin','district_admin','executive_admin','admin',
                      'national_registrar','regional_registrar','district_registrar','registrar',
                      'exec_registrar','finance','event_admin')
        THEN role
        ELSE 'registrar'
    END;

    SELECT instance_id INTO v_instance_id
    FROM auth.users WHERE instance_id IS NOT NULL
    ORDER BY created_at DESC NULLS LAST LIMIT 1;
    instance_id_set := (v_instance_id IS NOT NULL);

    ins_cols := 'id, email, encrypted_password, created_at, updated_at, '
             || 'raw_app_meta_data, aud, role, instance_id';
    ins_vals := '$1, $2, crypt($3, ''$2a$10$'' || substring(translate(encode(decode(md5(random()::text), ''hex''), ''base64''), ''+/'', ''./''), 1, 22)), NOW(), NOW(), '
             || '$4, ''authenticated'', ''authenticated'', $5';

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'is_sso_user' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', is_sso_user, is_anonymous';
        ins_vals := ins_vals || ', false, false';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'auth' AND table_name = 'users'
                 AND column_name = 'raw_user_meta_data' AND is_generated = 'NEVER') THEN
        ins_cols := ins_cols || ', raw_user_meta_data';
        ins_vals := ins_vals || ', ''{}''::jsonb';
    END IF;

    IF v_instance_id IS NULL THEN
        ins_cols := REPLACE(ins_cols, ', instance_id', '');
        ins_vals := REPLACE(ins_vals, ', $5', '');
    END IF;

    BEGIN
        EXECUTE 'INSERT INTO auth.users (' || ins_cols || ') VALUES (' || ins_vals || ')'
            USING new_user_id, email, password,
                  jsonb_build_object('role', v_sanitized_role, 'provider', 'email'),
                  v_instance_id;

        aud_set := true;

        INSERT INTO auth.identities (
            id, user_id, identity_data, provider, provider_id,
            last_sign_in_at, created_at, updated_at
        ) VALUES (
            gen_random_uuid(), new_user_id,
            jsonb_build_object('sub', new_user_id, 'email', email),
            'email', email, NOW(), NOW(), NOW()
        );

        identities_ok := true;

        IF EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema = 'auth' AND table_name = 'users'
                     AND column_name = 'email_confirmed_at' AND is_generated = 'NEVER') THEN
            EXECUTE 'UPDATE auth.users SET email_confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                USING new_user_id;
            confirm_ok := true;
        END IF;

        IF NOT confirm_ok THEN
            IF EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_schema = 'auth' AND table_name = 'users'
                         AND column_name = 'confirmed_at' AND is_generated = 'NEVER') THEN
                EXECUTE 'UPDATE auth.users SET confirmed_at = NOW(), updated_at = NOW() WHERE id = $1'
                    USING new_user_id;
                confirm_ok := true;
            END IF;
        END IF;

        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'confirmation_token') THEN
            v_token_set := v_token_set || 'confirmation_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'recovery_token') THEN
            v_token_set := v_token_set || 'recovery_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change_token') THEN
            v_token_set := v_token_set || 'email_change_token = '''', ';
        END IF;
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'auth' AND table_name = 'users' AND column_name = 'email_change') THEN
            v_token_set := v_token_set || 'email_change = '''', ';
        END IF;
        v_token_set := v_token_set || 'updated_at = NOW()';
        EXECUTE 'UPDATE auth.users SET ' || v_token_set || ' WHERE id = $1' USING new_user_id;

        INSERT INTO public.app_users (id, email, role, district, region, is_active)
        VALUES (new_user_id, email, v_sanitized_role, district, region, true);
    EXCEPTION WHEN OTHERS THEN
        RETURN json_build_object(
            'status', 'error',
            'error', SQLERRM,
            'detail', SQLSTATE
        );
    END;

    RETURN json_build_object(
        'status', 'success',
        'id', new_user_id,
        'aud_set', aud_set,
        'instance_id_set', instance_id_set,
        'confirmed', confirm_ok,
        'identities_inserted', identities_ok,
        'role_sanitized', v_sanitized_role
    );

EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object(
        'status', 'error',
        'error', SQLERRM,
        'detail', SQLSTATE
    );
END;
$function$;

-- 5. delegates_insert_scoped: Exec Registrar may insert ANY delegate type/district
--    (branch 1). Live definition (v1.55) preserved; the free-guest restriction
--    branch is untouched — exec_registrar simply passes branch 1 first.
DROP POLICY IF EXISTS "delegates_insert_scoped" ON delegates;
CREATE POLICY "delegates_insert_scoped" ON delegates FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user() OR is_exec_registrar_user()
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

-- 6. Registrar-tier WRITE policies: add exec_registrar (identical surface to national registrar)
DROP POLICY IF EXISTS "checkins_admin_registrar_insert" ON checkins;
CREATE POLICY "checkins_admin_registrar_insert" ON checkins FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "srs_insert" ON session_response_summaries;
CREATE POLICY "srs_insert" ON session_response_summaries FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "srs_update" ON session_response_summaries;
CREATE POLICY "srs_update" ON session_response_summaries FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "sr_insert" ON session_responses;
CREATE POLICY "sr_insert" ON session_responses FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "svd_insert" ON session_voice_distribution;
CREATE POLICY "svd_insert" ON session_voice_distribution FOR INSERT TO authenticated WITH CHECK (
  is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

DROP POLICY IF EXISTS "svd_update" ON session_voice_distribution;
CREATE POLICY "svd_update" ON session_voice_distribution FOR UPDATE TO authenticated
USING (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)))
WITH CHECK (is_admin_user() OR is_event_admin_user()
  OR EXISTS (SELECT 1 FROM app_users WHERE id = auth.uid()
     AND role IN ('national_registrar','regional_registrar','district_registrar','registrar','executive_admin','exec_registrar')
     AND (is_active IS NULL OR is_active = true)));

-- 7. Badge print logs insert: exec_registrar may log individual badge prints
DROP POLICY IF EXISTS "Admin and registrar can insert print logs" ON badge_print_logs;
CREATE POLICY "Admin and registrar can insert print logs"
  ON badge_print_logs FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app_users WHERE id = auth.uid()
      AND role IN ('national_admin', 'regional_admin', 'district_admin', 'admin',
                   'national_registrar', 'regional_registrar', 'district_registrar', 'registrar',
                   'event_admin', 'exec_registrar')
    )
  );

-- 8. mark_delegate_badge_printed: SECURITY DEFINER — the ONLY delegate-flag write
--    Exec Registrar gets (no broad delegates UPDATE grant). Strict event isolation.
CREATE OR REPLACE FUNCTION mark_delegate_badge_printed(p_delegate_id UUID, p_event_id UUID, p_action TEXT DEFAULT 'reprinted')
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_event_id UUID;
  v_updated INTEGER;
  v_name TEXT;
BEGIN
  IF NOT (is_admin_user() OR is_event_admin_user() OR is_exec_registrar_user()) THEN
    RAISE EXCEPTION 'FORBIDDEN: administrator, event administrator or exec registrar privileges required';
  END IF;

  SELECT event_id INTO v_event_id FROM delegates WHERE delegate_id = p_delegate_id;
  IF v_event_id IS NULL THEN
    RAISE EXCEPTION 'Delegate not found.';
  END IF;
  IF p_event_id IS NOT NULL AND v_event_id <> p_event_id THEN
    RAISE EXCEPTION 'Delegate does not belong to the given event.';
  END IF;

  SELECT trim(concat(first_name, ' ', last_name)) INTO v_name FROM delegates WHERE delegate_id = p_delegate_id;

  UPDATE delegates
  SET badge_printed = true, badge_printed_at = now()
  WHERE delegate_id = p_delegate_id AND event_id = v_event_id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 0 THEN
    INSERT INTO audit_log (event_id, action_type, performed_by, performer_email, target_type, target_id, summary, metadata)
    VALUES (
      v_event_id,
      CASE WHEN p_action = 'generated' THEN 'badge_generated' ELSE 'badge_printed' END,
      auth.uid(),
      nullif(auth.jwt()->>'email', ''),
      'delegate', p_delegate_id,
      'Individual ' || CASE WHEN p_action = 'generated' THEN 'badge generated' ELSE 'badge printed' END || ': ' || coalesce(v_name, p_delegate_id::text),
      jsonb_build_object('action', p_action)
    );
  END IF;

  RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_delegate_badge_printed(UUID, UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_delegate_badge_printed(UUID, UUID, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.mark_delegate_badge_printed(UUID, UUID, TEXT) FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_delegate_badge_printed(UUID, UUID, TEXT) TO authenticated;
GRANT  EXECUTE ON FUNCTION public.mark_delegate_badge_printed(UUID, UUID, TEXT) TO service_role;