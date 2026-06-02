-- 0025_engagement_events — student engagement telemetry for the OCIA learner player,
-- powering the catechist/admin Engagement Dashboard (Narthex port: engagement-dashboard).
--
-- The legacy Narthex feature streamed raw events to the browser and reduced them in JS
-- (a full-table SELECT * per view). Here the raw stream lives in this table and ALL
-- aggregation happens in SQL (packages/core/src/ocia/engagement.ts) — the scan-everything
-- pattern is NOT ported.
--
-- PORT DELTAS vs the legacy schema (see docs/narthex/DELTAS.md):
--   • Supabase auth.uid() RLS  -> Neon parish-fence RLS (app.parish_id) + role/ownership
--     enforced in packages/core ABOVE the fence (the documented house pattern, 0011).
--   • loose uuid soft-refs (block_id/question_id/cohort_id) -> REAL foreign keys.
--   • blocks+questions split    -> unified lesson_items (item_id), step_kind derives from it.
--   • mutable step_index timeline -> events stamp version_id; analytics aggregate PER VERSION
--     so a later lesson edit can't corrupt historical per-step/per-question numbers.
--   • fire-and-forget dup lesson_start/lesson_complete -> idempotent (partial unique index).
--
-- Activity data: parish_id = the ANSWERING parish (NOT NULL), strict tenant isolation,
-- exactly like `answers` (0003). A lesson may be global/diocese scope, but the engagement
-- it generates belongs to the student's parish.

CREATE TYPE engagement_event_type AS ENUM (
  'lesson_start',   -- student entered the lesson (once per student+version; beacon)
  'step_complete',  -- student finished an item and advanced (once per item, at the frontier)
  'answer_submit',  -- student submitted a question answer (carries metadata.answer_correct)
  'lesson_complete' -- student reached the end (once per student+version)
);

-- The player timeline's step type. Mirrors lesson_item_kind but adds 'feedback' for the
-- synthetic end-of-lesson step (no lesson_item backs it); aggregation folds feedback→question.
CREATE TYPE engagement_step_kind AS ENUM ('reading', 'video', 'question', 'feedback');

CREATE TABLE engagement_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,        -- answering parish (RLS fence)
  student_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id   uuid NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  version_id  uuid REFERENCES lesson_versions(id) ON DELETE SET NULL,         -- the version worked through
  cohort_id   uuid REFERENCES cohorts(id) ON DELETE SET NULL,                 -- real FK (null until cohort wiring)
  item_id     uuid REFERENCES lesson_items(id) ON DELETE SET NULL,            -- the step's item (null for lesson-level)
  event_type  engagement_event_type NOT NULL,
  step_index  int,                                                            -- timeline position at emit
  step_kind   engagement_step_kind,                                           -- denormalized so deleted items still classify
  metadata    jsonb NOT NULL DEFAULT '{}',                                    -- e.g. answer_submit → { answer_correct: bool|null }
  created_at  timestamptz NOT NULL DEFAULT now()                              -- the timeline clock for all durations
);

-- Read paths: by lesson, by version (the dashboard's primary scope), by cohort, by student.
CREATE INDEX engagement_events_lesson_id_idx ON engagement_events(lesson_id);
CREATE INDEX engagement_events_version_id_idx ON engagement_events(version_id);
CREATE INDEX engagement_events_student_version_idx ON engagement_events(student_id, version_id);
CREATE INDEX engagement_events_cohort_id_idx ON engagement_events(cohort_id);
CREATE INDEX engagement_events_parish_id_idx ON engagement_events(parish_id);
CREATE INDEX engagement_events_type_idx ON engagement_events(event_type);

-- At most one lesson_start / lesson_complete per student per version — makes the
-- fire-and-forget writer idempotent (ON CONFLICT DO NOTHING) and fixes the legacy
-- double-count bug for these singleton bookend events.
CREATE UNIQUE INDEX engagement_singleton_idx
  ON engagement_events (student_id, version_id, event_type)
  WHERE event_type IN ('lesson_start', 'lesson_complete');

-- ─── RLS: strict tenant isolation (same pattern as the other activity tables) ──
-- Role-gating (only admin/catechist/super_admin may read aggregates) and ownership
-- (a student writes only their own events) are enforced in packages/core, above this
-- row-level tenant fence — there is no per-user GUC, so the fence is by parish only.
ALTER TABLE engagement_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY engagement_events_isolation ON engagement_events FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
