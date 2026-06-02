import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@parvaordo/core";

// RLS tenant-isolation proof for the Parvus Gather T1 tables (RFC-005 §12/§13, po-qdw6). Every
// gather_* table denormalizes parish_id + carries the standard FOR ALL isolation policy, so a
// parish can neither READ nor WRITE another parish's rows. Parish A seeds a full graph (group →
// role → member → requestable → comment → subtask); parish B must see none of it and be unable to
// write into A. A superuser connection (bypasses RLS) verifies/cleans up.

const PARISH_A = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const PARISH_B = "22222222-2222-2222-2222-222222222222"; // St. Monica
const MARK = "qdw6-rls";

let su: Client;
let userId: string;
// Parish A's row ids, populated by setupParishAGraph (empty-string until then keeps them `string`).
const a = { group: "", role: "", member: "", req: "" };

async function setupParishAGraph(): Promise<void> {
  const group = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_groups (parish_id, name, type) VALUES ($1, $2, 'committee') RETURNING id",
    [PARISH_A, `${MARK}-group`],
  );
  a.group = group.rows[0]!.id;
  const role = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_group_roles (parish_id, group_id, label, is_leadership) VALUES ($1, $2, $3, true) RETURNING id",
    [PARISH_A, a.group, `${MARK}-lead`],
  );
  a.role = role.rows[0]!.id;
  const member = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [PARISH_A, a.group, userId, a.role],
  );
  a.member = member.rows[0]!.id;
  await getDb(PARISH_A).query(
    "INSERT INTO gather_group_role_log (parish_id, group_id, user_id, to_role_id, actor_user_id) VALUES ($1, $2, $3, $4, $3)",
    [PARISH_A, a.group, userId, a.role],
  );
  const req = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_requestables (parish_id, group_id, requester_id, title) VALUES ($1, $2, $3, $4) RETURNING id",
    [PARISH_A, a.group, userId, `${MARK}-req`],
  );
  a.req = req.rows[0]!.id;
  await getDb(PARISH_A).query(
    "INSERT INTO gather_request_comments (parish_id, requestable_id, author_id, body) VALUES ($1, $2, $3, $4)",
    [PARISH_A, a.req, userId, `${MARK}-comment`],
  );
  await getDb(PARISH_A).query(
    "INSERT INTO gather_request_subtasks (parish_id, requestable_id, title) VALUES ($1, $2, $3)",
    [PARISH_A, a.req, `${MARK}-subtask`],
  );
}

async function cleanup(): Promise<void> {
  // Children first (FKs), then group; bypass RLS via the superuser connection.
  await su.query("DELETE FROM gather_request_subtasks WHERE title LIKE $1", [`${MARK}%`]);
  await su.query("DELETE FROM gather_request_comments WHERE body LIKE $1", [`${MARK}%`]);
  await su.query("DELETE FROM gather_requestables WHERE title LIKE $1", [`${MARK}%`]);
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
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  userId = (await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", ["admin@parvaordo.test"])).rows[0]!
    .id;
  await cleanup();
  await setupParishAGraph();
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("Gather T1 RLS — cross-tenant isolation (po-qdw6)", () => {
  it("parish A sees its own gather_* rows (positive control)", async () => {
    const seen = await getDb(PARISH_A).query("SELECT id FROM gather_requestables WHERE id = $1", [a.req]);
    expect(seen.rows).toHaveLength(1);
    const grp = await getDb(PARISH_A).query("SELECT id FROM gather_groups WHERE id = $1", [a.group]);
    expect(grp.rows).toHaveLength(1);
  });

  it("parish B cannot READ any of parish A's gather_* rows", async () => {
    const cases: Array<[string, string]> = [
      ["gather_groups", a.group],
      ["gather_group_roles", a.role],
      ["gather_group_members", a.member],
      ["gather_requestables", a.req],
    ];
    for (const [table, id] of cases) {
      const { rows } = await getDb(PARISH_B).query(`SELECT id FROM ${table} WHERE id = $1`, [id]);
      expect(rows, `${table} leaked to parish B`).toHaveLength(0);
    }
    // Children keyed by the (invisible) parent are likewise hidden by their own parish_id policy.
    const comments = await getDb(PARISH_B).query("SELECT id FROM gather_request_comments WHERE requestable_id = $1", [
      a.req,
    ]);
    expect(comments.rows).toHaveLength(0);
    const subtasks = await getDb(PARISH_B).query("SELECT id FROM gather_request_subtasks WHERE requestable_id = $1", [
      a.req,
    ]);
    expect(subtasks.rows).toHaveLength(0);
    const log = await getDb(PARISH_B).query("SELECT id FROM gather_group_role_log WHERE group_id = $1", [a.group]);
    expect(log.rows).toHaveLength(0);
  });

  it("parish B cannot WRITE a row tagged with parish A's id (RLS WITH CHECK)", async () => {
    await expect(
      getDb(PARISH_B).query("INSERT INTO gather_requestables (parish_id, requester_id, title) VALUES ($1, $2, $3)", [
        PARISH_A,
        userId,
        `${MARK}-sneaky`,
      ]),
    ).rejects.toThrow();
    // And it never landed.
    const check = await su.query("SELECT id FROM gather_requestables WHERE title = $1", [`${MARK}-sneaky`]);
    expect(check.rows).toHaveLength(0);
  });

  it("parish B's UPDATE/DELETE cannot touch parish A's rows (RLS USING hides them)", async () => {
    const upd = await getDb(PARISH_B).query("UPDATE gather_requestables SET title = 'hijacked' WHERE id = $1", [a.req]);
    const del = await getDb(PARISH_B).query("DELETE FROM gather_groups WHERE id = $1", [a.group]);
    // Both affect zero rows; the originals are intact (verified via the RLS-bypassing superuser).
    const still = await su.query<{ title: string }>("SELECT title FROM gather_requestables WHERE id = $1", [a.req]);
    expect(still.rows[0]?.title).toBe(`${MARK}-req`);
    const grp = await su.query("SELECT id FROM gather_groups WHERE id = $1", [a.group]);
    expect(grp.rows).toHaveLength(1);
    void upd;
    void del;
  });
});
