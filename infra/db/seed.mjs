import "dotenv/config";
import pg from "pg";

const { Client } = pg;
const URL = process.env.MIGRATION_DATABASE_URL;

if (!URL) {
  console.error("MIGRATION_DATABASE_URL is not set (see .env).");
  process.exit(1);
}

// Fixed UUIDs so the seed lines up with the auth stub's parishId + tests.
const DIOCESE = "00000000-0000-0000-0000-000000000001"; // Altoona-Johnstown
const ERIE = "00000000-0000-0000-0000-000000000002"; // a second diocese (isolation test)
const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_MONICA = "22222222-2222-2222-2222-222222222222";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // in Erie

const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const DIOCESE_LESSON_AJ = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const HS_LESSON = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SM_LESSON = "dddddddd-dddd-dddd-dddd-dddddddddddd";

const client = new Client({ connectionString: URL });
await client.connect();

// Seed runs as superuser (bypasses RLS) so it can write across parishes.
await client.query("TRUNCATE memberships, ministries, users, parishes, dioceses RESTART IDENTITY CASCADE");

await client.query(
  `INSERT INTO dioceses (id, name, short_code) VALUES
     ($1, 'Diocese of Altoona-Johnstown', 'AJ'),
     ($2, 'Diocese of Erie', 'ER')`,
  [DIOCESE, ERIE],
);

await client.query(
  `INSERT INTO parishes (id, diocese_id, name, slug, primary_hostname) VALUES
     ($1, $4, 'Holy Spirit Parish',  'holy-spirit', 'holyspirit.localhost'),
     ($2, $4, 'St. Monica Parish',   'st-monica',   'stmonica.localhost'),
     ($3, $5, 'St. Peter Cathedral', 'st-peter',    'stpeter.localhost')`,
  [HOLY_SPIRIT, ST_MONICA, ST_PETER, DIOCESE, ERIE],
);

await client.query(
  `INSERT INTO ministries (parish_id, name, kind) VALUES
     ($1, 'Parish Council',       'council'),
     ($1, 'Knights of Columbus',  'council'),
     ($1, 'OCIA',                 'formation'),
     ($1, 'Choir',                'liturgical'),
     ($2, 'Parish Council',       'council'),
     ($2, 'Altar Society',        'council')`,
  [HOLY_SPIRIT, ST_MONICA],
);

// justinmmiller62@gmail.com is seeded so the real WorkOS login resolves to a
// real role for testing. Change/remove for production.
await client.query(
  `INSERT INTO users (email, display_name, is_super_admin) VALUES
     ('justinmmiller62@gmail.com', 'Justin Miller', true),
     ('admin@parvaordo.test',      'Parish Admin',  false),
     ('teacher@parvaordo.test',    'Catechist',     false),
     ('student@parvaordo.test',    'Catechumen',    false)`,
);

// Memberships at Holy Spirit. The catechist is scoped to the OCIA ministry to
// exercise the ministry-scoped RBAC hook (ministry_id non-null).
await client.query(
  `INSERT INTO memberships (user_id, parish_id, ministry_id, role)
   SELECT u.id, $1,
          CASE WHEN u.email = 'teacher@parvaordo.test'
               THEN (SELECT id FROM ministries WHERE parish_id = $1 AND name = 'OCIA')
               ELSE NULL END,
          (CASE u.email
             WHEN 'justinmmiller62@gmail.com' THEN 'admin'
             WHEN 'admin@parvaordo.test'      THEN 'admin'
             WHEN 'teacher@parvaordo.test'    THEN 'catechist'
             ELSE 'catechumen_candidate' END)::membership_role
   FROM users u
   WHERE u.email IN ('justinmmiller62@gmail.com','admin@parvaordo.test','teacher@parvaordo.test','student@parvaordo.test')`,
  [HOLY_SPIRIT],
);

// ─── Content: three-tier (global / diocese / parish), each a published v1 ───

async function seedLesson({ id, scope, dioceseId = null, parishId = null, title, description = null, lessonOrder = 0, createdByEmail = null, items = [] }) {
  await client.query(
    `INSERT INTO lessons (id, scope, diocese_id, parish_id, lesson_order, created_by)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM users WHERE email = $6))`,
    [id, scope, dioceseId, parishId, lessonOrder, createdByEmail],
  );
  const { rows } = await client.query(
    `INSERT INTO lesson_versions (lesson_id, scope, diocese_id, parish_id, version_number, title, description, published_at)
     VALUES ($1, $2, $3, $4, 1, $5, $6, now()) RETURNING id`,
    [id, scope, dioceseId, parishId, title, description],
  );
  const versionId = rows[0].id;
  for (const it of items) {
    await client.query(
      `INSERT INTO lesson_items (scope, diocese_id, parish_id, version_id, position, kind, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [scope, dioceseId, parishId, versionId, it.position, it.kind, JSON.stringify(it.content)],
    );
  }
  await client.query("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [versionId, id]);
}

await seedLesson({
  id: GLOBAL_LESSON,
  scope: "global",
  title: "Who Do You Say That I Am?",
  description: "An introduction to the person of Jesus Christ.",
  lessonOrder: 1,
  items: [
    { position: 0, kind: "reading", content: { html: '<p>One day Jesus asked his disciples, "Who do you say that I am?"</p>' } },
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

await seedLesson({
  id: DIOCESE_LESSON_AJ,
  scope: "diocese",
  dioceseId: DIOCESE,
  title: "Saints & History of Altoona-Johnstown",
  description: "Diocesan formation content.",
  lessonOrder: 1,
  items: [{ position: 0, kind: "reading", content: { html: "<p>The diocese of Altoona-Johnstown was established in 1901.</p>" } }],
});

await seedLesson({
  id: HS_LESSON,
  scope: "parish",
  parishId: HOLY_SPIRIT,
  title: "Welcome to OCIA at Holy Spirit",
  description: "Parish-specific orientation.",
  createdByEmail: "justinmmiller62@gmail.com",
  items: [
    { position: 0, kind: "reading", content: { html: "<p>Welcome to the Order of Christian Initiation of Adults at Holy Spirit Parish.</p>" } },
  ],
});

await seedLesson({
  id: SM_LESSON,
  scope: "parish",
  parishId: ST_MONICA,
  title: "St. Monica Parish Orientation",
});

// A cohort at Holy Spirit.
await client.query(`INSERT INTO cohorts (parish_id, name) VALUES ($1, 'OCIA 2026')`, [HOLY_SPIRIT]);

await client.end();
console.log(
  "seed complete: 2 dioceses, 3 parishes, 6 ministries, 4 users, 4 memberships, " +
    "4 lessons (global/diocese/parish×2), 1 cohort",
);
