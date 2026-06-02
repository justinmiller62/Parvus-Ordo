# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

**Parvus Ordo** ("the little order" — *"many small things, rightly ordered"*) is a multi-tenant
fullstack app for small Catholic parishes: OCIA formation (lesson builder + learner wizard), a parish
media library, onboarding/invites, a people-management console, and **Parvus Studio** (teens script
catechetical videos with AI help via MCP, then record them in the companion iOS app).

It is **one fullstack Next.js app, not a frontend + a separate API service.** Separation of concerns
comes from a *code* boundary (`packages/core`), never a network hop.

- **Canonical spec + memory** live in the anchor folder `~/Desktop/ParvoOrdo/` (CLAUDE.md + memory),
  intentionally separate from this code. Treat its CLAUDE.md as the source of truth if the two ever drift.
- **Companion app:** Parvus Studio (iOS) at `~/Desktop/Parvus Studio` — consumes the
  `/api/v1/parvus-studio/*` REST contract and the `/api/mcp/studio` MCP server.
- **Narthex port:** `docs/narthex/*.md` are deep specs of the legacy "Narthex" app being faithfully
  re-ported into this stack; `docs/narthex/DELTAS.md` tracks built-vs-spec gaps (☐ open / ☑ fixed).

## Build / run

pnpm + Turborepo monorepo. Postgres runs in Docker locally; the same Dockerfile is the prod image, so
**what runs locally is what runs in prod**.

```bash
pnpm install
pnpm db:up                 # Docker Postgres on :5432
pnpm db:migrate            # apply infra/db/migrations/*.sql (node migrate.mjs)
pnpm db:seed               # demo data (Holy Spirit / St. Monica / St. Peter); DESTRUCTIVE (TRUNCATEs)
node infra/db/seed-youth.mjs   # Parvus Studio demo (run AFTER the main seed)
pnpm dev                   # turbo → next dev on :3000

pnpm typecheck             # tsc --noEmit across all packages
pnpm lint                  # turbo run lint
pnpm test                  # unit (vitest)              — packages/**/*.test.ts
pnpm test:int              # integration (real Postgres) — packages/**/*.int.test.ts
pnpm test:e2e              # Playwright (boots dev, seeds the E2E parish)
pnpm db:reset              # down -v → up → migrate → seed (nuke + repave local DB)
```

Run a single test: `pnpm vitest run path/to/file.test.ts` (add `-t "name"` to filter by test name);
integration variants use `--config vitest.int.config.ts`.

**Dev auth bypass:** real login is WorkOS AuthKit, but locally/tests use `/dev/login?email=…`
(gated by non-production **AND** `AUTH_BYPASS=1`). `/dev/reset?email=…` clears a learner's progress;
`/dev/studio-reset?project=…&parish=…` resets a studio project. These 404 in production.

## Architecture

### The backend boundary (the one rule that matters)

**`packages/core` holds ALL business logic, data access, and validators. It imports no React and no
Next.js — this is "the backend."** Every entry point is a thin (~10-line) shim over it:

- **Reads** → RSC (Server Components call `core` directly). **Mutations** → Server Actions.
  **External consumers** (iOS) → small REST `/api/v1`. **AI** → the MCP server. No GraphQL.
- A Server Action / route handler is *auth check → validate input → call `core` → return*. The moment
  business logic leaks into a shim, move it into `core`.
- **Never add a standalone API service** to "separate concerns" — the clean `core` boundary is what
  makes a future extraction mechanical *if* a real trigger ever appears. Defer that cost until it does.
- **Out-of-band work** (transcription, clip-cutting, embeddings, bulk email) → `infra/workers`
  (Containers/Queues/Cron), but it still calls `core`.

### Hosting & request flow

Next.js **16** runs `next start` inside a **Cloudflare Container** (NOT Workers/OpenNext — Next 16's
Node `proxy.ts` isn't buildable on OpenNext). Cloudflare's edge **caches** in front of it. DB is **Neon**.

- **Public/CMS content** (Mass times, bulletins, homepage): `Cache-Control: public, s-maxage=…,
  stale-while-revalidate=…` → served from the edge, rarely hits the container.
- **Authenticated/dynamic content** (portal, OCIA, Parvus Studio, dashboards) is per-user → **never
  edge-cached**; renders fresh from the container + Neon. Keep the container **stateless** (no Redis,
  no ISR cache — lean on the edge).
- `infra/edge/worker.ts` forwards runtime secrets into the container and rewrites internal
  `0.0.0.0:3000` redirects (e.g. post-login) back to the public origin. On publish → write Neon →
  purge the edge cache for the affected URLs.

### Folder map

- `apps/web/` — the Next 16 app (`@parvaordo/web`). `app/(app)/` = authed shell (`ocia/`,
  `parvus-studio/`, `people/`, role-aware sidebar). `app/api/` = `mcp/studio` (MCP),
  `v1/parvus-studio/*` (iOS REST). `app/{login,sign-in,callback}` (WorkOS), `app/apply` (public OCIA),
  `app/dev/*` (bypass). `src/lib/` = `viewer` (request identity + active parish), `auth`, `api-auth`.
- `packages/core/src/` — the backend, by module: `platform/` (parishes, identity, hostname tenancy),
  `branding/`, `ocia/`, `media/`, `onboarding/`, `people/`, `youth-teaches/` (Parvus Studio),
  `dictionary/`. `db/client` = `getDb(parishId)`.
- `packages/shared/src/` — framework-agnostic types (`Role`, `ROLE_LABELS`, brand tokens). No React/Next.
- `infra/db/` — `migrations/*.sql` (numbered, append-only), `migrate.mjs`, `seed*.mjs`.
  `infra/workers/clip-cutter/` — out-of-band ffmpeg clip service (pure transform; zero business logic).

### Key invariants

- **Multi-tenant RLS:** every parish-scoped query goes through `getDb(parishId)`, which sets
  `app.parish_id` transaction-local; Postgres RLS policies pin rows to that parish. **Cross-tenant
  access is a bug.** The seed/migration role bypasses RLS (owner); pre-tenant lookups (e.g. MCP token
  validation) use a `SECURITY DEFINER` function.
- **Tenancy hierarchy:** diocese → parish → ministry/council → member. Parishes resolve by **slug +
  `PARISH_BASE_DOMAIN`** (per env), with `custom_domains` overrides.
- **Roles** (`membership_role`): `super_admin, admin, catechist, catechumen_candidate, parish_member,
  studio`. `super_admin` is the `users.is_super_admin` flag, never minted via invite.
- **Migrations are append-only and numbered** (`0001…`); never edit an applied one — add the next.

### Deploy

CI (`.github/workflows/development.yml`) on push to **`development`** → typecheck → unit → migrate Neon
(dev branch) → `wrangler deploy` (Dockerfile → Cloudflare Container) → upload secrets. Dev env:
**dev.parvusordo.com**. Secrets are GitHub Environment secrets, not in the repo.

## Scope discipline

**Stack is LOCKED:** Next.js 16 in a Cloudflare Container (no Workers/OpenNext, no Vercel — egress),
Neon, WorkOS, Bunny, R2, Groq. Reads→RSC, mutations→Server Actions, external→`/api/v1`, AI→MCP. **No**
GraphQL, **no** standalone API service, **no** Redis/ISR cache for public content, **no** business
logic outside `packages/core`.

This is a **solo project** (one builder + Claude) — favor a system you can hold in your head and operate
alone. When in doubt: smallest change that traces directly to the request; match the surrounding code's
style; surface tradeoffs and ask before building something speculative.
