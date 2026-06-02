import "dotenv/config";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, enabledModules, getDb } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // different diocese

const ALL_MODULES = ["ocia", "studio", "people", "dictionary", "prayers", "onboarding"];

// parish_modules / diocese_modules are RLS-isolated per tenant, so each DELETE only clears
// the active tenant's rows. Clear both layers in both test parishes before each test (and
// after the suite) so this is the sole writer of its state on the shared integration DB.
// diocese_modules is scoped by app.diocese_id, so the HOLY_SPIRIT delete clears AJ and the
// ST_PETER delete clears Erie.
async function clearModules(): Promise<void> {
  for (const parishId of [HOLY_SPIRIT, ST_PETER]) {
    await getDb(parishId).query("DELETE FROM parish_modules");
    await getDb(parishId).query("DELETE FROM diocese_modules");
  }
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

describe("enabledModules — diocese cascade + cross-diocese isolation (RFC-001 §3.3, RFC-004 D1)", () => {
  // Insert a row for the ACTIVE parish's diocese; WITH CHECK requires diocese_id = app.diocese_id,
  // which getDb sets from the parish's diocese — so the test never hardcodes a diocese id.
  const setDioceseModule = (parishId: string, key: string, enabled: boolean) =>
    getDb(parishId).query(
      "INSERT INTO diocese_modules (diocese_id, module_key, enabled) VALUES (NULLIF(current_setting('app.diocese_id', true), '')::uuid, $1, $2)",
      [key, enabled],
    );

  it("a diocese-level disable cascades to a parish with no parish row of its own", async () => {
    await setDioceseModule(HOLY_SPIRIT, "ocia", false);
    const enabled = await enabledModules(HOLY_SPIRIT);
    expect(enabled.has("ocia")).toBe(false); // inherited from the diocese
    expect(enabled.has("studio")).toBe(true); // untouched
  });

  it("a parish row overrides its diocese row (most-specific wins)", async () => {
    await setDioceseModule(HOLY_SPIRIT, "ocia", false); // diocese says off
    await getDb(HOLY_SPIRIT).query(
      "INSERT INTO parish_modules (parish_id, module_key, enabled) VALUES ($1, 'ocia', true)",
      [HOLY_SPIRIT],
    ); // parish says on
    expect((await enabledModules(HOLY_SPIRIT)).has("ocia")).toBe(true);
  });

  it("a diocese row cannot disable a non-toggleable (always-on) module", async () => {
    await setDioceseModule(HOLY_SPIRIT, "dictionary", false);
    expect((await enabledModules(HOLY_SPIRIT)).has("dictionary")).toBe(true);
  });

  it("a diocese toggle does NOT leak across dioceses (an AJ disable is invisible to Erie)", async () => {
    await setDioceseModule(HOLY_SPIRIT, "ocia", false); // AJ diocese
    // ST_PETER is in Erie: it neither inherits AJ's disable…
    expect((await enabledModules(ST_PETER)).has("ocia")).toBe(true);
    // …nor can it read AJ's diocese_modules rows from its own (Erie) tenant context.
    const { rows } = await getDb(ST_PETER).query("SELECT module_key FROM diocese_modules");
    expect(rows).toHaveLength(0);
  });
});
