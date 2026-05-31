# Student Lesson List

> Source of truth: `apps/web/src/routes/student/StudentLessonListPage.tsx` (Narthex). All `path:line` references in this doc are relative to the Narthex repo root unless noted otherwise.

## Overview

The Student Lesson List is the student's home view of "My Lessons." It is the entry point a student uses to see which lessons are available to them, track their own progress through those lessons, and navigate into the lesson player (`/lessons/:id/view`). It also renders a calendar ("My Schedule") of release / due / discussion dates derived from the student's cohort schedule.

It is fundamentally a **read + derive** screen — it performs no writes. All state is computed client-side from several Supabase reads:

- Which cohort(s) the student belongs to (`cohort_members`).
- Optionally, which learning path(s) the student is on (`learning_path_members` → `learning_path_lessons`), which can narrow the lesson set within a shared cohort.
- The cohort's scheduling/sequencing config (`cohorts`) and per-lesson schedule rows (`cohort_schedule`).
- The student's own completion telemetry (`engagement_events` with `event_type = 'lesson_complete'`) used to drive sequential unlocking.
- The lesson records themselves (`lessons`), only those that are published AND released.
- Per-lesson progress, computed by comparing the lesson's `questions` against the student's `answers`.

The screen reconciles three orthogonal gating concepts into one list:
1. **Release gating** (date-based): a scheduled lesson is hidden/absent until its computed release date has passed.
2. **Sequential gating** (completion-based): in a sequential cohort, a lesson is shown but visually "locked" until the previous sequenced lesson is completed.
3. **Progress status** (answers-based): `not_started` / `in_progress` / `completed`, used to split the list into "Due" and "Completed."

## Roles & access

- This page is for the **student** role. It is mounted under the student route group (`/lessons` list view → `StudentLessonListPage`).
- The auth layer (`apps/web/src/hooks/useAuth.ts`) resolves `user`, `memberships`, `profile`. The page reads `memberships[0]?.parishId` as the active parish (`StudentLessonListPage.tsx:33-34`). There is no explicit role check inside the component itself — gating is implicit:
  - If the user is **not in any cohort**, the list renders empty regardless of role (`StudentLessonListPage.tsx:97-101`). A teacher/admin with no `cohort_members` row sees nothing here.
  - If there is no `parishId` on the first membership, the fetch bails early (`StudentLessonListPage.tsx:171`).
- **Super-admin parish override**: `useAuth` injects a synthetic `admin` membership when a super-admin has switched into a parish (`useAuth.ts:139-148`). That changes `parishId` but does NOT create a `cohort_members` row, so a super-admin previewing a parish still sees an empty list here unless they are an actual cohort member.
- All data reads are constrained by Supabase RLS (see Data model). The page itself is a thin client; it relies on RLS to scope rows to the authenticated user's parish and ownership.

## User flows

1. **Student in a cohort with released lessons (happy path)**
   1. Page mounts, `loading = true`, shows `Loading lessons...` (`StudentLessonListPage.tsx:309-311`).
   2. Effect fires on `user` change (`:60-307`). It reads cohort membership, optional learning-path membership, cohort config, schedule, completion events, lessons, questions, answers.
   3. Lessons are split into a **Due** section (status `not_started` or `in_progress`) and a **Completed** section (status `completed`) (`:342-343`).
   4. "Due" is expanded by default (`dueOpen = true`), "Completed" collapsed by default (`completedOpen = false`) (`:50-51`). Completed section only renders if it has ≥1 lesson (`:421`).
   5. Each due lesson is a `Link` to `/lessons/:id/view` showing an index badge, title, optional description, and a status badge (`:394-412`). Completed lessons render as non-link rows with two buttons: "My Answers" (`/lessons/:id/view?review=true`) and "Review Lesson" (`/lessons/:id/view`) (`:446-457`).
   6. A calendar of all schedule events renders below if any events exist (`:470-499`).

2. **Sequential cohort with a locked lesson**
   1. Same fetch, but `cohorts.sequential = true` (`:111-112`).
   2. The next un-released lesson(s) are *hidden* entirely (release date in future) via `hiddenLessonIds` (`:142-168`, applied at `:337-339`).
   3. A released-but-not-yet-unlocked lesson shows as a **locked card**: a lock icon, greyed title, and the message `Complete "<previous lesson title>" first` (`:380-391`). It is NOT a link.
   4. When the student completes the previous sequenced lesson (writes a `lesson_complete` engagement event from the lesson player) and reloads, the lock clears.

3. **Student on a learning path within a cohort**
   1. The student belongs to one or more `learning_path_members` rows; the page collects `path_id`s and fetches `learning_path_lessons.lesson_id` (`:78-93`).
   2. The released-lesson set is intersected with the path's lessons (`:192-197`), so two students in the same cohort can see different lesson subsets while sharing the discussion schedule.

4. **Empty / no-cohort state**
   - If `cohort_members` returns nothing, list is set empty and `loading=false` immediately (`:97-101`). UI shows the dashed empty card: `No lessons available yet. Check back soon.` (`data-testid="lesson-empty-state"`, `:349-353`).

5. **Scheduled but nothing released yet**
   - If `lessonFilter.length === 0` after release filtering (and path intersection), list is empty with the same empty card (`:200-204`).

6. **All caught up (no due lessons but some completed)**
   - The "Due" section renders with count 0 and the message `All caught up!` (`data-testid="lesson-all-caught-up"`, `:372-373`). Completed section shows the finished lessons.

7. **Calendar interaction**
   - Default view is `agenda` on screens `< 768px`, else `month` (`:47, :482`). Clicking an event opens a modal (`selectedEvent`) showing the event title, a type pill (Discussion / Due / Available), the formatted date, and an optional detail line (discussion time · location) (`:501-534`).

8. **Error states**
   - Supabase errors are largely **swallowed**: every query destructures only `data` (e.g. `const { data: cohortMembership }`), so a failed query is treated identically to an empty result. There is no error banner; the screen degrades to an empty/partial list. (See Edge cases.)

## Data model

All tables are Postgres under Supabase with RLS enabled. Columns below reflect the state after all migrations (the consolidated `supabase/schema.sql` is a stale sketch and should be ignored; the real model is the migration sequence under `supabase/migrations/`).

### `cohort_members` — student↔cohort join (read: `:69-75`)
Defined in `supabase/migrations/20260422000000_initial.sql:85-91`.
- `id uuid pk`
- `cohort_id uuid not null → cohorts(id) on delete cascade`
- `student_id uuid not null → profiles(id) on delete cascade`
- `joined_at timestamptz`
- `UNIQUE(cohort_id, student_id)`
- RLS: `cohort_members_select` — readable by any member of the cohort's parish (`initial.sql:387-393`). Insert restricted to admin/teacher (`:396-402`). **Note:** there is no "own row only" select; any parish member can read the cohort roster. The page filters by `.eq('student_id', user.id)`.

### `cohorts` — discussion group + scheduling/sequence config (read: `:104-107`)
Base in `initial.sql:75-80`; extended by `20260426000003_cohort_schedule_redesign.sql:2-7` and `20260502000000_sequential_cohorts.sql:2`.
- `id uuid pk`
- `parish_id uuid not null → parishes(id) on delete cascade` (tenancy anchor)
- `name text not null`
- `start_date date`, `end_date date`
- `discussion_day text`, `discussion_time text`, `discussion_location text`
- `sequential boolean not null default true` (controls sequential gating)
- `created_at timestamptz`
- Page selects: `id, discussion_time, discussion_location, sequential, start_date`.
- RLS: `cohorts_select` readable by parish members (`initial.sql:372-373`).

### `cohort_schedule` — per-lesson schedule rows for a cohort (read: `:115-119`)
Base in `initial.sql:211-220`; reshaped by `20260426000003_cohort_schedule_redesign.sql`, `20260426000005_fix_schedule_columns.sql`, `20260505000001_schedule_due_date.sql`, `20260502000005_schedule_skip_sequence.sql`.
- `id uuid pk`
- `cohort_id uuid not null → cohorts(id) on delete cascade`
- `lesson_id uuid not null → lessons(id) on delete cascade`
- `discussion_date date not null` (primary ordering key)
- `release_date date` — **nullable override** (made nullable in `20260426000005`). When null, release is derived (see Key logic).
- `due_date date` — **nullable override** (added `20260505000001`). When null, derived as `discussion_date - 1 day`.
- `week_number int`, `is_date_override boolean not null default false`
- `skip_sequence boolean not null default false` — when true, the lesson is always visible and does NOT participate in the sequential chain (`20260502000005`).
- `UNIQUE(cohort_id, lesson_id)`
- Page selects: `lesson_id, discussion_date, release_date, due_date, cohort_id, skip_sequence`, ordered by `discussion_date`.
- RLS: `cohort_schedule_select` readable by parish members (`initial.sql:594-601`).

### `learning_paths`, `learning_path_members`, `learning_path_lessons` (read: `:78-93`)
Defined in `20260428000002_learning_paths.sql`.
- `learning_paths`: `id`, `cohort_id → cohorts(id)`, `name`, `created_at`.
- `learning_path_members`: `id`, `path_id → learning_paths(id)`, `student_id → profiles(id)`, `UNIQUE(path_id, student_id)`.
- `learning_path_lessons`: `id`, `path_id → learning_paths(id)`, `lesson_id → lessons(id)`, `week_number int`, `UNIQUE(path_id, lesson_id)`, `UNIQUE(path_id, week_number)`.
- Page selects: `learning_path_members.path_id` (filtered by `student_id`), then `learning_path_lessons.lesson_id` (filtered by `path_id IN ...`).
- RLS: all three readable by parish members, writable by admin/teacher.

### `lessons` — lesson records (read: `:206-210`)
Defined in `initial.sql:97-110`.
- `id uuid pk`
- `parish_id uuid not null → parishes(id) on delete cascade` (tenancy anchor)
- `title text not null`, `description text`, `discussion_template text`
- `visibility lesson_visibility ('parish' | 'diocese') default 'parish'`
- `source_lesson_id uuid → lessons(id)` (fork-and-edit provenance)
- `lesson_order int not null default 0` (global creation order; the page deliberately does NOT sort by this — see Key logic)
- `created_by uuid → profiles(id)`
- `published_at timestamptz` (null = unpublished/draft)
- `created_at`, `updated_at`
- Page selects: `id, title, description, published_at, lesson_order`, filtered `.in('id', lessonFilter).not('published_at', 'is', null)`.
- RLS: `lessons_select` readable by **any parish member** (`initial.sql:404-406`). Note: RLS does NOT enforce release dates or publish state — that gating is done client-side and in the `.in()` / `.not()` filters. (The migration comment "respecting release dates for students" is aspirational; the policy itself only checks parish membership.)

### `questions` — teacher-authored questions (read: `:225-228`)
Defined in `initial.sql:163-170`.
- `id`, `lesson_id → lessons(id)`, `position int`, `prompt text`, `created_at`, `UNIQUE(lesson_id, position)`.
- Page selects `id, lesson_id` filtered by `lesson_id IN (...)`.
- RLS: readable by parish members (`initial.sql:511-517`).

### `answers` — student responses (read: `:231-234`)
Defined in `initial.sql:175-183`.
- `id`, `question_id → questions(id)`, `student_id → profiles(id)`, `text`, `submitted_at`, `edited_at`, `UNIQUE(question_id, student_id)`.
- Page selects `question_id` filtered by `.eq('student_id', user.id)`.
- RLS: `answers_select_own` (student_id = auth.uid()) plus `answers_select_parish` for teacher/admin (`initial.sql:544-562`). **This is the ownership-relevant table for progress.**

### `engagement_events` — telemetry, used here for completion (read: `:126-130`)
Defined in `20260430000001_engagement_events.sql`.
- `id`, `student_id → profiles(id)`, `lesson_id → lessons(id)`, `event_type text`, `step_index int`, `step_kind text`, `block_id uuid`, `question_id uuid`, `cohort_id uuid`, `metadata jsonb`, `created_at`.
- Page selects `lesson_id` filtered by `.eq('student_id', user.id).eq('event_type', 'lesson_complete')`.
- RLS policies: `engagement_insert_own` (INSERT, `auth.uid() = student_id`), `engagement_select_parish` (SELECT for teacher/admin in parish), `engagement_super_admin` (SELECT for super-admins). **There is NO student-own SELECT policy** (`20260430000001_engagement_events.sql:23-37`, and confirmed absent across all migrations). See Edge cases — this is a real correctness bug.

### `profiles` / `memberships` (read indirectly via `useAuth`, `useAuth.ts:46-49`)
`memberships`: `id, user_id, parish_id, role ('admin'|'teacher'|'student')` (`initial.sql:62-69`). The page uses `memberships[0].parishId` only.

### Relationship summary
`parishes 1—* cohorts 1—* cohort_members *—1 profiles(student)`; `cohorts 1—* cohort_schedule *—1 lessons`; `cohorts 1—* learning_paths 1—* learning_path_members` and `1—* learning_path_lessons *—1 lessons`; `lessons 1—* questions 1—* answers *—1 profiles(student)`; `profiles 1—* engagement_events *—1 lessons`.

## Key logic & algorithms

### Release-date derivation (the core scheduling rule)
A scheduled lesson's effective release date is computed, not always stored. The rule (applied both for hiding in sequential mode `:148-167` and for the released-set filter `:174-190`):

```
if entry.release_date is set:   releaseDate = entry.release_date          // explicit override
else if i === 0:                releaseDate = cohort.start_date ?? '2000-01-01'  // first row
else:                           releaseDate = prevRow.discussion_date + 1 day    // day after prior discussion
```

A lesson is "released" iff `releaseDate <= today` where `today = fmtDate(new Date())` (local-date `YYYY-MM-DD`, `:142, :539-541`). String comparison on `YYYY-MM-DD` is used as a date comparison — this works only because the format is zero-padded and lexicographically sortable.

Important subtlety: the **hidden** computation iterates only over **sequenced** entries (`schedule.filter(s => !s.skip_sequence)`, `:147`), so the "i===0" and "day-after-previous" anchors are relative to the sequenced subsequence. The **released** computation iterates over the **full** schedule (`:175`) and indexes `schedule[i-1]` regardless of skip_sequence. These two loops use slightly different bases — a documented inconsistency (see Edge cases).

### Released-lesson filter + learning-path intersection
```
releasedLessonIds = schedule rows whose computed releaseDate <= today        // :174-190
lessonFilter = pathLessonIds ? releasedLessonIds ∩ pathLessons : releasedLessonIds   // :192-197
```
Lessons are then fetched `.in('id', lessonFilter).not('published_at', 'is', null)` — so a lesson must be scheduled AND released AND published to appear.

### Schedule-order sort (NOT lesson_order)
Lessons are sorted by their index in the cohort schedule (discussion_date order), not by the global `lesson_order` (`:212-219`):
```js
const scheduleOrder = new Map(schedule.map((s, i) => [s.lesson_id, i]));
const sorted = (lessonData ?? []).sort((a, b) => (scheduleOrder.get(a.id) ?? 999) - (scheduleOrder.get(b.id) ?? 999));
```
The number badge shown next to each lesson is `visibleLessons.indexOf(lesson) + 1` (`:402, :441`) — a 1-based position within the visible list, not a stored lesson number.

### Progress status computation (`:238-261`)
For each lesson: gather its `questions` (`questionsByLesson`), count how many of those question IDs appear in the student's `answers` (`answeredQuestionIds` set):
- 0 questions → `not_started`
- answeredCount === 0 → `not_started`
- answeredCount >= question count → `completed`
- otherwise → `in_progress`

Note: completion here is **answer-based**, independent of the `lesson_complete` engagement event used for sequential unlocking. A lesson with no questions is always `not_started` and never auto-completes via this path.

### Sequential lock check (`:313-326`)
```js
const isLessonLocked = (lessonId) => {
  if (!isSequential) return false;
  if (skipSequenceIds.has(lessonId)) return false;        // skip_sequence never locks
  const idx = orderedScheduleLessonIds.indexOf(lessonId);
  if (idx <= 0) return false;                              // first / not-in-schedule never locks
  for (let i = idx - 1; i >= 0; i--) {                    // walk back to previous *sequenced* lesson
    if (skipSequenceIds.has(orderedScheduleLessonIds[i])) continue;
    return !completedLessonIds.has(orderedScheduleLessonIds[i]);
  }
  return false;
};
```
`completedLessonIds` comes from `lesson_complete` engagement events (`:124-134`). Locking skips over `skip_sequence` entries to find the previous *sequenced* lesson, and depends on that lesson having a `lesson_complete` event.

### Calendar event construction (`:264-302`)
For each schedule row, up to three all-day events are pushed: a `discussion` event (on `discussion_date`, with detail `time · location`), a `due` event (`due_date` or `discussion_date - 1`), and a `release` event (only if `release_date` set OR `i > 0` derived from prior discussion + 1). Colors are keyed by type (`:484-492`).

## External integrations

- **react-big-calendar** + **date-fns** localizer (`:4-11`) for the "My Schedule" calendar. No server involvement.
- **lucide-react** icons (`:3`).
- **Supabase JS client** (`apps/web/src/lib/supabase.ts` → `@narthex/shared` `getSupabaseClient()`), used for all reads, scoped by RLS to the authenticated user.
- **No Mux, no Whisper/OpenAI, no ICS/ical export, no email, no YouTube** are touched by this screen directly. Those integrations live in the lesson player (`LessonViewPage.tsx`) and the media/upload pipeline, which this list only links into via `/lessons/:id/view`. The calendar is rendered in-app and is NOT exported as an `.ics` feed.

## Edge cases & gotchas

- **engagement_events has no student-own SELECT policy.** The page reads its own `lesson_complete` events at `:126-130`, but RLS only allows SELECT for teacher/admin-in-parish or super-admin (`20260430000001_engagement_events.sql`). For a plain student, this query returns **zero rows**, so `completedLessonIds` is always empty and `isLessonLocked` returns true for every gated lesson except the first sequenced one. In a sequential cohort this effectively blocks progression unless the student also has a teacher/admin role. This is a faithful bug; the port must add a student-own read path. (`LessonViewPage.tsx:219-223` has the same read and the same exposure.)
- **All Supabase errors are silently swallowed.** Every query ignores `.error`. A transient failure looks identical to "empty," producing a misleading empty/partial list with no user feedback.
- **Effect dependency is `[user]` only** (`:307`). `parishId` is derived from `memberships` but is NOT in the dep array, so if memberships resolve after `user` (or a super-admin switches parish via the override), the list may not refetch. Re-render relies on `user` identity changing.
- **Multi-cohort handling is partial.** The page collects all `cohortIds` and queries schedule/cohort data with `.in('id', cohortIds)`, but uses only `cohortData[0]` as the "primary cohort" for `sequential` and `start_date` (`:109-112`). A student in two cohorts with different `sequential`/`start_date` gets the first cohort's config applied to the merged schedule — likely incorrect ordering and release derivation.
- **Hidden vs released loops use different bases.** The hidden-set loop iterates the sequenced subset (`:147`), while the released-set loop iterates the full schedule and references `schedule[i-1]` (`:183`). With `skip_sequence` rows interleaved, a lesson's derived release date can differ between the two computations.
- **`'2000-01-01'` sentinel** is used as the release date when a first lesson has no override and the cohort has no `start_date` (`:156, :181`) — meaning it is treated as released immediately.
- **String date comparison** (`releaseDate <= today`, `:163, :187`) is only safe because both sides are zero-padded `YYYY-MM-DD`. `fmtDate` builds this from local time (`:539-541`); a `discussion_date` stored as a date and concatenated with `'T00:00:00'` (`:159, :270`) is parsed in the browser's local timezone — DST/timezone edge cases at midnight are possible.
- **Lessons not in the schedule sort last** (`?? 999`, `:217`) and would only appear if their id somehow entered `lessonFilter`, which it cannot via the normal path — so effectively dead, but worth preserving semantics.
- **`due_date` default** is `discussion_date - 1 day` (`:282`) — note this is *minus one*, distinct from the *release* derivation which is *plus one* off the previous row.
- **Completed lessons can still be hidden** if their release date is in the future in sequential mode (`hiddenLessonIds` filter at `:337-339` is applied before the due/completed split) — unlikely but possible if a completed lesson's schedule row is later edited.

## Acceptance criteria

- [ ] A student with no `cohort_members` row sees the empty state (`No lessons available yet. Check back soon.`, testid `lesson-empty-state`) and zero lessons.
- [ ] A student in a cohort sees only lessons that are (a) present in `cohort_schedule` for their cohort, (b) released (computed release date ≤ today), and (c) have a non-null `published_at`.
- [ ] An unpublished lesson (`published_at` null) that is scheduled and released does NOT appear.
- [ ] When `cohort_schedule.release_date` is null and the row is the first scheduled, release date falls back to the cohort's `start_date` (or is treated as released when `start_date` is also null).
- [ ] When `release_date` is null and the row is not first, release date is the day after the previous schedule row's `discussion_date`.
- [ ] Lessons are ordered by their position in the cohort schedule (`discussion_date` order), NOT by `lessons.lesson_order`.
- [ ] Lesson progress status is `completed` when the count of the student's answers to that lesson's questions ≥ the lesson's question count, `in_progress` when between 1 and count-1, and `not_started` when 0 (and `not_started` when the lesson has no questions).
- [ ] Lessons with status `completed` appear in the collapsed-by-default "Completed" section; all others appear in the expanded-by-default "Due" section.
- [ ] The "Due" section shows `All caught up!` (testid `lesson-all-caught-up`) when there are no due lessons but the list is non-empty.
- [ ] The "Completed" section is not rendered at all when there are zero completed lessons.
- [ ] In a non-sequential cohort, no lesson is ever rendered as locked.
- [ ] In a sequential cohort, a released lesson is rendered locked (testid `lesson-locked`, lock icon, message `Complete "<previous lesson>" first`) until the previous sequenced lesson has a `lesson_complete` event, and is not a clickable link while locked.
- [ ] A `cohort_schedule` row with `skip_sequence = true` is never locked and is skipped when computing the "previous sequenced lesson" for the next lesson's lock.
- [ ] In a sequential cohort, a scheduled lesson whose computed release date is in the future is hidden from the list entirely (not shown as locked).
- [ ] When the student is a `learning_path_members` member, the visible released lessons are intersected with that path's `learning_path_lessons`, so non-path lessons are excluded.
- [ ] Each due lesson links to `/lessons/:id/view`; each completed lesson exposes "My Answers" (`/lessons/:id/view?review=true`) and "Review Lesson" (`/lessons/:id/view`).
- [ ] The calendar renders one discussion event per schedule row (on `discussion_date`), one due event (on `due_date` or `discussion_date - 1`), and a release event when `release_date` is set or the row is not first.
- [ ] Clicking a calendar event opens a modal showing the event title, a type pill (Discussion/Due/Available), the formatted date, and the cohort detail line when present.
- [ ] All lesson, schedule, completion, question, and answer reads are scoped to the authenticated student by RLS/tenancy (a student cannot see lessons from another parish or another student's answers).

## Port notes

Mapping to the Parvus Ordo stack (Next.js 16 App Router, `packages/core` backend boundary, Neon + RLS, WorkOS auth, Bunny video, Groq transcription).

### Where the code goes
- **`packages/core` (all business logic).** Everything in the `fetch()` effect is business logic and must move into `core`, not a Server Action or component. Define a single read-model function, e.g. `core/students/getStudentLessonList(userId, parishId)`, that returns the fully-derived view model: `{ dueLessons, completedLessons, lockedLessonIds, hiddenLessonIds, calendarEvents }`. The release-date derivation, sequential-lock algorithm, schedule-order sort, and progress-status computation all belong here as pure, unit-testable functions. The current component mixes data access + derivation + rendering; that must be split.
- **RSC read (page).** Because this is a read-only screen, the App Router page should be a React Server Component that calls `core.getStudentLessonList(...)` directly against Neon (no Server Action, no tRPC needed for the initial render). Per CLAUDE.md, "Reads → RSC (direct DB)."
- **Client component for interactivity.** The collapsible Due/Completed sections, the react-big-calendar instance, the event-detail modal, and responsive view selection are client concerns — keep a thin `'use client'` child that receives the server-computed view model as props. No data fetching in the client component.
- **tRPC** is only warranted if you want the list to live-update as the student completes lessons in another tab; otherwise omit it.
- **Route handler / `/api/v1`** is NOT needed — there are no external consumers of this screen.
- **infra/workers** is NOT needed for this screen (no out-of-band work). Note that the *upstream* `lesson_complete` and transcription work lives elsewhere.

### RLS / tenancy implications (global/diocese/parish)
- Reuse Parvus Ordo's parish-scoped RLS. `cohorts`, `cohort_schedule`, `learning_paths*`, `lessons`, `questions` are parish-scoped reads for members. `answers` and the completion-events read must be **student-own**.
- **Fix the engagement_events read-policy gap.** In Parvus Ordo, the completion signal (whatever replaces `lesson_complete`) MUST have a student-own SELECT policy, or the sequential-unlock query will silently return empty as it does in Narthex. Prefer modeling lesson completion as a first-class, student-readable row (e.g. a `lesson_progress` / completion table with `student_id = auth-subject` RLS) rather than inferring it from append-only telemetry.
- Lesson visibility in Narthex is `parish | diocese`; Parvus Ordo's three-tier scope (global/diocese/parish, with fork-and-edit) is a superset. The list's "which lessons exist for this student" question should consult the cohort schedule (parish-level) — the global/diocese tiers are about *authoring/provenance*, not about what a cohort student sees. Resolve the displayed lesson via the parish-scoped (possibly forked) version.

### Mux → Bunny, Whisper → Groq
- **Not exercised by this screen.** This list never touches video or transcripts; it only links into the player. The Mux→Bunny and Whisper→Groq mappings apply to the lesson player + media/asset manager, not here. The only obligation for this screen is that the link target (`/lessons/:id/view` equivalent) resolves to the Bunny-backed, seek-enforcing player.

### Explicit GAPS vs what Parvus Ordo already has
- **Cohorts, cohort schedule, sequential mode, learning paths, skip_sequence** — verify these exist in Parvus Ordo. The memory index mentions lessons-with-versioning, the media/asset manager, the seek-enforcing player + transcript, and teacher preview, but does NOT mention a cohort/scheduling/learning-path subsystem. If absent, this is the largest porting gap: the entire release-gating + sequential-gating + path-intersection model (and the `cohorts` / `cohort_members` / `cohort_schedule` / `learning_paths` / `learning_path_members` / `learning_path_lessons` tables) must be built before this screen can function.
- **Progress status source.** Parvus Ordo's versioned lessons mean "the lesson's questions" must be resolved against the version the student is actually on; the Narthex computation assumes a single live question set. Decide whether progress counts answers against the assigned version's questions.
- **Completion signal.** Parvus Ordo may already track watch/seek completion via the seek-enforcing player; reconcile that with Narthex's two distinct notions of "done" (answer-based status vs `lesson_complete` event-based unlock). Recommend a single authoritative `completed` flag per (student, lesson) that both the status badge and the sequential lock consume.
- **Calendar export.** Narthex renders an in-app calendar only. If Parvus Ordo wants an ICS subscription feed for the schedule, that is net-new (a route handler emitting `text/calendar`, fed by `core`), not a port.
- **Multi-cohort correctness.** The Narthex "primary cohort = cohortData[0]" shortcut should be fixed in the port (decide and document multi-cohort behavior rather than inheriting the bug).
