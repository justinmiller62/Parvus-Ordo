import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, getDb, getMinistries } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_MONICA = "22222222-2222-2222-2222-222222222222";

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
