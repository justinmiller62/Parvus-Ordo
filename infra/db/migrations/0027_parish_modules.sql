-- 0027_parish_modules — per-parish module enablement (RFC-001 §3.2). SPARSE rows: a
-- missing (parish, module) row means "use MODULES[key].defaultEnabled" (resolved in
-- packages/shared resolveEnabled); only a NON-default choice writes a row, so there is
-- NO parish×module backfill on provision. Same RLS isolation pattern as
-- dictionary_overrides (0019) / prayer_overrides (0020).
-- (Numbered 0027: 0026 is taken on development by 0026_calendar (po-oa5n) — this is the
--  land-second renumber, per the migration-collision rule.)

CREATE TABLE parish_modules (
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  module_key  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parish_id, module_key)
);
ALTER TABLE parish_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY parish_modules_isolation ON parish_modules FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
