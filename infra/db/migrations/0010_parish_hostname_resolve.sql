-- 0010_parish_hostname_resolve — resolve a request hostname to a parish by SLUG
-- against a per-environment base domain (PARISH_BASE_DOMAIN), with explicit
-- custom domains as an override. This replaces full-hostname matching, so the
-- SAME parish row (slug 'holy-spirit') resolves in every environment:
--   local   holy-spirit.localhost
--   dev     holy-spirit.dev.parvusordo.com
--   stage   holy-spirit.stage.parvusordo.com
--   prod    holy-spirit.parvusordo.com   (or a custom domain, prod-only)
-- primary_hostname stays as a display/canonical value; it is no longer the lookup key.

ALTER TABLE parishes ADD COLUMN IF NOT EXISTS custom_domains text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS parishes_custom_domains_idx ON parishes USING gin (custom_domains);

-- Resolve a hostname (already split into slug XOR custom domain by the caller) to a
-- parish id, pre-tenant-context — RLS on parishes would otherwise hide every row,
-- so this is SECURITY DEFINER like login_lookup.
CREATE OR REPLACE FUNCTION resolve_parish_id(p_slug text, p_domain text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM parishes
  WHERE (p_slug   IS NOT NULL AND slug = lower(p_slug))
     OR (p_domain IS NOT NULL AND lower(p_domain) = ANY (custom_domains))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION resolve_parish_id(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resolve_parish_id(text, text) TO parvaordo_app;
