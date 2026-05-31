# Discussion

## Overview

The Discussion section is a cohort-scoped message board where parish members hold threaded conversations. It is a single route component, `DiscussionPage`, rendered inside the authenticated app shell. Each thread has a title and body; each thread can have a flat (non-nested) list of replies. Threads are scoped to a **cohort** (a class/group within a parish), so the board a user sees depends on which cohort is selected.

It exists to give a class of OCIA/catechesis students and their teachers a lightweight forum for discussion separate from the lesson content itself (lessons carry their own `discussion_template` field, but that is unrelated to this board). Teachers/admins can browse every cohort in their parish; students see only the cohorts they are enrolled in.

The entire feature is implemented client-side against Supabase (PostgREST) with Row Level Security enforcing access. There is no realtime subscription — the list is refetched after each mutation.

Source: `apps/web/src/routes/DiscussionPage.tsx` (the whole feature lives in this one file).

## Roles & access

Roles come from the `memberships` table via `useAuth` (`apps/web/src/hooks/useAuth.ts`). The relevant role enum is `membership_role = ('admin', 'teacher', 'student')`.

- **Everyone authenticated with a parish membership** can view threads/replies in cohorts they have access to, create threads, and post replies.
- **Teachers/admins** (`isTeacherOrAdmin()` → `hasRole('admin') || hasRole('teacher')`): the cohort picker lists **all** cohorts in their parish (`DiscussionPage.tsx:55-64`).
- **Students** (not teacher/admin): the cohort picker lists **only** cohorts they belong to, resolved via `cohort_members` filtered by `student_id = user.id` (`DiscussionPage.tsx:65-82`).
- **Deletion gating** is in the UI via `canDelete(authorId) = isAdmin || authorId === user?.id` (`DiscussionPage.tsx:198`). So the trash icon shows for an **admin** (not teacher) on any post, or for the **author** of a post. This is also enforced server-side by RLS (see Data model) — but note the RLS delete policy allows **admin OR author**, while the UI's `canDelete` checks `isAdmin` specifically (teachers do NOT get a delete button on others' posts, and RLS would also block a teacher deleting someone else's post).
- **Super-admin parish override**: `useAuth` injects a synthetic `admin` membership for the overridden parish when a super-admin switches parishes (`useAuth.ts:139-148`). This affects `parishId`, `isAdmin`, and `canManage` here.

`parishId` used for writes is `memberships[0]?.parishId` — the **first** membership only (`DiscussionPage.tsx:32`). Multi-parish users are not handled distinctly; the first membership wins.

## User flows

### 1. Load the page (teacher/admin)
1. Component mounts, `loading = true`.
2. `loadCohorts()` runs: since `canManage` is true, query `cohorts` where `parish_id = parishId` ordered by `created_at` (`DiscussionPage.tsx:57-61`).
3. `cohorts` state is set; `selectedCohortId` defaults to the first cohort if any exist.
4. `loading = false`.
5. A second effect fires on `selectedCohortId` change and calls `fetchThreads()`.

### 2. Load the page (student)
1. Component mounts, `loading = true`.
2. `loadCohorts()` queries `cohort_members` for rows where `student_id = user.id` to get `cohort_id`s (`DiscussionPage.tsx:67-70`).
3. If the student has cohort memberships, query `cohorts` where `id IN (cohortIds)` (`DiscussionPage.tsx:74-77`); set `cohorts`, default `selectedCohortId` to first.
4. If `cm` is empty/null, `cohorts` stays `[]`.
5. `loading = false`.

### 3. Empty states
- **No cohorts** (`cohorts.length === 0`, `DiscussionPage.tsx:202-216`): show the "Discussion" header and a dashed empty card. Message differs by role:
  - Teacher/admin: "No cohorts yet. Create a cohort in Settings to start discussions."
  - Student: "You haven't been assigned to a cohort yet."
- **Cohort selected but no threads** (`threads.length === 0`, `DiscussionPage.tsx:283-287`): dashed card "No discussions yet. Start one!"

### 4. Fetch threads (`fetchThreads`, `DiscussionPage.tsx:93-149`)
1. Guard: return if no `selectedCohortId`.
2. Query `discussion_threads` (`id, title, body, author_id, created_at`) where `cohort_id = selectedCohortId`, ordered `created_at` **descending** (newest first).
3. If no threads, set `threads = []` and return.
4. Collect `threadIds`, query `discussion_replies` (`id, thread_id, author_id, body, created_at`) where `thread_id IN (threadIds)`, ordered `created_at` **ascending** (oldest reply first).
5. Build a `Set` of all author IDs from threads + replies; query `profiles` (`id, display_name`) where `id IN (authorIds)` to build a `nameMap`.
6. Group replies by `thread_id`; assemble `ThreadRow[]` with `authorName` (falls back to `'Unknown'` when missing from `nameMap`), `replyCount`, and `replies`.

### 5. Create a thread
1. Click "New Thread" → toggles `showForm` (`DiscussionPage.tsx:239`).
2. Enter title + body. "Post Thread" is disabled unless both `newTitle.trim()` and `newBody.trim()` are non-empty (`DiscussionPage.tsx:267`).
3. `postThread()` guards on `user && parishId && selectedCohortId && trimmed title && trimmed body` (`DiscussionPage.tsx:152`), sets `posting = true`.
4. Insert into `discussion_threads`: `{ parish_id, cohort_id, author_id: user.id, title (trimmed), body (trimmed) }` (`DiscussionPage.tsx:155-161`).
5. Reset form fields, hide form, `posting = false`, then `fetchThreads()`.
6. Error state: there is **no** try/catch and no error surfacing — a failed insert is silently ignored; the form still resets and the list refetches (showing nothing new).

### 6. Expand / collapse a thread
- Clicking the chevron or the thread title toggles `expandedId` to the thread id (or null). Only one thread is expanded at a time (`expandedId` is a single id, `DiscussionPage.tsx:296,303`).
- Expanded view shows the full body, the replies list, and a reply input.

### 7. Post a reply
1. Type into the per-thread reply input (`replyDrafts[threadId]`). Pressing **Enter** or clicking the send button calls `postReply(threadId)` (`DiscussionPage.tsx:359,364`).
2. `postReply` trims the draft; returns early if no `user` or empty body (`DiscussionPage.tsx:170-173`).
3. Sets `submittingReply = threadId`, inserts into `discussion_replies`: `{ thread_id, author_id: user.id, body }` (note: **no** `parish_id` or `cohort_id` on replies).
4. Clears that thread's draft, `submittingReply = null`, `fetchThreads()`.
5. Send button is disabled while `submittingReply === thread.id` or the draft is empty (`DiscussionPage.tsx:365`).

### 8. Delete a thread / reply
- `deleteThread(threadId)`: `delete().eq('id', threadId)` on `discussion_threads`; if it was expanded, collapse; refetch (`DiscussionPage.tsx:187-191`). Cascade deletes its replies (FK `ON DELETE CASCADE`).
- `deleteReply(replyId)`: `delete().eq('id', replyId)` on `discussion_replies`; refetch (`DiscussionPage.tsx:193-196`).
- No confirmation dialog. No error handling.

## Data model

All tables live in the parish-scoped Supabase Postgres schema. Definitions from `supabase/migrations/20260422000000_initial.sql` and `supabase/migrations/20260428000000_discussion_cohort_and_deletes.sql`.

### `discussion_threads`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `parish_id` | uuid NOT NULL | FK → `parishes(id)` ON DELETE CASCADE. Tenancy anchor. |
| `cohort_id` | uuid | FK → `cohorts(id)` ON DELETE CASCADE. **Added** in `20260428000000`; nullable (legacy rows have NULL). |
| `author_id` | uuid NOT NULL | FK → `profiles(id)`. **Ownership** for RLS. |
| `title` | text NOT NULL | |
| `body` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | `now()`. No `updated_at` — threads are not editable. |

Indexes: `idx_discussion_threads_parish (parish_id)`, `idx_discussion_threads_cohort (cohort_id)`.

### `discussion_replies`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `thread_id` | uuid NOT NULL | FK → `discussion_threads(id)` ON DELETE CASCADE. Parish/cohort inherited transitively via the thread. |
| `author_id` | uuid NOT NULL | FK → `profiles(id)`. **Ownership** for RLS. |
| `body` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | `now()`. No `updated_at` — replies are not editable. |

Index: `idx_discussion_replies_thread (thread_id)`. Note replies carry **no** `parish_id`/`cohort_id`; scope is derived through `thread_id`.

### `cohorts` (read here)
`id`, `parish_id` (FK → parishes), `name`, `created_at`. Index `idx_cohorts_parish`.

### `cohort_members` (read here, for students)
`id`, `cohort_id` (FK → cohorts), `student_id` (FK → profiles), `joined_at`, `UNIQUE(cohort_id, student_id)`.

### `profiles` (read here, for author names)
`id` (= `auth.users.id`), `display_name` NOT NULL, `email`, `avatar_url`, `created_at`, `updated_at`. Only `id, display_name` are selected.

### `memberships` (read via useAuth)
`id`, `user_id` (FK → profiles), `parish_id` (FK → parishes), `role membership_role`, `UNIQUE(user_id, parish_id, role)`.

### Relationships
`parishes 1—* cohorts 1—* discussion_threads 1—* discussion_replies`; `cohorts 1—* cohort_members *—1 profiles`; `discussion_threads.author_id`/`discussion_replies.author_id —1 profiles`.

### RLS policies (ownership-relevant)
Helpers: `get_user_parish_ids(uid)` returns the user's parish ids; `user_has_role(uid, pid, roles[])` checks membership role (both `SECURITY DEFINER STABLE`).

- **`discussion_threads` SELECT** (`20260428000000`:9-12): `parish_id IN get_user_parish_ids(auth.uid())`. **Parish-wide, NOT cohort-scoped** — cohort filtering is done only in the client query, not by RLS.
- **`discussion_threads` INSERT** (`20260428000000`:16-20): `author_id = auth.uid() AND parish_id IN get_user_parish_ids(...)`. (Does not validate that `cohort_id` belongs to the parish.)
- **`discussion_threads` DELETE** (`20260428000000`:46-50): `author_id = auth.uid() OR user_has_role(auth.uid(), parish_id, ['admin'])`.
- **`discussion_replies` SELECT** (initial:661-668): `thread_id IN (SELECT id FROM discussion_threads WHERE parish_id IN get_user_parish_ids(...))`.
- **`discussion_replies` INSERT** (initial:670-677): same thread-parish membership check; insert allowed if the thread is in the user's parish. (Does NOT force `author_id = auth.uid()`.)
- **`discussion_replies` DELETE** (`20260428000000`:53-60): `author_id = auth.uid() OR thread_id IN (threads where user_has_role admin in that parish)`.
- **`profiles` SELECT**: `profiles_select_own` (id = auth.uid()) plus `profiles_select_parish` — any member can read profiles of users in the **same parish**. This is why the author-name lookup works for students too.
- **`cohorts` SELECT**: parish members. **`cohort_members` SELECT**: rows whose cohort is in the user's parish.

Grants (`20260422000001_grants.sql`): `authenticated` has `SELECT, INSERT` on threads/replies; `DELETE` granted in `20260428000000`. `service_role` has `ALL` (for the MCP server).

## Key logic & algorithms

- **Role-branched cohort loading** decides the entire data scope. `DiscussionPage.tsx:54-84`:
  ```ts
  if (canManage) { // teacher/admin → all cohorts in parish
    .from('cohorts').select('id, name').eq('parish_id', parishId).order('created_at')
  } else { // student → cohorts via cohort_members
    .from('cohort_members').select('cohort_id').eq('student_id', user?.id)
    ...
    .from('cohorts').select('id, name').in('id', cohortIds)
  }
  ```

- **Three-query thread assembly with client-side join.** There is no SQL join; replies and author names are fetched separately and stitched in JS via a `nameMap` and `repliesByThread` (`DiscussionPage.tsx:107-148`). Missing names fall back to `'Unknown'`.

- **Ordering is split**: threads newest-first (`created_at desc`), replies oldest-first (`created_at` asc default). `DiscussionPage.tsx:100,112`.

- **`replyCount` is derived from fetched replies**, not a stored counter: `(repliesByThread[t.id] ?? []).length` (`DiscussionPage.tsx:145`). Accurate but requires the full reply fetch.

- **Single-expand accordion**: `expandedId` holds one id; expanding one collapses others (`DiscussionPage.tsx:296,303`).

- **Optimistic-free refetch**: every mutation (`postThread`, `postReply`, `deleteThread`, `deleteReply`) ends with `fetchThreads()` rather than mutating local state, so the UI always reflects server state but incurs a full re-read.

- **Delete authorization is double**: UI `canDelete` = `isAdmin || own` (`:198`), RLS = `admin || own`. Teacher cannot delete others' posts in either layer.

## External integrations

**None.** This section uses no Mux, Whisper/OpenAI, ICS/ical, email, or YouTube. It talks only to Supabase (PostgREST + Auth via `apps/web/src/lib/supabase`). The MCP server (`packages/mcp-server`) can touch these tables via `service_role`, but that is outside the Discussion UI flow.

## Edge cases & gotchas

- **RLS SELECT is parish-wide, not cohort-scoped.** A student querying `discussion_threads` by `cohort_id` only sees their cohort because the *client* filters; but RLS would let any parish member read any thread in the parish. If the client query is changed/bypassed, cross-cohort leakage is possible. The cohort scoping is **not** a security boundary in the DB.
- **`parishId = memberships[0]?.parishId`** — only the first membership is used. Multi-parish users post into / are scoped to whichever membership happens to be first.
- **Reply INSERT policy does not pin `author_id = auth.uid()`** (unlike threads). The client always sends `user.id`, but the DB would accept a forged `author_id` on a reply as long as the thread is in the user's parish.
- **Thread INSERT does not validate `cohort_id` belongs to the thread's parish.** A crafted insert could attach a thread to a cohort in another parish (parish check passes on `parish_id`, but cohort linkage is unchecked).
- **No error handling anywhere.** Failed inserts/deletes are swallowed; the form resets and refetches regardless. No toast/inline error.
- **No confirmation on delete** of threads or replies; deleting a thread cascade-deletes all its replies.
- **Race / staleness**: no realtime; concurrent posters won't see each other's content until they trigger a refetch. Two rapid replies could each fire a `fetchThreads` and clobber drafts (`submittingReply` is a single global id, so overlapping reply submits across threads are not individually tracked — only one "submitting" thread at a time).
- **Reply input uses bare `onKeyDown Enter`** (`:359`) — no IME composition guard; Enter submits even mid-composition, and there is no multiline reply support (it's an `<input>`, not textarea).
- **Legacy threads with NULL `cohort_id`** (pre-`20260428000000`) will never appear because the client filters `cohort_id = selectedCohortId`.
- **`expandedId` survives cohort switches** — if you expand a thread then switch cohorts, the id may not match any visible thread (harmless, nothing renders expanded).
- **Empty `authorIds` set** is impossible when there are threads (a thread always has an author), so the `profiles` `.in()` query always has at least one id when reached.

## Acceptance criteria

- [ ] A teacher or admin sees a cohort picker listing **all** cohorts in their parish, ordered by `created_at`.
- [ ] A student sees a cohort picker listing **only** cohorts they belong to (resolved via `cohort_members.student_id = user.id`).
- [ ] When the current user has no accessible cohorts, the page shows the no-cohorts empty state with role-specific copy (teacher/admin vs student wording).
- [ ] When a cohort has no threads, the page shows the "No discussions yet. Start one!" empty state.
- [ ] Threads for the selected cohort load filtered by `cohort_id` and sorted newest-first.
- [ ] Each thread displays author display name, created date, and an accurate reply count (singular "reply" / plural "replies").
- [ ] Replies within an expanded thread are sorted oldest-first.
- [ ] An author name that cannot be resolved renders as "Unknown".
- [ ] Posting a thread is blocked until both title and body are non-empty (trimmed); the post inserts `parish_id`, `cohort_id`, `author_id`, trimmed `title`, trimmed `body`.
- [ ] After posting a thread, the form clears and hides and the thread list refetches showing the new thread.
- [ ] Posting a reply inserts `thread_id`, `author_id`, trimmed `body`; pressing Enter or clicking send both submit; empty drafts cannot be submitted.
- [ ] Only one thread is expanded at a time (expanding a second collapses the first).
- [ ] The delete control appears only for an admin (on any post) or the post's author (on their own post); teachers do not get a delete control on others' posts.
- [ ] Deleting a thread removes it and cascade-deletes its replies, and collapses it if it was expanded.
- [ ] RLS blocks a user from inserting a `discussion_threads` row whose `parish_id` is not one of their memberships.
- [ ] RLS blocks a non-author, non-admin user from deleting a thread or reply.
- [ ] A user can read threads/replies and author profiles only within their own parish(es) (RLS denies cross-parish reads).
- [ ] A super-admin with an active parish override is treated as `admin` of the override parish for cohort listing and delete controls.

## Port notes

**Backend boundary (`packages/core`).** All logic currently embedded in `DiscussionPage.tsx` must move into `packages/core` (e.g. `core/discussion`): validators (title/body non-empty, trimmed), the cohort-resolution branch (teacher/admin → parish cohorts; student → enrolled cohorts), the thread-assembly read (threads + replies + author names), and the create/delete operations. The React component becomes a thin RSC + client island.

**Entry points (thin shims, ~10 lines each):**
- **Reads** (cohort list, thread list with replies + author names) → **RSC** calling `core` directly with the request's tenant/user context. Replace the three sequential client fetches with one `core` function that does proper SQL joins (threads ⨝ replies ⨝ profiles) in a single round-trip — the client-side `nameMap`/`repliesByThread` stitching is an artifact of PostgREST and should not be ported.
- **Mutations** (create thread, post reply, delete thread, delete reply) → **Server Actions** that auth-check → validate → call `core` → return. Add the error handling that the legacy code lacks (return typed results; surface failures in the UI).
- **Client-reactive** (the cohort `<select>`, expand/collapse accordion, reply drafts) stays client state. If live updates are desired (legacy has none), use tRPC subscriptions or polling — not required for parity.
- No route handler or `infra/workers` job is needed; there is no out-of-band work, no external API.

**RLS / tenancy (Neon + RLS).** Map `parish_id` to the Parvus Ordo parish scope. Important corrections to make during the port:
- Make the **thread SELECT policy cohort-aware**, not just parish-aware, so cohort isolation is a real DB boundary (students should not be able to read other cohorts' threads even if the client query is bypassed). Reply SELECT should derive scope through the thread's cohort.
- Pin `author_id = current_user_id` on the **reply INSERT** policy (legacy omits this) and validate that `cohort_id` belongs to the thread's parish on **thread INSERT**.
- Keep delete = `author OR parish-admin`. Decide explicitly whether **teachers** should be able to moderate (legacy: no). Recommend allowing teacher moderation within their cohort and documenting it.
- Tenancy scope for this feature is **parish-level** (and cohort sub-scope). It is not global or diocese-scoped content; no three-tier lesson visibility applies here.

**Mux→Bunny / Whisper→Groq:** **Not applicable** — Discussion has no media or transcription. No mapping needed.

**Explicit GAPS vs what Parvus Ordo already has:**
- **Cohorts / cohort membership** are a prerequisite. Discussion depends on a `cohorts` + `cohort_members` model and a Settings UI to create cohorts and enroll students. If Parvus Ordo has not yet ported cohorts (separate Narthex section), Discussion cannot function — flag this as a hard dependency. The "Tenancy Hierarchy" memory mentions ministries/councils for RBAC; decide whether cohorts map onto that hierarchy or remain a parallel grouping.
- **Profiles / display names**: relies on a `profiles.display_name` equivalent readable across the parish. Parvus Ordo uses WorkOS auth — ensure a profile/display-name mirror exists and is parish-readable.
- This feature does **not** reuse the lessons-with-versioning system, the media/asset manager, the seek-enforcing player + transcript, or teacher preview. Those are orthogonal; nothing to integrate. (Note the unrelated `lessons.discussion_template` column is a lesson feature, not this board.)
- **New behavior to add (not in legacy):** error surfacing on mutations, delete confirmation, optional realtime, multiline reply input, and multi-parish handling (legacy hardcodes `memberships[0]`).
