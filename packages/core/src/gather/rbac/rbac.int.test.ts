import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  canAccessGroup,
  closeDb,
  getDb,
  GroupPermissionError,
  hasGroupPermission,
  requireGroupPermission,
} from "@parvaordo/core";

// Integration proof for the group-RBAC engine (RFC-005 §3.2/§3.3, §13 bypass-resistance).
// The pure decision tables are in permissions.test.ts / visibility.test.ts; THIS proves the
// DB-backed orchestration end-to-end against real RLS: module gate, staff short-circuit,
// per-group-INSTANCE isolation (a role in group A grants nothing in group B), the roles.define
// gate, self_leave, the visibility read-filter, and cross-PARISH isolation (RLS).
//
// gather is defaultEnabled:false (ships dark, po-a9c0), so the fixtures explicitly ENABLE it
// for the test parishes; one case disables it to prove the module gate denies even staff.

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // different diocese

const GROUP_A = "a0000000-0000-0000-0000-0000000000a1"; // public committee in Holy Spirit
const GROUP_B = "a0000000-0000-0000-0000-0000000000b2"; // a SECOND HS group — instance isolation
const GROUP_SECRET = "a0000000-0000-0000-0000-0000000000c3"; // leaders_only HS group — visibility
const GROUP_PETER = "a0000000-0000-0000-0000-0000000000d4"; // a group in the OTHER parish — RLS

const ROLE_LEAD_A = "b0000000-0000-0000-0000-0000000000a1"; // leadership bundle (no roles.define)
const ROLE_MEMBER_A = "b0000000-0000-0000-0000-0000000000a2"; // plain member (request.create only)
const ROLE_LEAD_SECRET = "b0000000-0000-0000-0000-0000000000c3";
const ROLE_LEAD_PETER = "b0000000-0000-0000-0000-0000000000d4";

const USER_LEADER = "c0000000-0000-0000-0000-0000000000a1"; // leader of GROUP_A (+ GROUP_SECRET, + PETER)
const USER_MEMBER = "c0000000-0000-0000-0000-0000000000a2"; // plain member of GROUP_A + GROUP_SECRET
const USER_OUTSIDER = "c0000000-0000-0000-0000-0000000000a3"; // member of NO group

// Leadership bundle deliberately omits group.roles.define (the separate grant) so the gate is testable.
const LEAD_PERMS = "{group.edit_settings,group.roster.add,meeting.draft,request.manage_board}";
const MEMBER_PERMS = "{request.create}";

const memberCtx = (userId: string, parishId = HOLY_SPIRIT) => ({ parishId, userId, role: "parish_member" as const });

async function enableGather(parishId: string, enabled = true): Promise<void> {
  await getDb(parishId).query(
    `INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'gather', $2)
       ON CONFLICT (parish_id, module_key) DO UPDATE SET enabled = EXCLUDED.enabled`,
    [parishId, enabled],
  );
}

async function cleanup(): Promise<void> {
  // Groups cascade their roles + members (FK ON DELETE CASCADE on group_id).
  for (const parishId of [HOLY_SPIRIT, ST_PETER]) {
    await getDb(parishId).query("DELETE FROM gather_groups WHERE id = ANY($1)", [
      [GROUP_A, GROUP_B, GROUP_SECRET, GROUP_PETER],
    ]);
    await getDb(parishId).query("DELETE FROM parish_modules WHERE module_key = 'gather'");
  }
  await getDb(null).query("DELETE FROM users WHERE id = ANY($1)", [[USER_LEADER, USER_MEMBER, USER_OUTSIDER]]);
}

beforeAll(async () => {
  await cleanup();
  // Global users (no RLS).
  await getDb(null).query(
    `INSERT INTO users (id, email, display_name) VALUES
       ($1, 'uk21-leader@parvaordo.test', 'Leader'),
       ($2, 'uk21-member@parvaordo.test', 'Member'),
       ($3, 'uk21-outsider@parvaordo.test', 'Outsider')`,
    [USER_LEADER, USER_MEMBER, USER_OUTSIDER],
  );

  await enableGather(HOLY_SPIRIT);
  await enableGather(ST_PETER);

  // Holy Spirit groups.
  await getDb(HOLY_SPIRIT).query(
    `INSERT INTO gather_groups (id, parish_id, name, type, visibility) VALUES
       ($1, $4, 'Committee A', 'committee', 'members_only'),
       ($2, $4, 'Committee B', 'committee', 'members_only'),
       ($3, $4, 'Leaders Council', 'board', 'leaders_only')`,
    [GROUP_A, GROUP_B, GROUP_SECRET, HOLY_SPIRIT],
  );
  await getDb(HOLY_SPIRIT).query(
    `INSERT INTO gather_group_roles (id, parish_id, group_id, label, is_leadership, permissions) VALUES
       ($1, $5, $6, 'Chair', true,  $3::text[]),
       ($2, $5, $6, 'Member', false, $4::text[]),
       ($7, $5, $8, 'Chair', true,  '{}'::text[])`,
    [ROLE_LEAD_A, ROLE_MEMBER_A, LEAD_PERMS, MEMBER_PERMS, HOLY_SPIRIT, GROUP_A, ROLE_LEAD_SECRET, GROUP_SECRET],
  );
  // USER_LEADER chairs GROUP_A and the leaders_only council; USER_MEMBER is a plain member of
  // both (role_id null in the council → active member, but not leadership). USER_LEADER is NOT
  // in GROUP_B (instance isolation).
  await getDb(HOLY_SPIRIT).query(
    `INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id, status) VALUES
       ($1, $2, $3, $4, 'active'),
       ($1, $2, $5, $6, 'active'),
       ($1, $7, $3, $8, 'active'),
       ($1, $7, $5, NULL, 'active')`,
    [HOLY_SPIRIT, GROUP_A, USER_LEADER, ROLE_LEAD_A, USER_MEMBER, ROLE_MEMBER_A, GROUP_SECRET, ROLE_LEAD_SECRET],
  );

  // The OTHER parish: USER_LEADER is even a CHAIR here, to prove cross-parish RLS still denies
  // when the caller's active parish is Holy Spirit.
  await getDb(ST_PETER).query(
    `INSERT INTO gather_groups (id, parish_id, name, type, visibility) VALUES ($1, $2, 'Peter Council', 'board', 'public')`,
    [GROUP_PETER, ST_PETER],
  );
  await getDb(ST_PETER).query(
    `INSERT INTO gather_group_roles (id, parish_id, group_id, label, is_leadership, permissions)
       VALUES ($1, $2, $3, 'Chair', true, $4::text[])`,
    [ROLE_LEAD_PETER, ST_PETER, GROUP_PETER, LEAD_PERMS],
  );
  await getDb(ST_PETER).query(
    `INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id, status)
       VALUES ($1, $2, $3, $4, 'active')`,
    [ST_PETER, GROUP_PETER, USER_LEADER, ROLE_LEAD_PETER],
  );
});

afterAll(async () => {
  await cleanup();
  await closeDb();
});

describe("requireGroupPermission — module → parish → group (RFC-005 §3.3)", () => {
  it("allows a member who holds the permission in this group's role bundle", async () => {
    await expect(requireGroupPermission(memberCtx(USER_LEADER), GROUP_A, "meeting.draft")).resolves.toBeUndefined();
  });

  it("denies an under-permissioned member, but allows what their bundle does carry", async () => {
    await expect(requireGroupPermission(memberCtx(USER_MEMBER), GROUP_A, "meeting.draft")).rejects.toThrow(
      GroupPermissionError,
    );
    await expect(requireGroupPermission(memberCtx(USER_MEMBER), GROUP_A, "request.create")).resolves.toBeUndefined();
  });

  it("parish staff short-circuit to allow ANY permission, even with no membership", async () => {
    const staffCtx = { parishId: HOLY_SPIRIT, userId: USER_OUTSIDER, role: "admin" as const };
    await expect(requireGroupPermission(staffCtx, GROUP_A, "group.roles.define")).resolves.toBeUndefined();
  });

  it("INSTANCE isolation: a chair of group A holds nothing in group B (no membership there)", async () => {
    expect(await hasGroupPermission(memberCtx(USER_LEADER), GROUP_A, "meeting.draft")).toBe(true);
    expect(await hasGroupPermission(memberCtx(USER_LEADER), GROUP_B, "meeting.draft")).toBe(false);
  });

  it("gates group.roles.define separately — a default chair does not hold it", async () => {
    await expect(requireGroupPermission(memberCtx(USER_LEADER), GROUP_A, "group.roles.define")).rejects.toThrow(
      GroupPermissionError,
    );
  });

  it("self_leave is grant-free — any active member may leave", async () => {
    await expect(requireGroupPermission(memberCtx(USER_MEMBER), GROUP_A, "group.self_leave")).resolves.toBeUndefined();
  });

  it("a disabled Gather module denies everyone — even parish staff", async () => {
    await enableGather(HOLY_SPIRIT, false);
    try {
      const staffCtx = { parishId: HOLY_SPIRIT, userId: USER_OUTSIDER, role: "admin" as const };
      expect(await hasGroupPermission(staffCtx, GROUP_A, "meeting.draft")).toBe(false);
      expect(await hasGroupPermission(memberCtx(USER_LEADER), GROUP_A, "meeting.draft")).toBe(false);
    } finally {
      await enableGather(HOLY_SPIRIT, true);
    }
  });

  it("cross-PARISH RLS: a chair in the OTHER parish is denied from the Holy Spirit tenant", async () => {
    // USER_LEADER chairs GROUP_PETER, but acting with parishId=Holy Spirit the membership is
    // invisible (RLS), so the permission is denied — group authz cannot leak across tenants.
    expect(await hasGroupPermission(memberCtx(USER_LEADER, HOLY_SPIRIT), GROUP_PETER, "meeting.draft")).toBe(false);
  });
});

describe("canAccessGroup — visibility read-filter (RFC-005 §3.1/§3.3)", () => {
  it("members_only: an active member sees it; an outsider does not", async () => {
    expect(await canAccessGroup(memberCtx(USER_MEMBER), GROUP_A)).toBe(true);
    expect(await canAccessGroup(memberCtx(USER_OUTSIDER), GROUP_A)).toBe(false);
  });

  it("leaders_only: only a leadership-role member sees it — not a plain member, not an outsider", async () => {
    expect(await canAccessGroup(memberCtx(USER_LEADER), GROUP_SECRET)).toBe(true);
    expect(await canAccessGroup(memberCtx(USER_MEMBER), GROUP_SECRET)).toBe(false);
    expect(await canAccessGroup(memberCtx(USER_OUTSIDER), GROUP_SECRET)).toBe(false);
  });

  it("parish staff see a leaders_only group with no membership", async () => {
    const staffCtx = { parishId: HOLY_SPIRIT, userId: USER_OUTSIDER, role: "admin" as const };
    expect(await canAccessGroup(staffCtx, GROUP_SECRET)).toBe(true);
  });

  it("cross-PARISH RLS: a group in the other parish is invisible (404, not 403)", async () => {
    expect(await canAccessGroup(memberCtx(USER_LEADER, HOLY_SPIRIT), GROUP_PETER)).toBe(false);
  });
});
