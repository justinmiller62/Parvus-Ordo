-- 0011_onboarding — public OCIA applications + the per-parish applications toggle.
--
-- ocia_applicants is a parish-scoped LEAD table (not an account): the public /apply
-- form creates a `pending` row; an admin/catechist later converts it to an invited
-- student or dismisses it. Lifecycle: pending -> invited | dismissed (+ soft delete).
-- Unlike Narthex (open `anon WITH CHECK (true)` insert), writes go through a Server
-- Action that resolves parish_id from the request tenant, so RLS is the only path.

ALTER TABLE parishes ADD COLUMN IF NOT EXISTS applications_enabled boolean NOT NULL DEFAULT false;

CREATE TABLE ocia_applicants (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id    uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  email        text NOT NULL,
  full_name    text NOT NULL,
  form_data    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- the rest of the intake form (trimmed v1)
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'invited', 'dismissed')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   timestamptz                          -- soft delete; non-null = hidden
);

CREATE INDEX ocia_applicants_parish_id_idx ON ocia_applicants(parish_id);
CREATE INDEX ocia_applicants_parish_status_idx ON ocia_applicants(parish_id, status);

-- Parish-scoped isolation, same pattern as the other activity tables. Role-gating
-- (only admin/catechist may read/convert; the public form may only insert) is
-- enforced in packages/core, above this row-level tenant fence.
ALTER TABLE ocia_applicants ENABLE ROW LEVEL SECURITY;
CREATE POLICY applicant_isolation ON ocia_applicants
  FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
