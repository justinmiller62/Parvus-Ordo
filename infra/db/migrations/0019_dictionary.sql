-- 0019_dictionary — Catholic glossary ported from Narthex. Three layers:
--   dictionary_entries     — GLOBAL universal glossary (no parish_id); everyone reads
--                            approved entries; writes only by the owner/seed (no app policy).
--   dictionary_overrides   — per-parish field overrides of a universal entry (wide columns).
--   dictionary_submissions — parish-proposed new terms (status 'pending').
-- Parish tables use the standard getDb(parishId) → app.parish_id RLS pattern; role
-- gating (admin/catechist) is enforced in the Server Actions, as elsewhere.

CREATE TABLE dictionary_entries (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  headword               text NOT NULL UNIQUE,
  variants               text[],
  pronunciation          text,
  definition             text NOT NULL,
  greek_word             text,
  greek_definition       text,
  hebrew_word            text,
  hebrew_definition      text,
  first_century_context  text,
  catechism_references   text[],
  scripture_references   text[],
  category               text,
  status                 text NOT NULL DEFAULT 'approved',
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dictionary_entries_headword_idx ON dictionary_entries(headword);
CREATE INDEX dictionary_entries_status_idx ON dictionary_entries(status);
ALTER TABLE dictionary_entries ENABLE ROW LEVEL SECURITY;
-- Global: anyone may read approved entries; no app write policy (owner/seed/MCP only).
CREATE POLICY dictionary_entries_read ON dictionary_entries FOR SELECT USING (status = 'approved');

CREATE TABLE dictionary_overrides (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id                       uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  entry_id                        uuid NOT NULL REFERENCES dictionary_entries(id) ON DELETE CASCADE,
  override_definition             text,
  override_greek_definition       text,
  override_hebrew_definition      text,
  override_first_century_context  text,
  override_notes                  text,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (parish_id, entry_id)
);
CREATE INDEX dictionary_overrides_parish_idx ON dictionary_overrides(parish_id);
ALTER TABLE dictionary_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY dictionary_overrides_isolation ON dictionary_overrides FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);

CREATE TABLE dictionary_submissions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id              uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  headword               text NOT NULL,
  variants               text[],
  definition             text NOT NULL,
  greek_word             text,
  greek_definition       text,
  hebrew_word            text,
  hebrew_definition      text,
  first_century_context  text,
  submitted_by           uuid NOT NULL REFERENCES users(id),
  status                 text NOT NULL DEFAULT 'pending',
  created_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX dictionary_submissions_parish_idx ON dictionary_submissions(parish_id);
ALTER TABLE dictionary_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY dictionary_submissions_isolation ON dictionary_submissions FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
