# Cohorts

> Source app: Narthex (Vite + React + Supabase). Primary file:
> `apps/web/src/routes/teacher/CohortDetailPage.tsx`.
> Supporting files: `apps/web/src/components/cohort/LearningPathsSection.tsx`,
> `apps/web/src/components/settings/CohortsTab.tsx`,
> `apps/web/src/components/calendar/CalendarEventModal.tsx`,
> `apps/web/src/routes/student/StudentLessonListPage.tsx` (the consumer of the schedule),
> `apps/web/src/routes/teacher/WeeklyExportPage.tsx`, and `apps/web/src/App.tsx` (routing/guards).

## Overview

A **Cohort** is a named group of students at a parish (e.g. "OCIA 2026-2027") with a
weekly discussion cadence and a **schedule** that maps published lessons to dates. It is the
unit that drives *what a student sees and when*. A cohort owns:

- A roster of students (`cohort_members`).
- A weekly meeting pattern (`discussion_day`, `discussion_time`, `discussion_location`) and a
  date window (`start_date`, `end_date`).
- An ordered **schedule** (`cohort_schedule`): one row per lesson, each with a discussion date
  and optional release/due/time/location overrides plus a "skip sequence" flag.
- A `sequential` flag that turns on **gated, drip-released** lessons for students.
- Zero or more **Learning Paths** (`learning_paths` + `learning_path_members` +
  `learning_path_lessons`): named sub-sequences of lessons assigned to a subset of the roster,
  so different students in the same cohort can follow different lesson sets.

The `CohortDetailPage` is the teacher/admin cockpit for one cohort. It is a tabbed UI:
**Lessons**, **Schedule**, **Calendar**, **Students**, **Learning Paths**, **Settings**.
Cohort *creation* and *roster management* live in a separate Settings tab (`CohortsTab.tsx`),
not in this page. This doc covers the cohort detail page and everything it reads/writes,
plus the student-side consumption needed to port the gating semantics faithfully.

It exists because lessons in Narthex are authored once (parish-scoped, ordered by
`lesson_order`) but *delivered* on a per-cohort timeline. The cohort layer decouples
"what was authored" from "what is released to whom, in what order, on what date."

## Roles & access

- **Routes are gated by `RoleGuard allowedRoles={['admin','teacher']}`** for all cohort
  detail/management routes (`App.tsx:111-176`). Students never reach `CohortDetailPage`.
  - `cohorts/:id` → `CohortDetailPage` (admin, teacher).
  - `cohorts/:cohortId/week/:weekNumber/export` → `WeeklyExportPage` (admin, teacher).
  - `cohorts/:cohortId/lessons/:id/responses|students|engagement` → respective pages (admin, teacher).
  - `cohorts` (no id) → `SchedulePage` (the per-user schedule, shared, not the management list).
- **Cohort creation & deletion is admin-only** inside `CohortsTab` (`isAdmin` gates the create
  input and the delete button — `CohortsTab.tsx:148, 186`). Teachers can manage an existing
  cohort's schedule, settings, students-view, learning paths, and calendar via the detail page,
  but cannot create/delete the cohort itself.
- **Students** are read-only consumers: the cohort's `sequential` flag, `cohort_schedule`, and
  learning-path membership determine which lessons appear in their `StudentLessonListPage`. They
  have no UI in this section.
- All access control in Narthex is **enforced only by client-side route guards plus Supabase
  RLS** (RLS policies are not in these files; the queries assume the parish scope is enforced by
  policy). There is no server middleware.

## User flows

### A. Open a cohort (Lessons tab — default)
1. Teacher navigates to `/cohorts/:id`. `fetchData()` runs (`CohortDetailPage.tsx:94-171`).
2. Loads the cohort row; if missing → renders `Cohort not found.` (`:243`).
3. Loads `cohort_schedule` ordered by `discussion_date`, resolves lesson titles, loads all
   published parish lessons (for the "add" picker), and computes per-student progress.
4. **Empty state:** if no schedule rows, Lessons tab shows "No lessons scheduled. Go to the
   Schedule tab to set up lessons." (`:312`).
5. Otherwise renders each week as a card: week number badge, lesson title, computed discussion
   date/time/location, and action links (Responses, Progress, Engagement, Export). Past weeks
   render greyed (`isPast = disc < new Date()`, `:320`).

### B. Build the schedule (Schedule tab)
1. Teacher sets Start Date, End Date, Discussion Day, Default Time, Default Location. Each field
   `onBlur` immediately calls `saveCohortSettings()` (`:389-414`) → writes to `cohorts`.
2. **Auto-Generate** (`generateSchedule`, `:177-203`): requires `start_date` + `discussion_day`
   (button disabled otherwise). It computes weekly dates from the first matching weekday, capped
   at `min(weeks-in-window, allLessons.length)`, then **deletes all existing schedule rows** and
   inserts one row per published lesson in `lesson_order`, with `week_number = i+1` and
   `discussion_date` set to the weekly cadence.
3. **Manual add** (`addLesson`, `:205-217`): a `<select>` of not-yet-scheduled published lessons;
   clicking Add inserts a row dated 7 days after the last scheduled discussion (or 7 days after
   `start_date`), `week_number = schedule.length + 1`.
4. **Per-row edit:** Release / Due / Discussion date inputs, Time and Location text inputs, and
   (if `sequential`) an "Always available (skip sequence)" checkbox. Each change calls
   `updateEntry` (`:224-227`) → `cohort_schedule.update(...).eq('id', entryId)` then refetch.
   Editing the Discussion date also sets `is_date_override = true` (`:473`).
5. **Remove:** trash icon → `removeEntry` → `cohort_schedule.delete().eq('id', entryId)` (`:219`).
6. **Empty state:** "No lessons scheduled. Use Auto-Generate or add lessons manually below." (`:421`).

### C. Calendar tab
1. Builds derived events from the schedule (discussion / due / release) and overlays parish
   `calendar_events` (`ParishEventsOverlay`, `:776-832`).
2. Color-coded by type: discussion (gold), due (red), release (green), parish (indigo) (`:804-809`).
3. Clicking a **discussion** event opens an inline editor for that schedule entry's
   dates/time/location (`onSelectEvent` → `setEditingEntryId`, `:616-621`, editor at `:555-611`).
4. **Add Event** opens `CalendarEventModal` in `customOnly` mode → inserts/updates/deletes a
   parish-scoped `calendar_events` row (`:623-652`). New events get `created_by: user.id`.

### D. Students tab
1. Renders each student with `completed/total` and a progress bar (`:657-690`).
2. Progress is computed from `answers` vs `questions` per scheduled lesson (see Key logic).
3. **Empty state:** "No students in this cohort. Add students in Settings → Cohorts." (`:661`).

### E. Learning Paths tab (`LearningPathsSection`)
1. Lists paths with lesson/member counts (`fetchPaths`, `LearningPathsSection.tsx:53-83`).
2. **Create:** type a name → insert `learning_paths {cohort_id, name}` (`:157-164`).
3. **Expand** a path → loads its members and lessons (`fetchPathDetail`, `:111-146`).
4. **Edit Lessons** ("quick setup", `:188-211`): check lessons in a list; on Save it **deletes
   all `learning_path_lessons` for the path** and re-inserts the selected lessons sorted by
   `lesson_order`, assigning `week_number = i+1`.
5. **Toggle student membership:** checkbox → insert/delete `learning_path_members` (`:172-180`).
6. **Delete path:** trash icon → `learning_paths.delete()` (`:166-170`).
7. **Empty states:** "No learning paths yet…" (`:238`); per-path "No lessons assigned…" (`:318`);
   "No students in this cohort." (`:343`).

### F. Settings tab
1. Edit name/dates/day/time/location (same `saveCohortSettings`, `onBlur`).
2. Toggle **"Require lessons in order"** (`sequential`) → immediate
   `cohorts.update({sequential}).eq('id', id)` then refetch (`:745-748`).

### G. Cohort creation / roster (separate — `CohortsTab` under Settings → Cohorts)
1. Admin types a name → `cohorts.insert({parish_id, name})` (`CohortsTab.tsx:66-74`).
2. Expand a cohort → loads all parish students (from `memberships` where `role='student'`,
   joined to `profiles`) and marks which are already in `cohort_members` (`:82-127`).
3. Checkbox per student → insert/delete `cohort_members` (`:129-141`). Counts update optimistically.
4. **Error/empty states:** "No cohorts yet…" (`:170`); "No students in this parish." (`:201`).

### H. Student consumption (read-only, `StudentLessonListPage`)
1. Student's cohort membership and (optional) learning-path membership are resolved
   (`StudentLessonListPage.tsx:75-93`).
2. If **not in any cohort → no lessons shown** (`:96-101`).
3. Schedule + `sequential` flag are loaded; released lessons (release_date ≤ today) are
   selected, intersected with learning-path lessons if any, then sorted by schedule order
   (`:170-220`). Locked/hidden logic per Key logic below.

## Data model

All cohort data is **parish-scoped**. Ownership for RLS is via `parish_id` on the cohort and
transitively through `cohort_id` on child tables.

### `cohorts`
Selected columns (`CohortDetailPage.tsx:97-100`, `CohortsTab.tsx:37-41`):
- `id` (uuid, pk)
- `parish_id` (uuid, fk → `parishes`) — **RLS ownership root**
- `name` (text)
- `start_date` (date, nullable)
- `end_date` (date, nullable)
- `discussion_day` (text, nullable — one of Sunday…Saturday)
- `discussion_time` (text, nullable — free-form like "7:00 PM")
- `discussion_location` (text, nullable)
- `sequential` (bool) — drip/gating switch
- `created_at` (timestamptz — used for `order('created_at')` in `CohortsTab`)

### `cohort_members`
Join table cohort↔student (`CohortDetailPage.tsx:136`, `CohortsTab.tsx:111-133`):
- `cohort_id` (uuid, fk → `cohorts`)
- `student_id` (uuid, fk → `profiles.id` / auth user id)
- (No surfaced surrogate key; rows deleted by composite `cohort_id`+`student_id`.)

### `cohort_schedule`
One row per scheduled lesson in a cohort (`CohortDetailPage.tsx:112-114`):
- `id` (uuid, pk)
- `cohort_id` (uuid, fk → `cohorts`)
- `lesson_id` (uuid, fk → `lessons`)
- `discussion_date` (date, not null) — the weekly meeting date; ordering key
- `release_date` (date, nullable) — when the lesson becomes visible; if null, computed
- `due_date` (date, nullable) — if null, computed as discussion_date − 1 day
- `week_number` (int, nullable) — display number; drives Export route
- `is_date_override` (bool) — set true when teacher manually edits discussion_date
- `time_override` (text, nullable) — overrides cohort `discussion_time`
- `location_override` (text, nullable) — overrides cohort `discussion_location`
- `skip_sequence` (bool) — "always available"; exempts the lesson from sequential gating

### `learning_paths`
(`LearningPathsSection.tsx:54-57, 160`):
- `id` (uuid, pk)
- `cohort_id` (uuid, fk → `cohorts`)
- `name` (text)
- `created_at` (timestamptz — order key)

### `learning_path_members`
(`LearningPathsSection.tsx:68, 115, 174-176`, `StudentLessonListPage.tsx:79-81`):
- `path_id` (uuid, fk → `learning_paths`)
- `student_id` (uuid, fk → `profiles.id`)

### `learning_path_lessons`
(`LearningPathsSection.tsx:69, 116, 199-205`):
- `id` (uuid, pk)
- `path_id` (uuid, fk → `learning_paths`)
- `lesson_id` (uuid, fk → `lessons`)
- `week_number` (int) — order within the path

### `lessons` (read-only here)
Selected: `id, title, description, published_at, lesson_order, parish_id`
(`CohortDetailPage.tsx:122, 127-132`). Only lessons with `published_at IS NOT NULL` and matching
`parish_id` are addable to a schedule/path.

### `profiles` (read-only here)
Selected: `id, display_name, email` (`CohortDetailPage.tsx:140`). Maps student ids → names.

### `memberships` (read in `CohortsTab` only)
Selected: `user_id, role, parish_id` (`CohortsTab.tsx:91-95`). Used to enumerate parish students
(`role = 'student'`). **Note the naming split:** `memberships` is the parish RBAC table, while
`cohort_members` is the cohort roster. They are distinct.

### `calendar_events` (read/write in Calendar tab)
Selected: `id, title, event_date, event_time, location, event_type, description, recurrence,
observed_date, parish_id, created_by` (`CohortDetailPage.tsx:628-648`, `:786-789`). Parish-scoped.

### `questions`, `answers` (read-only, for progress)
- `questions`: `id, lesson_id` (`CohortDetailPage.tsx:142`).
- `answers`: `student_id, question_id` (`:153`). A lesson is "completed" for a student when they
  have answered **all** of its questions; "started" when ≥1 answered.

### `engagement_events` (read-only, student side)
Selected: `lesson_id, student_id, event_type` (`StudentLessonListPage.tsx:126-130`). Sequential
*locking* uses `event_type = 'lesson_complete'` rows, **not** the answers-based progress. (The
teacher's Students tab uses answers; the student gating uses engagement events — these are two
different completion notions; see gotchas.)

## Key logic & algorithms

**Auto-generate schedule** — destructive regenerate (`CohortDetailPage.tsx:177-203`):
```ts
while (cursor.getDay() !== dayIndex) cursor.setDate(cursor.getDate() + 1); // find first weekday
while (cursor <= end && dates.length < allLessons.length) { dates.push(...); cursor +7d }
await supabase.from('cohort_schedule').delete().eq('cohort_id', id!); // wipes existing!
// then insert allLessons.slice(0, dates.length) in lesson_order with week_number = i+1
```
It pairs the i-th published lesson (by `lesson_order`) with the i-th weekly date. Count is capped
by both the date window and the number of lessons.

**Derived release date** (`CohortDetailPage.tsx:266-270`, mirrored at `:434-438` and
`StudentLessonListPage.tsx:148-167, 174-190`):
1. If `entry.release_date` is set → use it.
2. Else for the **first** entry → cohort `start_date` (fallback `'2000-01-01'`, i.e. always
   released, on the student side).
3. Else → **day after the previous entry's `discussion_date`** (`prevDiscussion + 1d`).
   In the teacher UI's non-first fallback, if no `start_date` it uses `discussion_date − 6d`.

**Derived due date** (`:263`, `:431-432`, `StudentLessonListPage.tsx:282`): if `due_date` set use
it, else `discussion_date − 1 day`.

**Sequential gating** — two independent mechanisms on the student side:
- *Hidden (drip release):* in `sequential` mode, a sequenced entry whose computed release date is
  in the future is hidden entirely (`StudentLessonListPage.tsx:145-168`). `skip_sequence` entries
  are excluded from the sequenced list and never hidden.
- *Locked (must complete prior):* `isLessonLocked` (`:313-326`) walks backward over the schedule
  order, skipping `skip_sequence` entries, and locks the lesson if the previous **sequenced**
  lesson has no `lesson_complete` engagement event:
```ts
if (skipSequenceIds.has(lessonId)) return false;
for (let i = idx - 1; i >= 0; i--) {
  if (skipSequenceIds.has(orderedScheduleLessonIds[i])) continue;
  return !completedLessonIds.has(orderedScheduleLessonIds[i]);
}
```

**Student lesson ordering** is by **schedule position (discussion_date order)**, NOT global
`lesson_order` (`StudentLessonListPage.tsx:212-219`).

**Learning-path lesson assignment** is destructive (`LearningPathsSection.tsx:196-205`): deletes
all `learning_path_lessons` for the path then re-inserts the checked set sorted by `lesson_order`
with fresh `week_number`s. Students in a path see only the **intersection** of released cohort
lessons and their path lessons (`StudentLessonListPage.tsx:192-197`).

**Per-student progress (teacher Students tab)** (`CohortDetailPage.tsx:156-167`): for each
scheduled lesson, count answered question ids; `completed` if answered ≥ total questions, else
`started` if >0. Lessons with zero questions are skipped from both counts.

**Calendar derived events** are built in-memory and merged with parish events fetched
asynchronously inside `ParishEventsOverlay` (`:785-802`); the overlay re-merges whenever
`calendarEvents` changes.

## External integrations

- **react-big-calendar + date-fns** (`CohortDetailPage.tsx:4-7, 13`): the Calendar tab renderer
  (`month`/`week`/`agenda` views; defaults to `agenda` on screens < 768px). All events are
  `allDay`. Not a network integration but a notable client dependency to replace/port.
- **Parish calendar events** (`calendar_events` table) overlaid onto the cohort calendar.
- **No Mux, no Whisper/OpenAI, no ICS/ical export, no email, no YouTube** are touched directly by
  this section. Video/transcription live in the lesson/media modules, not in cohorts. The
  per-week **Export** link (`/cohorts/:id/week/:n/export`) goes to `WeeklyExportPage`, which
  assembles lesson/blocks/questions/answers text and copies it to the clipboard via
  `navigator.clipboard.writeText` (`WeeklyExportPage.tsx:246`) — no email/ICS send.

## Edge cases & gotchas

- **Auto-Generate is destructive:** it `delete()`s all `cohort_schedule` rows for the cohort
  before inserting, silently discarding any per-entry overrides (release/due/time/location/
  skip_sequence). No confirmation dialog.
- **Learning-path "Edit Lessons" is also destructive:** it wipes and re-inserts all path lessons.
- **No optimistic concurrency / no transactions:** every mutation is a bare Supabase call
  followed by a full `fetchData()` refetch. Rapid edits on the same row can race (last write
  wins; a refetch may clobber an in-flight typed value).
- **Date math is local-timezone:** all dates are parsed as `new Date(s + 'T00:00:00')` (local
  midnight) and formatted with `fmtDate` (`:834-836`). Porting to UTC-stored Postgres `date`
  columns must preserve "calendar date, no time zone" semantics or weeks will shift by a day.
- **Two different "completion" definitions:** teacher progress uses `answers` coverage; student
  sequential lock uses `engagement_events` (`lesson_complete`). A student can appear "completed"
  on the teacher tab (answered all questions) yet still be locked out of the next lesson if no
  `lesson_complete` event fired, and vice-versa. Port should reconcile or preserve both.
- **`start_date` fallback `'2000-01-01'`** on the student side means a cohort with no start date
  treats the first lesson as always-released; the teacher UI instead falls back to
  `discussion_date − 6d`. These two fallbacks disagree.
- **Single-cohort assumption:** student gating uses `cohortData?.[0]` as the "primary" cohort
  (`StudentLessonListPage.tsx:110`). A student in multiple cohorts gets only the first cohort's
  `sequential` flag, though schedules from all cohorts are merged.
- **Add-lesson uses raw DOM read** (`document.getElementById('add-lesson-select')`,
  `:529`) instead of React state — a porting smell, not a behavior to replicate.
- **`week_number` is display + Export key only**; it is not guaranteed contiguous after manual
  add/remove (add uses `schedule.length + 1`, remove leaves gaps). Export links only render when
  `week_number` is set.
- **`is_date_override` is written but never read** in these files — it records intent but drives
  no behavior currently.
- **No cascade cleanup shown in app code:** deleting a cohort (`CohortsTab.tsx:77`) relies on DB
  cascades to clean `cohort_members`, `cohort_schedule`, `learning_paths`, etc.

## Acceptance criteria

- [ ] Only users with role `admin` or `teacher` can load the cohort detail page; a `student`
      request is rejected (route guard / RLS).
- [ ] Creating a cohort requires admin role; a teacher cannot create or delete a cohort but can
      edit an existing cohort's schedule and settings.
- [ ] Toggling a student in `cohort_members` adds/removes exactly one membership row and the
      cohort's student count reflects it immediately.
- [ ] Auto-Generate is disabled unless both `start_date` and `discussion_day` are set; when run,
      it deletes all existing schedule rows and inserts one row per published lesson (ordered by
      `lesson_order`) with weekly `discussion_date`s on the chosen weekday and `week_number = i+1`.
- [ ] Auto-Generate never produces more rows than `min(weeks in [start,end], published lesson count)`.
- [ ] Adding a lesson manually inserts a `cohort_schedule` row dated 7 days after the last
      scheduled discussion date with `week_number = current count + 1`.
- [ ] Editing the discussion date of a schedule entry persists the new date and sets
      `is_date_override = true`.
- [ ] When `release_date` is null, the computed release date equals cohort `start_date` for the
      first entry and `previous entry's discussion_date + 1 day` otherwise.
- [ ] When `due_date` is null, the computed due date equals `discussion_date − 1 day`.
- [ ] With `sequential = false`, a student sees all scheduled+released lessons regardless of
      prior completion.
- [ ] With `sequential = true`, a sequenced lesson whose computed release date is after today is
      hidden from the student.
- [ ] With `sequential = true`, a lesson is locked until the previous **sequenced** lesson has a
      `lesson_complete` engagement event; `skip_sequence` lessons are never locked or hidden.
- [ ] A student not in any cohort sees zero lessons.
- [ ] A student in a learning path sees only the intersection of released cohort lessons and
      their path's lessons.
- [ ] Saving a learning path's lessons deletes prior `learning_path_lessons` for that path and
      re-inserts the selected lessons ordered by `lesson_order` with sequential `week_number`s.
- [ ] Teacher Students tab marks a lesson "completed" only when the student has answered all of
      that lesson's questions, and "started" when ≥1 (zero-question lessons are ignored).
- [ ] Student lessons are ordered by schedule (discussion_date) position, not global lesson_order.
- [ ] Adding a calendar event in the Calendar tab inserts a parish-scoped `calendar_events` row
      with `created_by` set to the current user; editing/deleting target the same row by id.
- [ ] All schedule date arithmetic treats dates as calendar dates (no timezone shift): a lesson
      scheduled for a given date displays on that exact date in any client timezone.

## Port notes

**Layering (Parvus Ordo).** All cohort business logic moves into **`packages/core`** as a
`cohorts` domain module with pure functions + data access:
- `core/cohorts`: `createCohort`, `deleteCohort`, `updateCohortSettings`, `toggleMember`,
  `generateSchedule`, `addScheduleEntry`, `updateScheduleEntry`, `removeScheduleEntry`,
  `computeReleaseDate`, `computeDueDate`, `isLessonLocked`, `isLessonHidden`,
  `computeStudentProgress`.
- `core/learning-paths`: `createPath`, `deletePath`, `setPathLessons`, `togglePathMember`,
  `getPathDetail`.
- The release/due/lock/hidden date functions must be **pure and unit-tested** (they encode the
  subtle fallbacks above) and shared by both the teacher write path and the student read path so
  the two never diverge (fixing the current `'2000-01-01'` vs `−6d` inconsistency — pick one,
  document it, test it).

**Entry points:**
- **Mutations** (create/delete cohort, toggle member, generate/add/update/remove schedule,
  path edits, calendar event CRUD, toggle `sequential`) → **Server Actions**, each ~10 lines:
  auth check → Zod-validate input → call `core` → return. The Narthex pattern of
  "mutate then refetch everything" should be replaced with a `core` call + targeted revalidation.
- **Reads** (cohort detail, schedule, students tab, learning paths, student lesson list) → **RSC**
  reading directly via `core` query functions.
- **Client-reactive** pieces (inline schedule editing with onBlur autosave, calendar interactions,
  learning-path expand/toggle) → **tRPC** if optimistic/live updates are wanted; otherwise plain
  Server Actions with `useTransition`. Replace the raw `getElementById` add-lesson with state.
- **External REST `/api/v1`** is not needed for this section.
- **infra/workers:** nothing here is out-of-band today. *Optional future:* a Cron worker could
  precompute "released as of today" or send discussion reminders — but that calls `core`, and is
  not required to match Narthex behavior.

**Auto-Generate as a transaction.** In `core`, `generateSchedule` must wipe+insert inside a
**single DB transaction** (Narthex does two unguarded calls). Consider preserving per-entry
overrides on regenerate, or add an explicit "this will discard overrides" confirmation in the UI
(Narthex has none).

**RLS / tenancy.** Cohorts are **parish-scoped**; map onto Parvus Ordo's
diocese → parish → ministry hierarchy with cohorts living at **parish** scope.
- RLS root: `cohorts.parish_id`. Child tables (`cohort_members`, `cohort_schedule`,
  `learning_paths`, `learning_path_members`, `learning_path_lessons`) inherit access transitively
  via `cohort_id`/`path_id`; write Postgres RLS policies that join up to the cohort's parish and
  check the caller's membership/role.
- Distinguish the two roster tables explicitly in the schema: parish RBAC (`memberships`,
  role-based, ministry-aware) vs cohort roster (`cohort_members`). Ministries matter for RBAC but
  cohorts are orthogonal to ministries.
- Add a tenant-scoped FK so a cohort's lessons/students cannot cross parishes (Narthex enforces
  this only implicitly via `parish_id` filters).

**Lessons / versioning gap.** Parvus Ordo already has **lessons with versioning** and a
three-tier scope (global/diocese/parish). Narthex `cohort_schedule.lesson_id` points at a flat
parish lesson. Porting decisions:
- `cohort_schedule.lesson_id` should reference a **lesson (logical), pinned to a version** (or
  "latest published") — Parvus Ordo's versioning lets a cohort lock the version it was teaching.
- "Published" filter (`published_at IS NOT NULL`) maps to "has a published version."
- A diocese- or global-scoped lesson forked to a parish (fork-and-edit) is what a cohort schedules;
  ensure the schedule can reference diocese/global lessons too if the parish hasn't forked them.

**Already-built pieces to reuse (not rebuild):**
- **Media/asset manager**, **seek-enforcing player + transcript**, **teacher preview** — these are
  *lesson* concerns. Cohorts only *schedule* lessons; the cohort layer adds nothing video-related.
  The "Responses / Progress / Engagement / Export" links from cohort rows hand off to those
  existing lesson/analytics surfaces.

**Mux → Bunny / Whisper → Groq.** **Not applicable to this section** — cohorts touch no media or
transcription. Those mappings belong to the lesson/media docs. The only thing to confirm during
port is that the cohort→lesson links route into the Bunny-backed player and Groq-backed transcript
that Parvus Ordo already built.

**Explicit gaps vs. Parvus Ordo today:**
1. No cohort/scheduling primitives exist yet in `packages/core` — this is net-new domain code.
2. `learning_paths` (per-cohort lesson sub-sequences with their own membership) has no Parvus
   Ordo equivalent; it must be modeled fresh.
3. The two completion notions (answers-coverage vs `lesson_complete` engagement event) need a
   single source of truth decided at port time.
4. `engagement_events` (student-side) is assumed to exist; confirm Parvus Ordo's analytics/event
   model can supply `lesson_complete` for gating, or replace the lock signal with the lesson's
   versioned completion state.
5. Calendar: react-big-calendar + `calendar_events` overlay must be re-implemented; decide whether
   the cohort calendar is its own feature or a view over a shared parish calendar module.
