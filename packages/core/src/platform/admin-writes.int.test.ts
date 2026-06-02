import "dotenv/config";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@parvaordo/core";

const DIOCESE_AJ = "00000000-0000-0000-0000-000000000001";

// Throwaway parishes (created via the admin plane) keep these write tests off the seed parishes.
// admin_audit is RLS-locked and parishes can't be app-role-deleted, so a superuser connection
// verifies audit rows + cleans up.
let su: Client;
let superId: string;
let adminId: string; // a parish admin — explicitly NOT a super-admin
let parishA: string;
let parishB: string;

async function uid(email: string): Promise<string> {
  const { rows } = await su.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

async function createParish(slug: string): Promise<string> {
  const { rows } = await getDb(null).query<{ id: string }>("SELECT admin_create_parish($1, $2, $3, $4) AS id", [
    superId,
    "Admin-Writes Test",
    slug,
    DIOCESE_AJ,
  ]);
  return rows[0]!.id;
}

async function auditCount(parishId: string, action: string): Promise<number> {
  const { rows } = await su.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM admin_audit WHERE target_parish_id = $1 AND action = $2",
    [parishId, action],
  );
  return rows[0]!.n;
}

async function cleanup(): Promise<void> {
  await su.query("DELETE FROM admin_audit WHERE target_parish_id IN (SELECT id FROM parishes WHERE slug LIKE $1)", [
    "test-admwr-%",
  ]);
  await su.query("DELETE FROM admin_audit WHERE action = 'set_diocese_module_default' AND detail->>'diocese_id' = $1", [
    DIOCESE_AJ,
  ]);
  await su.query("DELETE FROM diocese_modules WHERE diocese_id = $1 AND module_key IN ('ocia', 'studio')", [
    DIOCESE_AJ,
  ]);
  await su.query("DELETE FROM parishes WHERE slug LIKE $1", ["test-admwr-%"]); // cascades parish_modules
}

beforeAll(async () => {
  su = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await su.connect();
  superId = await uid("super@parvaordo.test");
  adminId = await uid("admin@parvaordo.test");
  await cleanup();
  parishA = await createParish("test-admwr-a-juwe");
  parishB = await createParish("test-admwr-b-juwe");
});

afterAll(async () => {
  await cleanup();
  await su.end();
  await closeDb();
});

describe("admin write DEFINER fns — super-admin re-assert + audit-per-call (RFC-004, po-juwe)", () => {
  it("rejects a non-super-admin actor (in-function super-admin re-assert)", async () => {
    await expect(
      getDb(null).query("SELECT admin_set_module_enabled($1, $2, 'ocia', false)", [adminId, parishA]),
    ).rejects.toThrow(/super-admin/i);
  });

  it("a super-admin toggles a module and writes exactly one audit row", async () => {
    await getDb(null).query("SELECT admin_set_module_enabled($1, $2, 'ocia', false)", [superId, parishA]);
    const row = await su.query<{ enabled: boolean }>(
      "SELECT enabled FROM parish_modules WHERE parish_id = $1 AND module_key = 'ocia'",
      [parishA],
    );
    expect(row.rows[0]?.enabled).toBe(false);
    expect(await auditCount(parishA, "set_module_enabled")).toBe(1);
  });

  it("rejects toggling a non-toggleable (always-on) module", async () => {
    await expect(
      getDb(null).query("SELECT admin_set_module_enabled($1, $2, 'dictionary', false)", [superId, parishA]),
    ).rejects.toThrow(/toggleable/i);
  });

  it("set_parish_subdomain rejects a reserved slug", async () => {
    await expect(
      getDb(null).query("SELECT admin_set_parish_subdomain($1, $2, 'www')", [superId, parishA]),
    ).rejects.toThrow(/reserved/i);
  });

  it("set_parish_brand updates the brand and audits", async () => {
    await getDb(null).query("SELECT admin_set_parish_brand($1, $2, $3::jsonb)", [
      superId,
      parishA,
      JSON.stringify({ v: 1, displayName: "Test Brand" }),
    ]);
    const r = await su.query<{ brand: { displayName?: string } | null }>("SELECT brand FROM parishes WHERE id = $1", [
      parishA,
    ]);
    expect(r.rows[0]?.brand?.displayName).toBe("Test Brand");
    expect(await auditCount(parishA, "set_parish_brand")).toBe(1);
  });

  it("set_parish_custom_domains rejects a domain another parish already owns", async () => {
    await getDb(null).query("SELECT admin_set_parish_custom_domains($1, $2, $3)", [
      superId,
      parishA,
      ["dupe-juwe.example.com"],
    ]);
    await expect(
      getDb(null).query("SELECT admin_set_parish_custom_domains($1, $2, $3)", [
        superId,
        parishB,
        ["dupe-juwe.example.com"],
      ]),
    ).rejects.toThrow(/collision/i);
  });

  it("set_diocese_module_default writes the diocese row and audits (diocese-scope, null target)", async () => {
    await getDb(null).query("SELECT admin_set_diocese_module_default($1, $2, 'studio', false)", [superId, DIOCESE_AJ]);
    const r = await su.query<{ enabled: boolean }>(
      "SELECT enabled FROM diocese_modules WHERE diocese_id = $1 AND module_key = 'studio'",
      [DIOCESE_AJ],
    );
    expect(r.rows[0]?.enabled).toBe(false);
    const a = await su.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM admin_audit WHERE action = 'set_diocese_module_default' AND detail->>'diocese_id' = $1",
      [DIOCESE_AJ],
    );
    expect(a.rows[0]?.n).toBe(1);
  });

  it("the app role cannot perform the cross-tenant write directly — RLS confines it to the DEFINER fn", async () => {
    // In parishA's tenant context, a direct UPDATE of parishB's row hits RLS (id = app.parish_id),
    // so parishB is invisible and 0 rows change — the cross-tenant write is only reachable via the fn.
    await getDb(parishA).query("UPDATE parishes SET brand = '{\"v\":1}'::jsonb WHERE id = $1", [parishB]);
    const r = await su.query<{ brand: unknown }>("SELECT brand FROM parishes WHERE id = $1", [parishB]);
    expect(r.rows[0]?.brand).toBeNull();
  });
});
