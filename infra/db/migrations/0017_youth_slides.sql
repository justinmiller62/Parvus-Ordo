-- 0017_youth_slides — slide images per Parvus Studio project. Uploaded manually
-- (catechist/creator) or via the MCP upload_slide tool; the bytes live in R2, this
-- table records order + key. The iOS /package endpoint vends them as presigned URLs.
CREATE TABLE youth_slides (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  project_id  uuid NOT NULL REFERENCES youth_projects(id) ON DELETE CASCADE,
  slide_order integer NOT NULL,
  r2_key      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, slide_order)
);
CREATE INDEX youth_slides_project_idx ON youth_slides(project_id);

ALTER TABLE youth_slides ENABLE ROW LEVEL SECURITY;
CREATE POLICY youth_slides_isolation ON youth_slides FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
