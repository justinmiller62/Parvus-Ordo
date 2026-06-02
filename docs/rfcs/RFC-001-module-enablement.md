# RFC-001 — Per-parish module-enablement layer

**Status:** Draft (design-only; no code in Phase 1) · **Addresses:** po-d50 (HIGH) · **Refs:** po-9us
**Depended on by:** RFC-003 (systems-admin) · **Author:** platform-architect

## 1. Problem

CLAUDE.md states modules "must become toggleable per parish," but no mechanism exists.
Access is decided **purely by role**, and that logic is **scattered and already inconsistent**:

- `apps/web/src/components/app-shell.tsx:44-50` — `ociaEligible`/`youthEligible` (client component).
- `apps/web/app/(app)/page.tsx:21-22` — redefines `youthEligible` **differently** (`admin || super_admin`
  only, vs app-shell's `studio|catechist|admin|super_admin`). Same name, two meanings.
- `apps/web/app/(app)/ocia/layout.tsx:12`, `parvus-studio/*` — per-route `redirect("/")` gates.
- Dictionary/Prayers are hard-wired `live: true` in `CATECHIST_MODULES`/`LEARNER_MODULES`.

Consequence: every parish with a given role gets every module that role can see. A parish that doesn't
want Parvus Studio or the Dictionary cannot turn it off; there is no way to dark-launch a module to one
pilot parish. There is no `parish_modules` table, no `enabled_modules` column, no flag anywhere in
`infra/db/migrations`.

## 2. Goals / non-goals

**Goals.** (1) Per-parish on/off, keyed by parish. (2) One source of truth for "is module M available
to viewer V in parish P" = `enabled(P,M) AND roleCapable(V.role, M)`. (3) Cheap — resolved once per
request, folded into the already-`cache()`-wrapped `getViewer`. (4) The substrate the systems-admin tool
(po-2mm/RFC-003), billing, onboarding, and dark-launch all build on.

**Non-goals.** Billing/entitlements (this is the substrate they sit on), per-user flags, A/B, diocese
cascade (noted as a future option).

## 3. Design

### 3.1 Module registry in `packages/shared`
So app + core + the future admin tool share one definition (today `Role`/`ROLE_LABELS` already live
in `packages/shared/src/index.ts`).

```ts
export type ModuleKey = "ocia" | "media" | "people" | "studio" | "dictionary" | "prayers" | "onboarding";

export interface ModuleDef {
  key: ModuleKey;
  label: string;
  roles: Role[];          // roles that may use it WHEN enabled (capability, not enablement)
  toggleable: boolean;    // false = always-on platform capability (cannot be disabled)
  defaultEnabled: boolean;
}
export const MODULES: Record<ModuleKey, ModuleDef> = { /* … */ };
```

`platform`, `branding`, `auth` are **infra, not modules** (always on) and are not in this registry.

### 3.2 Data model — migration `0021_parish_modules` (additive)

```sql
CREATE TABLE parish_modules (
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  module_key  text NOT NULL,
  enabled     boolean NOT NULL DEFAULT true,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (parish_id, module_key)
);
ALTER TABLE parish_modules ENABLE ROW LEVEL SECURITY;
CREATE POLICY parish_modules_isolation ON parish_modules FOR ALL
  USING (parish_id = current_setting('app.parish_id', true)::uuid)
  WITH CHECK (parish_id = current_setting('app.parish_id', true)::uuid);
```

Same RLS pattern as `prayer_overrides` (0020) / `dictionary_overrides` (0019).

**Sparse-row semantics:** a missing row means "use `MODULES[key].defaultEnabled`." Only a non-default
choice writes a row. No parish×module backfill on provision; default state needs no rows. The resolver
merges defaults with present rows.

**Alternative considered — `enabled_modules text[]` on `parishes`:** rejected. No per-module
`updated_at`/audit, no room for per-module config later, toggling is read-modify-write on a shared row,
and it diverges from the established child-table+RLS pattern. A child table is the RLS-consistent,
extensible choice.

### 3.3 Core resolver — `packages/core/src/platform/modules.ts`

```ts
export async function enabledModules(parishId: string): Promise<Set<ModuleKey>> {
  const { rows } = await getDb(parishId).query<{ module_key: string; enabled: boolean }>(
    "SELECT module_key, enabled FROM parish_modules");
  return resolveEnabled(rows, MODULES);   // resolveEnabled = pure, in shared, unit-tested
}
export function moduleAvailable(role: Role | null, key: ModuleKey, enabled: Set<ModuleKey>): boolean {
  return enabled.has(key) && !!role && MODULES[key].roles.includes(role);
}
```

`resolveEnabled(rows, MODULES)` (pure, in `shared`) overlays present rows onto defaults → `Set<ModuleKey>`.

### 3.4 Request integration — fold into `getViewer`
`getViewer` is already `cache()`-deduped per request (`apps/web/src/lib/viewer.ts:35`). Add
`enabledModules: Set<ModuleKey>` for the **active parish** to the returned `Viewer`. Enablement is the
**parish's** property, independent of role — so super-admin "view as" does not change it. Cost: +1 query
inside `getViewer` (once per request; see RFC-002 §B for collapsing it with the existing lookups).

### 3.5 Enforcement — defense in depth (two layers)

- **Nav (app-shell):** pass `enabledModules` in; generate nav from `MODULES` filtered by
  `moduleAvailable(...)`. This **deletes** the scattered/duplicated `ociaEligible`/`youthEligible` and
  the hard-wired module arrays — one registry-driven list.
- **Entry points (the real gate):** a thin shared guard `requireModule(key)` in `apps/web/src/lib`
  calling the core resolver, used by each module's route-group `layout.tsx` (`ocia`, `parvus-studio`,
  `dictionary`, `prayers`) → `notFound()` for direct deep links, `redirect("/")` for top-level. **Server
  Actions, `/api/v1`, and the MCP server that touch a module's data must also check** — a disabled module
  rejects direct calls, it doesn't merely hide nav. Rule to document: *a module shim checks role AND
  module-enabled* (`auth → validate → requireModule → call core`). Core stays pure (takes `parishId`,
  not `viewer`); enforcement lives in the shim, consistently.

### 3.6 Rollout
Additive migration; `defaultEnabled: true` for all current modules ⇒ **zero behavior change** on deploy
(every parish keeps everything). Admins then disable per parish via RFC-003. No backfill (sparse defaults).

## 4. RLS / security
`parish_modules` is parish-isolated; reads via `getDb(parishId)`. Toggling writes the **target parish's
own row**, so the admin write path (RFC-003) uses `getDb(targetParishId)` — `WITH CHECK` passes; no
elevation needed (unlike parish *creation*, which does — see RFC-003 §1).

## 5. Test plan
- **unit:** `resolveEnabled` merge (default vs row, unknown keys), `moduleAvailable`.
- **integration (real PG):** RLS — parish A cannot read or toggle parish B's `parish_modules` rows.
- **e2e:** disable a module → nav hides AND deep link 404s; re-enable → restored.

## 6. Open questions (for mayor / user)
1. **Which modules are toggleable vs always-on?** Proposed toggleable: `ocia, studio, dictionary,
   prayers, onboarding`. Proposed always-on for staff: `people`. Is `media` its own module or part of
   OCIA (today it's an asset library used by OCIA)?
2. **Disabled deep link:** 404 (hide existence) vs redirect? Proposed: 404 for deep links, redirect for
   top-level.
3. **Diocese cascade** (a diocese enables a module for all its parishes), mirroring brand cascade?
   Proposed: defer; single-parish granularity first.

