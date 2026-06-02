import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addGroupMember,
  archiveGroup,
  closeDb,
  createGroup,
  createGroupRole,
  getGroup,
  listGroupRoles,
  listVisibleGroups,
  transferGroupRole,
} from "@parvaordo/core";

// Functional integration for the Gather Groups primitive (RFC-005 §3.1/§3.3, po-05xo) against a
// real DB: create seeds the type's default roles; the acceptance flow create → define role → add
// member → handoff sets the Past badge + badge_until and appends the role-transition log; and the
// visibility read-filter hides members_only/leaders_only groups from an outsider. A superuser
// connection (bypasses RLS) creates the test users + verifies/cleans up. Cross-tenant RLS
// isolation for these tables is proven separately by gather-rls.int.test.ts (po-qdw6).

const PARISH_A = "11111111-1111-1111-1111-111111111111";
const MARK = "po05xo-groups";

let su: Client;
let leader = "";
let successor = "";
let outsider = "";

async function ensureUser(email: string, name: string): Promise<string> {
  const r = await su.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
    [email, name],
  );
  return r.rows[0]!.id;
}

async function cleanup(): Promise<void> {
  await su.query(
    "DELETE FROM gather_group_role_log WHERE group_id IN (SELECT id FROM gather_groups WHERE name LIKE $1)",
    [`${MARK}%`],
  );
  await su.query(
    "DELETE FROM gather_group_members WHERE group_id IN (SELECT id FROM gather_groups WHERE name LIKE $1)",
    [`${MARK}%`],
  );
  await su.query("DELETE FROM gather_group_roles WHERE group_id IN (SELECT id FROM gather_groups WHERE name LIKE $1)", [
    `${MARK}%`,
  ]);
  await su.query("DELETE FROM gather_groups WHERE name LIKE $1", [`${MARK}%`]);
  await su.query("DELETE FROM users WHERE email LIKE $1", [`${MARK}%`]);
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  await cleanup();
  leader = await ensureUser(`${MARK}-leader@test`, "Gather Leader");
  successor = await ensureUser(`${MARK}-successor@test`, "Gather Successor");
  outsider = await ensureUser(`${MARK}-outsider@test`, "Gather Outsider");
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("Gather Groups core — CRUD + roster + handoff + visibility (po-05xo)", () => {
  it("create seeds the type's default roles; archive preserves the row (no hard delete)", async () => {
    const g = await createGroup(PARISH_A, { name: `${MARK}-committee`, type: "committee" });
    expect(g.type).toBe("committee");
    expect(g.visibility).toBe("public"); // default
    expect(g.archivedAt).toBeNull();

    const roles = await listGroupRoles(PARISH_A, g.id);
    const labels = roles.map((r) => r.label);
    expect(labels).toContain("Chair"); // committee leadership default (DEFAULT_GROUP_ROLES)
    expect(labels).toContain("Member");
    const chair = roles.find((r) => r.label === "Chair")!;
    expect(chair.isLeadership).toBe(true);
    expect(chair.permissions).toContain("group.edit_settings"); // a leadership-bundle permission
    const member = roles.find((r) => r.label === "Member")!;
    expect(member.isLeadership).toBe(false);
    expect(member.permissions).toEqual(["request.create"]); // the member bundle

    await archiveGroup(PARISH_A, g.id);
    const after = await getGroup(PARISH_A, g.id);
    expect(after).not.toBeNull(); // preserved, not deleted
    expect(after!.archivedAt).not.toBeNull();
  });

  it("create → define role → add member (seating logged) → handoff (past badge + badge_until + log)", async () => {
    const g = await createGroup(PARISH_A, { name: `${MARK}-ministry`, type: "ministry" });
    const role = await createGroupRole(PARISH_A, g.id, {
      label: `${MARK}-Coordinator`,
      isLeadership: true,
      permissions: ["group.edit_settings", "group.roster.add", "group.roster.transfer_role"],
    });
    expect(role.isLeadership).toBe(true);

    const seated = await addGroupMember(PARISH_A, g.id, leader, { roleId: role.id, actorUserId: leader });
    expect(seated.roleId).toBe(role.id);
    expect(seated.status).toBe("active");

    // seating a member into a role logs the transition (null → role)
    const seatLog = await su.query(
      "SELECT id FROM gather_group_role_log WHERE group_id = $1 AND user_id = $2 AND to_role_id = $3 AND from_role_id IS NULL",
      [g.id, leader, role.id],
    );
    expect(seatLog.rows).toHaveLength(1);

    // HAND OFF the role from leader → successor
    await transferGroupRole(
      PARISH_A,
      { groupId: g.id, roleId: role.id, outgoingUserId: leader, successorUserId: successor },
      leader,
    );

    const out = await su.query<{
      status: string;
      past_badge: string | null;
      badge_until: Date | null;
      role_id: string | null;
    }>(
      "SELECT status, past_badge, badge_until, role_id FROM gather_group_members WHERE group_id = $1 AND user_id = $2",
      [g.id, leader],
    );
    expect(out.rows[0]!.status).toBe("past");
    expect(out.rows[0]!.past_badge).toBe(`Past ${MARK}-Coordinator`);
    expect(out.rows[0]!.badge_until).not.toBeNull(); // time-boxed
    expect(out.rows[0]!.role_id).toBeNull(); // relinquished

    const succ = await su.query<{ status: string; role_id: string | null }>(
      "SELECT status, role_id FROM gather_group_members WHERE group_id = $1 AND user_id = $2",
      [g.id, successor],
    );
    expect(succ.rows[0]!.status).toBe("active");
    expect(succ.rows[0]!.role_id).toBe(role.id);

    // both transitions logged: outgoing (role → null) + successor (→ role)
    const outLog = await su.query(
      "SELECT id FROM gather_group_role_log WHERE group_id = $1 AND user_id = $2 AND from_role_id = $3 AND to_role_id IS NULL",
      [g.id, leader, role.id],
    );
    expect(outLog.rows).toHaveLength(1);
    const succLog = await su.query(
      "SELECT id FROM gather_group_role_log WHERE group_id = $1 AND user_id = $2 AND to_role_id = $3",
      [g.id, successor, role.id],
    );
    expect(succLog.rows).toHaveLength(1);
  });

  it("rejects an unknown permission when defining a role (validated against the contract union)", async () => {
    const g = await createGroup(PARISH_A, { name: `${MARK}-board`, type: "board" });
    await expect(
      createGroupRole(PARISH_A, g.id, {
        label: `${MARK}-bad`,
        permissions: ["totally.not.a.permission"] as unknown as never[],
      }),
    ).rejects.toThrow();
  });

  it("listVisibleGroups applies visibility: outsider sees only public; a member/leader sees more", async () => {
    const pub = await createGroup(PARISH_A, { name: `${MARK}-vis-public`, type: "ministry", visibility: "public" });
    const mem = await createGroup(PARISH_A, {
      name: `${MARK}-vis-members`,
      type: "ministry",
      visibility: "members_only",
    });
    const led = await createGroup(PARISH_A, {
      name: `${MARK}-vis-leaders`,
      type: "ministry",
      visibility: "leaders_only",
    });

    const seenBy = async (userId: string): Promise<Set<string>> =>
      new Set(
        (await listVisibleGroups(PARISH_A, userId)).filter((g) => g.name.startsWith(`${MARK}-vis-`)).map((g) => g.id),
      );

    const outsiderSees = await seenBy(outsider);
    expect(outsiderSees.has(pub.id)).toBe(true);
    expect(outsiderSees.has(mem.id)).toBe(false);
    expect(outsiderSees.has(led.id)).toBe(false);

    // successor: a plain member of the members_only group, a leader of the leaders_only group
    const memberRole = (await listGroupRoles(PARISH_A, mem.id)).find((r) => !r.isLeadership)!;
    await addGroupMember(PARISH_A, mem.id, successor, { roleId: memberRole.id });
    const leadRole = (await listGroupRoles(PARISH_A, led.id)).find((r) => r.isLeadership)!;
    await addGroupMember(PARISH_A, led.id, successor, { roleId: leadRole.id });

    const succSees = await seenBy(successor);
    expect(succSees.has(pub.id)).toBe(true); // public — everyone
    expect(succSees.has(mem.id)).toBe(true); // a member sees members_only
    expect(succSees.has(led.id)).toBe(true); // a leader sees leaders_only
  });
});
