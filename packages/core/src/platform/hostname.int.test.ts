import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import { closeDb, resolveParishIdForHost } from "@parvaordo/core";

// Default PARISH_BASE_DOMAIN is "localhost", so <slug>.localhost resolves by slug.
const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_MONICA = "22222222-2222-2222-2222-222222222222";

afterAll(async () => {
  await closeDb();
});

describe("resolveParishIdForHost (resolve_parish_id, integration)", () => {
  it("resolves a parish subdomain to its id by slug", async () => {
    expect(await resolveParishIdForHost("holy-spirit.localhost")).toBe(HOLY_SPIRIT);
    expect(await resolveParishIdForHost("st-monica.localhost:3000")).toBe(ST_MONICA);
  });

  it("is case-insensitive and ignores the port", async () => {
    expect(await resolveParishIdForHost("Holy-Spirit.LOCALHOST:3000")).toBe(HOLY_SPIRIT);
  });

  it("returns null for the apex (no parish)", async () => {
    expect(await resolveParishIdForHost("localhost:3000")).toBeNull();
    expect(await resolveParishIdForHost(null)).toBeNull();
  });

  it("returns null for an unknown slug / custom domain", async () => {
    expect(await resolveParishIdForHost("nope.localhost")).toBeNull();
    expect(await resolveParishIdForHost("unconfigured-parish.org")).toBeNull();
  });
});
