import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

// Apologetics GLOBAL corpus (apologetics_topics + apologetics_citations), ported from the
// "To Whom Shall We Go" corpus in infra/db/apologetics-corpus.json. These tables carry no
// parish_id — the same corpus is read by every tenant — so this seeds platform reference
// data, not demo data, and is safe to run on any environment.
//
// Idempotent: each topic is upserted by its stable `slug` and its citations are replaced,
// so re-running updates the corpus in place without touching anything else. Does NOT need
// the main seed (no parish dependency).

const { Client } = pg;
const URL = process.env.MIGRATION_DATABASE_URL;
if (!URL) {
  console.error("MIGRATION_DATABASE_URL is not set (see .env).");
  process.exit(1);
}

const here = dirname(fileURLToPath(import.meta.url));
const { topics } = JSON.parse(readFileSync(join(here, "apologetics-corpus.json"), "utf8"));

const c = new Client({ connectionString: URL });
await c.connect();

let citationCount = 0;
try {
  await c.query("BEGIN");
  for (const [i, t] of topics.entries()) {
    const { rows } = await c.query(
      `INSERT INTO apologetics_topics (slug, label, objection, reply, lead, ask, display_order, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'approved')
       ON CONFLICT (slug) DO UPDATE SET
         label = EXCLUDED.label, objection = EXCLUDED.objection, reply = EXCLUDED.reply,
         lead = EXCLUDED.lead, ask = EXCLUDED.ask, display_order = EXCLUDED.display_order,
         status = 'approved', updated_at = now()
       RETURNING id`,
      [t.slug, t.label ?? t.objection, t.objection, t.reply, t.lead, t.ask, i],
    );
    const topicId = rows[0].id;

    // Replace the citation set wholesale — ordering is positional, so an in-place upsert
    // would leave stale rows behind whenever a citation is removed from the corpus.
    await c.query("DELETE FROM apologetics_citations WHERE topic_id = $1", [topicId]);
    for (const [j, cit] of t.citations.entries()) {
      await c.query(
        `INSERT INTO apologetics_citations (topic_id, ref, source_kind, alt_ref, quote, why, display_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [topicId, cit.ref, cit.source_kind, cit.alt_ref, cit.quote || null, cit.why, j],
      );
      citationCount++;
    }
  }
  await c.query("COMMIT");
} catch (err) {
  await c.query("ROLLBACK");
  throw err;
} finally {
  await c.end();
}

console.log(`Seeded apologetics corpus: ${topics.length} topics, ${citationCount} citations.`);
