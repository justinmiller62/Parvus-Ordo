import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../db/client";
import { DICTIONARY_CACHE_TTL_MS, invalidateDictionaryCache, listDictionary } from "./dictionary";

// Unit-level: stub getDb so no DB is touched. The global glossary (dictionary_entries)
// is identical for every tenant and RLS-exposed to all (0019_dictionary.sql), so
// listDictionary caches it process-locally; per-parish overrides/submissions must stay
// fresh. These tests pin that split — and prove one parish never sees another's rows
// through the shared cache.
vi.mock("../db/client", () => ({ getDb: vi.fn() }));
const mockGetDb = vi.mocked(getDb);

interface Row {
  [k: string]: unknown;
}

// How many times each table was hit, so we can assert the global set is read once
// while per-parish reads happen on every call.
let entriesReads = 0;
const overrideReads: Record<string, number> = {};
const submissionReads: Record<string, number> = {};

const UNIVERSAL: Row[] = [
  {
    id: "u1",
    headword: "Eucharist",
    variants: null,
    pronunciation: null,
    definition: "universal def",
    greek_word: null,
    greek_definition: "thanksgiving",
    hebrew_word: null,
    hebrew_definition: null,
    first_century_context: null,
    catechism_references: null,
    scripture_references: null,
    category: null,
  },
];
// parish-a overrides the universal entry; parish-b proposes a local term. Neither should
// ever appear in the other's result, cache or no cache.
const OVERRIDES: Record<string, Row[]> = {
  "parish-a": [
    {
      entry_id: "u1",
      override_definition: "A's parish def",
      override_greek_definition: null,
      override_hebrew_definition: null,
      override_first_century_context: null,
      override_notes: "A note",
    },
  ],
  "parish-b": [],
};
const SUBMISSIONS: Record<string, Row[]> = {
  "parish-a": [],
  "parish-b": [
    {
      id: "s-b",
      headword: "Narthex",
      variants: null,
      definition: "B local term",
      greek_word: null,
      greek_definition: null,
      hebrew_word: null,
      hebrew_definition: null,
      first_century_context: null,
    },
  ],
};

beforeEach(() => {
  entriesReads = 0;
  for (const k of Object.keys(overrideReads)) delete overrideReads[k];
  for (const k of Object.keys(submissionReads)) delete submissionReads[k];
  invalidateDictionaryCache(); // every test starts with a cold cache

  mockGetDb.mockImplementation((parishId: string | null) => ({
    async query<T = Record<string, unknown>>(sql: string): Promise<{ rows: T[] }> {
      const p = parishId ?? "";
      if (sql.includes("dictionary_entries")) {
        entriesReads++;
        return { rows: UNIVERSAL as T[] };
      }
      if (sql.includes("dictionary_overrides")) {
        overrideReads[p] = (overrideReads[p] ?? 0) + 1;
        return { rows: (OVERRIDES[p] ?? []) as T[] };
      }
      if (sql.includes("dictionary_submissions")) {
        submissionReads[p] = (submissionReads[p] ?? 0) + 1;
        return { rows: (SUBMISSIONS[p] ?? []) as T[] };
      }
      return { rows: [] as T[] };
    },
  }));
});

describe("listDictionary global-glossary cache", () => {
  it("reads the global glossary once but per-parish data on every call", async () => {
    const t0 = 1_000_000;
    await listDictionary("parish-a", t0);
    await listDictionary("parish-a", t0 + 1_000);

    expect(entriesReads).toBe(1); // global set fetched once, then served from cache
    expect(overrideReads["parish-a"]).toBe(2); // per-parish overrides stay fresh
    expect(submissionReads["parish-a"]).toBe(2); // per-parish submissions stay fresh
  });

  it("never serves one parish's rows from another's via the shared cache", async () => {
    const t0 = 1_000_000;
    const a = await listDictionary("parish-a", t0);
    const b = await listDictionary("parish-b", t0);

    expect(entriesReads).toBe(1); // global base is shared (identical for all tenants)
    // A sees its own override applied on top of the shared base.
    expect(a.find((x) => x.headword === "Eucharist")?.definition).toBe("A's parish def");
    expect(a.find((x) => x.headword === "Eucharist")?.overrideNote).toBe("A note");
    // B sees the untouched universal definition + its own local submission.
    expect(b.find((x) => x.headword === "Eucharist")?.definition).toBe("universal def");
    expect(b.some((x) => x.headword === "Narthex" && x.isLocal)).toBe(true);
    // No bleed across tenants.
    expect(a.some((x) => x.headword === "Narthex")).toBe(false);
    expect(b.find((x) => x.headword === "Eucharist")?.overrideNote).toBeNull();
  });

  it("re-reads the global glossary after explicit invalidation (owner/MCP write path)", async () => {
    const t0 = 1_000_000;
    await listDictionary("parish-a", t0);
    expect(entriesReads).toBe(1);

    invalidateDictionaryCache();
    await listDictionary("parish-a", t0 + 1_000);
    expect(entriesReads).toBe(2); // invalidation forced a fresh read
  });

  it("re-reads the global glossary after the TTL elapses (backstop for out-of-process writes)", async () => {
    const t0 = 1_000_000;
    await listDictionary("parish-a", t0);
    await listDictionary("parish-a", t0 + DICTIONARY_CACHE_TTL_MS - 1); // still within TTL
    expect(entriesReads).toBe(1);

    await listDictionary("parish-a", t0 + DICTIONARY_CACHE_TTL_MS + 1); // past TTL
    expect(entriesReads).toBe(2);
  });
});
