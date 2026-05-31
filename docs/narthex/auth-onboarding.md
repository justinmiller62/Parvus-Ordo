# Auth & Onboarding

> Source app: Narthex (`apps/web`, Vite + React + React Router + Supabase JS v2). All `path:line` references below are relative to the Narthex repo root (`/Users/justinmiller/Desktop/Development/repositories/Narthex`).

## Overview

This section covers everything that gets a user **into** Narthex and establishes **who they are**:

- **Sign in** with email + password (`/login`).
- **Forgot / reset password** via Supabase recovery email (`/forgot-password` → email link → `/set-password`).
- **Accept invite** — an admin/teacher invites a person by email; the invitee lands on `/accept-invite?token=...`, verifies the token, and sets their first password.
- **Set password** — the post-invite/post-recovery landing where the new password is committed (`/set-password`).
- **Public OCIA inquiry application** (`/apply`) — an *unauthenticated* prospective student submits a long catechumen intake form; it lands in `ocia_applicants` for an admin/teacher to review and later convert into an invited student.
- The **session/identity layer** itself: `useAuth` loads the Supabase session, the user's `profile`, and their `memberships`, exposes role helpers (`hasRole`, `isTeacherOrAdmin`, `isSuperAdmin`), and supports a super-admin "parish override" used elsewhere in the app.

Narthex is **invite-only**. There is no public self-service signup that creates an account directly. The only public write path is the OCIA application form, which creates a *lead* (an `ocia_applicants` row), not an account. Accounts are created exclusively by the `invite-user` Supabase Edge Function, which an admin/teacher calls from the Settings UI.

This is the front door of a multi-tenant catechesis platform: tenancy is **diocese → parish → membership(role)**, and almost every other feature keys off the `memberships` rows that this section is responsible for creating and loading.

## Roles & access

Roles live in the `memberships` table as the `membership_role` enum. At the time this section was written the enum is `('admin', 'teacher', 'student')`, later extended with `'diocese_admin'` (`supabase/migrations/20260502000001_super_admin_and_test_infra.sql:10`). A separate boolean `profiles.is_super_admin` is an app-wide superuser flag.

Who touches each surface:

| Surface | Who can reach it | Gating |
| --- | --- | --- |
| `/login` | Anyone (public) | If already signed in, redirects to `/` (`routes/LoginPage.tsx:13`). |
| `/forgot-password` | Anyone (public) | None. |
| `/set-password` | Anyone with a route, but only useful with an active recovery/invite session | No guard; relies on having a Supabase session from the email link. |
| `/accept-invite` | Anyone with a valid `token` query param | Renders an error if `token` missing (`routes/AcceptInvitePage.tsx:16`). |
| `/apply` | Anyone (public, unauthenticated) | None — writes as the `anon` Postgres role. |
| Inviting a user (calling `invite-user`) | `admin` or `teacher` in the target parish | Enforced **server-side** in the Edge Function (`supabase/functions/invite-user/index.ts:41-58`); teachers cannot create `admin` users. |
| Reviewing/converting OCIA applicants | `admin` or `teacher` in the parish | RLS on `ocia_applicants` (`supabase/migrations/20260506000001_ocia_applicants.sql:27-38`). |

All authenticated app routes are wrapped by `AuthGuard` (`components/layout/AuthGuard.tsx`), which shows a loading state while `useAuth` resolves and redirects to `/login` if there is no `user`. The five auth/onboarding routes (`/login`, `/forgot-password`, `/set-password`, `/accept-invite`, `/apply`) are declared **outside** the `AuthGuard` wrapper (`apps/web/src/App.tsx:68-72`) so they are reachable while logged out.

## User flows

### 1. Sign in
1. User visits `/login`. If a session already exists, `useAuth().user` is set and the page immediately `<Navigate to="/" replace />` (`routes/LoginPage.tsx:13-15`).
2. User enters email + password and submits. Button shows "Signing in..." and is disabled (`submitting` state).
3. `signIn(email, password)` calls `supabase.auth.signInWithPassword` (`hooks/useAuth.ts:124-130`).
4. **Success:** `navigate('/')`. (The `onAuthStateChange` listener also fires and loads profile + memberships.)
5. **Error:** the raw Supabase error message is passed through `friendlyError()` (`routes/LoginPage.tsx:17-29`) which maps:
   - "invalid login credentials" / "invalid email or password" → "Incorrect email or password. Please try again." (and renders an inline "Forgot your password?" link).
   - "email not confirmed" → confirmation-link message.
   - "too many requests" / "rate limit" → throttle message.
   - anything else → shown verbatim.
6. Footer always shows the invite-only notice (`routes/LoginPage.tsx:124-126`).

### 2. Forgot password
1. User visits `/forgot-password`, enters email, submits ("Sending...").
2. Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${window.location.origin}/set-password\` })` (`routes/ForgotPasswordPage.tsx:17-19`).
3. **Success:** shows a generic "Check your email — *If an account exists for X*, we sent a password reset link" confirmation (deliberately does not confirm whether the account exists) (`routes/ForgotPasswordPage.tsx:34-47`).
4. **Error:** the Supabase error message is shown in a red box (`routes/ForgotPasswordPage.tsx:55-59`).

### 3. Set password (post-recovery / post-invite landing)
1. User clicks the recovery link in email. Supabase processes the token and creates a session; the app's `onAuthStateChange` fires with `PASSWORD_RECOVERY` and **hard-redirects** to `/set-password` via `window.location.href` (`hooks/useAuth.ts:100-104`). A second redirect path also exists: `InviteRedirect` inspects the URL hash for `type=invite`/`type=recovery` and navigates to `/set-password` (`apps/web/src/App.tsx:44-59`).
2. User enters password + confirm. Client validation: password ≥ 8 chars; password === confirm (`routes/SetPasswordPage.tsx:16-23`).
3. Calls `supabase.auth.updateUser({ password })` (`routes/SetPasswordPage.tsx:27`).
4. **Success:** `navigate('/')`.
5. **Error:** raw Supabase error message shown.

### 4. Accept invite
1. Admin/teacher invites the person (flow 6). The invitee receives an email whose link points at `https://narthex.info/accept-invite` (hard-coded `redirectTo` in `supabase/functions/invite-user/index.ts:75`), carrying a `token` (and optional `type`) query param.
2. Invitee opens `/accept-invite?token=...`. If `token` is missing → error card "Invalid invite link — no token found." with a "Go to Login" button (`routes/AcceptInvitePage.tsx:16-33`).
3. Invitee enters password + confirm (same ≥8 / match validation).
4. **On submit (not on page load):** Step 1 — `supabase.auth.verifyOtp({ token_hash: token, type: type === 'recovery' ? 'recovery' : 'invite' })` exchanges the token for a session (`routes/AcceptInvitePage.tsx:53-56`). Doing this on the user action rather than on mount is **intentional** to keep email-prefetch/link-scanner bots from silently consuming the one-time token (comment at `routes/AcceptInvitePage.tsx:50-52`).
5. If verify fails with "Token has expired or is invalid" → friendly "This invite link has expired. Please ask your administrator to send a new one." Otherwise the raw message is shown (`routes/AcceptInvitePage.tsx:58-66`).
6. Step 2 — `supabase.auth.updateUser({ password })` sets the password (`routes/AcceptInvitePage.tsx:69`).
7. **Success:** `navigate('/')`. The profile row already exists (auto-created at invite time by the `handle_new_user` trigger), and the membership already exists (created by the Edge Function), so the user lands logged-in with their role.

### 5. Public OCIA application (`/apply`)
1. Unauthenticated prospective catechumen opens `/apply` (branded "Holy Spirit Parish · Diocese of Altoona-Johnstown").
2. Fills a multi-section form: Personal Information, Faith Background (conditional "Catholic sacraments" sub-form appears when baptized = yes and faith tradition contains "catholic" — `routes/ApplyPage.tsx:66`), and Marriage Information (heavily conditional branches for currently-married / plans-to-marry / prior marriages).
3. Client validation is minimal: only `fullName` and `email` are required (`routes/ApplyPage.tsx:70`); everything else is optional and stored as a JSON blob.
4. On submit, inserts into `ocia_applicants` with `parish_id` **hard-coded** to `HOLY_SPIRIT_PARISH_ID = '00000000-0000-0000-0000-000000000002'` (`routes/ApplyPage.tsx:5, 75-80`); the whole `form` object goes into `form_data` (jsonb), plus normalized `email` and `full_name`.
5. **Success:** replaces the form with an "Application Received" confirmation card (`routes/ApplyPage.tsx:92-105`).
6. **Error:** generic "Something went wrong. Please try again or contact the parish office." (no detail leaked) (`routes/ApplyPage.tsx:84-87`).

### 6. Inviting a user (admin/teacher → `invite-user` Edge Function)
Triggered from Settings (`components/settings/MembersTab.tsx` direct invite, or `components/settings/ApplicationsTab.tsx` / `PendingApplicants.tsx` "convert applicant to student"):
1. Caller POSTs `{ email, displayName, parishId, role }` to `${VITE_SUPABASE_URL}/functions/v1/invite-user` with the caller's `Bearer <access_token>` (`components/settings/MembersTab.tsx:96-114`).
2. Function authenticates the caller via `supabase.auth.getUser(token)` using the service-role client (`supabase/functions/invite-user/index.ts:23-31`).
3. Validates `email && parishId && role` (400 if missing) (`index.ts:35-37`).
4. Looks up caller's membership in `parishId` filtered to roles `('admin','teacher')`; 403 if none (`index.ts:41-53`). Teacher inviting role `admin` → 403 (`index.ts:56-58`).
5. Checks `profiles` for an existing user by email (avoids the "broken `listUsers`" admin API — comment at `index.ts:60`). If found, reuses that `userId`; otherwise calls `supabase.auth.admin.inviteUserByEmail(email, { data: { display_name }, redirectTo: '.../accept-invite' })` which sends the invite email and creates the auth user (`index.ts:69-82`).
6. Checks for an existing identical membership (`user_id + parish_id + role`); returns 409 "User already has this role in this parish" if present (`index.ts:85-95`).
7. Inserts the membership (`index.ts:98-100`) and returns `{ success, userId, isNewUser }`.
8. Caller-side follow-ups: `MembersTab` may add the new student to a cohort (`cohort_members` insert) (`MembersTab.tsx:122-127`); `ApplicationsTab` flips the applicant row to `status:'invited'` with `reviewed_at`/`reviewed_by` (`ApplicationsTab.tsx:291-294`).

### 7. Sign out
`signOut()` clears the super-admin parish override from `sessionStorage`, then `supabase.auth.signOut()` (`hooks/useAuth.ts:132-137`). `onAuthStateChange` then resets state to anonymous; `AuthGuard` redirects to `/login`.

## Data model

Tables touched by this section (Supabase Postgres). Defined in `supabase/migrations/20260422000000_initial.sql` unless noted.

### `auth.users` (Supabase-managed)
The real identity record (email, encrypted password, invite/recovery tokens, `raw_user_meta_data`). Created by `inviteUserByEmail`. Not directly queried by app code; everything joins through `profiles`.

### `profiles` (1:1 with `auth.users`)
- `id uuid PK` → `auth.users(id) ON DELETE CASCADE` (same id as the auth user; this is the value used everywhere as the "user id").
- `display_name text NOT NULL`
- `email text NOT NULL`
- `avatar_url text`
- `is_super_admin boolean NOT NULL DEFAULT false` (added in `20260502000001`).
- `created_at`, `updated_at timestamptz` (auto-updated via `profiles_updated_at` trigger).
- **Auto-created** on every `auth.users` INSERT by the `handle_new_user()` SECURITY DEFINER trigger, defaulting `display_name` to `raw_user_meta_data->>'display_name'` or the email local-part (`initial.sql:683-698`).
- **RLS:** own-row select/update; teachers/admins read profiles in their parish; **plus** a blanket `profiles_select_authenticated USING (true)` added in `20260428000003_profiles_read_all.sql` so any authenticated user can read any profile (for author names). Super-admin select policy in `20260502000001`.

### `memberships` (the role/tenancy join)
- `id uuid PK`
- `user_id uuid NOT NULL` → `profiles(id) ON DELETE CASCADE`
- `parish_id uuid NOT NULL` → `parishes(id) ON DELETE CASCADE`
- `role membership_role NOT NULL` (`admin|teacher|student`, later `+diocese_admin`)
- `created_at`
- `UNIQUE(user_id, parish_id, role)` — a user can hold multiple roles in a parish and belong to multiple parishes; the Edge Function 409 maps to this constraint.
- **RLS:** users select own; admins select/insert/delete within their parish (`initial.sql:351-369`); super-admin select. The Edge Function bypasses RLS (service role) when inserting.

### `parishes`
- `id uuid PK`, `diocese_id uuid NOT NULL` → `dioceses(id)`, `name text`, `discussion_template text`, `created_at`. Test columns (`is_test`, `clock_override`, `test_run_id`) added later. Referenced by `ocia_applicants.parish_id` and `memberships.parish_id`. RLS: members can select their parishes.

### `dioceses`
- `id uuid PK`, `name`, `short_code`, `created_at` (+ test columns). The top of the tenancy tree; `/apply`'s hard-coded parish belongs to "Diocese of Altoona-Johnstown".

### `ocia_applicants` (the public-inquiry lead table)
Defined in `supabase/migrations/20260506000001_ocia_applicants.sql` (+ `20260506000002` soft-delete):
- `id uuid PK`
- `parish_id uuid NOT NULL` → `parishes(id) ON DELETE CASCADE`
- `email text NOT NULL`
- `full_name text NOT NULL`
- `form_data jsonb NOT NULL` (the entire intake form blob — see `initialForm` in `routes/ApplyPage.tsx:38-52`)
- `status text NOT NULL DEFAULT 'pending'` (lifecycle: `pending` → `invited` | `dismissed`)
- `submitted_at timestamptz DEFAULT now()`
- `reviewed_at timestamptz`, `reviewed_by uuid` → `profiles(id)`
- `deleted_at timestamptz` (soft delete; UI treats non-null as effective status "deleted" — `ApplicationsTab.tsx:250`)
- Indexes on `(parish_id)` and `(parish_id, status)`.
- **RLS (ownership-relevant):** `INSERT` allowed to **`anon` and `authenticated`** with `WITH CHECK (true)` — i.e. **anyone, including logged-out visitors, can create a row** (the public form). `SELECT`/`UPDATE` restricted to admin/teacher of the row's `parish_id` via `user_has_role(...)`. No DELETE policy — deletion is soft (UPDATE `deleted_at`).

### RLS helper functions (`initial.sql:276-294`)
- `get_user_parish_ids(uid)` → set of parish ids for the user.
- `get_user_roles(uid, pid)` → roles in a parish.
- `user_has_role(uid, pid, allowed_roles[])` → boolean. All `SECURITY DEFINER STABLE` to avoid RLS recursion.
- `is_super_admin()` (`20260502000001:46-56`) — `SECURITY DEFINER` lookup of `profiles.is_super_admin` for `auth.uid()`.

### `cohort_members` (touched only as an invite follow-up)
`cohort_id` + `student_id` (→ `profiles`), `UNIQUE(cohort_id, student_id)`. `MembersTab` inserts here after inviting a student into a selected cohort.

## Key logic & algorithms

**Token verification is deferred to user action, not page load.** This is the single most important non-obvious behavior:
```ts
// routes/AcceptInvitePage.tsx:50-56
// This is done HERE on user action, NOT on page load.
// This prevents email pre-fetch scanners from consuming the token.
const { error: verifyErr } = await supabase.auth.verifyOtp({
  token_hash: token,
  type: type === 'recovery' ? 'recovery' : 'invite',
});
```
Many mail clients/security gateways prefetch links; if the OTP were verified on mount the one-time token would be burned before the human clicks. The invite is a **two-step** process: `verifyOtp` (creates session) then `updateUser({ password })`.

**Two different redirect mechanisms route the email-link landing.** Supabase can return the token either in the URL hash (implicit flow) or as a `token_hash` query param:
- Hash flow: `InviteRedirect` reads `window.location.hash` for `type=invite`/`type=recovery` and pushes `/set-password` (`App.tsx:48-56`), and `onAuthStateChange(PASSWORD_RECOVERY)` hard-redirects via `window.location.href = '/set-password'` (`useAuth.ts:100-104`).
- Query-param flow: the invite email's `redirectTo` is `/accept-invite`, which reads `?token=` and verifies it manually.
This dual handling is brittle and a porting hazard (see gotchas).

**Membership-driven role model loaded once per session.** `fetchUserData` runs `profiles` + `memberships` queries **in parallel** (`useAuth.ts:45-49`) and maps snake_case DB rows to camelCase domain types. Role checks (`hasRole`, `isTeacherOrAdmin`) operate over the in-memory membership array.

**Super-admin "parish override".** A super-admin can impersonate a parish; the override is persisted in `sessionStorage` under `narthex_parish_override` and, when active, `useAuth` **injects a synthetic `admin` membership** for that parish so the rest of the app's role checks pass (`useAuth.ts:139-148`). `switchParish` is a no-op unless `isSuperAdmin()`. Note this is client-side only — the DB still enforces real RLS, with separate super-admin SELECT policies.

**Invite authorization is enforced server-side, not in the client.** The client just POSTs; all gating (caller is admin/teacher in that parish; teacher can't mint admins; duplicate detection) lives in the Edge Function (`invite-user/index.ts:41-95`). The function uses the **service-role key** and existing-user detection via `profiles` (not the admin `listUsers` API, noted as broken — `index.ts:60`).

**OCIA "Catholic" branch detection** is a fragile string match:
```ts
// routes/ApplyPage.tsx:66
const isCatholic = form.baptized === 'yes' && form.baptismFaith.toLowerCase().includes('catholic');
```

## External integrations

- **Email** is entirely **Supabase Auth's built-in transactional email**: `inviteUserByEmail` (invite), `resetPasswordForEmail` (recovery). There is no separate email provider, no SMTP code, and no email templates in this section's code — they live in Supabase project config. The invite email's link target is hard-coded to `https://narthex.info/accept-invite` (`invite-user/index.ts:75`).
- **Supabase Auth** (GoTrue): `signInWithPassword`, `signOut`, `getSession`, `onAuthStateChange`, `verifyOtp`, `updateUser`, `resetPasswordForEmail`, `admin.inviteUserByEmail`, `getUser`.
- **No Mux, no Whisper/OpenAI, no ICS/ical, no YouTube** are used in Auth & Onboarding. (Those belong to the media/lesson sections.)

## Edge cases & gotchas

- **Token consumed by link scanners:** mitigated only on `/accept-invite` by deferring `verifyOtp` to submit. The hash/`PASSWORD_RECOVERY` path for `/set-password` does **not** have this protection — the session is created by Supabase before the user acts.
- **Two parallel redirect paths to `/set-password`** (`InviteRedirect` hash sniff + `onAuthStateChange` hard nav). They can both fire; `useAuth.ts` ignores `INITIAL_SESSION` to avoid double-handling (`useAuth.ts:97`), but the hard `window.location.href` redirect bypasses React Router and reloads the app.
- **Hard-coded parish on `/apply`:** every public application is forced into `HOLY_SPIRIT_PARISH_ID = '00000000-...0002'`. There is no parish selection — the form only works for one parish. This is a deliberate demo/single-tenant shortcut and must be parameterized in the port.
- **Open insert on `ocia_applicants`:** RLS `WITH CHECK (true)` for `anon` means the form is **unauthenticated and unthrottled** — spam/abuse vector with no rate limiting, no CAPTCHA, no email verification.
- **Duplicate-invite handling is by exact `(user_id,parish_id,role)`** — inviting an existing student as a teacher succeeds (different role), and re-inviting the same triple returns 409 rather than re-sending an email. There is no "resend invite" affordance for an expired token other than inviting again.
- **`is_super_admin` is seeded to a specific personal email** in migration (`justinmmiller62@gmail.com`, `20260502000001:5`) — must not be carried into the port.
- **Service-role JWT is committed as a fallback default** in the Edge Function source (`invite-user/index.ts:5`) — a secret leak; do not replicate.
- **Password policy is client-only** (`>= 8` chars, match) in `/set-password` and `/accept-invite`; no server-side strength enforcement beyond Supabase defaults.
- **`profiles_select_authenticated USING (true)`** means any authenticated user can read every profile (display_name + email) across all tenants — broader than parish scope. Intentional for author-name display but worth re-scoping under Parvus Ordo tenancy.
- **No email confirmation step for invited users** — `inviteUserByEmail` + setting a password is sufficient; the `email not confirmed` login error is handled defensively but shouldn't occur for invited users.
- **`/login` redirect race:** the page reads `useAuthContext().user`; while `loading` is true `user` is null, so a freshly-loaded `/login` may briefly render the form before `AuthGuard` semantics apply (login page itself is not behind the guard).

## Acceptance criteria

- [ ] Visiting `/login` while already authenticated redirects to `/` without showing the form.
- [ ] Submitting `/login` with wrong credentials shows "Incorrect email or password. Please try again." and renders a "Forgot your password?" link.
- [ ] A successful `/login` establishes a session and loads the user's `profile` and all `memberships` (both queries fire).
- [ ] `/forgot-password` always shows the generic "if an account exists" confirmation on success and never reveals whether the email is registered.
- [ ] `/forgot-password` sends a recovery email whose link returns the user to a set-password experience.
- [ ] `/set-password` rejects passwords shorter than 8 characters and rejects mismatched confirm before any network call.
- [ ] After setting a new password on `/set-password`, the user is navigated to `/`.
- [ ] `/accept-invite` with no `token` query param renders an "Invalid invite link" error and a path back to login.
- [ ] `/accept-invite` does **not** verify/consume the token on page load — verification happens only on form submit.
- [ ] `/accept-invite` with an expired token shows "This invite link has expired. Please ask your administrator to send a new one."
- [ ] A valid `/accept-invite` submit verifies the OTP, sets the password, and lands the user logged-in with their pre-created membership/role.
- [ ] `/apply` submits successfully with only full name and email filled, persisting the full form as a JSON blob and showing the "Application Received" confirmation.
- [ ] `/apply` is reachable and submittable while completely unauthenticated.
- [ ] The OCIA form reveals the Catholic-sacraments sub-section only when baptized = "yes" and faith tradition contains "catholic".
- [ ] Calling the invite endpoint as a non-member of the target parish returns 403.
- [ ] A teacher attempting to invite a user with role `admin` is rejected (403); a teacher inviting `student`/`teacher` succeeds.
- [ ] Inviting an email that already holds the requested role in the parish returns a 409 conflict and does not send a duplicate.
- [ ] Inviting a brand-new email creates an auth user, auto-creates a `profiles` row, sends an invite email, and inserts the `memberships` row.
- [ ] Converting an OCIA applicant to a student updates the applicant row to `status:'invited'` with `reviewed_at`/`reviewed_by` set.
- [ ] Signing out clears the parish override and returns the user to `/login`.

## Port notes

Map to the Parvus Ordo stack (Next.js 16 App Router, `packages/core` backend boundary, Neon + RLS, WorkOS auth, Bunny video, Groq transcription). **Auth provider changes from Supabase Auth/GoTrue to WorkOS** — this is the largest delta.

**Identity / auth (Supabase Auth → WorkOS):**
- Sign-in, password reset, invite acceptance, and "set password" are all GoTrue calls today. Under WorkOS, replace with WorkOS AuthKit/User Management: hosted login or WorkOS-driven email+password, WorkOS magic-link/invitation for onboarding, and WorkOS password-reset flows. The custom `/set-password` and `/accept-invite` two-step OTP dance largely **disappears** because WorkOS owns the token lifecycle; keep only thin Next.js route handlers/pages for the WorkOS callback and post-auth redirect.
- `useAuth` (session + profile + memberships + role helpers) becomes: WorkOS session read in a Server Component / middleware, plus a `packages/core` function `getCurrentUserContext()` that loads the local `profiles`/`memberships` analog and returns role helpers. Role checks (`hasRole`, `isTeacherOrAdmin`, `isSuperAdmin`) move into `packages/core` as pure functions over the membership set.

**Where each entry point lands:**
- **Login / forgot-password / set-password / accept-invite pages** → thin App Router pages + route handlers that delegate to WorkOS; no business logic. Any local bookkeeping (e.g. ensuring a `profiles` row exists after first WorkOS login) calls a `packages/core` `ensureProfile(workosUser)` function.
- **Invite a user** → a **Server Action** (`inviteMember`) that is a ~10-line shim: auth check → validate `{ email, role, parishId }` → call `core.inviteMember(...)`. `core.inviteMember` holds *all* the Edge Function's logic (caller must be admin/teacher in parish; teacher can't mint admin; dedupe `(user,parish,role)`; create WorkOS invitation; upsert profile + membership). The current Deno Edge Function (`invite-user`) maps cleanly onto this single `core` function. Sending the actual invitation email is a WorkOS API call from within `core`.
- **OCIA public application** → a **Server Action** (or a small public `/api/v1` route handler if a non-Next consumer is ever needed) `submitOciaApplication(input)` that validates and calls `core.createOciaApplicant(...)`. Because the writer is unauthenticated, this is the one place to add **rate limiting / CAPTCHA / spam protection** that Narthex lacks. Parish must be resolved from the request **hostname** (per the branding/tenancy memory: per-parish custom branding is hostname-resolved) rather than the hard-coded `HOLY_SPIRIT_PARISH_ID`.
- **Applicant review/convert** → Server Actions (`listOciaApplicants`, `inviteApplicantAsStudent`, `dismissApplicant`, `softDeleteApplicant`) over `core`. "Convert" reuses `core.inviteMember` + updates the applicant lifecycle in the same `core` call/transaction.
- **No out-of-band/worker work** is required for this section (no transcription/embeddings here). Keep it all request/response.

**RLS / tenancy (global / diocese / parish scope):**
- `memberships`, `profiles`, `parishes`, `dioceses`, `ocia_applicants` port to Neon with RLS keyed on the same tenancy tree (diocese → parish). Re-implement `user_has_role`, `get_user_parish_ids`, `is_super_admin` as SECURITY DEFINER SQL (or as `packages/core` guards over a request-scoped tenant context, depending on how Parvus Ordo sets the Postgres session role).
- `ocia_applicants` should remain **parish-scoped**, but the public INSERT must be tightened: instead of `anon WITH CHECK (true)`, write via a Server Action that sets `parish_id` from the resolved tenant, so the open-insert abuse vector is closed.
- Re-scope the `profiles_select_authenticated USING(true)` blanket read to parish/diocese scope to respect multi-tenant isolation, exposing only `display_name` for author rendering where needed.
- Do **not** carry over the hard-coded super-admin email seed or the committed service-role key.

**Mux→Bunny / Whisper→Groq:** **N/A for this section** — Auth & Onboarding uses no video or transcription. (Those mappings apply to the media/asset and player sections.)

**Explicit GAPS vs what Parvus Ordo already has:**
- Parvus Ordo already has lessons-with-versioning, the media/asset manager, the seek-enforcing player + transcript, and teacher preview. **None of those overlap with this section** — Auth & Onboarding is currently a *gap*: the identity/onboarding layer must be built fresh on WorkOS.
- The OCIA inquiry form (long catechumen intake → `ocia_applicants` → convert-to-student) appears to be a **net-new domain object** with no existing Parvus Ordo equivalent; port the table, the form, the review queue, and the convert-to-invited-student bridge.
- The super-admin **parish override / impersonation** capability (`narthex_parish_override` in `sessionStorage`, synthetic admin membership) is a behavior to re-create deliberately and server-side (a real impersonation/scoped-context mechanism in `core`), not the client-only hack Narthex uses.
- WorkOS supersedes the bespoke recovery/invite token handling; the dual hash/query-param redirect logic (`InviteRedirect` + `PASSWORD_RECOVERY`) should **not** be ported — let WorkOS own it.
