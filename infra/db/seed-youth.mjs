import "dotenv/config";
import pg from "pg";

// Youth Teaches demo data, seeded into the existing Holy Spirit parish. Idempotent
// (delete + recreate the demo rows by fixed id / email) so it can run on the dev DB
// WITHOUT truncating anything else. Run after the main seed (needs Holy Spirit).

const { Client } = pg;
const URL = process.env.MIGRATION_DATABASE_URL;
if (!URL) {
  console.error("MIGRATION_DATABASE_URL is not set (see .env).");
  process.exit(1);
}

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const TOPIC = "22222222-2222-2222-2222-222222222222";
const PROJECT = "33333333-3333-3333-3333-333333333333";
const SARAH_EMAIL = "sarah@demo.parvusordo.app";

const c = new Client({ connectionString: URL });
await c.connect();

// Tear down prior demo rows (children first).
await c.query("DELETE FROM youth_recordings WHERE project_id = $1", [PROJECT]);
await c.query("DELETE FROM youth_mcp_audit_log WHERE project_id = $1", [PROJECT]);
await c.query("DELETE FROM youth_mcp_tokens WHERE teen_user_id IN (SELECT id FROM users WHERE email = $1)", [SARAH_EMAIL]);
await c.query("DELETE FROM youth_projects WHERE id = $1", [PROJECT]);
await c.query("DELETE FROM youth_topics WHERE id = $1", [TOPIC]);
await c.query("DELETE FROM memberships WHERE parish_id = $1 AND user_id IN (SELECT id FROM users WHERE email = $2)", [HOLY_SPIRIT, SARAH_EMAIL]);

// Sarah (youth_teen at Holy Spirit).
const { rows } = await c.query(
  "INSERT INTO users (email, display_name) VALUES ($1, 'Sarah') ON CONFLICT (email) DO UPDATE SET display_name = 'Sarah' RETURNING id",
  [SARAH_EMAIL],
);
const sarahId = rows[0].id;
await c.query("INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'youth_teen')", [sarahId, HOLY_SPIRIT]);

await c.query(
  `INSERT INTO youth_topics (id, parish_id, category, title, common_misconception, correct_teaching, age_band)
   VALUES ($1, $2, 'Sacraments', 'What Catholics actually believe about the Real Presence',
     'It''s just a symbol of Jesus'' body and blood.',
     'The Eucharist is the Body, Blood, Soul, and Divinity of Christ (CCC 1374) — Real Presence, not symbolic.',
     'high_school')`,
  [TOPIC, HOLY_SPIRIT],
);

await c.query(
  `INSERT INTO youth_projects (id, parish_id, teen_user_id, topic_id, title, status)
   VALUES ($1, $2, $3, $4, 'What Catholics actually believe about the Real Presence', 'drafting')`,
  [PROJECT, HOLY_SPIRIT, sarahId, TOPIC],
);

// Static long-lived MCP token for Claude Desktop (dev only — production mints a
// fresh 120-min token per "Start AI session"). Sarah's tokens were torn down above.
const DEV_MCP_TOKEN = "mcp_dev_youth_sarah_demo";
await c.query(
  "INSERT INTO youth_mcp_tokens (parish_id, teen_user_id, token, expires_at) VALUES ($1, $2, $3, '2099-01-01T00:00:00Z')",
  [HOLY_SPIRIT, sarahId, DEV_MCP_TOKEN],
);

await c.end();
console.log(`youth seed complete: Sarah (youth_teen) + Real Presence topic + project ${PROJECT}`);
console.log(`dev MCP token (Claude Desktop): ${DEV_MCP_TOKEN}`);
