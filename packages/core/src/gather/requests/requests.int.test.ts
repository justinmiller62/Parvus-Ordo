import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addRequestSubtask,
  closeDb,
  createRequestable,
  getDb,
  getRequestable,
  listGroupBoard,
  listGroupLeaderOverview,
  listMyRequests,
  listRequestComments,
  listRequestSubtasks,
  setRequestSubtaskDone,
  transitionRequestable,
} from "@parvaordo/core";

// Integration coverage for the Requests pillar (RFC-005 §4, po-jx7z) against the RLS database.
// Proves: createRequestable emission, transition data-changes + intrinsic authz, the done
// thank-you + SYNCHRONOUS recurrence regen, the three read surfaces, comments/subtasks, and that
// parish A never sees parish B requestables. A superuser builds the group graph + cleans up.

const PARISH_A = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const PARISH_B = "22222222-2222-2222-2222-222222222222"; // St. Monica
const MARK = "jx7z";

let su: Client;
// Test user ids (empty until beforeAll populates them — keeps each a `string`, not string|undefined).
const u = { req: "", helper: "", leader: "", other: "", staff: "" };
const g = { group: "", groupB: "", leaderRole: "", memberRole: "" };

async function mkUser(key: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
    [`${MARK}-${key}@parvaordo.test`, `${MARK} ${key}`],
  );
  return rows[0]!.id;
}

async function cleanup(): Promise<void> {
  await su.query("DELETE FROM gather_requestables WHERE title LIKE $1", [`${MARK}%`]); // cascades comments/subtasks
  await su.query("DELETE FROM gather_groups WHERE name LIKE $1", [`${MARK}%`]); // cascades roles/members
  await su.query("DELETE FROM users WHERE email LIKE $1", [`${MARK}-%@parvaordo.test`]);
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  await cleanup();
  u.req = await mkUser("req"); // requester (no parish membership → NOT staff)
  u.helper = await mkUser("helper"); // a group member, pool-eligible
  u.leader = await mkUser("leader"); // holds request.assign / manage_board
  u.other = await mkUser("other"); // unrelated non-staff
  const { rows: staffRows } = await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [
    "admin@parvaordo.test",
  ]);
  u.staff = staffRows[0]!.id; // a Holy Spirit admin → staff

  const grp = await su.query<{ id: string }>(
    "INSERT INTO gather_groups (parish_id, name, type) VALUES ($1, $2, 'committee') RETURNING id",
    [PARISH_A, `${MARK}-group`],
  );
  g.group = grp.rows[0]!.id;
  const grpB = await su.query<{ id: string }>(
    "INSERT INTO gather_groups (parish_id, name, type) VALUES ($1, $2, 'committee') RETURNING id",
    [PARISH_B, `${MARK}-groupB`],
  );
  g.groupB = grpB.rows[0]!.id;
  const lead = await su.query<{ id: string }>(
    "INSERT INTO gather_group_roles (parish_id, group_id, label, is_leadership, permissions) VALUES ($1, $2, 'Chair', true, $3) RETURNING id",
    [PARISH_A, g.group, ["request.assign", "request.manage_board", "request.create"]],
  );
  g.leaderRole = lead.rows[0]!.id;
  const mem = await su.query<{ id: string }>(
    "INSERT INTO gather_group_roles (parish_id, group_id, label, is_leadership, permissions) VALUES ($1, $2, 'Member', false, $3) RETURNING id",
    [PARISH_A, g.group, ["request.create"]],
  );
  g.memberRole = mem.rows[0]!.id;
  await su.query(
    "INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id) VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)",
    [PARISH_A, g.group, u.leader, g.leaderRole, u.helper, g.memberRole],
  );
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("Requests pillar — createRequestable (the emission spine)", () => {
  it("a direct person-assignment starts 'assigned'; a pool offer / unassigned start 'open'", async () => {
    const direct = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} direct`,
    });
    expect((await getRequestable(PARISH_A, direct))!.status).toBe("assigned");

    const pool = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeRoleId: g.memberRole,
      title: `${MARK} pool`,
    });
    expect((await getRequestable(PARISH_A, pool))!.status).toBe("open");
  });

  it("rejects a request assigned to both a person and a role", async () => {
    await expect(
      createRequestable(PARISH_A, {
        requesterId: u.req,
        assigneeUserId: u.helper,
        assigneeRoleId: g.memberRole,
        title: `${MARK} both`,
      }),
    ).rejects.toThrow();
  });
});

describe("Requests pillar — transitions (intrinsic authz + data changes)", () => {
  it("a pool-eligible member claims an open offer → assigned to them, role offer consumed", async () => {
    const id = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeRoleId: g.memberRole,
      title: `${MARK} claimable`,
    });
    expect(await transitionRequestable(PARISH_A, id, u.helper, "claim")).toBe("assigned");
    const r = (await getRequestable(PARISH_A, id))!;
    expect(r.assigneeUserId).toBe(u.helper);
    expect(r.assigneeRoleId).toBeNull(); // XOR: offer consumed
  });

  it("an unrelated non-staff member cannot claim a pool offer they are not eligible for", async () => {
    const id = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeRoleId: g.leaderRole, // offered to the LEADER pool; u.helper is a member
      title: `${MARK} leaderpool`,
    });
    expect(await transitionRequestable(PARISH_A, id, u.helper, "claim")).toBeNull();
  });

  it("only the assignee (or staff) may start/finish; done sets completed_at + an in-app thank-you", async () => {
    const id = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} dolifecycle`,
    });
    expect(await transitionRequestable(PARISH_A, id, u.other, "start")).toBeNull(); // not the assignee
    expect(await transitionRequestable(PARISH_A, id, u.helper, "start")).toBe("in_progress");
    expect(await transitionRequestable(PARISH_A, id, u.helper, "done")).toBe("done");
    const r = (await getRequestable(PARISH_A, id))!;
    expect(r.completedAt).not.toBeNull();
    const comments = await listRequestComments(PARISH_A, id);
    expect(comments.some((c) => c.authorId === u.helper && /thank you/i.test(c.body))).toBe(true);
  });

  it("cancel is requester-only (a non-requester non-staff is refused); hand_back re-opens", async () => {
    const id = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} cancelhb`,
    });
    expect(await transitionRequestable(PARISH_A, id, u.helper, "cancel")).toBeNull(); // assignee != requester
    expect(await transitionRequestable(PARISH_A, id, u.helper, "hand_back")).toBe("open");
    expect((await getRequestable(PARISH_A, id))!.assigneeUserId).toBeNull();
    expect(await transitionRequestable(PARISH_A, id, u.req, "cancel")).toBe("cancelled"); // requester may
  });

  it("a board leader (request.assign) may assign an open ask to a person; staff act on-behalf", async () => {
    const id = await createRequestable(PARISH_A, { groupId: g.group, requesterId: u.req, title: `${MARK} assignable` });
    expect(await transitionRequestable(PARISH_A, id, u.leader, "assign", { assigneeUserId: u.helper })).toBe(
      "assigned",
    );
    expect((await getRequestable(PARISH_A, id))!.assigneeUserId).toBe(u.helper);
    // staff (admin@) may finish on the helper's behalf (older-volunteer rule).
    expect(await transitionRequestable(PARISH_A, id, u.staff, "done")).toBe("done");
  });
});

describe("Requests pillar — recurrence regenerates synchronously on done", () => {
  it("a recurring ask spawns the next open occurrence with the advanced due date, no worker", async () => {
    const id = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} weekly-flowers`,
      dueOn: "2026-03-01",
      recurrence: { every: 1, unit: "week" },
    });
    await transitionRequestable(PARISH_A, id, u.helper, "done");
    const next = await getDb(PARISH_A).query<{ due_on: string; status: string }>(
      "SELECT due_on::text, status FROM gather_requestables WHERE title = $1 AND id <> $2",
      [`${MARK} weekly-flowers`, id],
    );
    expect(next.rows).toHaveLength(1);
    expect(next.rows[0]!.status).toBe("open");
    expect(next.rows[0]!.due_on).toBe("2026-03-08"); // +1 week
  });
});

describe("Requests pillar — read surfaces (§4.3) + tenant isolation", () => {
  it("the personal inbox spans groups: own asks, assigned, and pool offers to my role", async () => {
    await createRequestable(PARISH_A, { groupId: g.group, requesterId: u.helper, title: `${MARK} myown` });
    await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} mineassigned`,
    });
    await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeRoleId: g.memberRole,
      title: `${MARK} myrolepool`,
    });
    const titles = (await listMyRequests(PARISH_A, u.helper)).map((r) => r.title);
    expect(titles).toEqual(expect.arrayContaining([`${MARK} myown`, `${MARK} mineassigned`, `${MARK} myrolepool`]));
  });

  it("the group board returns live requests; the leader overview groups + surfaces past-due", async () => {
    const board = await listGroupBoard(PARISH_A, g.group);
    expect(board.length).toBeGreaterThan(0);
    expect(board.every((r) => r.groupId === g.group)).toBe(true);
    expect(board.every((r) => ["open", "assigned", "in_progress"].includes(r.status))).toBe(true);

    await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.req,
      assigneeUserId: u.helper,
      title: `${MARK} pastdue`,
      dueOn: "2000-01-01",
    });
    const overview = await listGroupLeaderOverview(PARISH_A, g.group);
    expect(overview.some((r) => r.pastDue > 0)).toBe(true);
  });

  it("a parish never sees another parish's requestables (board + personal + direct read)", async () => {
    const aReq = await createRequestable(PARISH_A, {
      groupId: g.group,
      requesterId: u.helper,
      title: `${MARK} secretA`,
    });
    // The board for parish A's group, queried in parish B's context, returns nothing.
    expect(await listGroupBoard(PARISH_B, g.group)).toHaveLength(0);
    // u.helper's personal inbox in parish B's context never surfaces the parish A ask.
    expect((await listMyRequests(PARISH_B, u.helper)).some((r) => r.id === aReq)).toBe(false);
    // A direct read of parish A's row from parish B is null (RLS).
    expect(await getRequestable(PARISH_B, aReq)).toBeNull();
  });
});

describe("Requests pillar — comments + subtasks", () => {
  it("subtasks: add, list ordered, toggle done", async () => {
    const id = await createRequestable(PARISH_A, { groupId: g.group, requesterId: u.req, title: `${MARK} withsubs` });
    const s1 = (await addRequestSubtask(PARISH_A, id, "bring chairs"))!;
    await addRequestSubtask(PARISH_A, id, "set up tables");
    let subs = await listRequestSubtasks(PARISH_A, id);
    expect(subs.map((s) => s.title)).toEqual(["bring chairs", "set up tables"]); // position order
    await setRequestSubtaskDone(PARISH_A, s1, true);
    subs = await listRequestSubtasks(PARISH_A, id);
    expect(subs.find((s) => s.id === s1)!.done).toBe(true);
  });
});
