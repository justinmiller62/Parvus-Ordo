# Teacher Lesson Students

## Overview

The "Teacher Lesson Students" section is a single-page teacher/admin view that shows **per-student progress for one lesson**. For a given lesson (optionally scoped to a single cohort), it lists every relevant student and shows, for each:

- How many of the lesson's **questions** they have answered (`answered/total`).
- How many of the lesson's **video blocks** they have watched (`watched/total`), only shown when the lesson has video blocks.
- A derived **status** badge: `Not Started`, `In Progress`, or `Completed`.

Admins (only) get a per-student **Reset** button that wipes that student's progress for the lesson (answers, video watches, asked questions, and feedback), letting them re-take the lesson from scratch.

It exists so a teacher running a cohort can see at a glance who has engaged with a lesson and who is behind, and so an admin can clear a student's progress (e.g. after a data issue, a re-enrollment, or a practice run).

Source: `apps/web/src/routes/teacher/LessonStudentsPage.tsx`.

Routes (from `apps/web/src/App.tsx:134`):
- `cohorts/:cohortId/lessons/:id/students` — the only route wired to this page. Despite the path always carrying a `cohortId`, the component is written to also support a lesson-only mode (no `cohortId`), in which case it falls back to all students in the lesson's parish. The "Back" link points to `/cohorts/:cohortId` when `cohortId` is present, else `/lessons/:id` (`LessonStudentsPage.tsx:179`).

Entry points (links into this page) are both in the cohort detail screen: `apps/web/src/routes/teacher/CohortDetailPage.tsx:349` and `:499` (a "Students" link rendered per scheduled lesson entry).

## Roles & access

- **Route guard:** wrapped in `<RoleGuard allowedRoles={['admin', 'teacher']}>` (`App.tsx:137`). Students cannot reach this page.
- **Effective roles** come from `useAuthContext()` → `useAuth()` (`apps/web/src/hooks/useAuth.ts`). A user's memberships are `(user_id, parish_id, role)` rows; `hasRole(role, parishId?)` checks `effectiveMemberships`.
- **Super-admin parish override:** `useAuth` supports a `parishOverride` stored in `sessionStorage` (`narthex_parish_override`). When active it injects a *synthetic `admin` membership* for the overridden parish (`useAuth.ts:139`). So a super-admin "acting as" a parish is treated as an admin there, including for the Reset button and the underlying RLS `user_has_role` checks (assuming the override matches a real DB membership for RLS to pass — see Gotchas).
- **Reset button gating:** rendered only when `isAdmin = hasRole('admin')` is true (`LessonStudentsPage.tsx:25`, `:210`). Teachers can *view* progress but **cannot reset** from the UI. Note `hasRole('admin')` here is called **without a `parishId`**, so any admin membership in *any* parish unlocks the button client-side; the actual delete is still gated server-side by RLS scoped to the lesson's parish.
- **RLS reads:** teachers/admins can read answers, video watches, profiles, questions, and blocks in their parish via parish-scoped SELECT policies (see Data model). Profiles are world-readable to any authenticated user.

## User flows

### 1. View student progress (teacher or admin)
1. From the cohort detail page, the teacher clicks the "Students" link on a scheduled lesson entry (`CohortDetailPage.tsx:349`/`:499`), navigating to `cohorts/:cohortId/lessons/:id/students`.
2. The page shows `Loading...` while `fetchData()` runs (`LessonStudentsPage.tsx:173`).
3. `fetchData` loads the lesson title + `parish_id`, resolves the student set, loads profiles, lesson questions, lesson video blocks, all answers, and all video watches, then computes per-student progress.
4. Header renders the lesson title and "Student Progress"; a "Back to Cohort" link returns to `/cohorts/:cohortId`.
5. Each student renders as a card with a status icon, display name, email, `Questions: x/y`, optionally `Videos: a/b`, and a status badge.

### 2. Cohort-scoped vs parish-scoped student set
- **With `cohortId` (the real route):** students = all `cohort_members.student_id` for that cohort (`LessonStudentsPage.tsx:42`).
- **Without `cohortId` (code path only):** students = all `memberships` with `role = 'student'` in the lesson's `parish_id` (`LessonStudentsPage.tsx:49`).

### 3. Reset a student's progress (admin only)
1. Admin clicks the "Reset" button on a student card (`LessonStudentsPage.tsx:211`).
2. Button is disabled while resetting that student (`resetting === student.userId`) or when the student's status is `not_started` (nothing to reset) (`:213`).
3. `resetStudent(studentId)` sets a spinner, re-fetches the lesson's question IDs and video-block IDs, then deletes (`:136`–`:171`):
   - `answers` where `student_id = studentId AND question_id IN (lesson questions)`
   - `video_watches` where `student_id = studentId AND block_id IN (lesson video blocks)`
   - `student_questions` where `student_id = studentId AND lesson_id = id`
   - `student_feedback` where `student_id = studentId AND lesson_id = id`
4. On completion it clears the spinner and calls `fetchData()` to refresh the list; the student's card should now read `Not Started` with zero counts.

### Empty state
- If the resolved `studentIds` is empty, the page renders the dashed empty-state box: **"No students in this parish yet."** (`LessonStudentsPage.tsx:191`). Note the copy says "parish" even in cohort-scoped mode.

### Error states
- **No `id` param:** `fetchData` returns immediately; page stays in `Loading...` forever (no error UI) (`:28`).
- **Lesson not found / RLS-denied:** `if (!lesson) return;` — `fetchData` returns *without* clearing `loading`, so the page is stuck on `Loading...` (`:37`). There is no error toast or message.
- **Any Supabase query error:** errors are not surfaced; code uses `?? []`/optional chaining and silently treats failed reads as empty data (e.g. a denied `answers` read just shows `0` answered). No retry.

## Data model

All tables are Supabase Postgres with RLS enabled. The lesson's `parish_id` is the tenancy anchor; every progress-related read/delete is parish-scoped through RLS using `user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher'])` (`20260422000000_initial.sql:288`).

Tables this section reads:

### `lessons` (`20260422000000_initial.sql:97`)
- `id uuid PK`, `parish_id uuid NOT NULL → parishes(id)`, `title text NOT NULL`, `description`, `discussion_template`, `visibility lesson_visibility DEFAULT 'parish'`, `source_lesson_id uuid → lessons(id)` (fork lineage), `lesson_order int`, `created_by uuid → profiles(id)`, `published_at timestamptz`, timestamps.
- Read here: `select('title, parish_id').eq('id', id).single()` (`LessonStudentsPage.tsx:31`).
- **Ownership/RLS:** `lessons_select` allows parish members + admins/teachers (`:405`). `parish_id` is the tenancy key.

### `cohorts` (`20260422000000_initial.sql:75`)
- `id`, `parish_id → parishes(id)`, `name`, `created_at`. Not read directly here but `cohortId` (route param) keys into `cohort_members`.

### `cohort_members` (`20260422000000_initial.sql:85`)
- `id`, `cohort_id uuid → cohorts(id)`, `student_id uuid → profiles(id)`, `joined_at`, `UNIQUE(cohort_id, student_id)`.
- Read here: `select('student_id').eq('cohort_id', cohortId)` (`LessonStudentsPage.tsx:43`).

### `memberships` (`20260422000000_initial.sql:62`)
- `id`, `user_id → profiles(id)`, `parish_id → parishes(id)`, `role membership_role` (enum `'admin'|'teacher'|'student'`, `:8`), `created_at`, `UNIQUE(user_id, parish_id, role)`.
- Read here (parish-scoped fallback): `select('user_id').eq('parish_id', lesson.parish_id).eq('role', 'student')` (`LessonStudentsPage.tsx:49`).
- Also drives the auth/role model via `user_has_role` and `get_user_roles` (`:282`/`:288`).

### `profiles` (`20260422000000_initial.sql:48`)
- `id uuid PK → auth.users(id)`, `display_name text NOT NULL`, `email text NOT NULL`, `avatar_url`, timestamps.
- Read here: `select('id, display_name, email').in('id', studentIds)` (`LessonStudentsPage.tsx:64`).
- **RLS:** `profiles_select_authenticated` — any authenticated user may read any profile (`20260428000003_profiles_read_all.sql:3`).

### `questions` (teacher-authored prompts) (`20260422000000_initial.sql:163`)
- `id`, `lesson_id → lessons(id)`, `position int`, `prompt text`, `created_at`, `UNIQUE(lesson_id, position)`.
- Read here: `select('id').eq('lesson_id', id)` to get `totalQuestions` and the ID set used to count/delete answers (`LessonStudentsPage.tsx:70`, `:141`).

### `blocks` (lesson content blocks) (`20260422000000_initial.sql:134`)
- `id`, `lesson_id → lessons(id)`, `position int`, `type block_type`, `content_json jsonb`, `created_at`, `UNIQUE(lesson_id, position)`.
- Read here: `select('id').eq('lesson_id', id).eq('type', 'video')` — only `type = 'video'` blocks count as trackable video (`LessonStudentsPage.tsx:78`, `:142`).

### `answers` (student responses) (`20260422000000_initial.sql:175`)
- `id`, `question_id → questions(id)`, `student_id → profiles(id)`, `text`, `submitted_at`, `edited_at`, `UNIQUE(question_id, student_id)`.
- Read here: `select('student_id, question_id').in('question_id', questionIds)` (`LessonStudentsPage.tsx:88`).
- Deleted on reset: `.eq('student_id', studentId).in('question_id', questionIds)` (`:149`).
- **RLS:** students read/write own (`answers_select_own`/`answers_insert`/`answers_update`, `:545`); admin/teacher read all in parish (`answers_select_parish`, `:555`); admin/teacher delete in parish (`answers_delete_parish`, `20260426000000_reset_grants.sql:8`).

### `video_watches` (fully-watched video blocks) (`20260423000003_video_watches.sql:2`)
- `id`, `student_id → profiles(id)`, `block_id → blocks(id)`, `watched_at`, `UNIQUE(student_id, block_id)`.
- Read here: `select('student_id, block_id').in('block_id', videoBlockIds)` (`LessonStudentsPage.tsx:97`).
- Deleted on reset: `.eq('student_id', studentId).in('block_id', blockIds)` (`:158`).
- **RLS:** student read/insert own (`video_watches.sql:15`/`:18`); admin/teacher read in parish (`video_watches_select_parish`, `20260428000004_video_watches_teacher_read.sql:3`); admin/teacher delete in parish (`video_watches_delete`, `20260426000000_reset_grants.sql:18`).

### `student_questions` (questions students ASK) (`20260422000000_initial.sql:189`)
- `id`, `lesson_id → lessons(id)`, `student_id → profiles(id)`, `text`, `created_at`.
- **Not read/displayed here**, but deleted on reset: `.eq('student_id', studentId).eq('lesson_id', id)` (`LessonStudentsPage.tsx:166`).
- **RLS delete:** `student_questions_delete` (parish admin/teacher) (`20260426000000_reset_grants.sql:28`).

### `student_feedback` (`20260422000000_initial.sql:200`)
- `id`, `lesson_id → lessons(id)`, `student_id → profiles(id)`, `text`, `created_at`.
- **Not read/displayed here**, but deleted on reset (`LessonStudentsPage.tsx:167`).
- **RLS delete:** `student_feedback_delete` (parish admin/teacher) (`20260426000000_reset_grants.sql:37`).

### Relationships summary
```
parishes ─┬─< cohorts ─< cohort_members >─ profiles
          ├─< memberships >─ profiles (role: admin/teacher/student)
          └─< lessons ─┬─< questions ─< answers >─ profiles(student)
                       └─< blocks(type=video) ─< video_watches >─ profiles(student)
lessons ─< student_questions / student_feedback >─ profiles(student)
```

## Key logic & algorithms

### Student-set resolution (cohort vs parish)
```ts
// LessonStudentsPage.tsx:42
if (cohortId) {
  const { data: cohortMembers } = await supabase
    .from('cohort_members').select('student_id').eq('cohort_id', cohortId);
  studentIds = (cohortMembers ?? []).map((m) => m.student_id);
} else {
  const { data: memberships } = await supabase
    .from('memberships').select('user_id')
    .eq('parish_id', lesson.parish_id).eq('role', 'student');
  studentIds = (memberships ?? []).map((m) => m.user_id);
}
```

### Progress counting via Sets (dedup defensive)
For each profile, answers/watches are filtered to that student, then counted with a `Set` to dedupe (the unique constraints already prevent dupes, but the Set is belt-and-suspenders):
```ts
// LessonStudentsPage.tsx:106
const answeredCount = new Set(studentAnswers.map((a) => a.question_id)).size;
const watchedCount  = new Set(studentWatches.map((w) => w.block_id)).size;
```

### Status derivation (`LessonStudentsPage.tsx:111`)
```ts
let status = 'not_started';
if (answeredCount > 0 || watchedCount > 0) {
  status = (answeredCount >= totalQ && watchedCount >= totalV) ? 'completed' : 'in_progress';
}
```
- `not_started`: zero answers AND zero watches.
- `completed`: answered ALL questions AND watched ALL video blocks. Uses `>=` so it's robust to extra rows.
- Edge: a lesson with **0 questions and 0 video blocks** — a student who has *any* activity can't reach the `if` (counts are 0), so status stays `not_started`. A lesson with 0 questions/0 videos can never be `completed` because the activity gate (`answeredCount>0 || watchedCount>0`) can never trip.

### Conditional empty-result short-circuits
The answers/watches queries are skipped entirely when there are no question/video IDs, returning `{ data: [] }` synthetically to avoid an `.in('...', [])` query (`LessonStudentsPage.tsx:87`, `:95`).

### Reset re-derives IDs server-side-of-truth, then deletes (`LessonStudentsPage.tsx:136`)
Reset does NOT reuse the IDs from `fetchData`; it re-queries `questions` and `blocks(type=video)` for the lesson, then issues up to four sequential deletes. All four deletes are best-effort (no error handling), and `student_questions`/`student_feedback` deletes run unconditionally even if there are no questions/blocks.

## External integrations

**None directly in this section.** This page only reads/writes Postgres via the Supabase JS client (`../../lib/supabase`). It does not touch Mux, OpenAI/Whisper, ICS/email, or YouTube.

Indirect coupling: the `video_watches` rows it counts/deletes are produced elsewhere by the student video player (a watch is recorded when a video block is fully watched). In the broader Narthex app, video blocks reference `videos` which carry Mux columns (`20260430000000_mux_video_columns.sql`) and Whisper transcripts (`videos.transcript_text/transcript_json`), but none of that is read here — this page only needs the *count* of `type='video'` blocks and the *existence* of watch rows.

## Edge cases & gotchas

- **Stale `useCallback` dependency (real bug):** `fetchData` is `useCallback(..., [id])` (`LessonStudentsPage.tsx:130`) — it reads `cohortId` but omits it from deps. If a user navigates between two students-pages that share the same lesson `id` but differ in `cohortId` without remounting, the cohort filter would not refresh. In practice the route always remounts, so it rarely bites, but the port should depend on both `id` and `cohortId`.
- **Stuck-loading on missing lesson:** `if (!lesson) return;` (`:37`) returns before `setLoading(false)`, leaving a permanent "Loading..." if the lesson is missing or RLS-denied. Same for missing `id` (`:28`).
- **"parish" wording in cohort mode:** the empty state always says "No students in this parish yet." even when scoped to a cohort (`:191`).
- **Admin gate is parish-agnostic client-side:** `hasRole('admin')` with no `parishId` (`:25`) shows the Reset button to any admin regardless of parish; safety comes from RLS, not the UI.
- **Reset is non-atomic / no error handling:** four separate deletes run sequentially with no transaction and no error surfacing (`:148`–`:167`). A partial failure (e.g. RLS denies one table) leaves progress half-reset and shows no error; the subsequent `fetchData()` just reflects whatever survived.
- **Reset deletes more than is displayed:** the UI only counts answers + video watches, but reset also deletes `student_questions` and `student_feedback` (`:166`–`:167`). Porting team must preserve this broader wipe semantics.
- **Status uses `>=` not `===`:** if questions/blocks are deleted after a student answered/watched, `answeredCount` can exceed `totalQ`, still yielding `completed`. Intentional robustness, keep it.
- **Only `type='video'` blocks count:** other block types (text, etc.) never contribute to the video denominator (`:81`).
- **N reads scale with students implicitly:** answers/watches are fetched in bulk (one `.in(...)` each) and joined client-side — O(students × answers) filtering in JS. Fine for cohort sizes, but the port should consider doing the aggregation in SQL.
- **`disabled` on reset uses `status === 'not_started'`** computed from possibly-stale list state; double-clicking is guarded by `resetting === student.userId` (`:213`).
- **No pagination/sorting:** students render in whatever order profiles came back (`.in('id', studentIds)` order is unspecified by Postgres).

## Acceptance criteria

- [ ] Navigating to `cohorts/:cohortId/lessons/:id/students` as a teacher or admin renders the lesson title and per-student progress cards.
- [ ] A user without an `admin` or `teacher` role is blocked from the route (RoleGuard) and cannot load the page.
- [ ] With a `cohortId`, the student set equals exactly the `cohort_members.student_id` rows for that cohort.
- [ ] Without a `cohortId` (lesson-only mode), the student set equals all `memberships` with `role='student'` in the lesson's `parish_id`.
- [ ] When the resolved student set is empty, the empty-state ("No students in this parish yet.") is shown and no progress cards render.
- [ ] For each student, `answeredQuestions` equals the count of distinct `questions.id` (for this lesson) the student has an `answers` row for.
- [ ] For each student, `watchedVideoBlocks` equals the count of distinct `blocks.id` (lesson blocks with `type='video'`) the student has a `video_watches` row for.
- [ ] The `Videos: a/b` line is hidden when the lesson has zero video blocks and shown when it has at least one.
- [ ] Status is `not_started` when the student has zero answers and zero watches.
- [ ] Status is `completed` only when `answeredCount >= totalQuestions` AND `watchedCount >= totalVideoBlocks` (and the student has any activity).
- [ ] Status is `in_progress` when the student has some activity but has not satisfied both completion conditions.
- [ ] The Reset button is rendered only for admins and is hidden for teachers.
- [ ] The Reset button is disabled when the student's status is `not_started` or while that student's reset is in flight.
- [ ] Resetting a student deletes their `answers` for the lesson's questions, their `video_watches` for the lesson's video blocks, their `student_questions` for the lesson, and their `student_feedback` for the lesson.
- [ ] After a successful reset, the list re-fetches and the student's card shows `not_started` with zero answered/watched counts.
- [ ] RLS prevents a teacher/admin from reading or deleting progress rows in a parish where they lack an admin/teacher membership.
- [ ] A reset performed by a user lacking admin/teacher membership in the lesson's parish deletes nothing (RLS denies).

## Port notes

**Stack mapping (Parvus Ordo: Next.js 16 App Router, `packages/core` backend, Neon Postgres + RLS, WorkOS, Bunny, Groq).**

### Where code goes
- **`packages/core`** owns all logic:
  - `getLessonStudentProgress({ lessonId, cohortId? })` → resolves student set (cohort vs parish), loads questions/video-block counts, loads answer/watch counts, and returns the `StudentProgress[]` with derived status. **Do the counting in SQL** (e.g. `COUNT(DISTINCT ...)` grouped by student via a couple of CTEs) instead of fetching all rows and filtering in JS — fixes the implicit O(N) client work.
  - `resetStudentLessonProgress({ lessonId, studentId })` → runs the four deletes **inside a single transaction** so reset is atomic (fixes the non-atomic gotcha). Validates the caller is admin in the lesson's parish.
  - Status derivation lives in a pure `core` helper so it's unit-testable: keep `>=` semantics and the `activity>0` gate exactly.
- **RSC read** (the page itself): a Server Component calls `core.getLessonStudentProgress(...)` directly for the initial render. No business logic in the component — just auth check + call + render.
- **Server Action** for Reset: `resetStudentProgressAction` is a ~10-line shim: WorkOS auth → validate (zod) `{ lessonId, studentId }` → `core.resetStudentLessonProgress(...)` → revalidate the path. The current admin-only gate must be enforced in `core` (and RLS), not just the button.
- **No route handler / REST** needed (internal teacher tool, not an external consumer).
- **No infra/workers** needed — both read and reset are request-scoped, not out-of-band.

### RLS / tenancy
- Tenancy is **parish-scoped** (diocese → parish → cohort → member). Carry the same model: every progress read/delete must be gated by the caller holding `admin`/`teacher` in the lesson's `parish_id`. Port the `user_has_role`-style policies for `answers`, `video_watches`, `student_questions`, `student_feedback`, plus parish-read for `lessons`/`questions`/`blocks` and world-read (within tenant) for `profiles`.
- **Tighten the admin gate:** in Narthex the UI uses `hasRole('admin')` with no parish; in Parvus Ordo the Reset action must require admin **in the lesson's parish** (server-side), matching RLS so the UI and backend agree.
- Lessons in Parvus Ordo can be global/diocese/parish scoped (three-tier). This section assumes a parish-owned lesson (`lessons.parish_id NOT NULL` in Narthex). For diocese/global lessons, decide whether "students" means parish cohort members consuming a forked/assigned copy — the student-set resolution must key off the **parish assignment/cohort**, not the lesson's authoring scope.

### Mux → Bunny, Whisper → Groq
- **Not directly used here.** This page only counts `type='video'` blocks and checks for watch rows. The Mux→Bunny and Whisper→Groq swaps live in the media/player slices, not this one. The only contract this section needs is: "a `video_watches`-equivalent row exists when a student completes a video block." Parvus Ordo's seek-enforcing player should write that completion signal.

### Explicit GAPS vs what Parvus Ordo already has
- **Lessons + versioning:** Parvus Ordo already has versioned lessons; Narthex `questions`/`blocks` are flat per-lesson. The progress query must target a **specific lesson version** (the one assigned to the cohort), or completion counts will drift when a lesson is edited. Narthex has no version concept — define which version "total questions/videos" is measured against.
- **Media/asset manager:** Parvus Ordo's asset manager replaces Narthex `videos` + Mux columns. Ensure "video block" in the new model still maps to a discrete, watch-trackable unit so the `watched/total` denominator is well-defined.
- **Seek-enforcing player + transcript:** the completion signal that backs `video_watches` is produced by this player in Parvus Ordo. Confirm it emits a per-block "completed" event that `core` records; otherwise the Videos denominator/numerator can't be computed.
- **Teacher preview:** Parvus Ordo has a teacher-preview mode — ensure preview activity does NOT write answers/watches (or is filtered out of progress), so a teacher previewing a lesson doesn't appear as a "student" or inflate counts.
- **Student-asked questions & feedback:** Narthex reset wipes `student_questions` and `student_feedback`, which are separate features. If Parvus Ordo hasn't built those yet, the reset action must be designed to also clear them once they exist (or the port should scope reset to answers+watches now and TODO the rest, documented).
- **No engagement events here:** Narthex has a separate `engagement_events` table (`20260430000001_engagement_events.sql`) used by the Engagement Dashboard, not by this page. Keep that distinction — this section is binary completion tracking, not granular analytics.
