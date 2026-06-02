# RFC-002 — Database connection scaling: front a pooler, trim needless transactions

**Status:** Draft (design-only; no code in Phase 1) · **Addresses:** po-tby (HIGH) · **Refs:** po-9us, po-do5
**Author:** platform-architect · **Stack:** respects LOCKED stack (Neon + stateless Cloudflare Container)

## 1. Problem

`getDb(parishId).query` (`packages/core/src/db/client.ts:30-52`) does, for **every logical read**:
`pool.connect()` → `BEGIN` → (if parishId) `set_config('app.parish_id', …, true)` → `query` → `COMMIT`
→ `release`. That is 3–4 server round trips and holds a pooled connection for the whole transaction.
The pool is `max: 10` **per container process** (`client.ts:21`).

An authenticated page does several such reads, and `getViewer` alone runs **2** transactions before the
page's own queries (`lookupAppUser` + `resolveParishIdForHost`, `viewer.ts:38,44`). So ~10 connections
are exhausted by only a few concurrent users. Today `wrangler.jsonc` pins `max_instances: 1`
(`standard-1`) — a deliberate dev guard ("Raise for prod") — so the ceiling is literally 10 connections;
adding instances makes the ceiling `instances × 10` against Neon's own connection limit.

`getDb` is **the single chokepoint** (its docstring + CLAUDE.md §5: the Neon-serverless swap lives only
here), so every fix below is local to `client.ts` plus infra config. The `parishes.dedicated_db_url`
Phase-4 hook (`client.ts:8-9`, column from `0001`) remains the escape hatch for a whale tenant.

## 2. Design — three independent, layered improvements

### (A) Front a server-side pooler — Neon PgBouncer / `-pooler` endpoint  *(primary fix)*
Point `DATABASE_URL` at Neon's **pooled** connection string (the `-pooler` host) in deployed envs. Neon's
PgBouncer (transaction mode) multiplexes many client connections onto few Postgres backends, so the
per-container pool can stay modest while **Postgres-side backends stay bounded** — this removes
`instances × 10` as the first hard wall.

**Compatibility (must verify, but our usage fits):** transaction-mode pooling forbids session-scoped
state (`SET SESSION`, session-pinned `LISTEN/NOTIFY`, cross-statement named prepared statements). We use
only **transaction-local** `set_config(…, true)` (= `SET LOCAL`) inside an explicit `BEGIN/COMMIT`, which
is exactly what transaction pooling supports; `pg` issues unnamed parse/bind per query (no persistent
prepared statements). Action: keep per-container `pool.max` modest (10–20) and add an integration test
that runs **through the pooled endpoint**.

### (B) Remove transactions that serve no isolation purpose  *(safe, high-value, local)*
The two pre-tenant lookups in `getViewer` call `getDb(null)` — `parishId` is null, so the `if (parishId)`
GUC set is **skipped**; they are `BEGIN; SELECT …; COMMIT` with **no tenant context to isolate**. The
transaction is pure overhead.

- **B1 — transaction-less path for `getDb(null)` single reads.** When `parishId === null`, run the
  statement directly on the pool (`pool.query(sql, params)` — checkout, run, release, autocommit, no
  `BEGIN`). Removes `BEGIN/COMMIT` from **every** `SECURITY DEFINER` cross-tenant lookup: `login_lookup`,
  `resolve_parish_id`, `list_application_parishes`, and `validateMcpToken` (the per-message MCP lookup,
  its own bead **po-do5**). Safe: no GUC, single statement.
- **B2 — collapse `getViewer`'s two lookups into one round trip.** Both are `getDb(null)` reads; combine
  into a single `SELECT` (or one combined SQL function) so identity + host→parish resolve in one
  exchange. `getViewer` goes 2 reads → 1.
- **B3 — keep tenant reads (`parishId != null`) transactional.** This is **required for correctness**
  under a transaction-mode pooler: tenant isolation needs the GUC to be transaction-local
  (`set_config(…, true)`), which only persists across the set+query inside a `BEGIN/COMMIT`. Do **not**
  switch tenant reads to a session-scoped GUC — under pooling the setting would leak to the next tenant
  that checks out the connection. After (A), per-read round-trip count is a latency concern, not a
  capacity wall; optimize it only if profiling says so (e.g. evaluate the Neon serverless driver's
  `transaction()` HTTP single-shot for one-statement reads). **Measure first.**

### (C) Document & enforce the connection budget  *(tiny, prevents the footgun)*
Couple the two knobs that today drift independently: per-container `pool.max` (`client.ts:21`) and
`max_instances` (`wrangler.jsonc`). Add cross-referencing comments in both files:
*"`pool.max` × `max_instances` must stay under the Neon endpoint's connection limit; raise
`max_instances` only against the pooled (`-pooler`) endpoint."* Log effective `pool.max` at startup.

### (D) Fail fast under saturation  *(cheap reliability win)*
The pool has no timeout — a saturated pool **hangs** the request. Add `connectionTimeoutMillis` (pool)
and a `statement_timeout` so an overloaded container returns 503 quickly instead of cascading latency.

## 3. Sequencing & effort
1. **(A) + (C) + (D)** — config + driver verification + tiny client/wrangler edits. Highest impact,
   lowest risk. Removes the capacity wall and adds graceful degradation.
2. **(B1) + (B2)** — small `client.ts` + `getViewer` change; cuts the per-request transaction count
   (esp. the 2→1 viewer collapse and BEGIN/COMMIT removal on all cross-tenant lookups).
3. **(B3 optimization)** — deferred, measure-first.

## 4. Risks
Transaction-mode pooler + any accidental session state = subtle cross-request bugs → mitigated by the
pooled-endpoint integration test (§A). All changes stay inside the `getDb` chokepoint + infra config, so
no call sites change (per CLAUDE.md §5).

## 5. Test plan
- **integration:** run the existing suite against the `-pooler` endpoint (proves transaction-local GUC
  isolation holds under pooling); assert `getDb(null)` path issues no `BEGIN`.
- **load smoke:** N concurrent authed renders stay under the connection budget with the pooler; without
  it, reproduce exhaustion at ~10.

