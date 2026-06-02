import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db/client";
import {
  PARISH_HOST_CACHE_TTL_MS,
  invalidateParishHostCache,
  resolveParishIdForHost,
  resolveParishRef,
} from "./hostname";

// Unit-level: stub getDb so no DB is touched. resolveParishIdForHost maps a request
// host → parish id via a pre-tenant-context SECURITY DEFINER lookup; the mapping is
// global routing data identical for every viewer, so it's cached process-locally.
vi.mock("../db/client", () => ({ getDb: vi.fn() }));
const mockGetDb = vi.mocked(getDb);

describe("resolveParishRef", () => {
  describe("base = parvusordo.com (prod)", () => {
    const base = "parvusordo.com";
    it("the bare base domain is the apex", () => {
      expect(resolveParishRef("parvusordo.com", base)).toEqual({ kind: "apex" });
    });
    it("www/app map to the apex, not a parish", () => {
      expect(resolveParishRef("www.parvusordo.com", base)).toEqual({ kind: "apex" });
      expect(resolveParishRef("app.parvusordo.com", base)).toEqual({ kind: "apex" });
    });
    it("a single leftmost label is the parish slug", () => {
      expect(resolveParishRef("holy-spirit.parvusordo.com", base)).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
    it("a host not under the base domain is a custom domain", () => {
      expect(resolveParishRef("holyspiritlockhaven.org", base)).toEqual({
        kind: "custom",
        domain: "holyspiritlockhaven.org",
      });
    });
    it("deeper sub-subdomains are not parish slugs (→ apex)", () => {
      expect(resolveParishRef("a.b.parvusordo.com", base)).toEqual({ kind: "apex" });
    });
  });

  describe("environment portability — same slug, every base domain", () => {
    it("resolves holy-spirit by slug in local/dev/stage/prod", () => {
      expect(resolveParishRef("holy-spirit.localhost", "localhost")).toEqual({ kind: "slug", slug: "holy-spirit" });
      expect(resolveParishRef("holy-spirit.dev.parvusordo.com", "dev.parvusordo.com")).toEqual({
        kind: "slug",
        slug: "holy-spirit",
      });
      expect(resolveParishRef("holy-spirit.stage.parvusordo.com", "stage.parvusordo.com")).toEqual({
        kind: "slug",
        slug: "holy-spirit",
      });
      expect(resolveParishRef("holy-spirit.parvusordo.com", "parvusordo.com")).toEqual({
        kind: "slug",
        slug: "holy-spirit",
      });
    });
  });

  describe("normalization", () => {
    it("strips the port", () => {
      expect(resolveParishRef("holy-spirit.localhost:3000", "localhost")).toEqual({
        kind: "slug",
        slug: "holy-spirit",
      });
    });
    it("is case-insensitive", () => {
      expect(resolveParishRef("Holy-Spirit.LOCALHOST", "localhost")).toEqual({ kind: "slug", slug: "holy-spirit" });
    });
    it("null/empty host is the apex", () => {
      expect(resolveParishRef(null, "localhost")).toEqual({ kind: "apex" });
      expect(resolveParishRef("", "localhost")).toEqual({ kind: "apex" });
    });
    it("bare localhost is the apex", () => {
      expect(resolveParishRef("localhost:3000", "localhost")).toEqual({ kind: "apex" });
    });
  });
});

describe("resolveParishIdForHost host→parishId cache", () => {
  // base domain defaults to "localhost" (PARISH_BASE_DOMAIN unset), so *.localhost
  // hosts resolve by slug. The mock maps known hosts → ids and counts every DB hit.
  let resolveCalls = 0;

  beforeEach(() => {
    resolveCalls = 0;
    invalidateParishHostCache(); // every test starts with a cold cache
    mockGetDb.mockImplementation(() => ({
      async query<T = Record<string, unknown>>(_sql: string, params?: unknown[]): Promise<{ rows: T[] }> {
        resolveCalls++;
        const [slug, domain] = (params ?? []) as (string | null)[];
        const id =
          slug === "holy-spirit"
            ? "parish-holy"
            : slug === "st-monica"
              ? "parish-monica"
              : domain === "holyspiritlockhaven.org"
                ? "parish-holy"
                : null;
        return { rows: [{ id }] as T[] };
      },
    }));
  });

  it("resolves a slug host once, then serves repeats from the cache", async () => {
    const t0 = 1_000_000;
    expect(await resolveParishIdForHost("holy-spirit.localhost", t0)).toBe("parish-holy");
    expect(await resolveParishIdForHost("holy-spirit.localhost", t0 + 1_000)).toBe("parish-holy");
    expect(resolveCalls).toBe(1); // second navigation hit the cache, not the DB
  });

  it("caches custom-domain resolutions too", async () => {
    const t0 = 1_000_000;
    expect(await resolveParishIdForHost("holyspiritlockhaven.org", t0)).toBe("parish-holy");
    expect(await resolveParishIdForHost("holyspiritlockhaven.org", t0 + 1)).toBe("parish-holy");
    expect(resolveCalls).toBe(1);
  });

  it("caches distinct hosts independently (no cross-host bleed)", async () => {
    const t0 = 1_000_000;
    expect(await resolveParishIdForHost("holy-spirit.localhost", t0)).toBe("parish-holy");
    expect(await resolveParishIdForHost("st-monica.localhost", t0)).toBe("parish-monica");
    expect(resolveCalls).toBe(2);
  });

  it("never hits the DB for the apex", async () => {
    const t0 = 1_000_000;
    expect(await resolveParishIdForHost("localhost:3000", t0)).toBeNull();
    expect(await resolveParishIdForHost(null, t0)).toBeNull();
    expect(resolveCalls).toBe(0);
  });

  it("does NOT cache an unknown host, so a newly provisioned parish resolves immediately", async () => {
    const t0 = 1_000_000;
    expect(await resolveParishIdForHost("nope.localhost", t0)).toBeNull();
    expect(await resolveParishIdForHost("nope.localhost", t0 + 1_000)).toBeNull();
    expect(resolveCalls).toBe(2); // a null is re-queried each time, never cached
  });

  it("re-resolves after the TTL elapses (backstop for un-invalidated provisioning)", async () => {
    const t0 = 1_000_000;
    await resolveParishIdForHost("holy-spirit.localhost", t0);
    await resolveParishIdForHost("holy-spirit.localhost", t0 + PARISH_HOST_CACHE_TTL_MS - 1); // still warm
    expect(resolveCalls).toBe(1);
    await resolveParishIdForHost("holy-spirit.localhost", t0 + PARISH_HOST_CACHE_TTL_MS); // expired
    expect(resolveCalls).toBe(2);
  });

  it("re-resolves after explicit invalidation (parish provisioning / re-domain path)", async () => {
    const t0 = 1_000_000;
    await resolveParishIdForHost("holy-spirit.localhost", t0);
    expect(resolveCalls).toBe(1);
    invalidateParishHostCache();
    await resolveParishIdForHost("holy-spirit.localhost", t0 + 1_000);
    expect(resolveCalls).toBe(2); // invalidation forced a fresh read
  });
});
