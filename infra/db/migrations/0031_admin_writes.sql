-- 0031_admin_writes — the remaining cross-tenant admin-plane SECURITY DEFINER write functions
-- (RFC-004 §4.1/§4.2; rector decision resolving the po-ug00 DEFINER-fn gap, bead po-juwe).
-- po-wdxi (0030) built the first batch (create/list/stats/set_status/write_audit); this adds the
-- cross-tenant WRITES that po-ug00's admin.ts routes through. Same template as 0030: owned by
-- the migration superuser, SECURITY DEFINER, SET search_path = public, REVOKE FROM PUBLIC +
-- GRANT EXECUTE TO parvaordo_app, exactly one atomic admin_audit row per call.
--
-- ADDITION over 0030 (per the rector): every write RE-ASSERTS super-admin in-function via
-- admin_require_super — defense in depth, so the cross-tenant write cannot occur unless the
-- actor is genuinely a super-admin, independent of the app-layer gate. `detail` NEVER carries
-- secrets (brand has none). The toggleable set (ocia/studio only) + slug shape mirror the locked
-- answer po-wisp-rrwul / @parvaordo/shared (the SQL boundary can't import TS — keep aligned).

-- Internal guard: raise unless the actor is a super-admin. Called within the DEFINER write fns
-- below (runs as the owner, so it reads `users` — which has no RLS). REVOKEd from PUBLIC and NOT
-- granted to the app role: it is internal-only (the write fns, owned by the same role, may call it).
CREATE OR REPLACE FUNCTION admin_require_super(p_actor_user_id uuid) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT COALESCE((SELECT is_super_admin FROM users WHERE id = p_actor_user_id), false) THEN
    RAISE EXCEPTION 'not authorized: super-admin required' USING ERRCODE = 'insufficient_privilege';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION admin_require_super(uuid) FROM PUBLIC;

-- Per-parish module toggle (parish_modules). Only ocia/studio are toggleable; always-on modules
-- are rejected (the resolver also pins them on, but reject early for a clear error).
CREATE OR REPLACE FUNCTION admin_set_module_enabled(
  p_actor_user_id uuid, p_parish_id uuid, p_module_key text, p_enabled boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM admin_require_super(p_actor_user_id);
  IF p_module_key NOT IN ('ocia', 'studio') THEN
    RAISE EXCEPTION 'module not toggleable: %', p_module_key USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO parish_modules (parish_id, module_key, enabled)
  VALUES (p_parish_id, p_module_key, p_enabled)
  ON CONFLICT (parish_id, module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = now();
  PERFORM admin_write_audit(p_actor_user_id, 'set_module_enabled', p_parish_id,
    jsonb_build_object('module_key', p_module_key, 'enabled', p_enabled));
END;
$$;

-- Per-parish branding (parishes.brand jsonb; no secrets).
CREATE OR REPLACE FUNCTION admin_set_parish_brand(
  p_actor_user_id uuid, p_parish_id uuid, p_brand jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM admin_require_super(p_actor_user_id);
  UPDATE parishes SET brand = p_brand WHERE id = p_parish_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parish not found: %', p_parish_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM admin_write_audit(p_actor_user_id, 'set_parish_brand', p_parish_id, COALESCE(p_brand, '{}'::jsonb));
END;
$$;

-- Per-parish subdomain slug. Shape + reserved labels mirror @parvaordo/shared isValidSlug;
-- GLOBAL uniqueness is enforced by the parishes.slug UNIQUE constraint (UPDATE → unique_violation
-- on collision).
CREATE OR REPLACE FUNCTION admin_set_parish_subdomain(
  p_actor_user_id uuid, p_parish_id uuid, p_slug text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM admin_require_super(p_actor_user_id);
  IF p_slug IN ('www', 'app') THEN
    RAISE EXCEPTION 'reserved slug: %', p_slug USING ERRCODE = 'check_violation';
  END IF;
  IF length(p_slug) < 3 OR length(p_slug) > 63 OR p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' THEN
    RAISE EXCEPTION 'invalid slug shape: %', p_slug USING ERRCODE = 'check_violation';
  END IF;
  UPDATE parishes SET slug = p_slug WHERE id = p_parish_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parish not found: %', p_parish_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM admin_write_audit(p_actor_user_id, 'set_parish_subdomain', p_parish_id, jsonb_build_object('slug', p_slug));
END;
$$;

-- Per-parish custom domains (parishes.custom_domains text[]). Lowercased + deduped; a domain
-- already claimed by ANOTHER parish (the resolve key — resolve_parish_id, 0010) is rejected.
CREATE OR REPLACE FUNCTION admin_set_parish_custom_domains(
  p_actor_user_id uuid, p_parish_id uuid, p_domains text[]
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_domains text[];
BEGIN
  PERFORM admin_require_super(p_actor_user_id);
  SELECT COALESCE(array_agg(DISTINCT lower(d)), '{}'::text[]) INTO v_domains
  FROM unnest(COALESCE(p_domains, '{}'::text[])) AS d;
  IF EXISTS (SELECT 1 FROM parishes WHERE id <> p_parish_id AND custom_domains && v_domains) THEN
    RAISE EXCEPTION 'custom domain collision' USING ERRCODE = 'unique_violation';
  END IF;
  UPDATE parishes SET custom_domains = v_domains WHERE id = p_parish_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'parish not found: %', p_parish_id USING ERRCODE = 'no_data_found';
  END IF;
  PERFORM admin_write_audit(p_actor_user_id, 'set_parish_custom_domains', p_parish_id,
    jsonb_build_object('custom_domains', v_domains));
END;
$$;

-- Diocese-scoped module default (diocese_modules, po-ekjb). Sparse upsert; toggleable only;
-- target_parish_id is NULL (diocese-scope) and the diocese is recorded in detail.
CREATE OR REPLACE FUNCTION admin_set_diocese_module_default(
  p_actor_user_id uuid, p_diocese_id uuid, p_module_key text, p_enabled boolean
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM admin_require_super(p_actor_user_id);
  IF p_module_key NOT IN ('ocia', 'studio') THEN
    RAISE EXCEPTION 'module not toggleable: %', p_module_key USING ERRCODE = 'check_violation';
  END IF;
  INSERT INTO diocese_modules (diocese_id, module_key, enabled)
  VALUES (p_diocese_id, p_module_key, p_enabled)
  ON CONFLICT (diocese_id, module_key) DO UPDATE SET enabled = excluded.enabled, updated_at = now();
  PERFORM admin_write_audit(p_actor_user_id, 'set_diocese_module_default', NULL,
    jsonb_build_object('diocese_id', p_diocese_id, 'module_key', p_module_key, 'enabled', p_enabled));
END;
$$;

-- Lock down: REVOKE FROM PUBLIC, GRANT EXECUTE only to the app role (mirror 0002/0030).
REVOKE ALL ON FUNCTION admin_set_module_enabled(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_parish_brand(uuid, uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_parish_subdomain(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_parish_custom_domains(uuid, uuid, text[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_set_diocese_module_default(uuid, uuid, text, boolean) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION admin_set_module_enabled(uuid, uuid, text, boolean) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_set_parish_brand(uuid, uuid, jsonb) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_set_parish_subdomain(uuid, uuid, text) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_set_parish_custom_domains(uuid, uuid, text[]) TO parvaordo_app;
GRANT EXECUTE ON FUNCTION admin_set_diocese_module_default(uuid, uuid, text, boolean) TO parvaordo_app;
