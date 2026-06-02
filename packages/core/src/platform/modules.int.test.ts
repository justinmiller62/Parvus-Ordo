import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, enabledModules, getDb } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // different diocese

const ALL_MODULES = ["ocia", "studio", "people", "dictionary", "prayers", "onboarding"];

// parish_modules is RLS-isolated per tenant, so each DELETE only clears its own parish's
// rows. Clear both test parishes before each test (and after the suite) so this is the
// sole writer of its state on the shared integration DB.
async function clearModules(): Promise<void> {
  await getDb(HOLY_SPIRIT).query("DELETE FROM parish_modules");
  await getDb(ST_PETER).query("DELETE FROM parish_modules");
}

beforeEach(clearModules);

afterAll(async () => {
  await clearModules();
  await closeDb();
});

describe("enabledModules — per-parish enablement + RLS isolation (RFC-001 §3.2/§3.3)", () => {
  it("a parish with no rows gets every default-enabled module (sparse-row default)", async () => {
    expect(await enabledModules(HOLY_SPIRIT)).toEqual(new Set(ALL_MODULES));
  });

  it("a disabled toggleable module is excluded; the rest stay enabled", async () => {
    await getDb(HOLY_SPIRIT).query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'ocia', false)",
      [HOLY_SPIRIT],
    );
    const enabled = await enabledModules(HOLY_SPIRIT);
    expect(enabled.has("ocia")).toBe(false);
    expect(enabled.has("studio")).toBe(true);
    expect(enabled.has("dictionary")).toBe(true);
  });

  it("a row cannot disable a non-toggleable (always-on) module", async () => {
    // Even a stray/legacy disable row for an always-on module is ignored by resolveEnabled.
    await getDb(HOLY_SPIRIT).query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'dictionary', false)",
      [HOLY_SPIRIT],
    );
    expect((await enabledModules(HOLY_SPIRIT)).has("dictionary")).toBe(true);
  });

  it("does not leak one parish's rows to another (read isolation)", async () => {
    await getDb(HOLY_SPIRIT).query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'ocia', false)",
      [HOLY_SPIRIT],
    );
    // St Peter has no row, so it cannot see Holy Spirit's disable — ocia stays enabled…
    expect((await enabledModules(ST_PETER)).has("ocia")).toBe(true);
    // …and a raw read in St Peter's tenant context sees zero rows.
    const { rows } = await getDb(ST_PETER).query("SELECT module_key FROM parish_modules");
    expect(rows).toHaveLength(0);
  });

  it("blocks writing another parish's row (RLS WITH CHECK)", async () => {
    // In Holy Spirit's tenant context, inserting a row scoped to St Peter violates the
    // WITH CHECK clause (parish_id must equal app.parish_id) → the write is rejected.
    await expect(
      getDb(HOLY_SPIRIT).query(
        "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'ocia', false)",
        [ST_PETER],
      ),
    ).rejects.toThrow();
    // St Peter's rows are untouched.
    const { rows } = await getDb(ST_PETER).query("SELECT module_key FROM parish_modules");
    expect(rows).toHaveLength(0);
  });
});
