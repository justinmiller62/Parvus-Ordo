# Admin

## Overview

The Admin section is the **super-admin-only "Parish Switcher"** in the legacy Narthex app. It is a single route (`/admin`) rendered by one component, `AdminPage` (`apps/web/src/routes/admin/AdminPage.tsx`). It exists to give the platform operator (a global super admin) a cross-tenant view of the whole system and the ability to **impersonate any parish as an admin** without having a real membership there.

Concretely it does two things:

1. **Read-only browse / stats.** Drill down from a list of all dioceses → parishes in a diocese → a single parish's stats card (member count broken down by role, lesson count + published count, list of cohorts).
2. **"View as Admin" impersonation.** Pick any parish and the entire app re-renders as if the super admin were an `admin` member of that parish. This is implemented client-side via a `parishOverride` stored in `sessionStorage` (it does NOT change anything in the database).

It is deliberately thin: it is purely a navigation/impersonation surface on top of existing tenant data. There is no create/update/delete of dioceses, parishes, users, or roles here — every Supabase call in this section is a `SELECT`.

> Note for the porting team: this is the *entire* admin surface that exists in Narthex. There is no separate "manage users", "manage dioceses", or "billing" admin in this codebase. Per-parish admin work (managing members, cohorts, lessons) lives in the teacher/admin routes (`RoleGuard allowedRoles={['admin','teacher']}`), not here.

## Roles & access

- **Gated entirely by `isSuperAdmin()`**, which reads `profile.is_super_admin` (a boolean column on `profiles`). See `apps/web/src/hooks/useAuth.ts:160` — `const isSuperAdmin = () => state.profile?.isSuperAdmin ?? false;`.
- The route itself is **NOT** wrapped in a `RoleGuard` in the router — `App.tsx:199` registers it as a bare `<Route path="admin" element={<AdminPage />} />`. All gating is done **inside** the component: if `!isSuperAdmin()` it renders an "Access Denied" panel (`AdminPage.tsx:82-92`). The data-fetch `useEffect` also early-returns when not super admin (`AdminPage.tsx:39`).
- The sidebar link to `/admin` ("Super Admin", `data-testid="sidebar-super-admin"`) is only shown when `isSuperAdmin()` is true — `Sidebar.tsx:56-70`.
- Super admin is seeded by data, not by UI: migration `20260502000001_super_admin_and_test_infra.sql:5` does `UPDATE profiles SET is_super_admin = true WHERE email = 'justinmmiller62@gmail.com';`. There is no in-app way to grant super admin.
- **`diocese_admin`** is a related but separate role (added in the same migration era). It is NOT used by this page — it grants scoped RLS read access to parishes/memberships in one diocese (`20260502000002_diocese_admin_policy.sql`) but has no dedicated UI in the Admin section.

Cross-tenant read access at the DB level is what makes this page work for a super admin even though they have no membership rows in those parishes — see "Key logic" and "Data model" below.

## User flows

All flows assume the signed-in user is a super admin. A non-super-admin who navigates to `/admin` directly sees the **Access Denied** state and nothing else.

1. **Open Admin (diocese list).**
   1. Click "Super Admin" in the sidebar → navigate to `/admin`.
   2. On mount, the page fetches all dioceses and all parishes in parallel (`AdminPage.tsx:42-45`) and shows `Loading...` until both resolve (`AdminPage.tsx:94`).
   3. Renders a red "Super Admin" banner and a list of dioceses, each showing name, a `TEST` badge if `is_test`, and a parish count (`AdminPage.tsx:296-323`). Parish count is computed client-side by filtering the already-loaded `parishes` array.
   4. **Empty state:** if there are no dioceses, the list simply renders empty (no explicit "no dioceses" message exists at this level).

2. **Drill into a diocese (parish list).**
   1. Click a diocese row → sets `selectedDiocese` (`AdminPage.tsx:304`).
   2. `dioceseParishes` is computed by filtering `parishes` to `diocese_id === selectedDiocese.id` (`AdminPage.tsx:150-152`).
   3. Renders the diocese header (with `TEST` badge) and the parish list (`AdminPage.tsx:237-293`). Each parish row has a name, optional `TEST` badge, a small "View" button, and a chevron.
   4. **Empty state:** if the diocese has no parishes, shows "No parishes in this diocese." (`AdminPage.tsx:260`).
   5. "All Dioceses" back link clears `selectedDiocese` and returns to flow 1.

3. **View a parish's stats.**
   1. Click a parish name (or its chevron) → calls `selectParish(parish)` (`AdminPage.tsx:53-75`).
   2. This runs **three parallel queries** for that parish: memberships (`id, role`), lessons (`id, published_at`), cohorts (`id, name`) — all filtered by `parish_id`.
   3. Computes derived stats client-side: total member count, a `Record<role, count>` breakdown, total lesson count, published-lesson count (`l.published_at` truthy), and the cohort list.
   4. Renders a stats card with three tiles (Members + per-role breakdown, Lessons + published count, Cohorts + names) (`AdminPage.tsx:203-234`). If a parish has a `clock_override`, it is shown as an orange "Clock override: <localized datetime>" line (`AdminPage.tsx:186-190`).
   5. **Error state:** queries are not error-checked; on failure `.data` is null and `?? []`/`?? 0` fallbacks make all stats render as `0`/empty rather than throwing. Cohorts tile shows "None" when empty (`AdminPage.tsx:231`).
   6. "Back to <diocese name>" link clears `selectedParish` and returns to flow 2.

4. **"View as Admin" (impersonate a parish).**
   1. From either the parish row "View" button (`AdminPage.tsx:278`) or the stats card "View as Admin" button (`AdminPage.tsx:194`), calls `handleViewAsAdmin(parish)` → `switchParish(parish.id, parish.name)` then `navigate('/lessons')` (`AdminPage.tsx:77-80`).
   2. `switchParish` (`useAuth.ts:162-167`) no-ops if not super admin, otherwise sets `parishOverride = { parishId, parishName }` in React state AND `sessionStorage` under key `narthex_parish_override`.
   3. While an override is active, `useAuth` injects a **synthetic admin membership** for that parish into `effectiveMemberships` (`useAuth.ts:140-148`), so the whole app treats the super admin as an `admin` of the impersonated parish. The real memberships remain available as `realMemberships`.
   4. The user lands on `/lessons` seeing that parish's content as an admin.

5. **Return / switch while impersonating.**
   1. Navigating back to `/admin` while `parishOverride` is set shows a distinct screen (`AdminPage.tsx:97-148`): a red "Currently viewing: <parishName>" banner with a "Return to Home Parish" button (`data-testid="admin-return-home"`), plus a flat "Switch Parish" list of **all** parishes.
   2. Clicking "Return to Home Parish" calls `resetParish()` (`useAuth.ts:169-172`) which clears the override from state and `sessionStorage`. The page re-renders into the normal diocese-list view.
   3. Clicking any parish in the switch list calls `handleViewAsAdmin` again → switches the override to that parish and navigates to `/lessons`. The currently-active parish is highlighted with a "Current" badge (`AdminPage.tsx:137-139`).

6. **Sign out clears impersonation.** `signOut` (`useAuth.ts:132-137`) calls `saveParishOverride(null)` and clears state before signing out of Supabase, so the override never persists across accounts.

## Data model

Every query in this section is a read (`SELECT`). The tables touched, with the columns this section actually uses (full column lists from `supabase/migrations/20260422000000_initial.sql` and the super-admin migration):

### `dioceses`
- `id uuid PK`, `name text`, `short_code text`, `created_at timestamptz`.
- Added by `20260502000001`: `is_test boolean NOT NULL DEFAULT false`, `test_run_id uuid`.
- **Used here:** `id, name, is_test` (`AdminPage.tsx:43`).
- Relationships: parent of `parishes` (1:N via `parishes.diocese_id`).

### `parishes`
- `id uuid PK`, `diocese_id uuid NOT NULL → dioceses(id) ON DELETE CASCADE`, `name text`, `discussion_template text`, `created_at timestamptz`.
- Added by `20260502000001`: `is_test boolean NOT NULL DEFAULT false`, `clock_override timestamptz` (null normally; set on test parishes to freeze "now"), `test_run_id uuid`.
- **Used here:** `id, name, diocese_id, is_test, clock_override` (`AdminPage.tsx:44`).
- Relationships: child of `dioceses`; parent of `memberships`, `cohorts`, `lessons`, `videos` (all reference `parish_id ON DELETE CASCADE`). Parish is the core tenancy unit.

### `profiles`
- `id uuid PK → auth.users(id)`, `display_name text`, `email text`, `avatar_url text`, `created_at`, `updated_at`.
- Added by `20260502000001`: `is_super_admin boolean NOT NULL DEFAULT false`.
- **Used here indirectly:** the `is_super_admin` flag drives all gating (read in `useAuth` at app load, not in `AdminPage` itself). `AdminPage` does not query `profiles` directly.

### `memberships`
- `id uuid PK`, `user_id uuid NOT NULL → profiles(id) ON DELETE CASCADE`, `parish_id uuid NOT NULL → parishes(id) ON DELETE CASCADE`, `role membership_role NOT NULL`, `created_at timestamptz`, `UNIQUE(user_id, parish_id, role)`.
- `membership_role` enum: `'admin' | 'teacher' | 'student'` originally; `'diocese_admin'` added by `20260502000001:10`.
- **Used here:** `id, role` filtered by `parish_id` (`AdminPage.tsx:55`) to compute member count + per-role breakdown.
- RLS note: a user normally only sees memberships of parishes they belong to; super admins see all (see below).

### `cohorts`
- `id uuid PK`, `parish_id uuid NOT NULL → parishes(id) ON DELETE CASCADE`, `name text`, `created_at timestamptz`.
- **Used here:** `id, name` filtered by `parish_id` (`AdminPage.tsx:57`).
- Children: `cohort_members` (cohort_id, student_id), not touched by this page.

### `lessons`
- `id uuid PK`, `parish_id uuid NOT NULL → parishes(id) ON DELETE CASCADE`, `title`, `description`, `discussion_template`, `visibility lesson_visibility ('parish'|'diocese')`, `source_lesson_id uuid → lessons(id)` (fork lineage), `lesson_order int`, `created_by uuid → profiles(id)`, `published_at timestamptz` (null = draft), `created_at`, `updated_at`.
- **Used here:** `id, published_at` filtered by `parish_id` (`AdminPage.tsx:56`) to count total vs published.

### `parish_snapshots` (defined, NOT used by AdminPage)
- Created in `20260502000001:24-33`: `id`, `parish_id → parishes ON DELETE CASCADE`, `label text`, `snapshot_data jsonb`, `created_at`, `expires_at (now()+7 days)`. RLS `FOR ALL` to `is_super_admin()`. This is test/snapshot infra; `AdminPage` never queries it, but it lives in the super-admin domain and may be relevant to the porting team's mental model.

### RLS-relevant ownership / cross-tenant reads
The page works for a super admin who has **no membership** in the parishes it shows because additive super-admin `SELECT` policies grant cross-tenant read:
- `dioceses_super_admin`, `parishes_super_admin` — `20260502000004`.
- `memberships_super_admin`, `lessons_super_admin`, `cohorts_super_admin`, `profiles_super_admin`, `engagement_super_admin`, `parish_snapshots_super_admin` — `20260502000001` / recreated in `20260502000003`.
- All use the **`is_super_admin()` SECURITY DEFINER** function (`20260502000003:8-18`), which bypasses RLS to read `profiles.is_super_admin` for `auth.uid()`. This indirection exists to avoid **infinite recursion (42P17)** that occurred when the policy on `profiles` referenced `profiles` inline (`20260502000003:1-5`).

## Key logic & algorithms

1. **Super-admin gate via `is_super_admin()` DEFINER function.** The non-obvious bit is the DB side: the original inline-subquery policy recursed on `profiles`. The fix is a `SECURITY DEFINER STABLE` SQL function (`supabase/migrations/20260502000003_fix_super_admin_recursion.sql:8-18`):
   ```sql
   CREATE OR REPLACE FUNCTION is_super_admin() RETURNS boolean
   LANGUAGE sql SECURITY DEFINER STABLE AS $$
     SELECT COALESCE((SELECT is_super_admin FROM profiles WHERE id = auth.uid()), false);
   $$;
   ```
   Every cross-tenant policy then just does `USING (is_super_admin())`. The porting team must preserve this "no recursion in the gate" property.

2. **Client-side impersonation via synthetic membership.** There is no server-side impersonation. `useAuth` injects a fake `admin` membership when an override is active (`apps/web/src/hooks/useAuth.ts:140-148`):
   ```ts
   const effectiveMemberships = parishOverride
     ? [{ id: 'override', userId: state.user?.id ?? '', parishId: parishOverride.parishId, role: 'admin', createdAt: '' }]
     : state.memberships;
   ```
   Downstream gating (`hasRole`, `isTeacherOrAdmin`) reads `effectiveMemberships`, so the whole app treats the super admin as an admin of the override parish. **The DB still only authorizes them via the super-admin RLS policies**, not via this fake row — the synthetic membership is purely a client UX construct.

3. **Override persistence in `sessionStorage`.** Key `narthex_parish_override` (`useAuth.ts:19-32`). Loaded lazily into initial state via `useState(loadParishOverride)`. Survives page reloads within a tab, not across tabs/sessions. Cleared on `resetParish` and `signOut`.

4. **Derived stats are computed in the browser, not the DB** (`AdminPage.tsx:60-73`). Role breakdown is a manual reduce over membership rows; published count is `lessons.filter(l => l.published_at)`. No aggregate SQL — fine at small scale, see gotchas.

5. **Two-tier vs flat parish list.** Normal mode uses a diocese→parish hierarchy with client-side filtering (`AdminPage.tsx:150-152`, `:300`). Override mode shows a single flat list of *all* parishes for quick switching (`AdminPage.tsx:122-145`). Two different UIs over the same `parishes` array.

## External integrations

**None.** The Admin section touches no external services — no Mux, no Whisper/OpenAI, no ICS/ical, no email, no YouTube. It is pure Supabase reads plus `sessionStorage`. (Those integrations live in other Narthex sections: media/video, calendar, transcription.) The only "integration" is Supabase Auth (the session) and Supabase Postgres RLS.

## Edge cases & gotchas

- **No `RoleGuard` on the route.** Gating is in-component only (`isSuperAdmin()` check + Access Denied panel). If the port relies on route-level guards, this page is an exception to replicate (or better, fix by guarding at the route/server layer).
- **Errors are swallowed.** None of the `SELECT`s in `AdminPage` check `.error`; failures silently degrade to empty lists / zero stats (`?? []`, `.length` on empty). A broken RLS policy would render "0 members, 0 lessons" rather than an error — easy to misread as real data.
- **Stats are not transactional / not aggregated.** Counts come from pulling full rows (`memberships`, `lessons`, `cohorts`) into the client and counting. For a large parish this transfers every membership/lesson row just to count them. Port should use SQL `count` aggregates.
- **Synthetic membership ≠ DB authorization.** Do not assume the override grants write access through normal RLS. Writes performed while impersonating are still only authorized because the actor is a super admin under super-admin policies — and those policies in Narthex are `FOR SELECT` only for most tables. So an impersonating super admin may be able to *navigate* admin UI but could hit RLS denials on writes that a real parish admin would pass. The porting team must decide impersonation's exact write semantics deliberately.
- **`switchParish` no-ops silently for non-super-admins** (`useAuth.ts:163`). Defense in depth, but means a stale/forged `sessionStorage` value matters: `loadParishOverride` trusts whatever is in storage at load time and injects the synthetic admin membership before any server check. A non-super-admin who manually sets `narthex_parish_override` would get a client-side admin UI for that parish — but RLS would block the actual data (they lack super-admin policies and the real membership). Still, the client trusting `sessionStorage` is a gotcha to not reproduce as-is.
- **`clock_override`** only renders when truthy and is for test parishes; it changes how "now" is computed elsewhere (test infra), not in this page.
- **`is_test` / `test_run_id`** badges are surfaced but never filtered out — test tenants appear in the super admin's lists alongside real ones.
- **Override mode hides the hierarchy.** While impersonating, you can only flat-switch parishes; you lose the diocese grouping and the stats card until you return home.
- **`diocese_admin` role exists in the enum** but has no Admin-section UI; its scoped RLS (`20260502000002`) is unrelated to this page. Don't confuse it with super admin.

## Acceptance criteria

- [ ] A user with `profiles.is_super_admin = true` who visits `/admin` sees the "Super Admin" banner and a list of all dioceses (not the Access Denied panel).
- [ ] A user with `is_super_admin = false` who visits `/admin` sees the "Access Denied" / "Super admin access required" panel and no diocese data.
- [ ] The "Super Admin" sidebar link (`sidebar-super-admin`) is rendered only when the current user is a super admin.
- [ ] The diocese list shows, for each diocese, its name and an accurate parish count (number of parishes whose `diocese_id` matches).
- [ ] Clicking a diocese shows only the parishes belonging to that diocese; a diocese with zero parishes shows "No parishes in this diocese."
- [ ] Selecting a parish displays member count equal to the number of membership rows for that `parish_id`, with a per-role breakdown summing to that total.
- [ ] The lessons tile shows total lesson count and a published count equal to the number of lessons with a non-null `published_at`.
- [ ] The cohorts tile lists cohort names for the parish, or "None" when the parish has no cohorts.
- [ ] A parish with a non-null `clock_override` shows the "Clock override:" line; a parish without one does not.
- [ ] Test tenants (`is_test = true`) render a `TEST` badge at both diocese and parish levels.
- [ ] Clicking "View as Admin"/"View" sets `parishOverride` in state and `sessionStorage` (`narthex_parish_override`) and navigates to `/lessons`.
- [ ] While `parishOverride` is active, `useAuth.memberships` contains exactly one synthetic membership with `role = 'admin'` and `parishId = override.parishId`, and `realMemberships` is unchanged.
- [ ] Revisiting `/admin` while impersonating shows the "Currently viewing: <parishName>" banner, a "Return to Home Parish" button (`admin-return-home`), and a flat list of all parishes with the active one marked "Current".
- [ ] Clicking "Return to Home Parish" clears `parishOverride` from both state and `sessionStorage` and returns the page to the normal diocese-list view.
- [ ] `switchParish` does nothing when called by a non-super-admin (no override is set).
- [ ] Signing out clears `narthex_parish_override` so impersonation does not leak into the next session.
- [ ] A super admin can read dioceses, parishes, memberships, lessons, and cohorts for tenants where they have no membership (cross-tenant RLS via `is_super_admin()`), and the `is_super_admin()` policy on `profiles` does not cause recursion (no 42P17 error).
- [ ] The page renders a `Loading...` state until both the dioceses and parishes queries resolve.

## Port notes

**Stack mapping (Parvus Ordo: Next.js 16 App Router, `packages/core` boundary, Neon + RLS, WorkOS, Bunny, Groq).**

- **Reads → RSC, logic → `packages/core`.** The diocese/parish browse and the per-parish stats are reads; per CLAUDE.md rule 5, do them as RSC reads calling thin `packages/core` query functions (e.g. `core/admin/listDioceses`, `core/admin/getParishStats(parishId)`). **Replace the "pull all rows and count in the browser" pattern with SQL `count` aggregates in `core`** — return `{ memberCount, membersByRole, lessonCount, publishedLessons, cohorts }` already computed. The page component becomes presentational.
- **Super-admin gate.** Move the gate to the server: a `core` helper `requireSuperAdmin(ctx)` plus a route/layout guard for `/admin`, instead of an in-component `isSuperAdmin()` + Access Denied panel. WorkOS provides the identity; the `is_super_admin` concept becomes a platform-level claim/flag (global scope, above diocese/parish). Do NOT rely on a `sessionStorage`-trusted client flag for authorization.
- **Impersonation → Server Action + signed/server-held context, not `sessionStorage`.** The "View as Admin" override is the one piece with real security weight. Re-implement as a Server Action (`switchParishContext(parishId)`) that (a) verifies super admin, (b) sets an **impersonation context in a signed httpOnly cookie or server session**, and (c) is read by `core` on every request so RLS/tenancy scoping uses the impersonated `parish_id`. Avoid the synthetic-client-membership trick; make impersonation an explicit, server-validated tenancy override so writes have well-defined semantics. Provide a matching `resetParishContext()` Server Action ("Return to Home Parish") and clear the context on logout.
- **RLS / tenancy (global/diocese/parish scope).** Parvus Ordo's hierarchy is diocese → parish → ministry/council → member. Super admin = **global** scope (sees everything, equivalent to Narthex `is_super_admin()` policies). `diocese_admin` maps to **diocese** scope (Narthex `20260502000002`). Port these as Neon RLS policies driven by the request's WorkOS-derived role + (when impersonating) the server-side parish context. Keep the no-recursion property of `is_super_admin()` (use a SECURITY DEFINER function or set the flag via a session GUC/claim rather than a self-referential policy).
- **`infra/workers`:** nothing here is out-of-band — Admin is entirely request/response. No worker jobs needed. (`parish_snapshots` test infra, if ported, could involve a worker for cleanup of expired snapshots, but it's out of this section's scope.)
- **Route handler / REST:** not needed for the in-app admin UI. Only add `/api/v1` if an external consumer needs cross-tenant admin reads — defer until a real trigger.
- **Mux→Bunny / Whisper→Groq:** **N/A for this section** — Admin touches no media or transcription. Those mappings belong to the media/asset-manager and player docs.

**Explicit GAPS vs what Parvus Ordo already has:**
- **Lessons with versioning** (Parvus Ordo) is richer than Narthex's `lessons` table (which has `source_lesson_id` fork lineage + `published_at` only). The stats "published lessons" count must be redefined against the new versioned model (count distinct lessons with a published version, not rows with non-null `published_at`).
- **Media/asset manager, seek-enforcing player + transcript, teacher preview** (already built in Parvus Ordo) are **not referenced by this Admin section at all** — there is nothing to port from Admin into them. The only overlap is that "View as Admin" impersonation should let a super admin reach teacher-preview/admin surfaces for the impersonated parish; ensure the new server-side impersonation context flows into those existing features.
- **No user/role management UI exists in Narthex Admin.** If Parvus Ordo needs super-admin user/diocese/parish CRUD, it is **net-new** — do not assume it can be ported; only the switcher/impersonation and stats browse exist today.
- **No billing, no audit log, no email, no scheduled jobs** in this section — all net-new if desired.
