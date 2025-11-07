-- Ensure tim.carrender@gmail.com is a super admin
-- This script works with Supabase Auth (auth.users table)

DO $$
DECLARE
    user_id_val UUID;
BEGIN
    -- Get the user ID from auth.users (Supabase Auth)
    SELECT id INTO user_id_val
    FROM auth.users
    WHERE LOWER(email) = LOWER('tim.carrender@gmail.com')
    LIMIT 1;

    IF user_id_val IS NULL THEN
        RAISE EXCEPTION 'User with email tim.carrender@gmail.com not found in auth.users. Please create the user first via Supabase Auth.';
    END IF;

    -- Insert or update user_roles
    INSERT INTO user_roles (user_id, is_super_admin, created_at, updated_at)
    VALUES (user_id_val, true, NOW(), NOW())
    ON CONFLICT (user_id)
    DO UPDATE SET is_super_admin = true, updated_at = NOW();

    RAISE NOTICE 'User % (tim.carrender@gmail.com) has been set as super admin', user_id_val;
END $$;

-- Verify the change
SELECT 
    u.id,
    u.email,
    COALESCE(ur.is_super_admin, false) as is_super_admin,
    ur.created_at as admin_since
FROM auth.users u
LEFT JOIN user_roles ur ON ur.user_id = u.id
WHERE LOWER(u.email) = LOWER('tim.carrender@gmail.com');

