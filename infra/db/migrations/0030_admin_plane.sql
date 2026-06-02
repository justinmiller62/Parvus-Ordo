-- 0030_admin_plane — SECURITY DEFINER admin-plane functions (RFC-004 §4.2).
--
-- WHY elevation: parishes RLS (0001) is `USING (id = app.parish_id)` — a FOR ALL policy
-- whose WITH CHECK defaults to that USING expr — so parvaordo_app can neither INSERT a parish
-- (a new random id never equals the caller's app.parish_id) nor SELECT across tenants. Parish
-- creation + cross-tenant listing/stats therefore REQUIRE elevation. Each function mirrors
-- 0002/login_lookup: owned by the migration superuser, SECURITY DEFINER, `SET search_path =
-- public` (closes the search-path-injection hole that DEFINER funcs are prone to), REVOKE
-- FROM PUBLIC + GRANT EXECUTE TO parvaordo_app.
--
-- AUTHORIZATION model: EXECUTE is granted to parvaordo_app (the single app DB role), exactly
-- like login_lookup. These are NOT self-authorizing — super-admin gating is enforced at the
-- APP layer (the admin route group + requireSuperAdmin; RFC-004 §6, separate beads). The
-- `p_actor_user_id` arg is for AUDIT attribution, not an authz check; the caller has already
-- proven the actor is a super-admin. `detail` NEVER carries secrets.
--
-- AUDIT actor: passed explicitly and the mutating functions self-write their audit row, so a
-- privileged action and its audit entry are atomic and the audit can never be forgotten by a
-- caller. (RFC-004's illustrative signatures omitted the actor; this is the security-
-- conservative choice — flagged for the §4.2 Censor review.)

-- The sole writer of admin_audit (RLS-locked + grant-revoked). Also callable directly by the
-- core admin layer to log privileged actions that have no dedicated function here.
CREATE OR REPLACE FUNCTION admin_write_audit(
  p_actor_user_id uuid,
  p_action text,
  p_target_parish_id uuid,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO admin_audit (actor_user_id, action, target_parish_id, detail)
  VALUES (p_actor_user_id, p_action, p_target_parish_id, COALESCE(p_detail, '{}'::jsonb))
  RETURNING id;
$$;

-- Create a BARE parish shell: status 'pending_setup', NO seeding (no memberships, ministries,
-- or parish_modules rows — parish_modules stays sparse, so the shell gets every module's
-- default). A super-admin later hands a setup link to a parish admin to finish provisioning.
-- Rejects a reserved slug and (via the parishes.slug UNIQUE constraint) a duplicate; the slug
-- shape mirrors @parvaordo/shared isValidSlug (defense in depth — the SQL boundary can't
-- import the TS validator, so keep the two aligned).
CREATE OR REPLACE FUNCTION admin_create_parish(
  p_actor_user_id uuid,
  p_name text,
  p_slug text,
  p_diocese_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_id uuid;
BEGIN
  IF p_slug IN ('www', 'app') THEN
    RAISE EXCEPTION 'reserved slug: %', p_slug USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_slug) < 3 OR length(p_slug) > 63 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid slug shape: %', p_slug USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO parishes (name, slug, diocese_id, status)
  VALUES (p_name, p_slug, p_diocese_id, 'pending_setup')
  RETURNING id INTO v_new_id;
  PERFORM admin_write_audit(
    p_actor_user_id, 'create_parish', v_new_id,
    jsonb_build_object('name', p_name, 'slug', p_slug, 'diocese_id', p_diocese_id)
  );
  RETURN v_new_id;
END;
$$;

-- Every parish, cross-tenant (RLS would otherwise hide all but the caller's active parish).
CREATE OR REPLACE FUNCTION admin_list_parishes()
RETURNS TABLE (
  id uuid,
  name text,
  slug text,
  diocese_id uuid,
  status text,
  primary_hostname text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, slug, diocese_id, status, primary_hostname, created_at
  FROM parishes
  ORDER BY created_at;
$$;

-- Lightweight stats for one parish (cross-tenant read).
CREATE OR REPLACE FUNCTION admin_get_parish_stats(p_parish_id uuid)
RETURNS TABLE (parish_id uuid, status text, member_count bigint, ministry_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.status,
    (SELECT count(*) FROM memberships m WHERE m.parish_id = p.id),
    (SELECT count(*) FROM ministries mi WHERE mi.parish_id = p.id)
  FROM parishes p
  WHERE p.id = p_parish_id;
$$;

-- Set a parish's lifecycle status + audit it. Validates the value (the parishes CHECK also
-- enforces it); TRANSITION validity (e.g. no active -> pending_setup) stays the app layer's
-- job via @parvaordo/shared canTransitionParishStatus.
CREATE OR REPLACE FUNCTION admin_set_status(
  p_actor_user_id uuid,
  p_parish_id uuid,
  p_status text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_status NOT IN ('pending_setup', 'active', 'suspended') THEN
    RAISE EXCEPTION 'invalid status: %', p_status USING ERRCODE = 'check_violation';
  END IF;
  UPDATE parishes SET status = p_status WHERE id = p_parish_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parish not found: %', p_parish_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM admin_write_audit(p_actor_user_id, 'set_status', p_parish_id, jsonb_build_object('status', p_status));
END;
$$;

-- Lock down every function: revoke from PUBLIC, grant EXECUTE only to the app role (mirror 0002).
REVOKE ALL ON FUNCTION admin_write_audit(uuid, text, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_create_parish(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_list_parishes() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_parish_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_status(uuid, uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_write_audit(uuid, text, uuid, jsonb) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_create_parish(uuid, text, text, uuid) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_list_parishes() TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_get_parish_stats(uuid) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_set_status(uuid, uuid, text) TO parvaordo_app;
