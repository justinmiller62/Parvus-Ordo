import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantDb } from "../db/client";
import { getDb } from "../db/client";
import { getLessonItemContent, isEditableDraft } from "./lessons";

// Unit-level: stub getDb so the editability rule and the item-content read are
// exercised without a DB. These two helpers were lifted out of the web edit shim
// (which used to run raw SQL) so the rule lives in one place. RLS-level isolation
// is covered by lessons.int.test.ts.
vi.mock("../db/client", () => ({ getDb: vi.fn(), withTenant: vi.fn() }));
const mockGetDb = vi.mocked(getDb);

function dbReturning(rows: Record<string, unknown>[]): void {
  mockGetDb.mockReturnValue({ query: async () => ({ rows }) } as unknown as TenantDb);
}

beforeEach(() => {
  mockGetDb.mockReset();
});

describe("isEditableDraft", () => {
  it("is true for a parish-owned, unpublished draft of this parish", async () => {
    dbReturning([{ published_at: null, scope: "parish", parish_id: "parish-1" }]);
    expect(await isEditableDraft("parish-1", "ver-1")).toBe(true);
  });

  it("is false once the version is published", async () => {
    dbReturning([{ published_at: "2026-01-01T00:00:00Z", scope: "parish", parish_id: "parish-1" }]);
    expect(await isEditableDraft("parish-1", "ver-1")).toBe(false);
  });

  it("is false for non-parish scope (global/diocese shared content is not editable)", async () => {
    dbReturning([{ published_at: null, scope: "global", parish_id: null }]);
    expect(await isEditableDraft("parish-1", "ver-1")).toBe(false);
    dbReturning([{ published_at: null, scope: "diocese", parish_id: null }]);
    expect(await isEditableDraft("parish-1", "ver-1")).toBe(false);
  });

  it("is false for another parish's draft (defense in depth beyond RLS)", async () => {
    dbReturning([{ published_at: null, scope: "parish", parish_id: "parish-2" }]);
    expect(await isEditableDraft("parish-1", "ver-1")).toBe(false);
  });

  it("is false when the version does not exist", async () => {
    dbReturning([]);
    expect(await isEditableDraft("parish-1", "missing")).toBe(false);
  });
});

describe("getLessonItemContent", () => {
  it("returns the item's content JSON", async () => {
    const content = { asset_id: "a1", start_ms: 0, end_ms: 5000, clip_asset_id: "clip-1" };
    dbReturning([{ content }]);
    expect(await getLessonItemContent("parish-1", "item-1")).toEqual(content);
  });

  it("returns an empty object when the item does not exist (or is out of tenant scope)", async () => {
    dbReturning([]);
    expect(await getLessonItemContent("parish-1", "missing")).toEqual({});
  });
});
