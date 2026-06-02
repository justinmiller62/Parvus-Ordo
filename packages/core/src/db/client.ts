import { Pool, type PoolClient } from "pg";

/**
 * getDb(parishId) — the single connection chokepoint (Architecture §7).
 *
 * Every query runs in a transaction that sets `app.parish_id` (and, when the parish
 * belongs to one, `app.diocese_id`) transaction-local, so RLS policies isolate by
 * tenant and match diocese-scoped shared content without a per-row subquery. Phase 1
 * always uses the shared pool; in Phase 4 this function checks
 * `parishes.dedicated_db_url` and routes accordingly — with no changes at any call site.
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

/**
 * Set the transaction-local tenant GUCs the RLS policies read — one place, shared by
 * both entry points. `app.parish_id` scopes every tenant table. `app.diocese_id` lets
 * the three-tier *read* policies (lessons / lesson_versions / lesson_items / assets)
 * match diocese-scoped shared content with a plain GUC compare instead of a per-row
 * correlated subquery on `parishes` — the active parish's diocese is resolved here,
 * once per request. It is set ONLY when the parish actually has a diocese; otherwise it
 * is left unset, which the policy's `NULLIF(...,'')::uuid` reads as NULL (the parish
 * sees no diocese content). The diocese lookup is RLS-safe because app.parish_id is set
 * first, so `parishes` exposes exactly the active parish row.
 */
async function setTenantContext(client: PoolClient, parishId: string): Promise<void> {
  await client.query("SELECT set_config('app.parish_id', $1, true)", [parishId]);
  await client.query(
    `SELECT set_config('app.diocese_id', p.diocese_id::text, true)
       FROM parishes p
      WHERE p.id = $1::uuid AND p.diocese_id IS NOT NULL`,
    [parishId],
  );
}

export interface TenantDb {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Roll back, swallowing the rollback error so we never mask the original throw —
 * but log it first. A failed ROLLBACK means the connection returns to the pool stuck
 * mid-transaction; this is the single multi-tenant chokepoint, so that silent pool
 * corruption must stay observable rather than vanishing into `.catch(() => {})`. (po-rt2)
 */
async function rollbackQuietly(client: PoolClient, context: string): Promise<void> {
  await client.query("ROLLBACK").catch((rollbackErr) => {
    console.error(`db chokepoint (${context}): ROLLBACK failed; connection may be poisoned`, rollbackErr);
  });
}

export function getDb(parishId: string | null): TenantDb {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        // Only set the GUCs when we have a tenant; with none, the policies see no
        // tenant and return only world-readable (global) rows.
        if (parishId) {
          await setTenantContext(client, parishId);
        }
        const result = await client.query(sql, params);
        await client.query("COMMIT");
        return { rows: result.rows as T[] };
      } catch (err) {
        await rollbackQuietly(client, "getDb");
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
      await setTenantContext(client, parishId);
    }
    const q: TenantQuery = async (sql, params = []) => (await client.query(sql, params)).rows;
    const result = await fn(q);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await rollbackQuietly(client, "withTenant");
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
