import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";

afterAll(async () => {
  await closeDb();
});

// RFC-002 §2A (po-4a29): tenant isolation rides on a transaction-local GUC —
// set_config('app.parish_id', …, true) (= SET LOCAL) inside an explicit BEGIN/COMMIT. Under a
// transaction-mode pooler (Neon -pooler / PgBouncer) the same Postgres backend is handed to
// different tenants across checkouts, so that GUC MUST NOT survive its transaction or it would
// leak across requests (RFC §4). These assert the invariant directly; run the suite against the
// -pooler endpoint in CI/staging to prove it holds under real PgBouncer multiplexing.
describe("getDb tenant GUC isolation (RFC-002 §2A)", () => {
  it("scopes the tenant GUC inside a tenant-scoped read", async () => {
    const { rows } = await getDb(HOLY_SPIRIT).query<{ pid: string | null }>(
      "SELECT current_setting('app.parish_id', true) AS pid",
    );
    expect(rows[0]?.pid).toBe(HOLY_SPIRIT);
  });

  it("clears the transaction-local GUC at COMMIT — a later context-less read sees no leak", async () => {
    // A tenant-scoped read sets app.parish_id transaction-locally…
    await getDb(HOLY_SPIRIT).query("SELECT 1");
    // …then a context-less read on a (possibly reused) pooled connection must observe none.
    const { rows } = await getDb(null).query<{ pid: string | null }>(
      "SELECT current_setting('app.parish_id', true) AS pid",
    );
    const leaked = rows[0]?.pid;
    expect(leaked === null || leaked === "").toBe(true);
  });
});
