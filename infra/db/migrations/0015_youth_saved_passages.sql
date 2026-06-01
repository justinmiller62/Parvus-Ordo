-- 0015_youth_saved_passages — passages a teen saves from the corpus (save_corpus_passage
-- MCP tool), plus a SECURITY DEFINER validator for MCP session tokens (Claude Desktop
-- presents the token pre-tenant-context, so RLS would otherwise hide the row).

ALTER TABLE youth_projects ADD COLUMN saved_passages jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION validate_youth_mcp_token(p_token text)
RETURNS TABLE (parish_id uuid, teen_user_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT parish_id, teen_user_id FROM youth_mcp_tokens
  WHERE token = p_token AND expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION validate_youth_mcp_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION validate_youth_mcp_token(text) TO parvaordo_app;
