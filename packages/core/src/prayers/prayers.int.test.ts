import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createPrayerSubmission,
  deletePrayerSubmission,
  getDb,
  listPrayers,
  updatePrayerSubmission,
  upsertPrayerOverride,
} from "@parvaordo/core";

const { Client } = pg;
const HS = "11111111-1111-1111-1111-111111111111";
const EMAIL = "prayer-int@inttest.local";
let userId: string;
let entryId: string;
let owner: InstanceType<typeof Client>;

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  const u = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, 'Prayer Int') ON CONFLICT (email) DO UPDATE SET display_name='Prayer Int' RETURNING id",
    [EMAIL],
  );
  userId = u.rows[0]!.id;
  const e = await owner.query<{ id: string }>(
    `INSERT INTO prayer_entries (title, prayer_text, category, status)
     VALUES ('Memorare (int)', 'Remember, O most gracious Virgin Mary...', 'marian', 'approved')
     ON CONFLICT (title) DO UPDATE SET prayer_text = EXCLUDED.prayer_text RETURNING id`,
  );
  entryId = e.rows[0]!.id;
});

afterAll(async () => {
  await getDb(HS).query("DELETE FROM prayer_submissions WHERE parish_id = $1", [HS]);
  await getDb(HS).query("DELETE FROM prayer_overrides WHERE parish_id = $1", [HS]);
  await owner.query("DELETE FROM prayer_entries WHERE title = 'Memorare (int)'");
  await owner.end();
  await getDb(null).query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await closeDb();
});

describe("prayers (integration)", () => {
  it("lists the universal prayer", async () => {
    const p = (await listPrayers(HS)).find((x) => x.title === "Memorare (int)");
    expect(p?.prayerText).toContain("gracious Virgin Mary");
    expect(p?.isLocal).toBe(false);
  });

  it("applies a parish override (text + note)", async () => {
    await upsertPrayerOverride(HS, entryId, { text: "Our parish phrasing of the Memorare.", notes: "shortened" });
    const p = (await listPrayers(HS)).find((x) => x.title === "Memorare (int)");
    expect(p?.prayerText).toBe("Our parish phrasing of the Memorare.");
    expect(p?.overrideNote).toBe("shortened");
  });

  it("creates, updates, deletes a submission; universal wins on title", async () => {
    expect(await createPrayerSubmission(HS, userId, { title: " ", prayerText: "x" })).toBeNull();
    const sub = (await createPrayerSubmission(HS, userId, { title: "Parish Litany", prayerText: "Lord have mercy." }))!;
    let p = (await listPrayers(HS)).find((x) => x.title === "Parish Litany");
    expect(p?.isLocal).toBe(true);
    await updatePrayerSubmission(HS, sub.id, { title: "Parish Litany", prayerText: "Christ have mercy." });
    p = (await listPrayers(HS)).find((x) => x.title === "Parish Litany");
    expect(p?.prayerText).toBe("Christ have mercy.");
    await deletePrayerSubmission(HS, sub.id);
    expect((await listPrayers(HS)).find((x) => x.title === "Parish Litany")).toBeUndefined();

    await createPrayerSubmission(HS, userId, { title: "Memorare (int)", prayerText: "dupe — hidden" });
    const matches = (await listPrayers(HS)).filter((x) => x.title === "Memorare (int)");
    expect(matches.length).toBe(1);
    expect(matches[0]!.isLocal).toBe(false);
  });
});
