-- 0020_prayers — Prayer Book ported from Narthex (same three-layer architecture as
-- the dictionary): global prayer_entries + per-parish prayer_overrides + prayer_submissions.
-- (The Rosary Guide is a static client asset, not backed by these tables.)

CREATE TABLE prayer_entries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL UNIQUE,
  prayer_text   text NOT NULL,
  latin_text    text,
  category      text,
  context       text,
  attribution   text,
  display_order integer NOT NULL DEFAULT 0,
  status        text NOT NULL DEFAULT 'approved',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prayer_entries_title_idx ON prayer_entries(title);
CREATE INDEX prayer_entries_status_idx ON prayer_entries(status);
ALTER TABLE prayer_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY prayer_entries_read ON prayer_entries FOR SELECT USING (status = 'approved');

CREATE TABLE prayer_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id      uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  entry_id       uuid NOT NULL REFERENCES prayer_entries(id) ON DELETE CASCADE,
  override_text  text,
  override_context text,
  override_notes text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parish_id, entry_id)
);
CREATE INDEX prayer_overrides_parish_idx ON prayer_overrides(parish_id);
ALTER TABLE prayer_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY prayer_overrides_isolation ON prayer_overrides FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);

CREATE TABLE prayer_submissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  title         text NOT NULL,
  prayer_text   text NOT NULL,
  latin_text    text,
  category      text,
  context       text,
  attribution   text,
  submitted_by  uuid NOT NULL REFERENCES users(id),
  status        text NOT NULL DEFAULT 'pending',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX prayer_submissions_parish_idx ON prayer_submissions(parish_id);
ALTER TABLE prayer_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY prayer_submissions_isolation ON prayer_submissions FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
