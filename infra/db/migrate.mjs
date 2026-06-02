import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Client } = pg;
const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");
const URL = process.env.MIGRATION_DATABASE_URL;

if (!URL) {
  console.error("MIGRATION_DATABASE_URL is not set (see .env).");
  process.exit(1);
}

async function connect(retries = 15) {
  for (let i = 1; i <= retries; i++) {
    const client = new Client({ connectionString: URL });
    try {
      await client.connect();
      return client;
    } catch (err) {
      await client.end().catch(() => {});
      if (i === retries) throw err;
      console.log(`waiting for postgres (${i}/${retries})…`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error("unreachable");
}

const client = await connect();
await client.query(
  "CREATE TABLE IF NOT EXISTS _migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
);
const applied = new Set((await client.query("SELECT name FROM _migrations")).rows.map((r) => r.name));
const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log("skip   ", file);
    continue;
  }
  const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
  console.log("apply  ", file);
  await client.query("BEGIN");
  try {
    await client.query(sql);
    await client.query("INSERT INTO _migrations(name) VALUES ($1)", [file]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(`failed on ${file}:`, err.message);
    process.exit(1);
  }
}

await client.end();
console.log("migrations complete");
