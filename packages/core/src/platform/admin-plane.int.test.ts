import "dotenv/config";
import { Client } from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const DIOCESE_AJ = "00000000-0000-0000-0000-000000000001";
const TEST_SLUG = "test-admin-plane-wdxi";

// admin_audit is RLS-locked + grant-revoked, and the app role cannot INSERT/DELETE parishes
// (RLS), so a superuser connection (MIGRATION_DATABASE_URL) verifies audit rows and cleans up
// the parishes this suite creates through the admin plane.
let su: Client;
let actorId: string;

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  // A real actor — admin_audit.actor_user_id FKs users (users has no RLS).
  const { rows } = await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", ["admin@parvaordo.test"]);
  actorId = rows[0]!.id;
});

async function cleanup(): Promise<void> {
  await su.query("DELETE FROM admin_audit WHERE target_parish_id IN (SELECT id FROM parishes WHERE slug LIKE $1)", [
    "test-admin-plane-%",
  ]);
  await su.query("DELETE FROM parishes WHERE slug LIKE $1", ["test-admin-plane-%"]);
}

afterEach(cleanup);

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

async function createParish(name: string, slug: string): Promise<string> {
  const { rows } = await getDb(null).query<{ id: string }>("SELECT admin_create_parish($1, $2, $3, $4) AS id", [
    actorId,
    name,
    slug,
    DIOCESE_AJ,
  ]);
  return rows[0]!.id;
}

describe("admin plane — SECURITY DEFINER provisioning + audit (RFC-004 §4.2)", () => {
  it("admin_create_parish makes a bare shell (pending_setup, no members/ministries) + audits", async () => {
    const pid = await createParish("Test Admin Parish", TEST_SLUG);

    // Read back through the admin plane (DEFINER): stats prove the bare shell.
    const stats = (
      await getDb(null).query<{ status: string; member_count: string; ministry_count: string }>(
        "SELECT status, member_count, ministry_count FROM admin_get_parish_stats($1)",
        [pid],
      )
    ).rows[0]!;
    expect(stats.status).toBe("pending_setup");
    expect(Number(stats.member_count)).toBe(0);
    expect(Number(stats.ministry_count)).toBe(0);

    // The new parish shows up in the cross-tenant listing.
    const listed = (await getDb(null).query<{ id: string }>("SELECT id FROM admin_list_parishes()")).rows.map(
      (r) => r.id,
    );
    expect(listed).toContain(pid);

    // Audited — verified via superuser (admin_audit is locked from the app plane).
    const audit = await su.query<{ actor_user_id: string }>(
      "SELECT actor_user_id FROM admin_audit WHERE target_parish_id = $1 AND action = 'create_parish'",
      [pid],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.actor_user_id).toBe(actorId);
  });

  it("rejects a duplicate slug (parishes.slug UNIQUE)", async () => {
    await createParish("First", TEST_SLUG);
    await expect(createParish("Duplicate", TEST_SLUG)).rejects.toThrow();
  });

  it("rejects a reserved slug", async () => {
    await expect(createParish("Reserved", "www")).rejects.toThrow(/reserved/i);
  });

  it("rejects a malformed slug shape", async () => {
    await expect(createParish("Bad", "Test Admin Plane")).rejects.toThrow(/slug/i);
  });

  it("blocks a direct parish INSERT from the app role — creation requires elevation", async () => {
    // parishes RLS USING(id = app.parish_id) → the WITH CHECK rejects a new (random-id) row.
    await expect(
      getDb(HOLY_SPIRIT).query("INSERT INTO parishes (name, slug, status) VALUES ($1, $2, 'active')", [
        "Sneaky",
        "test-admin-plane-sneaky",
      ]),
    ).rejects.toThrow();
  });

  it("admin_set_status updates the lifecycle + audits the change", async () => {
    const pid = await createParish("Lifecycle", TEST_SLUG);
    await getDb(null).query("SELECT admin_set_status($1, $2, $3)", [actorId, pid, "suspended"]);

    const status = (await getDb(null).query<{ status: string }>("SELECT status FROM admin_get_parish_stats($1)", [pid]))
      .rows[0]?.status;
    expect(status).toBe("suspended");

    const audit = await su.query("SELECT 1 FROM admin_audit WHERE target_parish_id = $1 AND action = 'set_status'", [
      pid,
    ]);
    expect(audit.rowCount).toBe(1);
  });

  it("the audit log is locked from the app/tenant plane (RLS + revoked grant)", async () => {
    await createParish("Locked", TEST_SLUG);
    // REVOKE ALL stripped the inherited grant → the app role cannot even read admin_audit.
    await expect(getDb(null).query("SELECT * FROM admin_audit")).rejects.toThrow();
  });
});
