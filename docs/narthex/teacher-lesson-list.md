# Teacher Lesson List

## Overview

The Teacher Lesson List is the teacher/admin landing page for managing the lessons
belonging to a single parish. It is the default home for any teacher or admin (see
`apps/web/src/routes/HomePage.tsx:16-17`, which redirects `isTeacherOrAdmin()` users to
`/lessons`). It renders a flat, ordered list of every lesson in the active parish and
exposes the four core lifecycle actions on each row:

- **Create** a new lesson (`New Lesson` button → `/lessons/new`).
- **Open/Edit** a lesson (clicking the title → `/lessons/:id`).
- **Preview** a lesson as a student (`/lessons/:id/view?preview=true`).
- **Publish** an unpublished (draft) lesson in place (sets `published_at = now()`).
- **Delete** a lesson (with a native `confirm()` guard).

It is a read-then-mutate-in-place screen: it fetches once on mount, then performs
optimistic local state updates for publish and delete rather than re-fetching.

Source file: `apps/web/src/routes/teacher/LessonListPage.tsx`.

## Roles & access

- Route `/lessons` is wrapped in `<RoleGuard allowedRoles={['admin', 'teacher']}>`
  (`apps/web/src/App.tsx:84-91`). Students never reach this page; if a non-teacher/admin
  hits the route, `RoleGuard` issues `<Navigate to="/" replace />`
  (`apps/web/src/components/layout/RoleGuard.tsx:25-27`). Students have their own list at
  `/my-lessons` (`StudentLessonListPage`, `apps/web/src/App.tsx:178`).
- The whole route subtree also sits behind `<AuthGuard>` + `<DashboardLayout>`
  (`apps/web/src/App.tsx:74-80`), so an unauthenticated user is bounced to login first.
- `RoleGuard` checks the in-memory `memberships` array, where a role match against ANY
  membership is sufficient (`RoleGuard.tsx:21-23`). It does NOT scope the check to a
  specific parish, so role gating is coarse-grained at the UI layer; parish scoping is
  enforced separately by the query (`.eq('parish_id', parishId)`) and by RLS.
- **Active parish** comes from `memberships[0]?.parishId`
  (`LessonListPage.tsx:15-16`). The list is effectively single-parish: it always uses the
  first membership. There is no parish picker on this page.
- **Super-admin parish override:** `useAuth` injects a synthetic `admin` membership when a
  super admin has selected a parish override (`apps/web/src/hooks/useAuth.ts:139-148`).
  That override membership becomes `memberships[0]`, so a super admin browsing a parish
  sees and manages that parish's lessons as if they were its admin.

## User flows

1. **View the lesson list (happy path).**
   1. Teacher/admin navigates to `/lessons` (or is auto-redirected from `/`).
   2. Component mounts, `loading = true`, shows `"Loading lessons..."`
      (`LessonListPage.tsx:39-41`).
   3. `fetchLessons()` reads `lessons` for `parish_id = memberships[0].parishId`, ordered
      by `lesson_order` ascending (`LessonListPage.tsx:23-27`).
   4. On success, rows render; each shows title, `Last updated: <localized date>`, a
      Preview link, a Publish button (drafts only), a Published/Draft badge, and a Delete
      trash icon.

2. **Empty state.** If the query returns zero rows, a dashed-border placeholder shows
   `"No lessons yet. Create your first lesson to get started."`
   (`LessonListPage.tsx:56-59`).

3. **Error state (fetch).** If the Supabase query returns an `error`, it is only
   `console.error`'d; `lessons` stays `[]` and `loading` is set false, so the user sees the
   identical empty-state UI as a genuinely empty list (`LessonListPage.tsx:29-34`). There
   is no visible error banner.

4. **No active parish.** If `memberships[0]?.parishId` is undefined, `fetchLessons()`
   returns early WITHOUT setting `loading = false` (`LessonListPage.tsx:22`), so the page
   is stuck showing `"Loading lessons..."` indefinitely. (See Edge cases.)

5. **Create a lesson.**
   1. Click `New Lesson` → routes to `/lessons/new` (`LessonCreatePage`).
   2. Enter title (required) and optional description, submit.
   3. Insert into `lessons` with `{ title, description|null, parish_id, created_by: user.id }`
      (`apps/web/src/routes/teacher/LessonCreatePage.tsx:23-32`); `published_at` is left
      null (draft), `lesson_order` defaults to 0.
   4. On success, navigate to `/lessons/:id` (the editor). On insert error, an inline red
      error banner shows `insertError.message` (`LessonCreatePage.tsx:34-51`).

6. **Open/edit a lesson.** Click the lesson title → `/lessons/:id` (`LessonEditPage`,
   which loads the lesson plus its `blocks` and `questions`).

7. **Preview as student.** Click `Preview` → `/lessons/:id/view?preview=true`. This opens
   the student lesson view in preview mode (the `?preview=true` flag lets teachers view
   unpublished/draft content as a student would).

8. **Publish a draft.**
   1. The Publish button only renders when `!lesson.published_at`
      (`LessonListPage.tsx:88`).
   2. On click, `e.preventDefault()` (the row title is a `Link`, so this prevents
      navigation), then `update({ published_at: new Date().toISOString() })` on that
      lesson id (`LessonListPage.tsx:90-94`).
   3. Local state is optimistically patched so the badge flips to `Published` and the
      Publish button disappears. The update is fire-and-forget — its result is not awaited
      for error handling beyond the implicit `await`. No re-fetch.

9. **Delete a lesson.**
   1. Click the trash icon. A native `confirm("Delete \"<title>\"? This cannot be undone.")`
      gates the action (`LessonListPage.tsx:113`).
   2. On confirm, `delete().eq('id', lesson.id)` and the row is removed from local state
      optimistically (`LessonListPage.tsx:114-115`). Cascading deletes remove dependent
      `blocks`/`questions`/etc. via FK `ON DELETE CASCADE`.

## Data model

The page directly touches `lessons`; it transitively depends on `profiles` /
`memberships` (for auth + parish resolution) and on the lesson child tables via cascade.

### `lessons` (primary table for this page)
Definition: `supabase/migrations/20260422000000_initial.sql:96-117`.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | `default gen_random_uuid()` |
| `parish_id` | `uuid NOT NULL` | FK → `parishes(id) ON DELETE CASCADE`. Tenancy key; the list filters on this. |
| `title` | `text NOT NULL` | Shown as the row heading. |
| `description` | `text` | Set at create; not displayed in the list. |
| `discussion_template` | `text` | Not used by the list (used by `LessonResponsesPage`). |
| `visibility` | `lesson_visibility NOT NULL DEFAULT 'parish'` | enum `('parish','diocese')`. Not surfaced in the list UI but present on every row. |
| `source_lesson_id` | `uuid` | FK → `lessons(id) ON DELETE SET NULL`. Fork/copy lineage (fork-and-edit). Not surfaced here. |
| `lesson_order` | `int NOT NULL DEFAULT 0` | **The sort key for the list** (`ORDER BY lesson_order ASC`). All new lessons default to 0. |
| `created_by` | `uuid NOT NULL` | FK → `profiles(id)`. Ownership/audit. Set on create. |
| `published_at` | `timestamptz` (nullable) | NULL = Draft, non-null = Published. The publish action sets this. |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `updated_at` | `timestamptz NOT NULL DEFAULT now()` | Auto-bumped by trigger `lessons_updated_at` BEFORE UPDATE (`...initial.sql:114-116`). Shown as `Last updated`. |

Indexes: `idx_lessons_parish (parish_id)`, `idx_lessons_created_by (created_by)`.

> Note: `supabase/schema.sql` is a stale/older snapshot of the `lessons` table (missing
> `discussion_template`, `visibility`, `source_lesson_id`, `lesson_order`, the trigger). The
> **migrations directory is authoritative** — trust `20260422000000_initial.sql`.

The page selects only `id, title, published_at, updated_at` (`LessonListPage.tsx:25`),
inserts `title, description, parish_id, created_by` (create page), updates `published_at`,
and deletes by `id`.

### RLS-relevant ownership (`lessons` policies)
Defined at `supabase/migrations/20260422000000_initial.sql:405-422`:

- **SELECT** (`lessons_select`): `USING (parish_id IN (SELECT get_user_parish_ids(auth.uid())))`
  — a user may read lessons for any parish they belong to (any role, including students).
- **INSERT** (`lessons_insert`): `WITH CHECK (user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher']))`.
- **UPDATE** (`lessons_update`): `USING (user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher']))`.
- **DELETE** (`lessons_delete`): `USING (user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher']))`.

So write access is role-gated by parish at the DB level; ownership is **parish + role**,
not per-`created_by`. A teacher can edit/publish/delete a co-teacher's lesson in the same
parish.

### `lessons` child tables (touched only via cascade on delete)
- `videos` — `parish_id` FK; holds `storage_path`, `duration_ms`, `transcript_text`,
  `transcript_json` (`...initial.sql` videos block).
- `blocks` — `lesson_id` FK `ON DELETE CASCADE`, `position`, `type` (`block_type`),
  `content jsonb`, `unique(lesson_id, position)`.
- `segments` — `block_id` FK cascade, `video_id` FK, `start_ms`/`end_ms`,
  `transcript_slice`.
- `questions` — `lesson_id` FK cascade, `position`, `prompt`, `unique(lesson_id, position)`.
- `answers` — `question_id` FK cascade, `student_id`.
- `assignments` — `lesson_id` FK cascade, `student_id`, `assigned_at`, `completed_at`.

Deleting a lesson from this page cascades into `blocks → segments`, `questions → answers`,
and `assignments`.

### Auth-supporting tables (read elsewhere, gate this page)
- `profiles` — read in `useAuth.fetchUserData` (`useAuth.ts:47`); provides `is_super_admin`.
- `memberships` — read in `useAuth.fetchUserData` (`useAuth.ts:48`); rows
  `{ id, user_id, parish_id, role }` with `role membership_role ('admin','teacher','student')`.
  `memberships[0].parishId` is the active parish for this page.

## Key logic & algorithms

- **Active parish = first membership.** `const parishId = memberships[0]?.parishId;`
  (`LessonListPage.tsx:16`). No multi-parish merge, no picker. Multi-parish teachers see
  only their first parish's lessons here.

- **Ordering is by `lesson_order` ascending**, not by date:
  ```ts
  // LessonListPage.tsx:24-27
  .from('lessons')
  .select('id, title, published_at, updated_at')
  .eq('parish_id', parishId)
  .order('lesson_order', { ascending: true });
  ```
  Since every lesson defaults `lesson_order = 0` and this page provides no reordering UI,
  in practice ordering among same-`lesson_order` rows is **non-deterministic** (Postgres
  returns ties in arbitrary order). Reordering must happen elsewhere.

- **Fetch runs once on mount with an empty dep array but reads `parishId`** — a known stale
  closure bug:
  ```ts
  // LessonListPage.tsx:20-37
  useEffect(() => {
    async function fetchLessons() {
      if (!parishId) return;            // early return WITHOUT setLoading(false)
      ...
      setLoading(false);
    }
    fetchLessons();
  }, []);                               // [] — does not re-run when parishId resolves
  ```
  If `memberships` are still loading on first render, `parishId` is undefined, the effect
  returns early, never clears `loading`, and never re-runs. (See Edge cases.)

- **Publish is in-row, optimistic, with `preventDefault`** (the row title is a `Link`, so
  the click must not navigate):
  ```ts
  // LessonListPage.tsx:90-94
  e.preventDefault();
  await supabase.from('lessons').update({ published_at: new Date().toISOString() }).eq('id', lesson.id);
  setLessons((ls) => ls.map((l) => l.id === lesson.id ? { ...l, published_at: new Date().toISOString() } : l));
  ```
  Two `new Date().toISOString()` calls produce two near-identical-but-distinct timestamps;
  the DB stores the first, local state shows the second. The update result is not checked
  for errors — a failed publish still flips the UI to Published (optimistic with no rollback).

- **Delete uses native `confirm()` and optimistic removal:**
  ```ts
  // LessonListPage.tsx:113-115
  if (!confirm(`Delete "${lesson.title}"? This cannot be undone.`)) return;
  await supabase.from('lessons').delete().eq('id', lesson.id);
  setLessons((ls) => ls.filter((l) => l.id !== lesson.id));
  ```
  Same pattern: no error check, no rollback if the delete fails.

- **Draft vs Published is purely `published_at` truthiness** (`LessonListPage.tsx:88,103,108`).
  Publishing is one-directional from this page (no unpublish button here — unpublish exists
  on `LessonEditPage`, `LessonEditPage.tsx:97`).

## External integrations

- **None directly on this page.** It performs only Supabase reads/writes to `lessons`.
- Indirect / downstream of the lessons it manages (relevant for the port mapping, not for
  this screen's own behavior):
  - **Video storage / playback** — `videos.storage_path` (legacy Mux/Supabase storage
    backed; maps to Bunny in Parvus Ordo).
  - **Transcription** — `videos.transcript_text` / `transcript_json` (legacy Whisper/OpenAI;
    maps to Groq in Parvus Ordo).
  - **Preview link** (`/lessons/:id/view?preview=true`) leads to the student player which
    consumes those video/transcript assets.
- No Mux SDK, ICS/ical, email, or YouTube calls occur on this page.

## Edge cases & gotchas

- **Stuck loading when parish not yet resolved.** Effect deps are `[]` and the early
  `if (!parishId) return;` skips `setLoading(false)`, so if auth/memberships resolve after
  first paint the page can hang on `"Loading lessons..."` (`LessonListPage.tsx:20-37`). The
  port should depend the fetch on `parishId` (or fetch server-side).
- **Fetch errors are invisible.** A query error only logs to console; the user sees the
  empty state, indistinguishable from a parish with no lessons
  (`LessonListPage.tsx:29-34`).
- **Optimistic mutations never roll back.** Publish and delete update local state
  regardless of whether the Supabase call succeeded; a failed write leaves the UI lying
  until a reload (`LessonListPage.tsx:90-94`, `113-115`).
- **Non-deterministic ordering.** All lessons share `lesson_order = 0` by default and there
  is no reorder UI here, so list order among ties is arbitrary.
- **Double timestamp on publish.** The DB-stored `published_at` and the locally-displayed
  value are computed from two separate `new Date()` calls (`LessonListPage.tsx:92-93`).
- **Coarse role gate.** `RoleGuard` matches the role against ANY membership without parish
  scoping (`RoleGuard.tsx:21-23`); true per-parish enforcement relies on the
  `parish_id` filter plus RLS, not the guard.
- **Single-parish blind spot.** A teacher in multiple parishes only ever manages
  `memberships[0]`'s lessons; there is no way to switch parish from this screen (only super
  admins can, via the `useAuth` override mechanism).
- **Delete cascades widely.** Deleting a lesson silently removes its blocks, segments,
  questions, answers, and assignments via FK cascade — including student answers.
- **`confirm()` is browser-native** and blocking; it won't work in a server component and
  needs replacing with a real dialog in the port.

## Acceptance criteria

- [ ] Navigating to `/lessons` as a user with no `admin`/`teacher` membership redirects to `/` (RoleGuard).
- [ ] An authenticated teacher/admin sees a list of lessons scoped to their active parish only (no other parish's lessons appear).
- [ ] Lessons are returned ordered by `lesson_order` ascending.
- [ ] When the parish has zero lessons, the empty-state message "No lessons yet. Create your first lesson to get started." is shown.
- [ ] Each lesson row displays the title, a localized "Last updated" date derived from `updated_at`, a Preview link, a status badge, and a delete control.
- [ ] A lesson with `published_at == null` shows a "Draft" badge AND a "Publish" button.
- [ ] A lesson with `published_at != null` shows a "Published" badge and NO "Publish" button.
- [ ] Clicking "Publish" sets `lessons.published_at` to a non-null timestamp for that lesson id and flips the badge to "Published" without navigating away.
- [ ] Clicking the lesson title navigates to `/lessons/:id` (editor) and does not trigger publish/delete.
- [ ] Clicking "Preview" navigates to `/lessons/:id/view?preview=true`.
- [ ] Clicking "New Lesson" navigates to `/lessons/new`.
- [ ] Creating a lesson inserts a row with the given title, parish_id of the active parish, created_by = current user, and `published_at` null (draft), then navigates to the new lesson editor.
- [ ] Creating a lesson with an empty title is prevented (submit disabled / required field).
- [ ] Deleting a lesson prompts for confirmation and only deletes on confirm; cancel leaves the row intact.
- [ ] Deleting a lesson removes it from the list and removes the DB row (with cascading child rows).
- [ ] A non-teacher (student) cannot SELECT-then-write: RLS rejects INSERT/UPDATE/DELETE on `lessons` for a parish where the user lacks admin/teacher role.
- [ ] A teacher can publish/delete a lesson created by a different teacher in the same parish (ownership is parish+role, not created_by).
- [ ] The page does not remain stuck on "Loading…" once the user's memberships/parish have resolved.

## Port notes

**Boundary placement (per CLAUDE.md `packages/core` rule):**

- **`packages/core`** owns all lesson logic and data access. Add functions like
  `listLessonsForParish({ parishId })`, `createLesson({ parishId, title, description, createdBy })`,
  `publishLesson({ lessonId })`, `deleteLesson({ lessonId })`. These contain the validation,
  ordering, and tenancy enforcement. No React/Next imports.
- **Reads → RSC.** The list itself is a read, so render it in a React Server Component that
  calls `core.listLessonsForParish` directly against Neon (resolve the active parish from
  the WorkOS session / hostname-resolved tenant, not `memberships[0]`). This removes the
  client-side fetch, the empty-dep `useEffect` bug, and the stuck-loading edge case.
- **Mutations → Server Actions.** Publish, delete, and create become thin Server Actions
  (~10 lines each: auth check → validate → call `core` → revalidate path). Replace the
  optimistic-without-rollback pattern with `revalidatePath('/lessons')` (or `useOptimistic`
  with proper error reconciliation). Replace native `confirm()` with a real confirm dialog
  (client component) that calls the delete action.
- **Client-reactive (tRPC):** only needed if the list must live-update; otherwise RSC +
  action revalidation is sufficient. Do not introduce a standalone API service.
- **No route handler / no workers** are needed for this screen. (Transcription/embedding of
  videos referenced by lessons stays in `infra/workers`, but that is downstream of this
  page, not part of it.)

**RLS / tenancy scope:**

- Lessons are **parish-scoped** with a `diocese`/`parish` visibility enum already in the
  legacy schema (`lesson_visibility`). Parvus Ordo's tenancy is diocese → parish, with a
  three-tier lesson scope (global/diocese/parish) and fork-and-edit. Map legacy
  `visibility ('parish','diocese')` + `source_lesson_id` onto the Parvus Ordo three-tier
  scope + fork lineage that already exists.
- Re-implement the legacy RLS intent in Neon RLS: SELECT for any parish member; INSERT/
  UPDATE/DELETE only for admin/teacher of that parish (legacy used
  `user_has_role(..., ['admin','teacher'])` and `get_user_parish_ids`). Ownership is
  parish+role, not per-user — preserve that.
- The active-parish resolution must come from the resolved tenant (hostname/diocese-parish
  cascade per the branding requirement), NOT `memberships[0]`. Decide the multi-parish UX
  explicitly (the legacy single-parish blind spot is a bug to fix, not port).

**Mux → Bunny / Whisper → Groq:**

- This page does not touch video/transcription directly, but the lessons it lists embed
  `videos` (legacy `storage_path` + Mux/Supabase storage) and transcripts
  (`transcript_text`/`transcript_json`, legacy Whisper/OpenAI). In the port these map to
  Bunny (storage/playback) and Groq (transcription), already handled by the Parvus Ordo
  Media/Asset module (Slice 5). The lesson list need only reference asset IDs.

**Explicit GAPS vs what Parvus Ordo already has:**

- **Lessons + versioning:** Parvus Ordo already has lessons with versioning and three-tier
  scope. The legacy model has only `published_at` (a boolean-ish draft/published flag) and
  no version history. GAP: legacy publish/unpublish is a single timestamp toggle — map it
  onto Parvus Ordo's versioning/publish model rather than re-adding a bare `published_at`.
- **Media/asset manager:** Already built. GAP: legacy `videos` table is flat; do NOT port
  it — point lessons at the existing asset manager.
- **Seek-enforcing player + transcript:** Already built. The legacy "Preview as student"
  (`?preview=true`) maps to Parvus Ordo's existing teacher-preview of the seek-enforcing
  player. GAP: ensure the new lesson list's Preview link targets the existing preview route
  rather than recreating a player.
- **Teacher preview:** Already built in Parvus Ordo. Reuse it; this page only needs to link
  to it.
- **NOT yet present (must be built for this slice):** the teacher lesson-list screen itself
  (RSC list + create/publish/delete Server Actions), parish-scoped ordering UI (legacy has
  none and ordering is non-deterministic — decide whether to add real reordering), and a
  non-`confirm()` delete confirmation.
