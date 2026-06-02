-- 0033_gather_join_requests_forms — Parvus Gather T2 Application slice (RFC-005 §5, §10, §12).
--
-- Adds the join-request primitive + the MINIMAL Forms slice (Application type only). The full
-- forms builder — field types, conditional logic, multi-page, e-sign, export — is T7 and is
-- deliberately NOT modeled here; this is only what the Q2 Application + reviewer flow (T2-c)
-- needs. Numbered 0033: the max on this branch is 0032_gather_t1 (the T1 migration this sequences
-- AFTER, per its FK on gather_groups). Re-check at merge and renumber above the current max if a
-- sibling migration lands first (the migration-collision rule). Every table is parish-scoped,
-- denormalizes parish_id (NOT NULL) so RLS never needs a join, and carries the standard FOR ALL
-- tenant-isolation policy (mirrors gather_groups_isolation from 0032). parvaordo_app picks up
-- SELECT/INSERT/UPDATE/DELETE via the 0001 ALTER DEFAULT PRIVILEGES; RLS still applies to it.

-- ── gather_join_requests: a parishioner asks to join a group; a leader approves/declines ──────
CREATE TABLE gather_join_requests (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id  uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id   uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message    text,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_join_requests_group_idx ON gather_join_requests(group_id);
CREATE INDEX gather_join_requests_user_idx ON gather_join_requests(user_id);

-- ── gather_form_definitions: a form a group (or the parish) publishes. T2 = Application only ──
-- group_id is nullable (null = a parish-level form, mirroring gather_requestables.group_id) and
-- SET NULL on group delete so a published form + its submissions are preserved, not destroyed.
-- `schema` holds the field list as jsonb (no per-field-type columns — T7 owns the rich builder);
-- `type` is constrained to 'application' for now and widened by a later migration when T7 lands.
CREATE TABLE gather_form_definitions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id  uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id   uuid REFERENCES gather_groups(id) ON DELETE SET NULL,
  type       text NOT NULL DEFAULT 'application' CHECK (type IN ('application')),
  schema     jsonb,
  status     text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_form_definitions_group_idx ON gather_form_definitions(group_id);

-- ── gather_form_submissions: one person's answers to a form, plus the reviewer's decision ─────
CREATE TABLE gather_form_submissions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id    uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  form_id      uuid NOT NULL REFERENCES gather_form_definitions(id) ON DELETE CASCADE,
  submitter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answers      jsonb,
  status       text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'rejected', 'info_requested')),
  reviewer_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_form_submissions_form_idx ON gather_form_submissions(form_id);
CREATE INDEX gather_form_submissions_submitter_idx ON gather_form_submissions(submitter_id);

-- ── RLS: standard parish tenant-isolation on every new table (mirror gather_groups_isolation) ─
ALTER TABLE gather_join_requests    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_form_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_form_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY gather_join_requests_isolation ON gather_join_requests FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_form_definitions_isolation ON gather_form_definitions FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_form_submissions_isolation ON gather_form_submissions FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
