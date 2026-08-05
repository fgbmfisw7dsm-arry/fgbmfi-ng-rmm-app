-- FGBMFI Nigeria EMS — Sprint 15: Fix A Step 2 — Rename bare-email accounts + rehash to cost-10 temp passwords
-- Purpose: Accounts created with bare usernames (no @domain) cause GoTrue to return
--          HTTP 500 on login ("Authentication service temporarily unavailable").
--          This renames each such account to a full email address (trying
--          @fgbmfi.ng -> @fgbmfi.com -> @fgbmfi.org in order, skipping taken domains),
--          syncs auth.users / auth.identities / public.app_users, and sets a fresh
--          bcrypt-cost-10 temporary password.
--
-- Deploy: Run the WHOLE script in Supabase SQL Editor (postgres role). A result table
--         prints the final email -> temporary password map. Save that map.

DROP TABLE IF EXISTS _bare_email_fix_results;
CREATE TEMP TABLE _bare_email_fix_results(old_email TEXT, new_email TEXT, temp_password TEXT);

DO $fix$
DECLARE
    v_rec       RECORD;
    v_new_email TEXT;
    v_domain    TEXT;
    v_temp      TEXT;
    v_salt      TEXT;
    v_domains   TEXT[] := ARRAY['fgbmfi.ng', 'fgbmfi.com', 'fgbmfi.org'];
BEGIN
    FOR v_rec IN
        SELECT id, email FROM auth.users
        WHERE email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
        ORDER BY email
    LOOP
        v_new_email := NULL;
        FOREACH v_domain IN ARRAY v_domains LOOP
            IF NOT EXISTS (
                SELECT 1 FROM auth.users
                WHERE lower(trim(email)) = lower(trim(v_rec.email)) || '@' || v_domain
                  AND id <> v_rec.id
            ) THEN
                v_new_email := lower(trim(v_rec.email)) || '@' || v_domain;
                EXIT;
            END IF;
        END LOOP;

        IF v_new_email IS NULL THEN
            INSERT INTO _bare_email_fix_results VALUES (v_rec.email, NULL, NULL);
            CONTINUE;
        END IF;

        v_temp := 'FGB@' || substr(md5(random()::text), 1, 8) || '!26';
        v_salt := '$2a$10$' || substring(translate(encode(decode(md5(random()::text), 'hex'), 'base64'), '+/', './'), 1, 22);

        UPDATE auth.users
        SET email = v_new_email,
            encrypted_password = crypt(v_temp, v_salt),
            updated_at = NOW()
        WHERE id = v_rec.id;

        UPDATE auth.identities
        SET provider_id = v_new_email,
            identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email}', to_jsonb(v_new_email)),
            updated_at = NOW()
        WHERE user_id = v_rec.id AND provider = 'email';

        UPDATE public.app_users
        SET email = v_new_email
        WHERE id = v_rec.id;

        INSERT INTO _bare_email_fix_results VALUES (v_rec.email, v_new_email, v_temp);
    END LOOP;
END;
$fix$;

SELECT old_email, new_email, temp_password FROM _bare_email_fix_results ORDER BY old_email;
