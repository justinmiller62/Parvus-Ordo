import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@parvaordo/core";

// RLS tenant-isolation proof for the Gather T2 Application-slice tables (RFC-005 §5/§10/§12,
// po-gatr): gather_join_requests, gather_form_definitions, gather_form_submissions. Each
// denormalizes parish_id (NOT NULL) + carries the standard FOR ALL isolation policy, so a parish
// can neither READ nor WRITE another parish's rows. Parish A seeds one of each (a join request, a
// published application form, a submission); parish B must see none and be unable to write into A.
// A superuser connection (bypasses RLS) seeds/verifies/cleans up. Pairs with gather-rls.int.test.ts
// (the T1 tables, po-qdw6).

const PARISH_A = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const PARISH_B = "22222222-2222-2222-2222-222222222222"; // St. Monica
const MARK = "pogatr-t2";

let su: Client;
let userId: string;
const a = { group: "", join: "", form: "", submission: "" };

async function setupParishA(): Promise<void> {
  const g = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_groups (parish_id, name, type) VALUES ($1, $2, 'committee') RETURNING id",
    [PARISH_A, `${MARK}-group`],
  );
  a.group = g.rows[0]!.id;
  const j = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_join_requests (parish_id, group_id, user_id, message) VALUES ($1, $2, $3, $4) RETURNING id",
    [PARISH_A, a.group, userId, `${MARK}-please-let-me-in`],
  );
  a.join = j.rows[0]!.id;
  const f = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_form_definitions (parish_id, group_id, type, status) VALUES ($1, $2, 'application', 'published') RETURNING id",
    [PARISH_A, a.group],
  );
  a.form = f.rows[0]!.id;
  const s = await getDb(PARISH_A).query<{ id: string }>(
    "INSERT INTO gather_form_submissions (parish_id, form_id, submitter_id, answers) VALUES ($1, $2, $3, $4::jsonb) RETURNING id",
    [PARISH_A, a.form, userId, JSON.stringify({ why: "called to serve" })],
  );
  a.submission = s.rows[0]!.id;
}

async function cleanup(): Promise<void> {
  const inMarkGroup = "group_id IN (SELECT id FROM gather_groups WHERE name LIKE $1)";
  await su.query(
    `DELETE FROM gather_form_submissions WHERE form_id IN (SELECT id FROM gather_form_definitions WHERE ${inMarkGroup})`,
    [`${MARK}%`],
  );
  await su.query(`DELETE FROM gather_form_definitions WHERE ${inMarkGroup}`, [`${MARK}%`]);
  await su.query(`DELETE FROM gather_join_requests WHERE ${inMarkGroup}`, [`${MARK}%`]);
  // any parish-level (null-group) forms a WITH-CHECK probe might have slipped in (it must not)
  await su.query(
    "DELETE FROM gather_form_definitions WHERE group_id IS NULL AND parish_id = $1 AND type = 'application' AND status = 'draft'",
    [PARISH_A],
  );
  await su.query("DELETE FROM gather_groups WHERE name LIKE $1", [`${MARK}%`]);
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  userId = (await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", ["admin@parvaordo.test"])).rows[0]!
    .id;
  await cleanup();
  await setupParishA();
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("Gather T2 RLS — cross-tenant isolation (po-gatr)", () => {
  const tables: Array<[string, () => string]> = [
    ["gather_join_requests", () => a.join],
    ["gather_form_definitions", () => a.form],
    ["gather_form_submissions", () => a.submission],
  ];

  it("parish A sees its own T2 rows (positive control)", async () => {
    for (const [table, id] of tables) {
      const { rows } = await getDb(PARISH_A).query(`SELECT id FROM ${table} WHERE id = $1`, [id()]);
      expect(rows, table).toHaveLength(1);
    }
  });

  it("parish B cannot READ any of parish A's T2 rows", async () => {
    for (const [table, id] of tables) {
      const { rows } = await getDb(PARISH_B).query(`SELECT id FROM ${table} WHERE id = $1`, [id()]);
      expect(rows, `${table} leaked to parish B`).toHaveLength(0);
    }
  });

  it("parish B cannot WRITE a row tagged with parish A's id (RLS WITH CHECK)", async () => {
    await expect(
      getDb(PARISH_B).query("INSERT INTO gather_form_definitions (parish_id, type) VALUES ($1, 'application')", [
        PARISH_A,
      ]),
    ).rejects.toThrow();
    // and nothing landed (a null-group parish-A draft would be the sneaky row)
    const check = await su.query(
      "SELECT id FROM gather_form_definitions WHERE group_id IS NULL AND parish_id = $1 AND status = 'draft'",
      [PARISH_A],
    );
    expect(check.rows).toHaveLength(0);
  });

  it("parish B's UPDATE/DELETE cannot touch parish A's rows (RLS USING hides them)", async () => {
    await getDb(PARISH_B).query("UPDATE gather_form_submissions SET status = 'approved' WHERE id = $1", [a.submission]);
    await getDb(PARISH_B).query("DELETE FROM gather_join_requests WHERE id = $1", [a.join]);
    // verified via the RLS-bypassing superuser: the originals are intact
    const sub = await su.query<{ status: string }>("SELECT status FROM gather_form_submissions WHERE id = $1", [
      a.submission,
    ]);
    expect(sub.rows[0]?.status).toBe("submitted");
    const jr = await su.query("SELECT id FROM gather_join_requests WHERE id = $1", [a.join]);
    expect(jr.rows).toHaveLength(1);
  });
});
