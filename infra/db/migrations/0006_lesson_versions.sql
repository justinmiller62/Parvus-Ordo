-- 0006_lesson_versions — lesson versioning + history. Content moves under versions.
--
-- lessons (stable container) -> lesson_versions (full history) -> lesson_items (per version).
-- lessons.live_version_id points at the version students see (NULL = offline).
-- At most one DRAFT (published_at IS NULL) per lesson (partial unique index).
-- title/description/discussion_template/published_at move from lessons to versions.
-- Data-preserving: each existing lesson becomes a v1 version (items moved in).

CREATE TABLE lesson_versions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id           uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  scope               content_scope NOT NULL,
  diocese_id          uuid REFERENCES dioceses(id) ON DELETE CASCADE,
  parish_id           uuid REFERENCES parishes(id) ON DELETE CASCADE,
  version_number      int NOT NULL,
  title               text NOT NULL,
  description         text,
  discussion_template text,
  published_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, version_number),
  CONSTRAINT lesson_versions_scope_owner_chk CHECK (
    (scope = 'global'  AND diocese_id IS NULL     AND parish_id IS NULL) OR
    (scope = 'diocese' AND diocese_id IS NOT NULL AND parish_id IS NULL) OR
    (scope = 'parish'  AND parish_id  IS NOT NULL AND diocese_id IS NULL)
  )
);
CREATE INDEX lesson_versions_lesson_id_idx ON lesson_versions(lesson_id);
CREATE INDEX lesson_versions_parish_id_idx ON lesson_versions(parish_id);
-- At most one draft (unpublished) version per lesson.
CREATE UNIQUE INDEX lesson_versions_one_draft ON lesson_versions(lesson_id) WHERE published_at IS NULL;
CREATE TRIGGER lesson_versions_set_updated_at BEFORE UPDATE ON lesson_versions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE lessons ADD COLUMN live_version_id uuid REFERENCES lesson_versions(id) ON DELETE SET NULL;
ALTER TABLE lesson_items ADD COLUMN version_id uuid REFERENCES lesson_versions(id) ON DELETE CASCADE;

-- Backfill (no-op on a fresh DB; real for an existing one): one v1 per lesson.
INSERT INTO lesson_versions (lesson_id, scope, diocese_id, parish_id, version_number, title, description, discussion_template, published_at, created_at)
SELECT id, scope, diocese_id, parish_id, 1, title, description, discussion_template, published_at, created_at
FROM lessons;

UPDATE lesson_items li
SET version_id = lv.id
FROM lesson_versions lv
WHERE lv.lesson_id = li.lesson_id AND lv.version_number = 1;

UPDATE lessons l
SET live_version_id = lv.id
FROM lesson_versions lv
WHERE lv.lesson_id = l.id AND lv.version_number = 1 AND l.published_at IS NOT NULL;

-- Lock down lesson_items to versions (dropping lesson_id auto-drops its unique + index).
ALTER TABLE lesson_items ALTER COLUMN version_id SET NOT NULL;
ALTER TABLE lesson_items DROP COLUMN lesson_id;
ALTER TABLE lesson_items ADD CONSTRAINT lesson_items_version_position_key UNIQUE (version_id, position);
CREATE INDEX lesson_items_version_id_idx ON lesson_items(version_id);

-- Lesson metadata now lives on versions.
ALTER TABLE lessons
  DROP COLUMN title,
  DROP COLUMN description,
  DROP COLUMN discussion_template,
  DROP COLUMN published_at;

-- RLS: versions follow the same three-tier read; writes are parish-owned only.
ALTER TABLE lesson_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY lesson_versions_read ON lesson_versions FOR SELECT USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = (SELECT p.diocese_id FROM parishes p WHERE p.id = current_setting('app.parish_id', true)::uuid))
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);
CREATE POLICY lesson_versions_insert ON lesson_versions FOR INSERT
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY lesson_versions_update ON lesson_versions FOR UPDATE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY lesson_versions_delete ON lesson_versions FOR DELETE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
