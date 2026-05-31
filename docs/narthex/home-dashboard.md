# Home / Dashboard

## Overview

Narthex has **no standalone dashboard page**. The "Home / Dashboard" section is the application's **authenticated entry point and shell**: the index route (`/`) is a pure role-based redirect, and everything authenticated renders inside a single persistent layout (sidebar + top bar + content outlet). There is no widget grid, no "welcome" landing, no aggregated stats for ordinary users — landing on `/` immediately bounces the user to the page that matters for their role.

Concretely this section is made of four cooperating pieces:

1. **`HomePage`** (`apps/web/src/routes/HomePage.tsx`) — the index route. Decides whether to send the user to `/lessons` (teacher/admin) or `/my-lessons` (student).
2. **The auth bootstrap** (`useAuth` / `AuthContext`) — loads the Supabase session, the user's `profiles` row, and their `memberships` rows. Every routing/role decision in the shell depends on this.
3. **The route guards** (`AuthGuard`, `RoleGuard`) — gate the whole authenticated tree on a session, and individual routes on role.
4. **The dashboard shell** (`DashboardLayout` + `Sidebar`) — the chrome that wraps every authenticated page: role-filtered nav, user name in the top bar, sign-out, and the **Super-Admin parish-override banner**.

Why it exists: Narthex is multi-tenant (diocese → parish → member) with three roles. There is no single home screen that works for everyone, so `/` is a router, not a page. The shell exists to enforce auth/role consistently and to surface the super-admin "view as parish" affordance globally.

## Roles & access

Roles come from the `memberships` table: `'admin' | 'teacher' | 'student'` (`packages/shared/src/constants.ts`, `ROLES`). A separate boolean `profiles.is_super_admin` is the platform-level super-admin flag (independent of parish role).

- **Unauthenticated**: `AuthGuard` redirects to `/login`. Cannot reach `/` or any shell route.
- **Student** (`role === 'student'`, or any user who is *not* admin/teacher): index `/` → `/my-lessons`. Sees the **student** sidebar link set.
- **Teacher / Admin** (`hasRole('teacher')` or `hasRole('admin')`): index `/` → `/lessons`. Sees the **teacher** sidebar link set (which includes a Settings link, but Settings itself is admin-only via `RoleGuard`).
- **Admin**: same redirect as teacher (→ `/lessons`); additionally passes `RoleGuard allowedRoles={['admin']}` for `/settings`.
- **Super-admin** (`profiles.is_super_admin === true`): additionally sees a red **Super Admin** nav link to `/admin`, and can activate a **parish override** that injects a synthetic `admin` membership for any parish, making them land/behave as a teacher/admin of that parish.

Gating mechanics:
- `AuthGuard` (`apps/web/src/components/layout/AuthGuard.tsx`): shows "Loading…" while `loading`, redirects to `/login` if no `user`, else renders children.
- `RoleGuard` (`apps/web/src/components/layout/RoleGuard.tsx`): shows "Loading…" while `loading`, redirects to `/` if the user has none of `allowedRoles` among their (effective) memberships.
- `isTeacherOrAdmin()` (`apps/web/src/hooks/useAuth.ts:156`) drives both the index redirect and which sidebar link set renders.

## User flows

**Flow A — Returning authenticated user hits `/`:**
1. App mounts; `useAuth` calls `supabase.auth.getSession()`. While pending, `loading === true`.
2. `AuthGuard` renders centered "Loading…" (`AuthGuard.tsx:11`).
3. Session resolves with a user → `fetchUserData` runs two parallel queries: `profiles` (by `id`) and `memberships` (by `user_id`) (`useAuth.ts:46-49`).
4. `loading` flips false; `DashboardLayout` + `Sidebar` render; `HomePage` evaluates `isTeacherOrAdmin()`.
5. Teacher/admin → `<Navigate to="/lessons" replace />`; student → `<Navigate to="/my-lessons" replace />` (`HomePage.tsx:16-20`).

**Flow B — Unauthenticated user hits `/` (or any shell route):**
1. `getSession()` returns no session; `loading` → false, `user` stays `null`.
2. `AuthGuard` returns `<Navigate to="/login" replace />` (`AuthGuard.tsx:19-21`).

**Flow C — Student manually navigates to a teacher route (e.g. `/lessons`):**
1. `RoleGuard allowedRoles={['admin','teacher']}` checks memberships.
2. No matching role → `<Navigate to="/" replace />` → `HomePage` → `/my-lessons`. Net effect: silent bounce back to the student home.

**Flow D — Sign-out from the sidebar:**
1. User clicks "Sign Out" (`Sidebar.tsx:94`). `signOut()` clears the parish override (session-storage + state) then calls `supabase.auth.signOut()` (`useAuth.ts:132-137`).
2. `onAuthStateChange` fires with no session → state reset → `AuthGuard` redirects to `/login`.

**Flow E — Super-admin activates a parish override (from `/admin`):**
1. Super-admin clicks "View as admin" on a parish (`AdminPage.tsx` `handleViewAsAdmin`) → `switchParish(parishId, parishName)` (guarded by `isSuperAdmin()`, `useAuth.ts:162-167`), then navigates to `/lessons`.
2. Override is persisted to `sessionStorage` key `narthex_parish_override` and held in state; `effectiveMemberships` becomes a single synthetic `{ role: 'admin', parishId }` (`useAuth.ts:140-148`).
3. `DashboardLayout` renders a sticky **red banner**: "Viewing as admin: \<parishName\>" with an **Exit** button (`DashboardLayout.tsx:40-57`, testid `admin-exit-override`).
4. Exit → `resetParish()` clears override + storage; real memberships are restored.

**Empty / error states:**
- **No profile row** (`profileResult.error` or null): `profile` is `null`; the app still renders. Top-bar name shows empty string (`profile?.displayName ?? ''`, `DashboardLayout.tsx:81`). Errors are only `console.error`-logged (`useAuth.ts:51-52`), never surfaced to the user.
- **No memberships**: `effectiveMemberships` is `[]`; `isTeacherOrAdmin()` is false → user is treated as a student and lands on `/my-lessons`; teacher routes bounce via `RoleGuard`.
- **Membership-fetch error**: same as no memberships (logged, swallowed).
- **Unknown route** under the shell: top-level catch-all `<Route path="*" element={<NotFoundPage />} />` (outside the guarded tree).

## Data model

This section only **reads**; it never writes (writes to these tables live in Settings/Admin sections).

**`profiles`** — one row per auth user (`id` = Supabase `auth.users.id`).
- Read: `supabase.from('profiles').select('*').eq('id', user.id).single()` (`useAuth.ts:47`).
- Columns used: `id`, `display_name`, `email`, `avatar_url`, `is_super_admin` (defaulted to `false` if null), `created_at`, `updated_at` (`useAuth.ts:54-63`).
- Mapped to shared `Profile` type (`packages/shared/src/types.ts:18-26`).
- Ownership/RLS: a user must be able to read their own profile row (`id = auth.uid()`).

**`memberships`** — join of users ↔ parishes with a role; the RBAC backbone.
- Read: `supabase.from('memberships').select('*').eq('user_id', user.id)` (`useAuth.ts:48`).
- Columns used: `id`, `user_id`, `parish_id`, `role` (`'admin'|'teacher'|'student'`), `created_at` (`useAuth.ts:66-72`).
- Mapped to shared `Membership` type (`packages/shared/src/types.ts:28-34`).
- Ownership/RLS: a user must read their own membership rows (`user_id = auth.uid()`). Each membership scopes a role to a single `parish_id`.

**`parishes`** — referenced via the super-admin override path (the override carries a `parishId`/`parishName`). The override itself does **not** query `parishes`; the name is passed in from `/admin`, which reads `parishes.select('id, name, diocese_id, is_test, clock_override')` (`AdminPage.tsx:44`). Shared `Parish` type at `packages/shared/src/types.ts:10-16` (`id`, `dioceseId`, `name`, `discussionTemplate`, `createdAt`).

**`dioceses`** — top of the tenancy tree; read only by `/admin` (`AdminPage.tsx:43`), not by the dashboard shell itself, but relevant because membership `parish_id` rolls up to a diocese.

Relationships: `dioceses 1—* parishes 1—* memberships *—1 profiles(auth user)`. A user can hold memberships in multiple parishes (the shell does not pick a "current" parish; role checks are global-OR across all memberships unless a `parishId` is passed to `hasRole`).

## Key logic & algorithms

**Index redirect is purely role-derived, defaulting to student:**
```tsx
// routes/HomePage.tsx:16-20
if (isTeacherOrAdmin()) {
  return <Navigate to="/lessons" replace />;
}
return <Navigate to="/my-lessons" replace />;
```
`isTeacherOrAdmin()` is `hasRole('admin') || hasRole('teacher')` (`useAuth.ts:156-158`). Anyone who is not explicitly teacher/admin (including users with zero memberships) is routed as a student. Both navigations use `replace` so `/` never lands in history.

**Auth bootstrap — getSession + onAuthStateChange, with INITIAL_SESSION suppressed:**
The effect both reads the initial session and subscribes to changes, but explicitly ignores `INITIAL_SESSION` to avoid double-fetching (`useAuth.ts:97`). Profile + memberships are fetched in parallel (`Promise.all`, `useAuth.ts:46`). On `PASSWORD_RECOVERY` it hard-redirects to `/set-password` (`useAuth.ts:100-105`). Fetch errors are logged, never thrown.

**Synthetic-membership override (super-admin "view as parish"):**
```ts
// hooks/useAuth.ts:140-148
const effectiveMemberships = parishOverride
  ? [{ id: 'override', userId: ..., parishId: parishOverride.parishId, role: 'admin', createdAt: '' }]
  : state.memberships;
```
While an override is active, the hook returns `effectiveMemberships` as `memberships` (and exposes `realMemberships` separately, `useAuth.ts:178-179`). All role checks (`hasRole`, guards, sidebar, redirect) therefore see exactly one admin membership for the overridden parish — the super-admin is impersonated as a parish admin. `switchParish` is a no-op unless `isSuperAdmin()` (`useAuth.ts:163`).

**Override persistence:** stored in `sessionStorage` under `narthex_parish_override` as JSON, loaded lazily as the initial state (`loadParishOverride`, `useAuth.ts:19-32`), cleared on sign-out and on `resetParish`.

**Sidebar link set is role-derived:**
```ts
// components/layout/Sidebar.tsx:44
const links = isTeacherOrAdmin() ? teacherLinks : studentLinks;
```
Teacher set adds Lesson Builder, Videos, Cohorts, Settings; student set is the read-only subset (My Lessons, Calendar, Dictionary, Prayers, Announcements, Discussion). The Super-Admin link renders conditionally on `isSuperAdmin()` (`Sidebar.tsx:56`).

**Content remount on navigation:** `<main … key={location.pathname}>` (`DashboardLayout.tsx:86`) forces a remount of page content on every route change, discarding per-page state.

## External integrations

**None** in this section. The Home/Dashboard shell touches only Supabase Auth (`supabase.auth.getSession`, `onAuthStateChange`, `signInWithPassword`, `signOut`) and Postgres reads (`profiles`, `memberships`). No Mux, no Whisper/OpenAI, no ICS/iCal, no email, no YouTube. (Those integrations live in the lesson/video/calendar/transcription sections that the shell merely links to.) The `testMode` helper (`lib/testMode.ts`) affects video playback speed, animations, and telemetry app-wide but is not consumed by the dashboard shell directly.

## Edge cases & gotchas

- **Default-to-student fallthrough:** a user with a corrupt/missing membership fetch silently becomes a "student" and lands on `/my-lessons`; there is no error UI. Easy to mistake an RLS misconfiguration for "user is a student."
- **Errors are swallowed:** profile/membership fetch errors only `console.error` (`useAuth.ts:51-52`). The UI never blocks or warns.
- **`getSession` + `onAuthStateChange` race:** both can fire; `INITIAL_SESSION` is intentionally dropped in the listener to prevent a duplicate `fetchUserData` (`useAuth.ts:97`). Removing that guard reintroduces a double-fetch.
- **Override uses `sessionStorage`, not `localStorage`:** the parish override survives reloads within the same tab but not new tabs/windows, and is wiped on tab close. Intentional, but surprising.
- **Override grants `admin`, never `teacher`:** super-admins always impersonate as parish *admin*, so they can reach admin-only routes (`/settings`) for any parish.
- **No "current parish" selection for multi-parish users:** `hasRole` OR-matches across *all* memberships when no `parishId` is passed. A user who is a teacher in parish A and student in parish B is globally treated as teacher (lands on `/lessons`). The shell never disambiguates which parish's data they're viewing.
- **`RoleGuard` redirect loop safety:** denial redirects to `/`, which re-runs `HomePage`; for a student hitting a teacher route this resolves to `/my-lessons` (no loop) because `HomePage` does not itself gate.
- **Top-bar name button is a dead control:** the user-name button has an empty `onClick` placeholder (`DashboardLayout.tsx:78`) — there is no profile dropdown yet.
- **`PASSWORD_RECOVERY` does a full `window.location.href` redirect** (`useAuth.ts:102`), not a router navigate — it reloads the app.

## Acceptance criteria

- [ ] Visiting `/` while unauthenticated redirects to `/login`.
- [ ] Visiting `/` as a user whose only role is `student` redirects to `/my-lessons`.
- [ ] Visiting `/` as a user with a `teacher` membership redirects to `/lessons`.
- [ ] Visiting `/` as a user with an `admin` membership redirects to `/lessons`.
- [ ] A user with **zero** memberships is treated as a student and lands on `/my-lessons`.
- [ ] While the session/profile is still loading, a centered "Loading…" placeholder is shown and no redirect fires.
- [ ] A `student` navigating directly to `/lessons` (teacher route) is bounced to `/` and ends up on `/my-lessons`.
- [ ] A non-admin navigating directly to `/settings` is redirected away (denied) by the admin `RoleGuard`.
- [ ] The sidebar shows the **teacher** link set (incl. Lesson Builder, Videos, Cohorts, Settings) for teacher/admin users and the **student** link set otherwise.
- [ ] The "Super Admin" sidebar link renders only when `profiles.is_super_admin === true`.
- [ ] The top bar displays `profiles.display_name`; when the profile is null it renders an empty string and does not crash.
- [ ] `switchParish` is a no-op for a non-super-admin (no override is created).
- [ ] After a super-admin activates a parish override, `isTeacherOrAdmin()` is true and effective memberships contain exactly one synthetic `admin` membership for the overridden parish.
- [ ] When an override is active, the red "Viewing as admin: \<parishName\>" banner with an Exit control is visible across all shell routes.
- [ ] Clicking Exit (or signing out) clears the override from state and `sessionStorage` (`narthex_parish_override`) and restores real memberships.
- [ ] Signing out clears the parish override before calling Supabase `signOut` and ultimately lands the user on `/login`.
- [ ] Profile and membership reads are scoped to the current user (`profiles.id = auth.uid()`, `memberships.user_id = auth.uid()`) and a user cannot read another user's rows.
- [ ] `INITIAL_SESSION` auth events do not trigger a second profile/membership fetch.

## Port notes

**Shape in Parvus Ordo (Next.js 16 App Router):** This section becomes the **authenticated layout + an index redirect**, not a page with logic.

- **`packages/core`** owns the only business logic here: a `getAuthContext()` / `resolveViewer()` function that, given the WorkOS session + resolved tenant (from hostname → diocese/parish per the branding cascade), returns `{ user, profile, memberships, isSuperAdmin, effectiveMemberships }` and the derived predicates (`isTeacherOrAdmin`, `hasRole`). The role-resolution + "default to student" + "OR across memberships" rules live here, fully unit-testable, with no React/Next imports. Keep `effectiveMemberships`/override derivation in core too.
- **RSC layout (`app/(app)/layout.tsx`)** = the `DashboardLayout` + `Sidebar` equivalent. It reads the viewer via `core` (direct DB read in a Server Component — reads → RSC per CLAUDE.md), enforces auth (redirect to login if no session), and renders the role-filtered nav. No business logic in the component.
- **Index redirect (`app/(app)/page.tsx`)** = `HomePage`. Server-side `redirect()` to `/lessons` or `/my-lessons` based on `core`'s `isTeacherOrAdmin`. This is a ~5-line shim.
- **`RoleGuard`** → middleware and/or per-segment server checks: each protected route segment calls `core` to assert role and `redirect('/')` (or `notFound`) otherwise. Prefer server enforcement over a client guard.
- **Super-admin "view as parish" override** → a Server Action `setParishOverride(parishId)` (auth check → `isSuperAdmin` in core → set a signed httpOnly cookie). Replace the `sessionStorage` JSON with a cookie so it is readable in RSC. The banner is a server-rendered strip in the layout when the cookie is present; **Exit** is a Server Action clearing the cookie. The synthetic-`admin`-membership injection stays in `core`'s `resolveViewer` based on the cookie.
- **`infra/workers`**: nothing in this section is out-of-band; no worker involvement.

**Auth mapping:** Supabase Auth (`getSession`/`onAuthStateChange`/`signInWithPassword`/`signOut`) → **WorkOS**. The reactive `onAuthStateChange` listener is unnecessary in the RSC model — session is resolved per-request server-side. Sign-out becomes a WorkOS logout route handler. `PASSWORD_RECOVERY → window.location.href` becomes WorkOS's own recovery flow.

**RLS / tenancy:** `profiles`→ a `users`/`profiles` table keyed to WorkOS user id; `memberships`→ membership rows scoped by `parish_id`. Enforce with Neon RLS: a viewer reads only their own profile and memberships; tenant scoping (diocese/parish) flows from the hostname-resolved tenant + membership `parish_id`. Note the legacy global-OR role behavior across multiple parishes — Parvus Ordo should decide explicitly whether role checks are tenant-scoped to the resolved parish (recommended, given hostname resolution already pins a tenant) rather than OR'd across all memberships. **Flag this as a behavior decision for the port.**

**Mux→Bunny / Whisper→Groq:** **Not applicable to this section** — the dashboard shell has zero media/transcription touchpoints. Those mappings belong to the lesson/video/media-asset sections.

**Explicit GAPS vs what Parvus Ordo already has:**
- Parvus Ordo's built lessons-with-versioning, media/asset manager, seek-enforcing player + transcript, and teacher preview are all **destinations the shell links to**, not part of this section. The only coupling is that the index redirect and sidebar must point at the Parvus Ordo equivalents of `/lessons`, `/my-lessons`, `/videos` (now the media/asset manager), etc. **Audit the Parvus Ordo route names and update the redirect + nav targets accordingly.**
- There is **no analytics/engagement summary** on the Narthex home — do not port one in. (Engagement dashboards are a separate teacher route.)
- The legacy top-bar profile button is a **non-functional placeholder**; treat a profile menu as net-new if desired, not a port.
- The legacy `testMode` global (16x playback, disabled animations, skipped telemetry) is an e2e affordance — decide separately whether Parvus Ordo needs an equivalent; it is **not** part of the dashboard's behavior.
