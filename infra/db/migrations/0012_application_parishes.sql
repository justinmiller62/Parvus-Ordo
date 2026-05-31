-- 0012_application_parishes — list parishes accepting public applications, for the
-- /apply picker shown on the apex (no subdomain → no resolved parish). Cross-tenant
-- and pre-context, so SECURITY DEFINER like login_lookup / resolve_parish_id.

CREATE OR REPLACE FUNCTION list_application_parishes()
RETURNS TABLE (id uuid, name text, slug text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, name, slug FROM parishes WHERE applications_enabled ORDER BY name;
$$;

REVOKE ALL ON FUNCTION list_application_parishes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION list_application_parishes() TO parvaordo_app;
