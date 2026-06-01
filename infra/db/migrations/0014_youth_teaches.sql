-- 0014_youth_teaches — Youth Teaches module. A teen drafts a short catechetical
-- video script (AI-assisted via the MCP server), marks it ready, records it in the
-- Parvus Studio iOS app, and the recording lands back here. Parish-scoped RLS,
-- same pattern as the OCIA activity tables.

CREATE TABLE youth_topics (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id            uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  category             text NOT NULL,
  title                text NOT NULL,
  common_misconception text,
  correct_teaching     text,
  age_band             text,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX youth_topics_parish_id_idx ON youth_topics(parish_id);

CREATE TABLE youth_projects (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  teen_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id      uuid REFERENCES youth_topics(id) ON DELETE SET NULL,
  title         text NOT NULL,
  status        text NOT NULL DEFAULT 'drafting'
                  CHECK (status IN ('drafting', 'ready_to_record', 'submitted')),
  -- { full_text, segments: [{ id, text, slide_id }] }
  script_draft  jsonb NOT NULL DEFAULT '{"full_text":"","segments":[]}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX youth_projects_parish_id_idx ON youth_projects(parish_id);
CREATE INDEX youth_projects_teen_idx ON youth_projects(teen_user_id);

-- MCP session tokens: a teen's "Start AI session" mints one; Claude Desktop sends
-- it on every MCP tool call. Scoped to the teen's parish + (optionally) project.
CREATE TABLE youth_mcp_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  teen_user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         text UNIQUE NOT NULL,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX youth_mcp_tokens_token_idx ON youth_mcp_tokens(token);

-- Every MCP tool call is logged (AI-literacy / safety requirement).
CREATE TABLE youth_mcp_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  project_id  uuid REFERENCES youth_projects(id) ON DELETE CASCADE,
  tool_name   text NOT NULL,
  params      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX youth_mcp_audit_parish_idx ON youth_mcp_audit_log(parish_id);

-- Uploaded recordings. The MP4 lives in Bunny Stream (existing video infra); we
-- store its id + playback URL. Slide images live in R2 (referenced from the package).
CREATE TABLE youth_recordings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id           uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  project_id          uuid NOT NULL REFERENCES youth_projects(id) ON DELETE CASCADE,
  bunny_video_id      text,
  playback_url        text,
  duration_seconds    integer,
  slide_advance_count integer,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX youth_recordings_project_idx ON youth_recordings(project_id);

-- Parish-scoped RLS — app.parish_id is set transaction-local by getDb(parishId).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['youth_topics', 'youth_projects', 'youth_mcp_tokens', 'youth_mcp_audit_log', 'youth_recordings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (parish_id = current_setting(''app.parish_id'', true)::uuid) WITH CHECK (parish_id = current_setting(''app.parish_id'', true)::uuid)',
      t || '_isolation', t);
  END LOOP;
END $$;
