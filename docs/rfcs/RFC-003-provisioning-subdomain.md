# RFC-003 — Systems-admin / provisioning + subdomain model

**Status:** Draft (design-only; no code in Phase 1) · **Addresses:** po-2mm (MED) · **Refs:** po-9us
**Depends on:** RFC-001 (module registry/toggle) · **Complements:** RFC-002 · **Author:** platform-architect

## 1. Problem

There is no super-admin surface to create a parish, assign its slug/subdomain, set `custom_domains`, or
toggle modules. The only parish-level mutation in core is `setApplicationsEnabled`
(`onboarding/applicants.ts:152`). Parishes are created via seed scripts / manual SQL; slug→subdomain and
`custom_domains` are hand-edited. `is_super_admin` exists and is read by `getViewer` as `canImpersonate`
(`viewer.ts:54`), but no `/admin` area consumes it for configuration. At any real tenant count, onboarding
a parish is a manual DB operation — unscalable and error-prone (a typo'd slug silently breaks
`resolveParishIdForHost`).

## 2. Core principle: the "admin plane" vs the "tenant plane"

The `parishes` RLS policy is `USING (id = current_setting('app.parish_id', true)::uuid)` with **no insert
policy and no `WITH CHECK`** (`0001_foundation.sql:76-77`). Therefore the non-superuser app role
**cannot `INSERT` a new parish** (the new row's `id` is unknown pre-insert, so it can never equal
`app.parish_id`). Parish *creation* and any cross-tenant admin read/write must go through the
**owner/elevated `SECURITY DEFINER` path**, exactly like the existing pre-tenant lookups
(`resolve_parish_id` in `0010`, `login_lookup`, `list_application_parishes`). This is the established
pattern; the admin tool is its natural home.

(Note the asymmetry: *editing an existing parish's own row* — slug, `custom_domains`, `applications_enabled`,
and `parish_modules` toggles — works under `getDb(targetParishId)` because the `USING` check passes on
`id = app.parish_id`. Only **creation** and **cross-tenant listing** strictly require elevation. For
uniformity and centralized validation, this RFC routes all admin writes through the elevated module.)

## 3. Design

### 3.1 Core module — `packages/core/src/platform/admin.ts` (super-admin gated)
- `provisionParish({ name, slug, dioceseId? })` → `SECURITY DEFINER admin_create_parish(...)`: validates
  slug (format + global uniqueness + reserved labels), inserts `parishes`, optionally seeds default
  ministries / the first admin membership / initial non-default `parish_modules` rows; returns the row.
- `setParishSubdomain(parishId, slug)` / `setCustomDomains(parishId, domains[])` — elevated path;
  validate slug rules and **uniqueness** (`slug` is `UNIQUE`; `custom_domains` is the resolve key, so
  collisions must be rejected) and reserved labels (`www`, `app` — see `hostname.ts:11`).
- `setModuleEnabled(parishId, key, enabled)` — writes `parish_modules` (RFC-001); validates
  `key ∈ MODULES` and `toggleable`.
- `listParishes()` → `SECURITY DEFINER admin_list_parishes()` (like `list_application_parishes`).

DDL lives in migration **`0022_admin`** (SECURITY DEFINER functions + `REVOKE … FROM PUBLIC` +
`GRANT EXECUTE … TO parvaordo_app`, mirroring `0010`). No column changes — `slug`, `custom_domains`,
`dedicated_db_url` already exist on `parishes`.

### 3.2 App surface — `/admin` route group (`apps/web/app/(admin)/`)
- Gated on `viewer.canImpersonate` (is_super_admin) → `redirect("/")` otherwise. **Every** admin Server
  Action re-asserts `is_super_admin` server-side (nav hiding ≠ enforcement).
- Pages: parish list + "create parish"; per-parish editor (name, **live subdomain preview**
  `<slug>.<PARISH_BASE_DOMAIN>`, custom domains, module toggles from RFC-001).
- Mutations are thin Server Action shims over `platform/admin` (`auth: assert super_admin → validate →
  call core → revalidate`).

### 3.3 Subdomain model (the tenancy half of the mandate)
- **Resolution already exists** and is sound: `resolveParishRef` → `resolve_parish_id` (slug XOR
  `custom_domains`), and the *same* parish row resolves in every env via `PARISH_BASE_DOMAIN` (`0010`
  header). Provisioning's job is only to **write valid, unique slugs safely** — which is exactly what's
  missing today.
- **Naming convention:** slug includes the **city** for global uniqueness (two "Holy Spirit" parishes
  need disambiguation; `slug` is `UNIQUE`), e.g. `holy-spirit-lockhaven` →
  `holy-spirit-lockhaven.parvusordo.com`. Encode as a shared validator (`lowercase`, `[a-z0-9-]`, not
  reserved, globally unique) used by both the admin UI and core.
- **Infra dependency (surfaced):** serving `*.parvusordo.com` per parish needs a **wildcard TLS cert**.
  `wrangler.jsonc` already notes the 2-level wildcard `*.dev.parvusordo.com` requires **Advanced
  Certificate Manager** (Universal SSL doesn't cover 2-level wildcards) plus a proxied DNS record, and
  that the API token lacks DNS-edit (a **one-time** manual dashboard step). Net: provisioning a parish is
  a **DB write only** against an already-provisioned wildcard — **no per-parish DNS/cert edits** — which
  is what makes the subdomain model scale.
- **Custom domains (prod-only):** parish brings its own domain → add to `custom_domains[]`, they CNAME to
  us, and certs are issued via **Cloudflare SSL-for-SaaS / custom hostnames** (the scaling mechanism for
  many BYO domains; one-time platform setup). Flag as a follow-on once subdomains ship.

### 3.4 Seam to the future CMS roadmap RFC
Today a parish subdomain with no public site shows the **login** screen (apex/login). The CMS RFC will
make the subdomain serve the parish's **edge-cached public website**. The clean seam: **CMS is itself a
module** (RFC-001); when enabled, the subdomain root renders public, cacheable pages, else it falls
through to login. `resolveParishRef` already distinguishes apex vs parish, so the branch is
"parish + CMS-enabled → public site (cache) ; else → login." Cross-link from the CMS RFC.

## 4. Security
- `super_admin` stays the `is_super_admin` flag, never minted via invite (existing invariant).
- Cross-tenant privileged writes warrant an **`admin_audit`** table (who/what/when/target-parish) — there
  is an MCP audit-log precedent. Recommended in `0022_admin`.
- Re-assert `is_super_admin` in every admin action; elevated `SECURITY DEFINER` functions `REVOKE FROM
  PUBLIC` and `GRANT EXECUTE` only to `parvaordo_app`.

## 5. Sequencing
RFC-001 (registry + `parish_modules`) → **RFC-003** (admin consumes the toggle + provisions parishes).
RFC-002 is independent and can land in parallel. This RFC is the prerequisite for scalable onboarding,
and a dependency of the Ministries-management and CMS roadmap RFCs.

## 6. Open questions (for mayor / user)
1. Should `provisionParish` auto-create the first parish admin (invite) + default ministries? Proposed:
   yes, as optional params.
2. Diocese management (the `dioceses` table exists) in the same tool now, or v2? Proposed: v2.
3. Self-serve parish signup vs super-admin-only? Mandate = super-admin configures → **admin-only now**.

