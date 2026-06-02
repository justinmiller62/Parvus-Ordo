-- 0026_calendar — Unified Calendar: parish/diocese feast days & events + external
-- iCal feed sources (the calendar half of docs/narthex/schedule-calendar.md, deferred
-- from the cohorts keystone po-mf1). Bead po-oa5n.
--
-- THREE-TIER SCOPE (global → diocese → parish), identical to lessons/assets (0003/0021):
--   • READ cascades DOWN — a parish sees global + its-diocese + its-own rows, matched by
--     the request-scoped app.diocese_id / app.parish_id GUCs (no per-row subquery).
--   • WRITE is restricted to scope='parish' owned by the active parish; diocese/global
--     feast days are seeded/managed out of band exactly like diocese/global lessons.
-- Diocese-scoped feast days / feeds are a DELIBERATE new capability (Narthex had only
-- parish events) per the port notes — the cascade lets a diocese publish its liturgical
-- calendar once and have every parish inherit it.
--
-- Role gating (admin/catechist write) lives in the Server Actions, matching the cohorts
-- slice — RLS here enforces tenant isolation, not role (PO activity/content tables carry
-- no role predicate in-policy). "Students see only enabled sources" is enforced on the
-- read path (core listEnabledSources filters enabled=true; the admin list is reached only
-- through role-gated entry points).
--
-- Legacy fixes folded in (the doc flags both): calendar_events.observed_date is added as
-- a real column here (Narthex read/wrote it with NO migration defining it — silently
-- broken); the leaked proxy-ical service_role JWT is NOT carried over (the proxy is a
-- WorkOS-authed Next route — see apps/web/app/api/v1/calendar/ical).

-- ─── calendar_events (the "Narthex Events" source) ──────────────────────────────
CREATE TABLE calendar_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        content_scope NOT NULL DEFAULT 'parish',
  diocese_id   uuid REFERENCES dioceses(id) ON DELETE CASCADE,  -- set iff scope='diocese'
  parish_id    uuid REFERENCES parishes(id) ON DELETE CASCADE,  -- set iff scope='parish'
  title        text NOT NULL,
  event_date   date NOT NULL,                                   -- the actual calendar date
  observed_date date,                                           -- transferred-feast celebrated date (the doc's missing column)
  event_time   text,                                            -- free-text "7:00 PM"; parsed app-side; NULL ⇒ all-day
  location     text,
  event_type   text NOT NULL DEFAULT 'custom',                  -- liturgical | obligation | custom (app-enforced)
  description  text,
  recurrence   text,                                            -- only 'annual' is interpreted by the UI
  created_by   uuid REFERENCES users(id) ON DELETE SET NULL,    -- NULL for system/seeded content
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_scope_owner_chk CHECK (
    (scope = 'global'  AND diocese_id IS NULL     AND parish_id IS NULL) OR
    (scope = 'diocese' AND diocese_id IS NOT NULL AND parish_id IS NULL) OR
    (scope = 'parish'  AND parish_id  IS NOT NULL AND diocese_id IS NULL)
  )
);
CREATE INDEX calendar_events_parish_date_idx ON calendar_events(parish_id, event_date);
CREATE INDEX calendar_events_diocese_date_idx ON calendar_events(diocese_id, event_date);
CREATE INDEX calendar_events_scope_idx ON calendar_events(scope);

-- ─── calendar_sources (external iCal feeds — live-fetched, NEVER synced to the DB) ──
CREATE TABLE calendar_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         content_scope NOT NULL DEFAULT 'parish',
  diocese_id    uuid REFERENCES dioceses(id) ON DELETE CASCADE,
  parish_id     uuid REFERENCES parishes(id) ON DELETE CASCADE,
  name          text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  url           text NOT NULL CHECK (url ~* '^https://' AND char_length(url) BETWEEN 12 AND 2048),
  color         text NOT NULL DEFAULT '#3b82f6',
  enabled       boolean NOT NULL DEFAULT true,
  display_order int NOT NULL DEFAULT 0,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_sources_scope_owner_chk CHECK (
    (scope = 'global'  AND diocese_id IS NULL     AND parish_id IS NULL) OR
    (scope = 'diocese' AND diocese_id IS NOT NULL AND parish_id IS NULL) OR
    (scope = 'parish'  AND parish_id  IS NOT NULL AND diocese_id IS NULL)
  )
);
CREATE INDEX calendar_sources_parish_idx ON calendar_sources(parish_id, enabled, display_order);
CREATE INDEX calendar_sources_diocese_idx ON calendar_sources(diocese_id, enabled, display_order);

CREATE TRIGGER calendar_sources_set_updated_at
  BEFORE UPDATE ON calendar_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── RLS: three-tier read (GUC compare, no subquery), parish-scope write ─────────
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_sources ENABLE ROW LEVEL SECURITY;

-- calendar_events: read cascades; write only to the active parish's own rows.
CREATE POLICY calendar_events_read ON calendar_events FOR SELECT USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);
CREATE POLICY calendar_events_insert ON calendar_events FOR INSERT
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY calendar_events_update ON calendar_events FOR UPDATE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY calendar_events_delete ON calendar_events FOR DELETE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);

-- calendar_sources: identical posture (the enabled-filter is applied on the read path).
CREATE POLICY calendar_sources_read ON calendar_sources FOR SELECT USING (
  scope = 'global'
  OR (scope = 'diocese' AND diocese_id = NULLIF(current_setting('app.diocese_id', true), '')::uuid)
  OR (scope = 'parish'  AND parish_id  = current_setting('app.parish_id', true)::uuid)
);
CREATE POLICY calendar_sources_insert ON calendar_sources FOR INSERT
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY calendar_sources_update ON calendar_sources FOR UPDATE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY calendar_sources_delete ON calendar_sources FOR DELETE
  USING (scope = 'parish' AND parish_id = current_setting('app.parish_id', true)::uuid);
