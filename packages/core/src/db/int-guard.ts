/**
 * Integration-suite guard (Architecture §14, Layer 2 — real Postgres + RLS).
 *
 * The *.int.test.ts layer depends on a live DB via getDb (./client.ts). With no
 * guard, a missing DATABASE_URL surfaced as a wall of per-test connection errors
 * (noise, not a signal), and — worse — a reachable-but-empty DB could pass green,
 * masking a misconfigured connection (po-99f). These are the pure checks behind
 * the integration globalSetup (../../../../vitest.int.setup.ts): kept beside the
 * getDb chokepoint they protect, and free of `pg`/vitest so they unit-test as
 * plain logic under the unit layer.
 */

/**
 * The env vars the integration layer requires:
 *  - DATABASE_URL            — app role (RLS-enforced); the connection tests use.
 *  - MIGRATION_DATABASE_URL  — superuser; drives `pnpm db:migrate` / `db:seed`.
 */
export const REQUIRED_INT_ENV = ["DATABASE_URL", "MIGRATION_DATABASE_URL"] as const;

export interface IntegrationEnv {
  databaseUrl: string;
  migrationUrl: string;
}

// Same remedy applies to every failure here, so it's said once and appended to each.
const HOW_TO_FIX =
  "Copy .env.example to .env, then run `pnpm db:up && pnpm db:migrate && pnpm db:seed` " +
  "(or `pnpm db:reset`) before `pnpm test:int`.";

/**
 * Validate the integration env vars, returning them when present. Throws a single
 * clear, actionable error naming every missing (or blank) var — so the suite fails
 * fast once, instead of each test file failing to connect in turn.
 */
export function requireIntegrationEnv(env: Record<string, string | undefined>): IntegrationEnv {
  const missing = REQUIRED_INT_ENV.filter((name) => (env[name] ?? "").trim() === "");
  if (missing.length > 0) {
    const verb = missing.length === 1 ? "is" : "are";
    throw new Error(
      `Integration tests require ${REQUIRED_INT_ENV.join(" and ")} to be set, ` +
        `but ${missing.join(" and ")} ${verb} missing. ${HOW_TO_FIX}`,
    );
  }
  // Non-null after the guard: every required var is a non-blank string.
  return {
    databaseUrl: (env.DATABASE_URL as string).trim(),
    migrationUrl: (env.MIGRATION_DATABASE_URL as string).trim(),
  };
}

/**
 * Assert the integration DB is actually seeded. `dioceseCount` comes from a live
 * `SELECT count(*) FROM dioceses` — a non-RLS tenancy-root table the app role can
 * read with no tenant set, so the count is a clean marker that the DB is both
 * migrated AND seeded. Zero (or a malformed, non-finite count) means the
 * connection succeeded but points at an empty DB: fail loudly so a green run can
 * never mask it.
 */
export function assertSeeded(dioceseCount: number): void {
  if (!Number.isFinite(dioceseCount) || dioceseCount <= 0) {
    throw new Error(`Integration DB is reachable but appears unseeded (found ${dioceseCount} dioceses). ${HOW_TO_FIX}`);
  }
}
