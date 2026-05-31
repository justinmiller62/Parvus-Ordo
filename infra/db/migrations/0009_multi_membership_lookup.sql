-- 0009_multi_membership_lookup — return ALL of a user's memberships at login.
--
-- A single email can belong to multiple parishes (e.g. a volunteer at two), with a
-- different role at each. The active parish is resolved per request from the
-- hostname (each parish has its own domain) or a chooser. So login_lookup now
-- returns one row PER membership (no LIMIT 1), with the parish name + hostname so
-- the app can build the "Choose a parish" list and resolve the active one.

-- Return type changes (added parish_name/hostname), so drop + recreate.
DROP FUNCTION IF EXISTS login_lookup(text);

CREATE FUNCTION login_lookup(p_email text)
RETURNS TABLE (
  user_id          uuid,
  display_name     text,
  is_super_admin   boolean,
  role             membership_role,
  parish_id        uuid,
  parish_name      text,
  parish_hostname  text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.id, u.display_name, u.is_super_admin, m.role, m.parish_id, p.name, p.primary_hostname
  FROM users u
  LEFT JOIN memberships m ON m.user_id = u.id
  LEFT JOIN parishes p ON p.id = m.parish_id
  WHERE lower(u.email) = lower(p_email)
  -- Parish-wide membership ranks above a ministry-scoped one for the same parish;
  -- then alphabetical for a stable chooser order.
  ORDER BY (m.ministry_id IS NULL) DESC, p.name;
$$;

REVOKE ALL ON FUNCTION login_lookup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION login_lookup(text) TO parvaordo_app;
