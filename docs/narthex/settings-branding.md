# Settings & Branding

> Source of truth: Narthex legacy app (`apps/web` Vite + React + Supabase). Paths below are relative to the Narthex repo root unless noted. Line references are `relativepath:line`.

## Overview

The Settings section is the **parish administration console**. It is a single route (`/settings`, rendered by `apps/web/src/routes/SettingsPage.tsx`) with a horizontal tab bar. Each tab is a self-contained component under `apps/web/src/components/settings/`. There is **no separate "Branding" feature** in Narthex today — the closest thing to branding/identity is the **Parish** tab (parish name + default AI discussion template). The doc therefore covers everything reachable from the Settings page:

| Tab id | Component | Purpose |
|---|---|---|
| `members` | `MembersTab.tsx` (+ `PendingApplicants.tsx`) | Invite/manage parish members; surfaces pending OCIA applications inline |
| `applications` | `ApplicationsTab.tsx` | Full OCIA application inbox (search, sort, filter, PDF export, invite/dismiss/delete) |
| `cohorts` | `CohortsTab.tsx` | Create cohorts (student groups) and toggle student membership |
| `parish` | `ParishTab.tsx` | Edit parish name + default discussion-prep prompt template ("branding"/identity) |
| `calendars` | `CalendarSourcesTab.tsx` | Manage external iCal feed sources (name/url/color/enabled/order) + live test |
| `api-keys` | `ApiKeysTab.tsx` | Mint/revoke hashed API keys for external tools (MCP, AI assistants) |
| `video` | `VideoClipsTab` (inline in `SettingsPage.tsx`) | Manually trigger nightly Mux clip sync |

Why it exists: Narthex is multi-tenant (diocese → parish → cohort → member). This page is where a parish admin/teacher configures their tenant: who belongs, how students are grouped, what calendars feed the schedule, what AI prompt is used for discussion-guide export, and what external API access exists.

Tab content (except `video`) only renders when a `parishId` is resolved: `SettingsPage.tsx:28` reads `memberships[0]?.parishId` and gates each tab on `activeTab === 'x' && parishId` (`SettingsPage.tsx:54-71`). The `video` tab renders unconditionally.

## Roles & access

Roles come from `useAuth` (`apps/web/src/hooks/useAuth.ts`), backed by the `memberships` table (enum `membership_role` = `admin | teacher | student`). The page computes `isAdmin = hasRole('admin')` (`SettingsPage.tsx:27`).

- **Route-level:** The Settings route has no hard role guard in this file — it relies on the surrounding app router and on RLS. Any authenticated member with a parish can open it, but most write actions are gated in-component and again by RLS.
- **Members tab:** Invite form + Pending Applicants render for `isAdmin || hasRole('teacher')` (`MembersTab.tsx:184,187`). A teacher can manage (role-change/remove) only `student` rows; admin can manage anyone (`MembersTab.tsx:143-147`). The role `<select>` only offers `admin` when `isAdmin` (`MembersTab.tsx:229,275`). You cannot manage your own row (`member.userId !== user?.id`, `MembersTab.tsx:265`) and `removeMember` early-returns on self (`MembersTab.tsx:155`).
- **Applications tab:** No in-component gate beyond `parishId`; protected by RLS (admin/teacher SELECT/UPDATE only).
- **Cohorts tab:** Create/delete buttons render only for `isAdmin` (`CohortsTab.tsx:148,186`). Expanding/toggling students has no `isAdmin` gate in the UI (RLS allows admin only for `cohort_members` writes — see Edge cases).
- **Parish tab:** Inputs are `disabled={!isAdmin}`; Save button only renders for admin (`ParishTab.tsx:62,79,86`).
- **Calendars tab:** Returns "Only admins can manage calendar sources." for non-admins (`CalendarSourcesTab.tsx:228-230`). (Note: RLS actually permits admin **and** teacher writes — the UI is stricter than the DB.)
- **API Keys tab:** Returns "Only admins can manage API keys." for non-admins (`ApiKeysTab.tsx:115-117`). RLS is admin-only.
- **Video tab:** No role gate; any authenticated user can press Sync (the `mux-clip` edge function only checks that a valid Supabase JWT is present, not role — `mux-clip/index.ts:301-312`).
- **Super-admin override:** `useAuth` supports a `parishOverride` stored in `sessionStorage` (`narthex_parish_override`) that injects a synthetic `admin` membership for a chosen parish (`useAuth.ts:139-167`). Only `isSuperAdmin` users (from `profiles.is_super_admin`) can set it via `switchParish`. This makes Settings usable cross-parish by super admins.

## User flows

### A. Invite a member (Members tab)
1. Admin/teacher opens Members tab. Component loads members and cohorts (`MembersTab.tsx:35-47,49-86`).
2. Fill email (required), optional display name, role (`student`/`teacher`; `admin` only if admin), and — if role is `student` and cohorts exist — an optional cohort (`MembersTab.tsx:205-242`).
3. Submit → `POST {VITE_SUPABASE_URL}/functions/v1/invite-user` with bearer token + `apikey` header, body `{email, displayName?, parishId, role}` (`MembersTab.tsx:97-114`).
4. Edge function verifies caller is admin/teacher in that parish; teachers may not create admins; looks up existing profile by email (reuses user) else `auth.admin.inviteUserByEmail` with `redirectTo https://narthex.info/accept-invite`; then inserts a `memberships` row (rejects duplicate role with 409) (`invite-user/index.ts:39-104`).
5. On success, if a cohort was chosen and role is student, client inserts `cohort_members` (`MembersTab.tsx:122-127`), shows "User invited successfully!" for 3s, clears form, refetches.
6. **Error states:** missing email → no-op; non-200 → red banner with `result.error` (`MembersTab.tsx:118-119`); network throw → "Failed to invite user".

### B. Change role / remove member (Members tab)
1. For manageable rows, a role `<select>` calls `changeRole` → `memberships.update({role}).eq('id', membershipId)` then refetch (`MembersTab.tsx:149-152`).
2. Trash icon calls `removeMember` → `memberships.delete().eq('id', membershipId)` (self-removal blocked) then refetch (`MembersTab.tsx:154-158`).

### C. Review OCIA applications (Applications tab + Pending Applicants)
1. Pending applicants also appear inline at top of Members tab as a collapsible panel (only `status='pending'`, count badge); hidden entirely if zero (`PendingApplicants.tsx:200-208,268`).
2. Applications tab fetches all applicants for the parish ordered by `submitted_at desc` (`ApplicationsTab.tsx:230-237`).
3. Search box filters by name/email; status pill filters (`all/pending/invited/dismissed/deleted`) with counts; clicking a column header toggles sort (`ApplicationsTab.tsx:241-267,329-367`). `all` hides soft-deleted rows (`ApplicationsTab.tsx:256`).
4. Click a name → detail modal showing personal info, faith background (conditional Catholic sacrament fields), and marriage info (`ApplicationsTab.tsx:60-216`).
5. **Invite as Student** (pending only) → calls `invite-user` with `role:'student'`, then `ocia_applicants.update({status:'invited', reviewed_at, reviewed_by})` (`ApplicationsTab.tsx:269-303`). Success/error banner.
6. **Dismiss** → update status `dismissed` (`ApplicationsTab.tsx:305-312`).
7. **Delete** (soft) → set `deleted_at` (requires inline Confirm/Cancel) (`ApplicationsTab.tsx:314-322,438-463`).
8. **Download PDF** → lazy-imports `generateApplicantPdf` and renders a client-side jsPDF document (`ApplicationsTab.tsx:324-327`; `lib/generateApplicantPdf.ts`).
9. **Empty states:** "No applications yet." vs "No applications match your search." (`ApplicationsTab.tsx:376-379`).

### D. Manage cohorts (Cohorts tab)
1. Admin types a cohort name and clicks Create → `cohorts.insert({parish_id, name})` then refetch (`CohortsTab.tsx:66-74`).
2. Fetch counts: loads all cohorts, then loads **all** `cohort_members` and tallies per `cohort_id` (`CohortsTab.tsx:36-64`).
3. Expand a cohort → loads parish students (`memberships` where `role='student'`), their profiles, and current `cohort_members` for that cohort; renders checkboxes (`CohortsTab.tsx:82-127`).
4. Toggle a student → insert/delete `cohort_members`, optimistic local update + refetch counts (`CohortsTab.tsx:129-141`).
5. Delete cohort (admin) → `cohorts.delete().eq('id')` (cascades to members) (`CohortsTab.tsx:76-80`).
6. **Empty states:** "No cohorts yet." / "No students in this parish." (`CohortsTab.tsx:170-172,201`).

### E. Edit parish identity (Parish tab)
1. Loads `parishes.select('name, discussion_template')` for the parish (`ParishTab.tsx:18-33`). If `discussion_template` is null, the textarea is prefilled with `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE`.
2. Admin edits name and/or template, clicks Save → `parishes.update({name: trim, discussion_template: trim || null})` (`ParishTab.tsx:35-49`). Empty template saves as `null` (falls back to system default at use time).
3. Transient "Saved!" indicator for 2s (`ParishTab.tsx:48,96`). Non-admins see read-only disabled fields, no Save button.

### F. Manage calendar sources (Calendars tab)
1. Loads sources for parish ordered by `display_order` (`CalendarSourcesTab.tsx:58-66`).
2. Add: name + URL (must start `https://`) + color from 6 presets; `display_order` = max+1 (`CalendarSourcesTab.tsx:72-102`). Client validates HTTPS prefix; DB also enforces via CHECK constraint.
3. Inline edit (click the info area), enable/disable checkbox, delete with Confirm/Cancel (`CalendarSourcesTab.tsx:104-142,407-453`).
4. **Test**: `POST .../functions/v1/proxy-ical` with `{url}`; counts `BEGIN:VEVENT` occurrences and extracts up to 3 `SUMMARY:` lines; renders HTTP status + event count or error (`CalendarSourcesTab.tsx:144-213,456-487`).
5. **Empty state:** "No calendar sources yet." (`CalendarSourcesTab.tsx:320-324`).

### G. Mint / revoke API keys (API Keys tab)
1. Loads `api_keys` for parish (newest first), joins `profiles.display_name` for `userName` (`ApiKeysTab.tsx:41-62`).
2. Create: type a name → key generated **client-side**: 24 random bytes → hex → `nrx_<hex>`; prefix = first 12 chars; SHA-256 hash computed via WebCrypto; insert `{key_hash, key_prefix, name, user_id, parish_id}` (`ApiKeysTab.tsx:64-98`).
3. The plaintext key is shown **once** in an amber warning box with Copy; never retrievable again (`ApiKeysTab.tsx:124-149`).
4. Revoke: `api_keys.update({revoked_at: now()})`; revoked keys render dimmed with a "Revoked" badge (`ApiKeysTab.tsx:100-106,203-216`).
5. **Empty state:** "No API keys yet." (`ApiKeysTab.tsx:195-199`).

### H. Sync video clips (Video tab)
1. Press "Sync Video Clips" → `POST .../functions/v1/mux-clip` body `{op:'sync-clips'}` with bearer token (`SettingsPage.tsx:83-106`).
2. Renders created/updated/deleted counts and any errors (`SettingsPage.tsx:129-143`).

## Data model

All tables are parish-scoped (tenant = parish, parent = diocese). Migrations live in `supabase/migrations/`.

### `dioceses` (`20260422000000_initial.sql:29`)
`id`, `name`, `short_code`, `created_at`. Top of tenancy. Not written by this section but is the parent of `parishes`.

### `parishes` (`20260422000000_initial.sql:37`)
`id`, `diocese_id → dioceses(id) CASCADE`, `name`, **`discussion_template text`** (nullable; parish-default AI prompt), `created_at`. Written by Parish tab (`name`, `discussion_template`). RLS: `parishes_select` for authenticated (`:331`); `parishes_update` requires admin via `user_has_role(...,'admin')` (`20260426000001_settings_grants.sql`).

### `profiles` (`20260422000000_initial.sql:48`)
`id (= auth.users.id)`, `display_name`, `email`, `avatar_url`, timestamps. Plus `is_super_admin` (added in `20260502000001_super_admin_and_test_infra.sql`, read by `useAuth`). Read for name/email joins throughout. RLS: own row + same-parish read (`profiles_select_*`).

### `memberships` (`20260422000000_initial.sql:62`)
`id`, `user_id → profiles CASCADE`, `parish_id → parishes CASCADE`, `role membership_role`, `created_at`, `UNIQUE(user_id, parish_id, role)`. The RBAC backbone. Written by Members tab (role change, delete) and `invite-user` (insert). RLS: select own/same-parish; insert/delete admin-or-teacher; `memberships_update` admin-only (`settings_grants.sql`).

### `cohorts` (`20260422000000_initial.sql:75`)
`id`, `parish_id → parishes CASCADE`, `name`, `created_at`. RLS: select for parish members; insert/update/delete gated by `user_has_role` (admin for delete; admin/teacher for update via `20260426000004_cohort_update_grant.sql`).

### `cohort_members` (`20260422000000_initial.sql:85`)
`id`, `cohort_id → cohorts CASCADE`, `student_id → profiles CASCADE`, `joined_at`, `UNIQUE(cohort_id, student_id)`. RLS: insert/delete admin-only (`cohort_members_delete` in `settings_grants.sql` uses `user_has_role(...,'admin')`).

### `calendar_sources` (`20260501000001_calendar_sources.sql`)
`id`, `parish_id → parishes CASCADE`, `name`, `url`, `color (default '#3b82f6')`, `enabled (default true)`, `display_order (default 0)`, `created_at`, `created_by → profiles`, `updated_at`. CHECK constraints: `url ~* '^https://'`, `length(url) BETWEEN 12 AND 2048`, `length(name) BETWEEN 1 AND 200`. RLS: `calendar_sources_manage` FOR ALL to admin/teacher; `calendar_sources_read` SELECT for any parish member where `enabled=true`. Sources are **live-fetched at view time, never synced to DB** (per migration comment).

### `api_keys` (`20260427000000_api_keys.sql`)
`id`, `key_hash text` (SHA-256, never plaintext), `key_prefix text` (first 8–12 chars), `name`, `user_id → profiles CASCADE`, `parish_id → parishes CASCADE`, `scopes text[] DEFAULT '{*}'` (unused in UI), `last_used_at`, `expires_at`, `created_at`, `revoked_at` (null = active). Indexes on `key_hash`, `user_id`. RLS: select/insert/update **admin-only**. Note: there is **no DELETE policy** — revocation is a soft update of `revoked_at`.

### `ocia_applicants` (`20260506000001_ocia_applicants.sql`, soft-delete `20260506000002`)
`id`, `parish_id → parishes CASCADE`, `email`, `full_name`, `form_data jsonb`, `status text DEFAULT 'pending'` (`pending|invited|dismissed`), `submitted_at`, `reviewed_at`, `reviewed_by → profiles`, `deleted_at timestamptz` (soft delete). Indexes on `parish_id` and `(parish_id, status)`. RLS: **INSERT for `anon` + authenticated (public form submission, `WITH CHECK true`)**; SELECT/UPDATE admin/teacher only. No hard delete policy (delete is `deleted_at` update).

### `blocks` / `videos` (touched only by Video tab via edge fn)
`blocks` carries `content_json` (with `videoId/startMs/endMs`) plus Mux clip columns `mux_clip_asset_id`, `mux_clip_playback_id`, `mux_clip_status`, `clip_start_ms`, `clip_end_ms` (`20260430000000_mux_video_columns.sql`). `videos` holds `storage_path`, `duration_ms`, `transcript_text/json`. The Settings Video tab does not query these directly; it triggers the `mux-clip` edge function which does.

### Helper functions
`user_has_role(uid, pid, allowed_roles[])` and `get_user_roles(uid, pid)` are `SECURITY DEFINER STABLE` SQL functions over `memberships` (`20260422000000_initial.sql:282-294`). They power nearly every RLS policy in this section.

## Key logic & algorithms

**Parish/lesson/system template cascade.** Discussion template resolution is three-tier: lesson override → parish default → system default. `packages/shared/src/discussion-template.ts:3-14`:
```ts
if (lessonTemplate?.trim()) return lessonTemplate;
if (parishTemplate?.trim()) return parishTemplate;
return SYSTEM_DEFAULT_DISCUSSION_TEMPLATE;
```
The Parish tab stores the **parish** tier; saving an empty textarea persists `null` so the cascade falls through to the system default (`ParishTab.tsx:42`).

**Client-side API key generation + hashing (zero-knowledge).** The server never sees plaintext; the DB stores only a SHA-256 hash + prefix (`ApiKeysTab.tsx:69-87`):
```ts
const apiKey = `nrx_${hex}`;          // 24 random bytes, hex-encoded
const prefix = apiKey.substring(0, 12);
const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(apiKey));
// insert { key_hash, key_prefix, name, user_id, parish_id }
```
Plaintext is shown once, then unrecoverable.

**iCal test: parse without a library.** The Test button counts events with a regex on `BEGIN:VEVENT` and extracts up to 3 `SUMMARY:` lines from raw text (`CalendarSourcesTab.tsx:181-191`). No ICS parser is used for the test; full parsing lives in the schedule/calendar feature, not here.

**proxy-ical SSRF hardening.** The proxy (`proxy-ical/index.ts`) enforces: HTTPS-only; a host allowlist of regex patterns (`google.com`, `googleapis.com`, `ical-feeds.com`, `faithlife.com`, `churchofjesuschrist.org`, `dioceseaj.org`, extendable via `ICAL_ALLOWED_HOSTS`) (`:18-36`); DNS resolution with private-IP rejection (`isPrivateIP`, `:40-68`); 10s timeout; 5 MB cap with streaming read (`:72-73,200-212`); 10-minute `Cache-Control` on success.

**sync-clips reconciliation.** `mux-clip` `syncClips()` loads all `type='video'` blocks and, per block, treats a clip as needed if `mux_clip_playback_id` is missing, or stale if `clip_start_ms/clip_end_ms` differ from `content_json.startMs/endMs` (`mux-clip/index.ts:206-213`):
```ts
const needsClip = !block.mux_clip_playback_id;
const isStale = block.clip_start_ms !== content.startMs || block.clip_end_ms !== content.endMs;
if (!needsClip && !isStale) continue;
```
For stale-with-existing-asset it counts both a `deleted` and `updated`; otherwise `created` (`:222-227`). It then **polls Mux up to 24×5s (2 min) per clip** waiting for `ready`/`errored`, updating `mux_clip_status` (`:230-247`).

**invite-user idempotency.** Looks up existing profile by email to avoid duplicate auth users; rejects a duplicate `(user_id, parish_id, role)` with HTTP 409; teachers blocked from creating admins (`invite-user/index.ts:55-95`).

**Applicant filter/sort semantics.** `effectiveStatus` makes `deleted_at` win over `status`; the `all` filter hides deleted; sort is a generic `<`/`>` comparison on the chosen field with direction multiplier (`ApplicationsTab.tsx:250-267`).

## External integrations

- **Supabase Edge Functions** (`{VITE_SUPABASE_URL}/functions/v1/...`), all authed with the user's `access_token` bearer + `apikey` header:
  - `invite-user` — uses Supabase Admin API `auth.admin.inviteUserByEmail` (this is the **email/invite** integration; redirect to `https://narthex.info/accept-invite`). Uses the service role key.
  - `proxy-ical` — server-side iCal/`.ics` fetch proxy (CORS + SSRF guard). Backs the Calendars Test button and the schedule feature.
  - `mux-clip` (`op: 'sync-clips'`) — **Mux** video clipping. Creates trimmed Mux assets from source videos based on block trim points; polls Mux asset status.
- **Mux** — video provider. Clip assets created/deleted via Mux API inside `mux-clip`; playback via `mux_clip_playback_id`. Clips are normally generated by a nightly cron (the Video tab is the manual trigger).
- **jsPDF** (`lib/generateApplicantPdf.ts`) — client-side PDF generation for OCIA applications. Hard-codes the header "Holy Spirit Parish · Diocese of Altoona-Johnstown" and footer "Generated from Narthex" (`generateApplicantPdf.ts:105,195`) — **not currently per-tenant branded**.
- No YouTube, Whisper/OpenAI, or email-template integration is used by *this* section (transcription `transcribe`/`youtube-transcript` functions exist but belong to the media/lessons sections).

## Edge cases & gotchas

- **Cohort member-count query is unscoped.** `fetchCohorts` selects `cohort_members.cohort_id` with **no parish filter** (`CohortsTab.tsx:49-51`). It relies entirely on RLS to scope rows; if RLS ever loosened, counts would leak cross-parish. The port must scope this explicitly.
- **UI is stricter than RLS in two places.** Calendars tab blocks non-admins in the UI (`:228`) though RLS allows teachers; Cohorts tab shows student checkboxes without an `isAdmin` gate but `cohort_members` insert/delete is **admin-only** in RLS — a teacher toggling a student will silently fail (no error surfaced). Decide intended behavior during port.
- **`memberships[0]?.parishId` assumes single parish.** `SettingsPage.tsx:28` always uses the *first* membership. A user in multiple parishes has no parish switcher here (only super-admins get `parishOverride`). Multi-membership users see only their first parish's settings.
- **Video Sync has no role gate** and the edge function only checks JWT presence, not role (`mux-clip/index.ts:301-312`) — any logged-in user can trigger a parish-wide (actually **global**, all video blocks) clip sync, and `syncClips` scans **all** video blocks across all parishes, not just the caller's (`mux-clip/index.ts:192-195`). This is a tenancy leak to fix on port.
- **sync-clips is slow/blocking.** Up to 2 minutes of polling *per clip* in a single request (`:230-247`); a request-path trigger can time out with many stale clips. Belongs in a worker.
- **API keys have no DELETE; revocation is soft** (`revoked_at`). Last-used tracking (`last_used_at`) is written elsewhere (the MCP/API auth path), not here.
- **OCIA insert is fully public (`anon`, `WITH CHECK true`)** — the public application form writes directly. Spam/abuse protection is not in the schema; consider rate limiting / captcha at the form layer on port.
- **Optimistic vs refetch races.** `toggleStudent` updates local state then calls `fetchCohorts()` (`CohortsTab.tsx:137-140`); rapid toggles can show a stale count until the refetch resolves.
- **`order('display_order')` without secondary key** — ties (same `display_order`) have nondeterministic order. New sources use `max+1` so duplicates are unlikely but possible after edits.
- **PDF header is hard-coded to one parish** — not multi-tenant; a clear branding gap.
- **No optimistic-locking on parish/calendar edits** — last write wins; concurrent admins can clobber each other (`updated_at` is set but not checked).

## Acceptance criteria

- [ ] Opening `/settings` with no resolved `parishId` renders the tab bar but no parish-scoped tab content (only the Video tab renders).
- [ ] A non-admin (student) sees "Only admins can manage API keys." on the API Keys tab and "Only admins can manage calendar sources." on the Calendars tab.
- [ ] A teacher can invite a `student` and a `teacher` but the role `<select>` does not offer `admin`; the `invite-user` endpoint returns 403 if a teacher attempts to create an admin.
- [ ] Inviting an email that already has a profile reuses that user and returns 409 if the `(user, parish, role)` membership already exists; a brand-new email triggers `inviteUserByEmail`.
- [ ] After a successful student invite with a cohort selected, a `cohort_members` row is created linking the new `userId` to that cohort.
- [ ] An admin cannot change or remove their own membership row (no controls render for self; `removeMember` no-ops on self).
- [ ] Saving the Parish tab with an empty discussion-template textarea persists `discussion_template = NULL`, and `resolveDiscussionTemplate(null, null)` returns `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE`.
- [ ] Creating an API key generates an `nrx_`-prefixed key, stores only its SHA-256 hash and 12-char prefix (never plaintext), and displays the plaintext exactly once.
- [ ] Revoking an API key sets `revoked_at` (key still exists, shown as "Revoked"); no row is hard-deleted.
- [ ] Adding a calendar source with a non-`https://` URL is rejected client-side ("URL must start with https://") and by the DB CHECK constraint.
- [ ] New calendar sources receive `display_order = max(existing) + 1`; the list renders ordered by `display_order`.
- [ ] The Calendars Test action POSTs the source URL to the iCal proxy and reports HTTP status, a count of `BEGIN:VEVENT` events, and up to 3 event summaries; the proxy rejects non-allowlisted hosts (403) and non-HTTPS URLs (400).
- [ ] The iCal proxy rejects URLs resolving to private/internal IPs and aborts fetches exceeding 10s or 5 MB.
- [ ] An OCIA application can be inserted by the `anon` role; only admin/teacher of the same parish can SELECT/UPDATE it.
- [ ] In the Applications tab, the `all` status filter excludes soft-deleted applicants; the `deleted` filter shows only rows with `deleted_at` set; deleting sets `deleted_at` (no hard delete).
- [ ] "Invite as Student" on a pending applicant calls `invite-user` then sets the applicant to `status='invited'` with `reviewed_at`/`reviewed_by`; "Dismiss" sets `status='dismissed'`.
- [ ] Downloading an applicant PDF produces a jsPDF document containing the applicant's personal, faith, and (when present) marriage data.
- [ ] Cohort student-count badges reflect actual `cohort_members` rows for that cohort and update after toggling a student.
- [ ] Toggling a student into/out of a cohort as a non-admin (teacher) fails at the RLS layer (insert/delete are admin-only).

## Port notes

**Stack mapping (ParvaOrdo: Next.js 16 App Router, `packages/core`, Neon + RLS, WorkOS, Bunny, Groq).** Per `CLAUDE.md`, business logic and data access live in `packages/core`; entry points are thin shims.

- **`packages/core` (the backend).** Put all of this here as use-cases + validators (Zod) + queries:
  - `members`: invite/changeRole/remove, with the admin/teacher gating rules and the "can't manage self / teacher can't create admin" invariants.
  - `cohorts`: create/delete, list-with-counts (scope the count query by parish — fix the unscoped query), toggle membership.
  - `parish`: get/update name + discussion_template; reuse `resolveDiscussionTemplate(lesson, parish, system)` (this already maps cleanly — port the three-tier cascade verbatim).
  - `calendarSources`: CRUD + ordering; keep the HTTPS + length CHECK constraints in the Neon schema.
  - `apiKeys`: mint (SHA-256 hash + prefix), revoke (soft). Move key generation server-side if you want the secret never to touch the client more than display, but the hash-only storage model ports as-is.
  - `ociaApplicants`: list/filter, invite/dismiss/soft-delete, plus the public submit use-case.
- **Server Actions (mutations, ~10 lines each):** member invite/role/remove, cohort create/delete/toggle, parish save, calendar add/edit/delete/toggle, API key create/revoke, applicant invite/dismiss/delete. Each does auth check → validate → call `core` → return.
- **RSC reads:** the initial loads (members list, cohorts+counts, sources, api_keys, applicants list, parish settings) should be direct DB reads in Server Components.
- **Route handler (`/api/v1`):** the iCal proxy and any external-consumer API-key auth. The proxy's SSRF guard (allowlist + private-IP + size/timeout caps) must be reimplemented in the route handler — it is security-critical and must not move client-side. The public OCIA submission is a good `/api/v1` (or a Server Action behind the public form).
- **infra/workers (Cron/Queue):** the **clip sync** must move out of the request path entirely — it's a long-polling reconciliation job. Map Mux→**Bunny**: replace `mux-clip` asset creation/clip/poll with Bunny Stream collection/clip operations; replace `mux_clip_*` block columns with Bunny equivalents. ParvaOrdo already has a **media/asset manager** and a **seek-enforcing player + transcript** — the "students see only the trimmed segment" requirement (`SettingsPage.tsx:116-118`) is likely already satisfied by the seek-enforcing player, so the nightly *physical* clip job may be unnecessary; verify before porting. The manual "Sync Video Clips" button likely becomes obsolete or a worker re-trigger.
- **Whisper→Groq:** not used in this section (transcription belongs to lessons/media). No mapping needed here beyond noting `transcribe`/`youtube-transcript` are out of scope.
- **RLS/tenancy:** All tables are **parish-scoped**, parented by **diocese**. Reproduce `user_has_role`/`get_user_roles` (or WorkOS-org-role equivalents) and the per-table policies. Critical fixes during port: (1) scope the unscoped cohort_members count query; (2) scope/role-gate the clip sync so it cannot operate cross-parish or be triggered by non-admins; (3) reconcile UI-vs-RLS mismatches (calendars teacher write, cohort teacher write). Auth moves from Supabase JWT to **WorkOS** — `inviteUserByEmail` maps to a WorkOS invitation/magic-link; `accept-invite` redirect becomes a WorkOS callback. `profiles.is_super_admin` + `parishOverride` map to a WorkOS super-admin role + an explicit parish switcher (don't rely on `sessionStorage`).
- **Branding gap (explicit):** ParvaOrdo's memory states **per-parish AND per-diocese custom branding is required (hostname-resolved, cascading)**. Narthex has **none** of this: the only identity field is `parishes.name`, the OCIA PDF header/footer is hard-coded to "Holy Spirit Parish · Diocese of Altoona-Johnstown" / "Generated from Narthex" (`generateApplicantPdf.ts:105,195`), and `narthex.info` is hard-coded in `invite-user`. The port must add a branding model (logo, colors, names) at diocese and parish scope with cascade, resolved by hostname, and thread it through the PDF generator, invite emails, and any tenant-facing surface. There is **no existing Narthex code to port for branding** — it is net-new.
- **Other gaps vs. what ParvaOrdo has built:** lessons-with-versioning and the media/asset manager already exist, so the discussion-template field should hook into the existing lesson override mechanism; the teacher-preview feature is unrelated to Settings. API-key `scopes` is present-but-unused (`['*']`) — decide whether ParvaOrdo wants real scopes now.
