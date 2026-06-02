import "dotenv/config";
import pg from "pg";

// ─── E2E-only fixtures ───────────────────────────────────────────────────────
// A dedicated "E2E Test Parish" with its own diocese, users, video asset, and
// lessons. The Playwright suite operates ENTIRELY within this parish so the demo
// content (Holy Spirit / St. Monica, locally-uploaded videos, your manual edits)
// is never an e2e fixture — and is never touched here.
//
// Idempotent + non-destructive: this deletes and recreates ONLY the rows it owns
// (the E2E diocese/parish by fixed UUID + users by the `e2e-` email prefix). It
// does NOT TRUNCATE, so running it leaves all other data intact. global-setup
// runs it before every e2e run, so the fixtures are pristine each time even if a
// prior run left debris (e.g. a half-deleted lesson).

const { Client } = pg;
const URL = process.env.MIGRATION_DATABASE_URL;
if (!URL) {
  console.error("MIGRATION_DATABASE_URL is not set (see .env).");
  process.exit(1);
}

const E2E_DIOCESE = "0e2e0000-0000-0000-0000-000000000001";
const E2E_PARISH = "0e2e0000-0000-0000-0000-0000000000a1";
const E2E_VIDEO = "0e2e0000-0000-0000-0000-0000000000b1";
const E2E_VIDEO_LESSON = "0e2e0000-0000-0000-0000-0000000000c1";
const E2E_QUIZ_LESSON = "0e2e0000-0000-0000-0000-0000000000c2";
const E2E_YOUTH_TOPIC = "0e2e0000-0000-0000-0000-0000000000d1";
const E2E_YOUTH_PROJECT = "0e2e0000-0000-0000-0000-0000000000d2";
const E2E_MCP_TOKEN = "mcp_e2e_youth_token"; // long-lived; the youth-teaches spec drives MCP with it

const client = new Client({ connectionString: URL });
await client.connect();

// ── Tear down only what we own (child → parent), so a re-run is clean ──────────
// All e2e users live only in the e2e parish, so deleting the parish + the
// e2e-prefixed users removes every dependent row. Explicit child deletes guard
// against any FK without ON DELETE CASCADE and clean up test-created debris
// (forks/lessons a crashed spec failed to delete via the UI).
await client.query("DELETE FROM ocia_applicants WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM student_questions WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM student_feedback  WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM answers              WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM engagement_events    WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM lesson_item_progress WHERE parish_id = $1", [E2E_PARISH]);
await client.query(
  "DELETE FROM lesson_items   WHERE version_id IN (SELECT id FROM lesson_versions WHERE parish_id = $1)",
  [E2E_PARISH],
);
await client.query("DELETE FROM lesson_versions WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM lessons         WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM assets          WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM cohorts         WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM youth_recordings   WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM youth_mcp_audit_log WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM youth_mcp_tokens    WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM youth_projects      WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM youth_topics        WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM dictionary_submissions WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM dictionary_overrides   WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM prayer_submissions     WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM prayer_overrides       WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM memberships     WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM ministries      WHERE parish_id = $1", [E2E_PARISH]);
await client.query("DELETE FROM users    WHERE email LIKE 'e2e-%@parvaordo.test'");
await client.query("DELETE FROM parishes WHERE id = $1", [E2E_PARISH]);
await client.query("DELETE FROM dioceses WHERE id = $1", [E2E_DIOCESE]);

// ── Diocese + parish ───────────────────────────────────────────────────────
await client.query(`INSERT INTO dioceses (id, name, short_code) VALUES ($1, 'E2E Test Diocese', 'E2E')`, [E2E_DIOCESE]);
await client.query(
  // applications_enabled = true so the public /apply flow can be exercised on the
  // e2e-test.localhost subdomain.
  `INSERT INTO parishes (id, diocese_id, name, slug, primary_hostname, applications_enabled)
   VALUES ($1, $2, 'E2E Test Parish', 'e2e-test', 'e2e-test.localhost', true)`,
  [E2E_PARISH, E2E_DIOCESE],
);
await client.query(`INSERT INTO ministries (parish_id, name, kind) VALUES ($1, 'OCIA', 'formation')`, [E2E_PARISH]);

// ── Users + memberships (single-parish, so no chooser/switcher in the way) ───
await client.query(
  `INSERT INTO users (email, display_name, is_super_admin) VALUES
     ('e2e-admin@parvaordo.test',     'E2E Admin',     false),
     ('e2e-catechist@parvaordo.test', 'E2E Catechist', false),
     ('e2e-student@parvaordo.test',   'E2E Student',   false),
     ('e2e-teen@parvaordo.test',      'E2E Teen',      false)`,
);
await client.query(
  `INSERT INTO memberships (user_id, parish_id, ministry_id, role)
   SELECT u.id, $1,
          CASE WHEN u.email = 'e2e-catechist@parvaordo.test'
               THEN (SELECT id FROM ministries WHERE parish_id = $1 AND name = 'OCIA')
               ELSE NULL END,
          (CASE u.email
             WHEN 'e2e-admin@parvaordo.test'     THEN 'admin'
             WHEN 'e2e-catechist@parvaordo.test' THEN 'catechist'
             WHEN 'e2e-teen@parvaordo.test'      THEN 'studio'
             ELSE 'catechumen_candidate' END)::membership_role
   FROM users u
   WHERE u.email LIKE 'e2e-%@parvaordo.test'`,
  [E2E_PARISH],
);

// ── Youth Teaches fixtures (topic + project + a long-lived MCP token) ────────
// The youth-teaches spec loads this project as the teen, drives the MCP endpoint
// with E2E_MCP_TOKEN (Claude's role), and marks it ready.
await client.query(
  `INSERT INTO youth_topics (id, parish_id, category, title, common_misconception, correct_teaching, age_band)
   VALUES ($1, $2, 'Sacraments', 'What Catholics actually believe about the Real Presence',
     'It''s just a symbol of Jesus'' body and blood.',
     'The Eucharist is the Body, Blood, Soul, and Divinity of Christ (CCC 1374) — Real Presence, not symbolic.',
     'high_school')`,
  [E2E_YOUTH_TOPIC, E2E_PARISH],
);
await client.query(
  `INSERT INTO youth_projects (id, parish_id, teen_user_id, topic_id, title, status)
   VALUES ($1, $2, (SELECT id FROM users WHERE email = 'e2e-teen@parvaordo.test'), $3,
     'What Catholics actually believe about the Real Presence', 'drafting')`,
  [E2E_YOUTH_PROJECT, E2E_PARISH, E2E_YOUTH_TOPIC],
);
await client.query(
  `INSERT INTO youth_mcp_tokens (parish_id, teen_user_id, token, expires_at)
   VALUES ($1, (SELECT id FROM users WHERE email = 'e2e-teen@parvaordo.test'), $2, '2099-01-01T00:00:00Z')`,
  [E2E_PARISH, E2E_MCP_TOKEN],
);

// ── A ready video asset with a completed transcript (stub provider) ──────────
// Same Apple bipbop sample + word list as the demo seed so the player, trimmer,
// and synced transcript can be exercised without a live upload.
const WORDS = [
  { word: "Welcome", start: 0, end: 0.6 },
  { word: "to", start: 0.6, end: 0.9 },
  { word: "the", start: 0.9, end: 1.1 },
  { word: "Order", start: 1.1, end: 1.6 },
  { word: "of", start: 1.6, end: 1.8 },
  { word: "Christian", start: 1.8, end: 2.4 },
  { word: "Initiation", start: 2.4, end: 3.1 },
  { word: "of", start: 3.1, end: 3.3 },
  { word: "Adults.", start: 3.3, end: 4.0 },
];
await client.query(
  `INSERT INTO assets
     (id, scope, parish_id, created_by, kind, title, provider, provider_asset_id, playback_url,
      status, duration_ms, transcription_status, transcript_text, transcript_json)
   VALUES ($1, 'parish', $2, (SELECT id FROM users WHERE email = 'e2e-admin@parvaordo.test'),
      'video', 'OCIA Welcome Clip', 'stub', 'e2e-welcome',
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_ts/master.m3u8',
      'ready', 600000, 'completed', $3, $4::jsonb)`,
  [E2E_VIDEO, E2E_PARISH, WORDS.map((w) => w.word).join(" "), JSON.stringify(WORDS)],
);

// ── Lessons (each a published v1) ────────────────────────────────────────────
async function seedLesson({ id, title, description = null, items }) {
  await client.query(
    `INSERT INTO lessons (id, scope, parish_id, lesson_order, created_by)
     VALUES ($1, 'parish', $2, 0, (SELECT id FROM users WHERE email = 'e2e-admin@parvaordo.test'))`,
    [id, E2E_PARISH],
  );
  const { rows } = await client.query(
    `INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title, description, published_at)
     VALUES ($1, 'parish', $2, 1, $3, $4, now()) RETURNING id`,
    [id, E2E_PARISH, title, description],
  );
  const versionId = rows[0].id;
  for (const it of items) {
    await client.query(
      `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
       VALUES ('parish', $1, $2, $3, $4, $5)`,
      [E2E_PARISH, versionId, it.position, it.kind, JSON.stringify(it.content)],
    );
  }
  await client.query("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [versionId, id]);
}

// Video lesson: reading → video. Drives the seek-enforcing player + transcript test.
await seedLesson({
  id: E2E_VIDEO_LESSON,
  title: "E2E: Welcome Video Lesson",
  description: "E2E fixture — reading then a gated video.",
  items: [
    { position: 0, kind: "reading", content: { html: "<p>Welcome to the E2E video lesson.</p>" } },
    { position: 1, kind: "video", content: { asset_id: E2E_VIDEO, start_ms: 0, end_ms: 8000 } },
  ],
});

// Quiz lesson: reading → open-ended → multiple-choice. Drives the complete →
// question/feedback → review → catechist-inbox journey, self-contained (no
// dependency on the demo "global" lesson).
await seedLesson({
  id: E2E_QUIZ_LESSON,
  title: "E2E: Who Do You Say That I Am",
  description: "E2E fixture — completable lesson with a question + MC.",
  items: [
    { position: 0, kind: "reading", content: { html: '<p>Jesus asked, "Who do you say that I am?"</p>' } },
    { position: 1, kind: "question", content: { prompt: "Who do you say that Jesus is?", format: "open_ended" } },
    {
      position: 2,
      kind: "question",
      content: {
        prompt: "Which is a profession of faith?",
        format: "multiple_choice",
        choices: [
          { label: "A teacher only", correct: false },
          { label: "The Son of the living God", correct: true },
          { label: "A prophet only", correct: false },
        ],
      },
    },
  ],
});

// Global dictionary entry (no parish_id — universal). Owner conn bypasses RLS.
await client.query(
  `INSERT INTO dictionary_entries (headword, definition, category, status)
   VALUES ('eucharist', 'The Real Presence — the Body, Blood, Soul, and Divinity of Christ.', 'sacramental', 'approved')
   ON CONFLICT (headword) DO UPDATE SET definition = EXCLUDED.definition`,
);

await client.query(
  `INSERT INTO prayer_entries (title, prayer_text, category, status)
   VALUES ('Hail Mary', 'Hail Mary, full of grace, the Lord is with thee...', 'marian', 'approved')
   ON CONFLICT (title) DO UPDATE SET prayer_text = EXCLUDED.prayer_text`,
);

await client.end();
console.log(
  "e2e fixtures ready: E2E Test Parish (4 users, 1 video asset, 2 lessons, 1 youth project, 1 dictionary + 1 prayer entry)",
);
