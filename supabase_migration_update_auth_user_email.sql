-- Sprint 8.5: Add update_auth_user_email RPC
-- Allows the app to overwrite auth.users.email after signUp() with a fabricated email
-- Required for non-email usernames (e.g., n_reg) that GoTrue's signUp() rejects

CREATE OR REPLACE FUNCTION update_auth_user_email(user_id UUID, new_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    UPDATE auth.users SET
        email = new_email,
        email_confirmed_at = COALESCE(email_confirmed_at, NOW()),
        confirmation_sent_at = COALESCE(confirmation_sent_at, NOW()),
        confirmation_token = '',
        recovery_token = '',
        email_change_token = '',
        email_change = ''
    WHERE id = user_id;

    IF NOT FOUND THEN
        RETURN json_build_object('status', 'error', 'message', 'User not found');
    END IF;

    RETURN json_build_object('status', 'success');
END;
$$;
