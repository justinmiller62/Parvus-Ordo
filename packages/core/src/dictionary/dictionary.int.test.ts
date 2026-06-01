import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createSubmission,
  deleteSubmission,
  getDb,
  listDictionary,
  updateSubmission,
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
  await owner.query("DELETE FROM dictionary_entries WHERE headword = 'eucharist-int'");
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
    const sub = await createSubmission(HS, userId, { headword: "Narthex", definition: "The entrance of a church." });
    expect(sub).not.toBeNull();
    const e = (await listDictionary(HS)).find((x) => x.headword === "narthex");
    expect(e?.isLocal).toBe(true);
    expect(e?.definition).toBe("The entrance of a church.");
  });

  it("rejects an empty submission", async () => {
    expect(await createSubmission(HS, userId, { headword: "  ", definition: "x" })).toBeNull();
    expect(await createSubmission(HS, userId, { headword: "ok", definition: "  " })).toBeNull();
  });

  it("updates then deletes a submission", async () => {
    const sub = (await createSubmission(HS, userId, { headword: "ambo", definition: "A lectern." }))!;
    await updateSubmission(HS, sub.id, { headword: "ambo", definition: "The reading stand." });
    let e = (await listDictionary(HS)).find((x) => x.headword === "ambo");
    expect(e?.definition).toBe("The reading stand.");
    await deleteSubmission(HS, sub.id);
    e = (await listDictionary(HS)).find((x) => x.headword === "ambo");
    expect(e).toBeUndefined();
  });

  it("a universal entry wins over a same-headword parish submission", async () => {
    await createSubmission(HS, userId, { headword: "eucharist-int", definition: "should be hidden" });
    const matches = (await listDictionary(HS)).filter((x) => x.headword === "eucharist-int");
    expect(matches.length).toBe(1);
    expect(matches[0]!.isLocal).toBe(false); // universal wins
  });
});
