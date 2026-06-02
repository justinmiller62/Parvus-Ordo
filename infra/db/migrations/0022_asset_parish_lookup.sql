-- 0022_asset_parish_lookup — resolve an asset's owning parish by id, pre-tenant-context.
--
-- The clip cut-service calls back POST /api/ocia/clips/:assetId/ready to flip a clip's
-- status. That callback used to take the parish straight from the request body to scope
-- the RLS update. po-78a gated the endpoint behind a constant-time CLIP_CALLBACK_SECRET,
-- so it is no longer an open exploit — but it still trusted the caller for tenancy. A
-- buggy or compromised cutter job supplying the wrong parishId would scope the UPDATE to
-- the wrong tenant and silently no-op (RLS matches no row) instead of landing on the real
-- asset — a correctness/observability gap (po-k92).
--
-- Deriving the parish from the asset row closes that gap, but `assets` is RLS-scoped, so a
-- tenant-scoped read can't find the asset before we know its parish. This SECURITY DEFINER
-- lookup bypasses RLS for one narrow read — id (PK) in, parish_id out — exactly like
-- login_lookup / resolve_parish_id / validate_youth_mcp_token (migrations 0002/0009/0010/0014).
-- It returns NULL for an unknown id or a non-parish-scoped asset (global/diocese assets have
-- a NULL parish_id; clips are always parish-scoped).

CREATE OR REPLACE FUNCTION asset_parish_id(p_asset_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT parish_id FROM assets WHERE id = p_asset_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION asset_parish_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION asset_parish_id(uuid) TO parvaordo_app;
