import "dotenv/config";
import { Client } from "pg";
import { assertSeeded, requireIntegrationEnv } from "./packages/core/src/db/int-guard";

/**
 * Integration globalSetup (Architecture §14, Layer 2). Runs ONCE before any
 * *.int.test.ts and fails the whole suite fast — and loudly — when the DB layer
 * is misconfigured (po-99f). Three guards, in order of likelihood:
 *
 *   1. env unset      → a single actionable error, not N files failing to connect.
 *   2. DB unreachable  → a clear "start the DB" message, not a raw ECONNREFUSED wall.
 *   3. DB unseeded     → fail (zero seed rows), so an empty DB can't pass green.
 *
 * The smoke check runs over DATABASE_URL — the same app/RLS role the tests use —
 * so it proves exactly the path under test. Pure logic lives beside the getDb
 * chokepoint at packages/core/src/db/int-guard.ts (and is unit-tested there).
 */
export default async function setup(): Promise<void> {
  const { databaseUrl } = requireIntegrationEnv(process.env);

  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Integration DB at DATABASE_URL is not reachable: ${reason}. ` +
        "Start it with `pnpm db:up` (then `pnpm db:migrate && pnpm db:seed`).",
      { cause: err },
    );
  }
  try {
    await client.query("SELECT 1");
    // dioceses has no RLS, so the app role sees the true seed count with no tenant
    // set — a clean signal that migrations ran AND the seed populated the DB.
    const { rows } = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM dioceses");
    assertSeeded(Number(rows[0]?.n));
  } finally {
    await client.end();
  }
}
