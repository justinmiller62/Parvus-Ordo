-- 0032_gather_t1 — Parvus Gather T1 foundation (RFC-005 po-2whw §3.1/§3.4/§4.1/§12/§13).
--
-- ONE primitive: the legacy `ministries` table is RENAMED + EXTENDED into `gather_groups`
-- (the RFC REJECTS a parallel table). Adds the group-RBAC tables (roles/members/role-log) and
-- the Requestables ticket primitive (requestables/comments/subtasks). Every new table is
-- parish-scoped, RLS-enabled with the standard isolation policy (mirrors ministry_isolation),
-- and denormalizes parish_id so RLS never needs a join (§12/§13).
--
-- Numbered 0032: dev max on this branch is 0031_admin_writes. Re-check at merge and renumber
-- above the current max if a sibling migration lands first (the migration-collision rule).
--
-- ENUM SOURCES: gather_groups.type / .visibility and gather_group_members.status are the
-- bead-locked values; gather_requestables.status is the LOCKED Requests brief state machine
-- (open -> assigned -> in_progress -> done, plus declined / cancelled). priority is left
-- unconstrained at the DB — its vocabulary is owned by the T1-a shared contract (po-a9c0),
-- exactly like gather_group_roles.permissions (a text[] validated in app code), so the two
-- never drift through a guessed CHECK.

-- ── gather_groups: rename + extend the ministries primitive ──────────────────────────────────
ALTER TABLE ministries RENAME TO gather_groups;
ALTER INDEX ministries_parish_id_idx RENAME TO gather_groups_parish_id_idx;
ALTER POLICY ministry_isolation ON gather_groups RENAME TO gather_groups_isolation;

-- kind -> type, then backfill the free-text legacy kinds into the new enum BEFORE constraining
-- it (every legacy row was a "ministry"; only deliberative councils map to committee). The
-- council->committee read is a judgment call (vs board) the Gather UI / rector can refine per
-- group; NULL/unknown/formation/liturgical all fall to the generic 'ministry'.
ALTER TABLE gather_groups RENAME COLUMN kind TO type;
UPDATE gather_groups SET type = CASE lower(coalesce(type, '')) WHEN 'council' THEN 'committee' ELSE 'ministry' END;

ALTER TABLE gather_groups
  ALTER COLUMN type SET DEFAULT 'ministry',
  ALTER COLUMN type SET NOT NULL,
  ADD CONSTRAINT gather_groups_type_chk CHECK (type IN ('committee', 'board', 'ministry', 'event_team')),
  ADD COLUMN parent_id   uuid REFERENCES gather_groups(id) ON DELETE SET NULL,
  ADD COLUMN visibility  text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'members_only', 'leaders_only')),
  ADD COLUMN profile     jsonb,
  ADD COLUMN quorum      jsonb,
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN updated_at  timestamptz NOT NULL DEFAULT now();
-- (created_at already exists from 0001; memberships.ministry_id FK follows the rename by OID.)

-- Repoint admin_get_parish_stats (RFC-004 / 0030) off the now-renamed table: its `ministry_count`
-- stat counted `FROM ministries`, which no longer exists. CREATE OR REPLACE preserves the
-- function's ACL (REVOKE FROM PUBLIC + GRANT EXECUTE TO parvaordo_app), owner, and SECURITY
-- DEFINER hardening from 0030 — only the table name changes (ministries -> gather_groups). The
-- return column keeps the name `ministry_count` so the RFC-004 consumers/tests do not churn.
CREATE OR REPLACE FUNCTION admin_get_parish_stats(p_parish_id uuid)
RETURNS TABLE (parish_id uuid, status text, member_count bigint, ministry_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.id,
    p.status,
    (SELECT count(*) FROM memberships m WHERE m.parish_id = p.id),
    (SELECT count(*) FROM gather_groups g WHERE g.parish_id = p.id)
  FROM parishes p
  WHERE p.id = p_parish_id;
$$;

-- ── gather_group_roles: named roles per group, each a bundle of group-scoped permissions ──────
CREATE TABLE gather_group_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  label         text NOT NULL,
  is_leadership boolean NOT NULL DEFAULT false,
  permissions   text[] NOT NULL DEFAULT '{}', -- GatherPermission values; validated by po-a9c0
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_group_roles_group_idx ON gather_group_roles(group_id);

-- ── gather_group_members: who belongs to a group, in which role, with acceptance + past badge ─
CREATE TABLE gather_group_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid REFERENCES gather_group_roles(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'awaiting_acceptance', 'past')),
  past_badge  text,        -- e.g. "Past President" — kept when status flips to 'past'
  badge_until timestamptz, -- optional expiry for the past badge
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);
CREATE INDEX gather_group_members_group_idx ON gather_group_members(group_id);
CREATE INDEX gather_group_members_user_idx ON gather_group_members(user_id);

-- ── gather_group_role_log: append-only role-transition audit (written by the core handoff) ────
CREATE TABLE gather_group_role_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id      uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_role_id  uuid REFERENCES gather_group_roles(id) ON DELETE SET NULL,
  to_role_id    uuid REFERENCES gather_group_roles(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_group_role_log_group_idx ON gather_group_role_log(group_id);

-- ── gather_requestables: the lightweight ticket primitive every Gather flow emits (§4.1) ──────
-- Assignee is a single user OR a group-role (whoever-can-help claims it), never both; an open
-- requestable has neither yet — so the XOR is "at most one" (num_nonnulls <= 1). KEEP LIGHTWEIGHT:
-- no SLA / custom-field / automation / approval-chain columns (locked).
CREATE TABLE gather_requestables (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id        uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id         uuid REFERENCES gather_groups(id) ON DELETE SET NULL, -- null = personal request
  requester_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assignee_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  assignee_role_id uuid REFERENCES gather_group_roles(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'assigned', 'in_progress', 'done', 'declined', 'cancelled')),
  priority         text NOT NULL DEFAULT 'normal', -- vocabulary owned by po-a9c0 (no DB CHECK)
  title            text NOT NULL,
  detail           text,
  due_on           date,
  source_type      text, -- the flow that spawned it: join_request | meeting | signup | ...
  source_id        uuid,
  recurrence       jsonb,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT gather_requestables_assignee_xor CHECK (num_nonnulls(assignee_user_id, assignee_role_id) <= 1)
);
CREATE INDEX gather_requestables_group_idx ON gather_requestables(group_id);
CREATE INDEX gather_requestables_assignee_user_idx ON gather_requestables(assignee_user_id); -- "my requests" inbox

-- ── gather_request_comments: the discussion thread on a requestable ───────────────────────────
CREATE TABLE gather_request_comments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id      uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  requestable_id uuid NOT NULL REFERENCES gather_requestables(id) ON DELETE CASCADE,
  author_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_request_comments_requestable_idx ON gather_request_comments(requestable_id);

-- ── gather_request_subtasks: the small checklist within a requestable ─────────────────────────
CREATE TABLE gather_request_subtasks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id      uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  requestable_id uuid NOT NULL REFERENCES gather_requestables(id) ON DELETE CASCADE,
  title          text NOT NULL,
  done           boolean NOT NULL DEFAULT false,
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gather_request_subtasks_requestable_idx ON gather_request_subtasks(requestable_id);

-- ── RLS: every new table denormalizes parish_id + the standard tenant-isolation policy ────────
-- (mirror ministry_isolation / parish_modules_isolation: FOR ALL, USING + WITH CHECK on
-- app.parish_id, so reads AND writes are confined to the active tenant). parvaordo_app picks up
-- SELECT/INSERT/UPDATE/DELETE via the 0001 ALTER DEFAULT PRIVILEGES, and RLS still applies to it
-- (non-owner, non-bypass).
ALTER TABLE gather_group_roles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_group_members  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_group_role_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_requestables   ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_request_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE gather_request_subtasks  ENABLE ROW LEVEL SECURITY;

CREATE POLICY gather_group_roles_isolation ON gather_group_roles FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_group_members_isolation ON gather_group_members FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_group_role_log_isolation ON gather_group_role_log FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_requestables_isolation ON gather_requestables FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_request_comments_isolation ON gather_request_comments FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
CREATE POLICY gather_request_subtasks_isolation ON gather_request_subtasks FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
