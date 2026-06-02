import { Pool } from "pg";

/**
 * getDb(parishId) — the single connection chokepoint (Architecture §7).
 *
 * Every query runs in a transaction that sets `app.parish_id` transaction-local,
 * so RLS policies isolate by tenant. Phase 1 always uses the shared pool; in
 * Phase 4 this function checks `parishes.dedicated_db_url` and routes
 * accordingly — with no changes at any call site.
 *
 * Driver note: local/Node uses `pg`. The Workers/Neon-serverless swap lives
 * inside this file only (the chokepoint), per CLAUDE.md §5.
 */

let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set");
    pool = new Pool({ connectionString, max: 10 });
  }
  return pool;
}

export interface TenantDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export function getDb(parishId: string | null): TenantDb {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        // Only set the GUC when we have a tenant; leaving it unset yields no rows
        // (an empty string would fail the ::uuid cast in the RLS policy).
        if (parishId) {
          await client.query("SELECT set_config('app.parish_id', $1, true)", [parishId]);
        }
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return { rows: result.rows as T[] };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

export type TenantQuery = <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>;

/**
 * Run multiple statements in one tenant-scoped transaction (RLS active). Use when
 * a mutation needs several statements atomically — e.g. reordering positions.
 */
export async function withTenant<T>(parishId: string | null, fn: (q: TenantQuery) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    if (parishId) {
      await client.query("SELECT set_config('app.parish_id', $1, true)", [parishId]);
    }
    const q: TenantQuery = async (sql, params = []) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Close the shared pool (tests / graceful shutdown). */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
