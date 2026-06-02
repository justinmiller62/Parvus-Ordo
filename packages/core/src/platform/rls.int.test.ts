import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, getMinistries, withTenant } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111"; // Diocese of Altoona-Johnstown
const ST_MONICA = "22222222-2222-2222-2222-222222222222"; // Diocese of Altoona-Johnstown
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // Diocese of Erie

const DIOCESE_AJ = "00000000-0000-0000-0000-000000000001";
const DIOCESE_ERIE = "00000000-0000-0000-0000-000000000002";
const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DIOCESE_LESSON_AJ = "cccccccc-cccc-cccc-cccc-cccccccccccc";

afterAll(async () => {
  await closeDb();
});

describe("RLS tenant isolation (integration)", () => {
  it("returns no parish rows when no tenant is set", async () => {
    const { rows } = await getDb(null).query("SELECT id FROM parishes");
    expect(rows).toHaveLength(0);
  });

  it("returns exactly the active parish row", async () => {
    const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM parishes");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(HOLY_SPIRIT);
  });

  it("never leaks one parish's ministries to another", async () => {
    const holySpirit = await getMinistries(HOLY_SPIRIT);
    const stMonica = await getMinistries(ST_MONICA);
    expect(holySpirit.length).toBeGreaterThan(0);
    expect(stMonica.length).toBeGreaterThan(0);
    const stMonicaIds = new Set(stMonica.map((m) => m.id));
    expect(holySpirit.some((m) => stMonicaIds.has(m.id))).toBe(false);
  });
});

// The three-tier read policies (lessons/lesson_versions/lesson_items/assets) match
// diocese-scoped content against `app.diocese_id`, a GUC resolved once per request in
// getDb — instead of a per-row correlated subquery on parishes. These pin both the
// mechanism (the GUC is set, and only to a valid uuid) and the visibility it enforces.
describe("diocese GUC (app.diocese_id)", () => {
  async function dioceseGuc(parishId: string | null): Promise<string | null> {
    const { rows } = await getDb(parishId).query<{ d: string | null }>(
      "SELECT current_setting('app.diocese_id', true) AS d",
    );
    return rows[0]?.d ?? null;
  }

  it("getDb(parishId) resolves the active parish's diocese into app.diocese_id", async () => {
    expect(await dioceseGuc(HOLY_SPIRIT)).toBe(DIOCESE_AJ);
  });

  it("resolves per-parish — a parish in another diocese gets its own", async () => {
    expect(await dioceseGuc(ST_PETER)).toBe(DIOCESE_ERIE);
  });

  it("the GUC equals the parish's stored diocese_id (matches the legacy subquery)", async () => {
    const { rows } = await getDb(HOLY_SPIRIT).query<{ guc: string | null; stored: string | null }>(
      `SELECT current_setting('app.diocese_id', true) AS guc,
              (SELECT diocese_id::text FROM parishes WHERE id = $1) AS stored`,
      [HOLY_SPIRIT],
    );
    expect(rows[0]?.guc).toBe(rows[0]?.stored);
    expect(rows[0]?.guc).toBe(DIOCESE_AJ);
  });

  it("no tenant ⇒ app.diocese_id is not a uuid (unset/empty), so diocese rows are excluded", async () => {
    // getDb(null) must not set the GUC. On a pooled connection a prior tenant txn
    // leaves it reverted to "" (not NULL), so assert falsy rather than strictly null —
    // the policy's NULLIF(...,'')::uuid turns both NULL and "" into NULL (row excluded).
    expect(await dioceseGuc(null)).toBeFalsy();
  });

  it("diocese branch keys off app.diocese_id and tolerates an empty value (no ::uuid crash)", async () => {
    // Force the reverted-pooled-connection state (app.diocese_id = "") inside a real
    // tenant txn: the diocese read predicate must NULLIF it to NULL and return no
    // diocese rows — not throw `invalid input syntax for type uuid: ""`.
    await withTenant(HOLY_SPIRIT, async (q) => {
      await q("SELECT set_config('app.diocese_id', '', true)");
      const rows = await q<{ id: string }>("SELECT id FROM lessons WHERE scope = 'diocese'");
      expect(rows).toEqual([]);
    });
  });

  it("a parish reads its own diocese's content; a parish in another diocese cannot", async () => {
    const ajVisible = (
      await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM lessons WHERE scope = 'diocese'")
    ).rows.map((r) => r.id);
    expect(ajVisible).toContain(DIOCESE_LESSON_AJ);

    const erieVisible = (
      await getDb(ST_PETER).query<{ id: string }>("SELECT id FROM lessons WHERE scope = 'diocese'")
    ).rows.map((r) => r.id);
    expect(erieVisible).not.toContain(DIOCESE_LESSON_AJ);

    // sanity: the global lesson is visible to both regardless of diocese
    const stPeterGlobal = (
      await getDb(ST_PETER).query<{ id: string }>("SELECT id FROM lessons WHERE scope = 'global'")
    ).rows.map((r) => r.id);
    expect(stPeterGlobal).toContain(GLOBAL_LESSON);
  });
});
