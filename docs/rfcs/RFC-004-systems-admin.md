# RFC-004 — Systems-Admin / Setup Manager

**Status:** **rfc-ready** — D1 + D2 resolved 2026-06-02 (diocese cascade builds now, data+resolver = po-ekjb; impersonation = **read-write + mandatory audit**) · **Addresses:** po-724 (net-new) · **Refs:** po-2mm, po-9us
**Builds on:** RFC-001 (module-enablement — *in build, prerequisite*) · **Absorbs:** RFC-003 (provisioning + subdomain — *held; rector decomposes via RFC-004*) · **Complements:** RFC-002 (db scaling — in build)
**Author:** platform-architect · **User-locked answers:** BUILD auth po-wisp-rrwul

> This is the **implementation RFC** for the first net-new feature: the super-admin tool that replaces
> manual-SQL parish provisioning. It folds in RFC-003's admin-plane + subdomain design wholesale (cited,
> not re-derived) and consumes RFC-001's module toggle, then extends both into a full management surface:
> create/list parishes, subdomain, module toggles (parish + diocese-cascade management UI), per-parish
> branding, first-admin handoff, a stats dashboard, lifecycle (activate/suspend), and server-side
> "view as parish".

---

## 1. Problem & what exists today

Onboarding a parish is a **manual DB operation**: insert `parishes` (slug, `primary_hostname`,
`custom_domains`, `diocese_id`, `brand`), hand-edit the slug, set `applications_enabled`, seed the first
admin membership by SQL. A typo'd `slug` silently breaks `resolve_parish_id` (`0010`). There is **no
super-admin surface** to do any of it — `apps/web` has no `(admin)` route group, and the only
parish-level mutation in core is `setApplicationsEnabled` (`onboarding/applicants.ts`).

What the schema **already** gives us (grounded in `infra/db/migrations/`):

| Concern | Exists today | Gap |
|---|---|---|
| Tenancy key | `parishes.slug UNIQUE`, `primary_hostname UNIQUE`, `custom_domains text[]` (`0001`,`0010`) | no UI to set them safely |
| Hostname→parish | `resolve_parish_id(slug, domain)` SECURITY DEFINER (`0010`) | sound; nothing to change |
| Branding | `dioceses.brand jsonb` + `parishes.brand jsonb` — **two cascade tiers already modeled** (`0001`) | no typed schema, no resolver, no editor |
| Super-admin | `users.is_super_admin`; `viewer.canImpersonate`; role-only `po_view_as` cookie (`viewer.ts:64-72`) | cannot select a parish you have **no membership** in |
| Module toggle | **in build** — RFC-001 `parish_modules`/`diocese_modules` (po-m05v/po-ekjb) | RFC-004 adds the admin UI over it |
| Parish lifecycle | `applications_enabled` only | no `active`/`suspended` status |
| Provisioning | — | net-new (RFC-003: `admin_create_parish` SECURITY DEFINER) |
| First-admin invite | `inviteMember(input, caller)` (`onboarding/invite.ts:71`) | reusable for handoff |
| Stats | — | net-new (SQL aggregates) |

So the tool is mostly **net-new UI + a SECURITY DEFINER admin core** over a schema that already anticipated
multi-tenancy. **Migration numbering:** the tip is past 0023 (`0022` is taken) — build beads must use the
**next free integer at build time**, never a hardcoded number (collision rule).

## 2. Scope & relationships

**In scope (po-724 locked scope):** create/list parishes · set subdomain (slug + `custom_domains`) · module
toggles — **parish + diocese-cascade management UI** (§11) · per-parish branding · seed first admin +
setup-link handoff · stats dashboard · lifecycle (activate/suspend) · "view as parish" impersonation
(§10/§16-D2). Polished, delightful UX is a **requirement**, not a finish (§13).

**Relationship to prior RFCs.**
- **RFC-001 (po-3db)** — module-enablement, **now in build**: po-dnp0 (registry + pure resolver,
  *toggleable = ocia/studio only*), po-m05v (`parish_modules` + `enabledModules`), **po-ekjb
  (`diocese_modules` + 3-layer resolver)**, po-z11o (getViewer fold-in), po-8j0q (nav), po-7diw
  (`requireModule` enforcement — *redirect home when disabled*). This is RFC-004's **build prerequisite**.
  Per the user's locked answers (po-wisp-rrwul, overriding RFC-001 §6): **toggleable = {ocia, studio}
  only**; **disabled-module access redirects home** (not 404); **full diocese cascade incl. management
  UI**. RFC-004 owns the diocese **management UI + admin write path only** — the `diocese_modules` table +
  3-layer resolver are **po-ekjb's; do not re-spec them**.
- **RFC-003 (po-7rz)** — provisioning + subdomain. **Absorbed + held**: the rector is **not** decomposing
  RFC-003 separately (it would duplicate this admin plane); RFC-004 covers all of RFC-003's
  provisioning/subdomain scope plus the additions, and the rector decomposes RFC-004 once it reaches
  rfc-ready. RFC-003 §2 (admin-plane), §3.1 (`admin_create_parish` etc.), §3.3 (subdomain + wildcard cert)
  are the foundation of §5/§6 here.
- **RFC-002 (po-iih)** — independent, in build (po-4a29 pooler, po-8p99 txn-trim); the admin tool's reads
  benefit from it but don't depend on it.

**Narthex overlap** (`docs/narthex/admin.md`, `settings-branding.md`): the legacy `/admin` is a read-only
**parish-switcher + stats + client-side impersonation** — no parish CRUD. This tool **absorbs** the
stats-browse and re-implements impersonation server-side (per the port note), and **adds** everything CRUD.
Per-parish *member/cohort/calendar/api-key* management stays in the **parish** Settings console
(`settings-branding.md`), not here — the super-admin seeds the first admin and hands off (§6.3). What this
delivers vs. Narthex is enumerated in §17.

## 3. Module boundaries (where the code lives)

Respecting CLAUDE.md §5 (`packages/core` = all logic; entry points are thin shims):

- `packages/shared/src/` — `ModuleKey`/`MODULES` (RFC-001), plus net-new **`BrandConfig`** type + pure
  `resolveBrand()` cascade, **`PARISH_STATUS`** union, and the shared **slug validator** (`isValidSlug`,
  reserved labels). Pure, isomorphic, unit-tested. App + core + admin UI share one definition.
- `packages/core/src/platform/admin.ts` — the **super-admin-gated admin plane**: `provisionParish`,
  `listParishes`, `getParishStats`, `setParishSubdomain`, `setCustomDomains`, `setModuleEnabled`,
  `setDioceseModuleDefault` (write path over po-ekjb's resolver), `setParishBrand`, `setParishStatus`,
  `inviteFirstAdmin`, `beginImpersonation`/`endImpersonation` context helpers, audit writes. Every fn
  re-asserts super-admin and routes cross-tenant work through SECURITY DEFINER functions (§5).
- `apps/web/app/(admin)/` — net-new route group. RSC reads (list, per-parish editor, stats) + thin Server
  Action shims (`auth: assert super_admin → validate → call core → revalidate`). No business logic.
- `apps/web/src/lib/` — `requireSuperAdmin()` guard; impersonation context read folded into `getViewer`.
- **No `/api/v1`** unless an external consumer needs cross-tenant admin reads — defer until a real trigger
  (Narthex admin had none).

## 4. Data model + migrations (additive, next-free numbers)

> RFC-004 adds **two** migrations (lifecycle/audit + admin-plane functions). The `diocese_modules` table is
> **not** here — it's **po-ekjb** under RFC-001. `0025/0026` below are illustrative; build beads use the
> next free integer at build time (the tip is past 0023). Each is append-only.

### 4.0 Prerequisites (RFC-001, in build)
`parish_modules` (po-m05v) + `diocese_modules` + 3-layer resolver (po-ekjb) + `requireModule` (po-7diw).
RFC-004 builds on these; it does not re-define the tables or the resolver.

### 4.1 `0025_parish_admin` — lifecycle, audit

```sql
-- Parish lifecycle. 'active' default keeps every existing parish live on deploy (zero behavior change).
ALTER TABLE parishes
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending_setup', 'active', 'suspended'));

-- Cross-tenant privileged-write audit (RFC-003 §4 recommended it; required here).
CREATE TABLE admin_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES users(id),
  action      text NOT NULL,                 -- 'provision_parish' | 'set_status' | 'set_module' | 'impersonate' | …
  target_parish_id uuid REFERENCES parishes(id) ON DELETE SET NULL,
  detail      jsonb,                          -- before/after, args (no secrets)
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Written ONLY by the SECURITY DEFINER admin functions; readable only via an admin SECURITY DEFINER reader.
ALTER TABLE admin_audit ENABLE ROW LEVEL SECURITY;   -- no tenant policy ⇒ no tenant-plane access at all.
```

### 4.2 `0026_admin_plane` — SECURITY DEFINER provisioning (RFC-003 §3.1, expanded)
`admin_create_parish(name, slug, diocese_id)` (creates a **bare shell**, `status='pending_setup'`, **no
seeding**), `admin_list_parishes()`, `admin_get_parish_stats(parish_id)`, `admin_set_status(parish_id,
status)`, `admin_write_audit(...)` — all `SECURITY DEFINER`, owned by the elevated role,
`REVOKE … FROM PUBLIC`, `GRANT EXECUTE … TO parvaordo_app` (mirrors `0010`/`login_lookup`). Rationale:
`parishes` RLS is `USING (id = app.parish_id)` with **no insert policy** (`0001:75-76`), so the app role
cannot `INSERT` a parish — creation and cross-tenant listing **require** elevation (RFC-003 §2). The diocese
module write (`setDioceseModuleDefault`) is likewise elevated (diocese scope is above the parish tenant).

### 4.3 No schema change for branding or setup
`brand jsonb` already exists on `dioceses` + `parishes` (§7 types it). The setup-link handoff reuses the
existing WorkOS invitation path (`inviteMember`) — **no setup-token table** (§6.3).

## 5. RLS / admin-plane security (absorbs RFC-003 §2, §4)

- **`super_admin` is the `users.is_super_admin` flag**, set out-of-band, never minted via invite (existing
  invariant; `onboarding/roles.ts:3-4`). `requireSuperAdmin()` re-asserts it **server-side in every admin
  Server Action** — nav hiding ≠ enforcement.
- **Two planes.** *Tenant plane:* editing a parish's **own** row (slug, `custom_domains`, `brand`,
  `status`, `parish_modules`) passes parish RLS under `getDb(targetParishId)`. *Admin plane:* **creation**,
  **cross-tenant listing/stats**, and **diocese-scope writes** strictly require SECURITY DEFINER (the new
  row's id is unknown pre-insert, so `id = app.parish_id` can never hold; diocese rows are above the parish
  tenant). For uniformity + central validation + auditing, **all admin writes route through the elevated
  module**, even the ones RLS would technically allow.
- **Audit.** Every privileged write appends `admin_audit` (who/action/target/detail) inside the same
  DEFINER call. Impersonation start/stop is audited too (§10).
- DEFINER functions `REVOKE FROM PUBLIC`, `GRANT EXECUTE` only to `parvaordo_app`.

## 6. Provisioning & subdomain flow (absorbs RFC-003 §3)

### 6.1 Subdomain model (unchanged from RFC-003 — sound)
Resolution already works in every env via `PARISH_BASE_DOMAIN` + `resolve_parish_id` (slug XOR custom
domain). **Naming = `slug-city` for global uniqueness** (po-724): `holyspirit-austin` →
`holyspirit-austin.parvusordo.com`. The shared validator enforces `lowercase`, `[a-z0-9-]`, not a reserved
label (`www`, `app` — `hostname.ts`), globally unique (`slug` is `UNIQUE`; collisions rejected with a clear
error). `custom_domains` collisions likewise rejected (it's a resolve key).

### 6.2 Infra dependency (surfaced, from RFC-003 §3.3)
Serving `*.parvusordo.com` needs a **wildcard TLS cert** — a **one-time manual ops prerequisite** (Advanced
Certificate Manager for the 2-level wildcard; `wrangler.jsonc` notes Universal SSL doesn't cover it, and the
API token lacks DNS-edit → one manual dashboard step). The rector is surfacing this to the user as an **ops
task, not fleet build work**. **Once provisioned, provisioning a parish is a DB write only — no per-parish
DNS/cert edits** — which is what makes the model scale. BYO custom domains use Cloudflare SSL-for-SaaS
(one-time platform setup; follow-on). po-724 notes this is "half-built" — finishing it is **build-blocking
for live subdomains; sequence it first**.

### 6.3 First-admin handoff (the "setup link")
po-724: "super-admin creates the shell, hands a setup link to a parish admin to finish." **Provisioning is a
BARE SHELL only** (user-locked, po-wisp-rrwul) — reuses the existing invite path, no net-new token table:
1. Super-admin `provisionParish({name, slug, dioceseId})` → parish created `status='pending_setup'`; default
   `parish_modules` (sparse, inherits diocese defaults), `brand` empty. **Nothing else is seeded.**
2. **Separate action** — admin enters the first parish-admin email → `inviteFirstAdmin` wraps
   `inviteMember({email, role:'admin', parishId})` (WorkOS invitation). The invite link **is** the setup
   link; the admin UI also shows a **"Copy setup link"** affordance so the operator can hand it over
   out-of-band (Slack/in person), not only by email.
3. The new admin opens the link → WorkOS auth → lands on a **first-run setup wizard** gated on
   `parish.status='pending_setup'`: confirm branding (logo/colors/name), invite more members, confirm enabled
   modules → **"Activate parish"** flips `status='active'`. (Super-admin can also activate directly.)
4. Until activated, the parish resolves but the tenant app shows the wizard for the admin and a neutral
   "coming soon" for everyone else.

**Ministries seeding is a separate action AND blocked on the future Ministries module** (po-wisp-rrwul) —
it cannot ship until that module lands; the admin tool exposes it as a disabled **"Seed default ministries
(requires Ministries module)"** affordance until then. `provisionParish` itself never seeds.

## 7. Branding model + cascade (types the existing `brand jsonb`)

The schema already has the two tiers; this defines their **shape** and **resolution** (net-new, additive —
jsonb needs no migration).

```ts
// packages/shared — versioned, all-optional so cascade can fill gaps
export interface BrandConfig {
  v: 1;
  displayName?: string;      // overrides parishes.name for chrome/emails/PDF
  logoUrl?: string;          // R2/Bunny asset
  faviconUrl?: string;
  colors?: { primary?: string; accent?: string; onPrimary?: string };
  loginTagline?: string;
  emailFromName?: string;    // fixes Narthex's hard-coded "Generated from Narthex"/jsPDF header gap
}
// Pure cascade: system defaults ← diocese.brand ← parish.brand (most specific wins, per field).
export function resolveBrand(system: BrandConfig, diocese?: BrandConfig | null, parish?: BrandConfig | null): Required<…>;
```

- Resolved **once per request by hostname** (the active parish + its diocese), folded into `getViewer` /
  a `getBrand()` cache, and threaded into chrome, the login screen, invite emails, and the OCIA applicant
  PDF (closing the `settings-branding.md` hard-coded-header gap).
- Admin editor: live preview (logo + color swatches against a mock chrome), per-field "inherited from
  diocese / system" badges so an operator sees what cascade fills. Colors validated as hex; contrast hint.
- **Asset upload** (logo/favicon) reuses the existing asset pipeline (R2/Bunny); store the URL in `brand`.

## 8. Parish lifecycle (`status` state machine)

`pending_setup → active ⇄ suspended`. Decide-and-noted semantics (confirm only if surprising):
- **`pending_setup`** — created, not yet activated. Resolves; tenant app = setup wizard (admin) / "coming
  soon" (others). Excluded from public/active counts.
- **`active`** — normal.
- **`suspended`** — members see a neutral **"This parish is temporarily unavailable"** page (no data); the
  **super-admin retains full access** (to reactivate/inspect); data is preserved (no delete). Enforced in
  one place: a check folded into `getViewer`/the app-group layout (suspended + not-super-admin → unavailable
  page), so it covers RSC, Server Actions, `/api/v1`, and MCP uniformly — the same shim discipline as
  RFC-001's `requireModule`. No hard-delete path (destructive; out of scope — archival is a future RFC).

## 9. Stats dashboard (SQL aggregates, not client-side)

Per-parish card computed in **one DEFINER query** (`admin_get_parish_stats`) returning
`{ memberCount, membersByRole, lessonCount, publishedLessonCount, cohortCount, enabledModules, status,
lastActivityAt }` — replacing Narthex's "pull all rows, count in the browser" anti-pattern
(`admin.md` gotcha). `publishedLessonCount` is redefined against the **versioned** lesson model
(distinct lessons with a published version, per `admin.md` GAP). Top-level dashboard: parish count by
status, modules-enabled heatmap, recent provisions. Diocese → parish drill-down preserved from Narthex.

## 10. Impersonation — "view as parish" (server-side; read-write + audit)

Today `po_view_as` only changes **role within a parish the super-admin already belongs to** (it flows
through `pickActiveMembership(real.memberships, …)`, `viewer.ts:55-72`). The admin tool needs **cross-tenant**
"view as parish X" where the super-admin has **no membership** — the heart of the Narthex admin page,
re-implemented per its port note (server-side, not `sessionStorage`):

- New **signed, httpOnly** impersonation cookie `po_impersonate_parish` (parish id + issued-at), set only
  by a `beginImpersonation(parishId)` Server Action that asserts `canImpersonate` and **audits**. `getViewer`
  reads it: if `canImpersonate` and the cookie is present, inject a **synthetic active membership** for that
  parish at the chosen role, so `getDb(parishId)` and the whole app scope to it. A forged cookie escalates
  no one (only `is_super_admin` users are honored — same invariant as `po_view_as`).
- `endImpersonation()` ("Return to operator view") clears it; logout clears it.
- **Write semantics — RESOLVED (user, 2026-06-02): read-write "act as parish admin".** An impersonating
  super-admin can mutate the parish (settings, members, content) exactly as its admin could, so operators can
  fix parishes on their behalf. `getDb(parishId)` scopes the writes to the impersonated parish; the gate is
  the signed httpOnly cookie + the "only `is_super_admin` honored" invariant. **Every mutation while
  impersonating is audited to `admin_audit` with the real super-admin identity** (§5) — and is the
  highest-priority subject of the 4-lens Censor security pass.

## 11. Module toggles — parish + diocese cascade (D1 resolved: build now)

- **Per-parish:** the admin editor shows the **toggleable** modules — **`ocia` and `studio` only**
  (user-locked; `dictionary`/`prayers`/`onboarding`/`people` are always-on and render as non-toggle "always
  on" rows). Toggling writes `parish_modules` via `setModuleEnabled` (validates `key ∈ MODULES` and
  `toggleable`). RFC-001's `enabledModules(parishId)` + `requireModule` (po-7diw) enforce at nav **and**
  every module shim; a disabled module **redirects home** (user-locked — not 404).
- **Diocese cascade:** the `diocese_modules` table + 3-layer resolver (`defaults ← diocese_modules ←
  parish_modules`) are **po-ekjb** (RFC-001). RFC-004 adds the **diocese-scope management UI + admin write
  path only**: a diocese editor toggles `diocese_modules` (super-admin gated, audited); a parish with no
  explicit row inherits its diocese default, an explicit parish row overrides. Full cascade incl.
  management UI is user-locked (po-wisp-rrwul).

## 12. API / entry-point surface

- **RSC reads:** parish list, per-parish editor, stats, diocese view — direct DB reads calling thin
  `platform/admin` query fns (DEFINER-backed for cross-tenant).
- **Server Actions** (≤~10 lines each, `(admin)` group): `createParish`, `setSubdomain`, `setCustomDomains`,
  `setModule`, `setDioceseModuleDefault`, `setBrand`, `setStatus`, `inviteFirstAdmin`, `beginImpersonation`,
  `endImpersonation`. Each: `requireSuperAdmin → zod-validate → core → revalidatePath`.
- **MCP / `/api/v1`:** none now. The suspend + module + impersonation checks live in the same shim
  discipline so any future surface inherits them.

## 13. UX — polish & delight (a requirement, per the architect mandate)

This is an operator tool, but operator tools earn trust through **legible state** and **confident motion**.

- **Interaction states, everywhere:** every list/editor/stat defines *loading* (skeletons matching final
  layout, never a spinner-on-blank), *empty* ("No parishes yet — create the first" with a primary CTA, not
  a bare list), *error* (inline, specific — "Slug `holyspirit-austin` is taken", never a swallowed `0`; this
  directly fixes the Narthex "errors render as 0 stats" gotcha), *success* (transient confirmation + optimistic
  row).
- **The provisioning moment is the delight beat:** as the operator types the slug, a **live subdomain
  preview** (`holyspirit-austin.parvusordo.com`) validates inline (debounced uniqueness check, green check /
  red reason). On create, the new parish **animates into the list** and a **"Copy setup link"** toast slides
  in. Branding edits show a **live chrome preview** that cross-fades as colors change.
- **Micro-animations:** the two module toggles (`ocia`, `studio`) spring (not snap); always-on modules show
  a calm static "always on" pill; status changes ripple a color shift on the parish row; impersonation entry
  dims the operator chrome and slides in a persistent **"Viewing as <parish>"** banner (un-missable, one tap
  to exit) — borrowing Narthex's red-banner clarity, done smoothly.
- **`prefers-reduced-motion`:** all of the above degrade to instant state changes; banners/toasts still
  appear, just without transition. Honor it globally.
- **Destructive confirmations:** suspend/reactivate use an inline confirm (not a modal wall), with the
  consequence spelled out ("Members will see an unavailable page; you keep access").

## 14. Test plan

- **unit (shared):** `isValidSlug` (case/reserved/charset), `resolveBrand` cascade (per-field
  most-specific-wins, empty tiers), `PARISH_STATUS` transitions. (Module resolver incl. diocese tier is
  po-ekjb's test surface, not re-tested here.)
- **integration (real PG):** `admin_create_parish` rejects duplicate/reserved slug and creates a bare shell
  (no memberships/ministries); non-superuser cannot `INSERT parishes` directly (admin-plane proof); RLS —
  parish A cannot read/toggle B's `parish_modules` rows; diocese write requires elevation; suspended parish
  blocks tenant reads but not super-admin; `admin_audit` row written per privileged action; impersonation
  cookie scopes `getDb` to the target.
- **e2e:** provision bare shell → copy setup link → first admin completes wizard → activate; toggle `ocia`
  (parish + diocese) → nav + deep-link reflect it (disabled → redirect home); suspend → member sees
  unavailable page, super-admin doesn't; "view as parish" → operator sees the parish, banner present, exit
  restores.

## 15. Sequencing & dependencies

```
infra bead #0:  finish wildcard cert/routing (one-time, manual ops; build-blocking for live subdomains)
RFC-001 (in build): po-dnp0 registry → po-m05v parish_modules → po-ekjb diocese cascade
                    → po-z11o getViewer → po-8j0q nav → po-7diw enforcement        (RFC-004 prerequisite)
RFC-004 (post-D2):  0025 lifecycle/audit → 0026 admin-plane fns → core platform/admin
                    → (admin) UI → branding resolver → impersonation → setup wizard
RFC-002 (in build): po-4a29 pooler, po-8p99 txn-trim — parallel, independent.
```
RFC-004's build beads depend on **po-m05v** (parish_modules), **po-ekjb** (diocese cascade), **po-7diw**
(enforcement), **po-dnp0** (registry). With D1 + D2 resolved, RFC-004 is **rfc-ready**; the rector now
decomposes it (covering RFC-003's absorbed scope) — net-new build beads run the 4-lens Censor panel.

## 16. Decisions & open questions

**D1 — Diocese-cascade module defaults — RESOLVED 2026-06-02 (build now).** The user locked full diocese
cascade incl. management UI (BUILD auth po-wisp-rrwul); rector confirmed. The **data + 3-layer resolver** are
**po-ekjb** under RFC-001; **RFC-004 owns the diocese management UI + admin write path only** (§11). Done.

**D2 — Impersonation write semantics — RESOLVED 2026-06-02 (user): read-write "act as parish admin".** An
impersonating super-admin can mutate the parish; every such write is audited with the real super-admin
identity (§5, §10). This is the highest-risk surface — the Censor security pass must scrutinize the
cross-tenant gate. With D1 + D2 both resolved, **RFC-004 is rfc-ready**; the rector decomposes it (covering
RFC-003's absorbed provisioning/subdomain scope) into build beads.

**User-locked / decide-and-noted** (stated in-doc): **provisionParish = bare shell, no auto-seed**
(po-wisp-rrwul); **toggleable = {ocia, studio} only**; **disabled-module → redirect home**; **ministries
seeding = separate action, blocked on the future Ministries module**; setup-link = reuse `inviteMember` +
copyable link + first-run wizard, no token table (§6.3); `BrandConfig` shape (§7); lifecycle + suspend =
lockout-with-notice, super-admin retains access (§8); **RFC-003 absorbed + held** (rector covers its scope
when decomposing RFC-004).

## 17. What this delivers vs. Narthex (overlap accounting, per po-724)

- **`admin.md` (super-admin parish switcher):** *absorbed + upgraded.* Keep the diocese→parish→stats
  browse (now SQL-aggregated, error-legible). Re-implement "View as Admin" as **server-side** "view as
  parish" (§10) — kills the `sessionStorage`-trusted client flag. **Add** all parish CRUD,
  provisioning, lifecycle, branding, module toggles (none existed in Narthex admin).
- **`settings-branding.md` (parish console):** *mostly stays a parish-admin surface, not super-admin.* This
  tool **delivers the flagged branding gap** — the per-parish + per-diocese cascading, hostname-resolved
  brand (logo/colors/names) that Narthex lacked entirely (only `parishes.name` + a hard-coded PDF header) —
  at the platform level (§7), then the parish Settings console can expose parish-tier brand edits to parish
  admins. Member/cohort/calendar/api-key management is **not** moved here; the super-admin seeds the first
  admin and hands off (§6.3).

## 18. Risks

- **Wildcard cert is build-blocking** for live subdomains (one-time, manual ops; §6.2) — sequence it first;
  the rector is surfacing the ops step to the user.
- **Impersonation is the highest-risk surface** (cross-tenant by design; D2 = read-write means an operator
  can mutate any parish while impersonating) — server-side gate + per-write audit + the "only
  `is_super_admin` honored" invariant are mandatory; the 4-lens Censor security pass must scrutinize it.
- **Migration numbering** — build beads must use the next free integer at build time (`0022` is taken),
  reconciled to the live tip (collision rule).
- **Suspend semantics touch every entry point** — enforce in one shim (§8), not per-route, or coverage drifts.
- **Diocese write is cross-tenant-elevated** — the diocese management UI must re-assert super-admin and
  audit, same as parish creation (§5).
