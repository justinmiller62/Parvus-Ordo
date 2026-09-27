import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, invalidateApologeticsCache, listApologetics } from "@parvaordo/core";

// listApologetics against a real Postgres: the global corpus reads identically for every
// tenant, per-parish overrides layer on top, and the overrides table is RLS-isolated.

const { Client } = pg;
const HS = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // different diocese
const SLUG = "int-objection";
let topicId: string;
let owner: InstanceType<typeof Client>;

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
  // Global corpus rows have no parish_id and no app write policy, so the owner seeds them.
  const t = await owner.query<{ id: string }>(
    `INSERT INTO apologetics_topics (slug, label, objection, reply, ask, display_order, status)
       VALUES ($1, 'Int label', 'They say the int test is only a symbol.', 'It is not.',
               'What would change your mind?', 9999, 'approved')
     ON CONFLICT (slug) DO UPDATE SET reply = EXCLUDED.reply RETURNING id`,
    [SLUG],
  );
  topicId = t.rows[0]!.id;
  await owner.query("DELETE FROM apologetics_citations WHERE topic_id = $1", [topicId]);
  await owner.query(
    `INSERT INTO apologetics_citations (topic_id, ref, source_kind, alt_ref, quote, why, display_order) VALUES
       ($1, 'John 6:53', NULL, 'DR 6:54', 'except you eat the flesh', NULL, 0),
       ($1, 'Hebrews 11', NULL, NULL, NULL, 'A whole-chapter pointer with no quotation.', 1),
       ($1, 'St. Cyprian, On the Unity of the Church 6', 'Father · c. 251', NULL, 'He cannot have God for his Father', NULL, 2)`,
    [topicId],
  );
});

beforeEach(async () => {
  // The global corpus is cached process-locally; clear it so each test reads current rows.
  invalidateApologeticsCache();
  for (const parishId of [HS, ST_PETER]) {
    await getDb(parishId).query("DELETE FROM apologetics_overrides");
  }
});

afterAll(async () => {
  for (const parishId of [HS, ST_PETER]) {
    await getDb(parishId).query("DELETE FROM apologetics_overrides");
  }
  await owner.query("DELETE FROM apologetics_citations WHERE topic_id = $1", [topicId]);
  await owner.query("DELETE FROM apologetics_topics WHERE slug = $1", [SLUG]);
  await owner.end();
  await closeDb();
});

const findTopic = async (parishId: string) => (await listApologetics(parishId)).find((t) => t.slug === SLUG);

describe("listApologetics — global corpus + per-parish overrides", () => {
  it("returns the global topic with its citations in display order", async () => {
    const topic = await findTopic(HS);
    expect(topic).toBeDefined();
    expect(topic!.objection).toBe("They say the int test is only a symbol.");
    expect(topic!.reply).toBe("It is not.");
    expect(topic!.citations.map((c) => c.ref)).toEqual([
      "John 6:53",
      "Hebrews 11",
      "St. Cyprian, On the Unity of the Church 6",
    ]);
  });

  it("carries the Douay-Rheims alternate numbering and the source badge", async () => {
    const cites = (await findTopic(HS))!.citations;
    expect(cites[0]!.altRef).toBe("DR 6:54");
    expect(cites[0]!.sourceKind).toBeNull(); // Scripture needs no badge
    expect(cites[2]!.sourceKind).toBe("Father · c. 251");
  });

  it("preserves a null quote on a whole-chapter pointer (why-only citation)", async () => {
    const cites = (await findTopic(HS))!.citations;
    expect(cites[1]!.quote).toBeNull();
    expect(cites[1]!.why).toBe("A whole-chapter pointer with no quotation.");
  });

  it("reads identically for a parish in another diocese (the corpus is global)", async () => {
    const hs = await findTopic(HS);
    const sp = await findTopic(ST_PETER);
    expect(sp!.id).toBe(hs!.id);
    expect(sp!.citations.length).toBe(hs!.citations.length);
  });

  it("applies a parish override to reply and ask, and surfaces the note", async () => {
    await getDb(HS).query(
      `INSERT INTO apologetics_overrides (parish_id, topic_id, override_reply, override_ask, override_notes)
         VALUES ($1, $2, 'Our parish wording.', 'Our parish question?', 'Approved by Fr. Int.')`,
      [HS, topicId],
    );
    invalidateApologeticsCache();
    const topic = await findTopic(HS);
    expect(topic!.reply).toBe("Our parish wording.");
    expect(topic!.ask).toBe("Our parish question?");
    expect(topic!.overrideNote).toBe("Approved by Fr. Int.");
    // The override must not change the global citations.
    expect(topic!.citations.length).toBe(3);
  });

  it("RLS: one parish's override is invisible to another parish", async () => {
    await getDb(HS).query(
      `INSERT INTO apologetics_overrides (parish_id, topic_id, override_reply) VALUES ($1, $2, 'HS only.')`,
      [HS, topicId],
    );
    invalidateApologeticsCache();
    expect((await findTopic(HS))!.reply).toBe("HS only.");
    expect((await findTopic(ST_PETER))!.reply).toBe("It is not."); // falls back to the global reply
  });

  it("excludes a topic that is not approved", async () => {
    await owner.query("UPDATE apologetics_topics SET status = 'draft' WHERE slug = $1", [SLUG]);
    invalidateApologeticsCache();
    try {
      expect(await findTopic(HS)).toBeUndefined();
    } finally {
      await owner.query("UPDATE apologetics_topics SET status = 'approved' WHERE slug = $1", [SLUG]);
      invalidateApologeticsCache();
    }
  });
});
