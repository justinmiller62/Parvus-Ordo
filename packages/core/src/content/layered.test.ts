import { describe, expect, it, vi } from "vitest";
import { getDb } from "../db/client";
import { deleteParishSubmission, mergeLayered, upsertParishOverride } from "./layered";

// Unit-level: mergeLayered is pure (no DB). The two SQL builders are exercised with a
// stubbed getDb that just records (sql, params), so we can pin the exact statement they
// emit — the override upsert and the tenant-scoped submission delete shared by the
// dictionary and prayers modules (po-5bp).
vi.mock("../db/client", () => ({ getDb: vi.fn() }));
const mockGetDb = vi.mocked(getDb);

function recordQueries(): { sql: string; params: unknown[] }[] {
  const calls: { sql: string; params: unknown[] }[] = [];
  mockGetDb.mockReturnValue({
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<{ rows: T[] }> {
      calls.push({ sql, params });
      return { rows: [] as T[] };
    },
  });
  return calls;
}

const flat = (sql: string): string => sql.replace(/\s+/g, " ").trim();

// A minimal three-layer shape standing in for dictionary/prayers: a universal row with a
// base value an override can replace, and a submission that contributes a local value.
interface U {
  id: string;
  name: string;
  base: string;
}
interface O {
  entry_id: string;
  over: string | null;
}
interface S {
  id: string;
  name: string;
  local: string;
}
interface Item {
  id: string;
  name: string;
  value: string;
  isLocal: boolean;
}

const merge = (universal: U[], overrides: O[], submissions: S[]): Item[] =>
  mergeLayered<U, O, S, Item>({
    universal,
    overrides,
    submissions,
    overrideEntryId: (o) => o.entry_id,
    universalEntryId: (u) => u.id,
    fromUniversal: (u, o) => ({ id: u.id, name: u.name, value: o?.over ?? u.base, isLocal: false }),
    fromSubmission: (s) => ({ id: s.id, name: s.name, value: s.local, isLocal: true }),
    dedupeKey: (it) => it.name.toLowerCase(),
    sortKey: (it) => it.name,
  });

describe("mergeLayered three-layer merge (po-5bp)", () => {
  it("applies a matching override on top of the universal item", () => {
    const out = merge([{ id: "u1", name: "Alpha", base: "base" }], [{ entry_id: "u1", over: "overridden" }], []);
    expect(out).toEqual([{ id: "u1", name: "Alpha", value: "overridden", isLocal: false }]);
  });

  it("leaves a universal item untouched when it has no override", () => {
    const out = merge([{ id: "u1", name: "Alpha", base: "base" }], [], []);
    expect(out[0]!.value).toBe("base");
  });

  it("adds a submission only when no universal entry shares its key (universal wins)", () => {
    const out = merge(
      [{ id: "u1", name: "Alpha", base: "base" }],
      [],
      [
        { id: "s1", name: "alpha", local: "dup" }, // case-insensitive collision with universal -> dropped
        { id: "s2", name: "Beta", local: "kept" }, // unique -> kept as a local item
      ],
    );
    expect(out.map((i) => i.name)).toEqual(["Alpha", "Beta"]);
    expect(out.find((i) => i.name === "Beta")!.isLocal).toBe(true);
    expect(out.find((i) => i.name === "Alpha")!.value).toBe("base"); // the colliding submission did not overwrite
  });

  it("sorts the merged set by sortKey", () => {
    const out = merge(
      [
        { id: "u2", name: "Zebra", base: "z" },
        { id: "u1", name: "Apple", base: "a" },
      ],
      [],
      [{ id: "s1", name: "Mango", local: "m" }],
    );
    expect(out.map((i) => i.name)).toEqual(["Apple", "Mango", "Zebra"]);
  });
});

describe("upsertParishOverride builds a tenant-keyed upsert (po-5bp)", () => {
  it("emits INSERT ... ON CONFLICT (parish_id, entry_id) DO UPDATE over the given columns, values parameterized", async () => {
    const calls = recordQueries();
    await upsertParishOverride("parish-x", "dictionary_overrides", "e1", {
      override_definition: "d",
      override_notes: null,
    });
    expect(calls).toHaveLength(1);
    expect(flat(calls[0]!.sql)).toBe(
      "INSERT INTO dictionary_overrides (parish_id, entry_id, override_definition, override_notes) " +
        "VALUES ($1, $2, $3, $4) ON CONFLICT (parish_id, entry_id) DO UPDATE SET " +
        "override_definition = EXCLUDED.override_definition, override_notes = EXCLUDED.override_notes",
    );
    expect(calls[0]!.params).toEqual(["parish-x", "e1", "d", null]);
  });
});

describe("deleteParishSubmission deletes only within the tenant (po-5bp)", () => {
  it("scopes the delete by id AND parish_id", async () => {
    const calls = recordQueries();
    await deleteParishSubmission("parish-x", "prayer_submissions", "s1");
    expect(flat(calls[0]!.sql)).toBe("DELETE FROM prayer_submissions WHERE id = $1 AND parish_id = $2");
    expect(calls[0]!.params).toEqual(["s1", "parish-x"]);
  });
});
