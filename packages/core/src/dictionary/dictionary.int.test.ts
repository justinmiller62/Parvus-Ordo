import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createDictionarySubmission,
  deleteDictionarySubmission,
  getDb,
  invalidateDictionaryCache,
  listDictionary,
  updateDictionarySubmission,
  upsertOverride,
} from "@parvaordo/core";

const { Client } = pg;
const HS = "11111111-1111-1111-1111-111111111111";
const EMAIL = "dict-int@inttest.local";
let userId: string;
let entryId: string; // a global universal entry
let owner: InstanceType<typeof Client>; // owner conn — bypasses RLS for the global table

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  const u = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Dict Int') ON CONFLICT (email) DO UPDATE SET display_name = 'Dict Int' RETURNING id",
    [EMAIL],
  );
  userId = u.rows[0]!.id;
  // Global universal entry — written via the owner connection (the app role can't, by design).
  const e = await owner.query<{ id: string }>(
    `INSERT INTO dictionary_entries (headword, definition, greek_word, greek_definition, category, status)
     VALUES ('eucharist-int', 'The Real Presence.', 'eucharistia', 'thanksgiving', 'sacramental', 'approved')
     ON CONFLICT (headword) DO UPDATE SET definition = EXCLUDED.definition RETURNING id`,
  );
  entryId = e.rows[0]!.id;
});

afterAll(async () => {
  await getDb(HS).query("DELETE FROM dictionary_submissions WHERE parish_id = $1", [HS]);
  await getDb(HS).query("DELETE FROM dictionary_overrides WHERE parish_id = $1", [HS]);
  await owner.query("DELETE FROM dictionary_entries WHERE headword IN ('eucharist-int', 'sacristy-int')");
  await owner.end();
  await getDb(null).query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await closeDb();
});

describe("dictionary (integration)", () => {
  it("lists the universal entry for the parish", async () => {
    const list = await listDictionary(HS);
    const e = list.find((x) => x.headword === "eucharist-int");
    expect(e?.definition).toBe("The Real Presence.");
    expect(e?.isLocal).toBe(false);
  });

  it("applies a parish override to a universal entry", async () => {
    await upsertOverride(HS, entryId, { definition: "Body, Blood, Soul, Divinity.", notes: "parish phrasing" });
    const e = (await listDictionary(HS)).find((x) => x.headword === "eucharist-int");
    expect(e?.definition).toBe("Body, Blood, Soul, Divinity."); // override wins
    expect(e?.greekDefinition).toBe("thanksgiving"); // untouched field falls back to universal
    expect(e?.overrideNote).toBe("parish phrasing");
  });

  it("creates a parish submission that appears badged local", async () => {
    const sub = await createDictionarySubmission(HS, userId, {
      headword: "Narthex",
      definition: "The entrance of a church.",
    });
    expect(sub).not.toBeNull();
    const e = (await listDictionary(HS)).find((x) => x.headword === "narthex");
    expect(e?.isLocal).toBe(true);
    expect(e?.definition).toBe("The entrance of a church.");
  });

  it("rejects an empty submission", async () => {
    expect(await createDictionarySubmission(HS, userId, { headword: "  ", definition: "x" })).toBeNull();
    expect(await createDictionarySubmission(HS, userId, { headword: "ok", definition: "  " })).toBeNull();
  });

  it("updates then deletes a submission", async () => {
    const sub = (await createDictionarySubmission(HS, userId, { headword: "ambo", definition: "A lectern." }))!;
    await updateDictionarySubmission(HS, sub.id, { headword: "ambo", definition: "The reading stand." });
    let e = (await listDictionary(HS)).find((x) => x.headword === "ambo");
    expect(e?.definition).toBe("The reading stand.");
    await deleteDictionarySubmission(HS, sub.id);
    e = (await listDictionary(HS)).find((x) => x.headword === "ambo");
    expect(e).toBeUndefined();
  });

  it("a universal entry wins over a same-headword parish submission", async () => {
    await createDictionarySubmission(HS, userId, { headword: "eucharist-int", definition: "should be hidden" });
    const matches = (await listDictionary(HS)).filter((x) => x.headword === "eucharist-int");
    expect(matches.length).toBe(1);
    expect(matches[0]!.isLocal).toBe(false); // universal wins
  });

  it("serves the global glossary from cache until invalidated (owner/MCP write path)", async () => {
    await listDictionary(HS); // warm the cache before the out-of-band write
    // Owner adds a new global entry directly (the app role has no write policy here).
    await owner.query(
      `INSERT INTO dictionary_entries (headword, definition, status)
       VALUES ('sacristy-int', 'A room for vestments.', 'approved')
       ON CONFLICT (headword) DO UPDATE SET definition = EXCLUDED.definition`,
    );
    // Still served from the warm cache → not visible yet.
    expect((await listDictionary(HS)).some((x) => x.headword === "sacristy-int")).toBe(false);
    // The write path invalidates → the next read picks it up.
    invalidateDictionaryCache();
    expect((await listDictionary(HS)).some((x) => x.headword === "sacristy-int")).toBe(true);
  });

  it("does not leak a parish-local submission or override across parishes (RLS)", async () => {
    // St. Monica — a different parish. listDictionary's per-parish reads carry NO explicit
    // parish_id filter; they rely entirely on RLS, so this is the regression guard for the
    // dictionary_submissions / dictionary_overrides policies against cross-tenant leakage.
    const OTHER = "22222222-2222-2222-2222-222222222222";
    await createDictionarySubmission(HS, userId, { headword: "hsonlyterm", definition: "Holy Spirit only." });
    await upsertOverride(HS, entryId, { definition: "HS-only override.", notes: "hs-private" });

    // Holy Spirit sees its own local submission…
    expect((await listDictionary(HS)).find((x) => x.headword === "hsonlyterm")?.isLocal).toBe(true);

    // …but another parish must not.
    const other = await listDictionary(OTHER);
    expect(other.find((x) => x.headword === "hsonlyterm")).toBeUndefined();
    // The shared universal entry is still visible — with its universal definition, never
    // Holy Spirit's private override (overrides must not cross parishes either).
    const shared = other.find((x) => x.headword === "eucharist-int");
    expect(shared?.isLocal).toBe(false);
    expect(shared?.definition).toBe("The Real Presence.");
    expect(shared?.overrideNote).toBeNull();
  });
});
