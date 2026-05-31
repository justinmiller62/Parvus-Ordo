# Engagement Dashboard

## Overview

The Engagement Dashboard is the teacher/admin-facing analytics view for a single lesson and/or a single cohort. It aggregates the raw `engagement_events` telemetry stream that students generate while working through a lesson (in `LessonViewPage`) and renders summary cards, charts (Recharts), and two tables (per-question analytics and per-student progress).

It exists to answer questions a catechist actually asks: *How many students started this lesson? How many finished? Where do they get stuck (which step takes longest)? Which questions are hard or answered wrong? Which individual students have stalled?*

All aggregation is computed **client-side in the browser** from a single `SELECT *` over `engagement_events`. There is no server-side rollup, materialized view, or aggregate query — the page pulls every matching event row and reduces them in JavaScript. This is the most important fact for the port.

Source component: `apps/web/src/routes/teacher/EngagementDashboardPage.tsx`.

## Roles & access

- **Roles allowed:** `admin` and `teacher`. Students cannot reach the dashboard.
- **Gating (frontend):** In `apps/web/src/App.tsx` all three engagement routes are wrapped in `<RoleGuard allowedRoles={['admin', 'teacher']}>`. `RoleGuard` (`apps/web/src/components/layout/RoleGuard.tsx:21`) checks `memberships.some((m) => allowedRoles.includes(m.role))` against the auth context; if no allowed role, it `<Navigate to="/" replace />`. This is a global membership check — it does NOT verify the user belongs to the parish that owns the lesson/cohort being viewed; that scoping is enforced only at the DB layer.
- **Gating (database / real authority):** The `engagement_events` RLS `SELECT` policy `engagement_select_parish` (`supabase/migrations/20260430000001_engagement_events.sql:29`) restricts visible rows to lessons whose `parish_id` matches a parish where the caller has an `admin` or `teacher` membership. So even though `RoleGuard` is parish-agnostic, a teacher in parish A querying a lesson in parish B simply gets zero rows back (and the page renders its empty state).
- **Routes** (all under the authenticated app shell), `apps/web/src/App.tsx:152-175`:
  - `lessons/:id/engagement` — single lesson, all cohorts.
  - `cohorts/:cohortId/engagement` — single cohort, all lessons (note: no lesson means blocks/questions/per-step/per-question charts are mostly empty).
  - `cohorts/:cohortId/lessons/:id/engagement` — single lesson scoped to one cohort (the primary, richest view).

## User flows

1. **Teacher opens a lesson's analytics.** Navigates to one of the engagement routes. Component reads `cohortId` and `id` (lesson) from `useParams()` (`EngagementDashboardPage.tsx:61`). `loadData()` runs on mount and whenever `lessonId`/`cohortId` change (`:70-72`).
2. **Loading state.** While `loading` is true, the page shows `"Loading engagement data..."` (`:121-123`).
3. **Data fetch (sequential awaits in `loadData`, `:74-119`):**
   1. If `lessonId`: fetch lesson title (`lessons`), blocks (`blocks`), questions (`questions`).
   2. If `cohortId`: fetch cohort name (`cohorts`).
   3. Fetch engagement events with optional `.eq('lesson_id', ...)` and `.eq('cohort_id', ...)` filters, ordered by `created_at` ascending.
   4. Collect distinct `student_id`s from the returned events and fetch their `display_name`s from `profiles` via `.in('id', studentIds)`.
4. **Empty state.** If `events.length === 0`, render a dashed-border placeholder: *"No engagement data yet. Students will generate data as they work through lessons."* (`:282-286`). This is the only "empty" branch — there is no distinct "lesson not found" or "permission denied" state; an RLS-denied query returns `[]` and falls into this same branch.
5. **Populated dashboard** (`:287-466`), rendered top-to-bottom:
   - **Header:** back link, "Engagement Analytics", and subtitle `lesson.title ?? 'All Lessons'` plus ` — {cohortName}` if present.
   - **Summary cards:** Students (unique starters), Completed (count + %), Avg Time, Events (total row count).
   - **Completion Rate pie** (Completed vs In Progress) and **Avg Time by Content Type bar** (video/reading/question), side by side.
   - **Avg Time Per Step** horizontal bar — only rendered if `stepData.length > 0`.
   - **Question Analytics table** — only rendered if `questionStats.length > 0` (i.e., the lesson has questions).
   - **Student Progress table** — always rendered when there are events.
6. **Error handling.** None surfaced to the user. Every Supabase call ignores its `error` field and falls back to `?? []` / `?? null`. A failed lesson fetch leaves `lesson` null (header shows "All Lessons"); a failed events fetch yields the empty state. The only error logging in the whole feature is the fire-and-forget `console.warn` inside `trackEngagement` on the student side (`lib/engagement.ts:32`).
7. **Back navigation.** `backUrl` (`:254-258`) goes to `/cohorts/{cohortId}` when a cohort is present, else `/lessons/{lessonId}`.

## Data model

The dashboard reads from these Supabase tables. Only `engagement_events` is "owned" by this feature; the rest are read-only references.

### `engagement_events` (the core table — defined in `supabase/migrations/20260430000001_engagement_events.sql`)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `student_id` | uuid NOT NULL | FK → `profiles(id)` ON DELETE CASCADE. RLS ownership key. |
| `lesson_id` | uuid NOT NULL | FK → `lessons(id)` ON DELETE CASCADE. |
| `event_type` | text NOT NULL | One of: `lesson_start`, `step_enter`, `step_exit`, `answer_submit`, `reading_complete`, `lesson_complete`. |
| `step_index` | int (nullable) | Index into the lesson timeline; null for lesson-level events. |
| `step_kind` | text (nullable) | `video` / `reading` / `question` / `feedback`. |
| `block_id` | uuid (nullable) | Soft reference to `blocks(id)` (NOT a FK constraint). |
| `question_id` | uuid (nullable) | Soft reference to `questions(id)` (NOT a FK constraint). |
| `cohort_id` | uuid (nullable) | Soft reference to `cohorts(id)` (NOT a FK constraint). Used for cohort filtering. |
| `metadata` | jsonb (nullable) | Per-event payload — see below. |
| `created_at` | timestamptz NOT NULL | `now()`. Used as the timeline clock for all durations. |

Indexes: `idx_engagement_lesson(lesson_id)`, `idx_engagement_student_lesson(student_id, lesson_id)`, `idx_engagement_cohort(cohort_id)`, `idx_engagement_type(event_type)`.

**`metadata` shapes (set by the student player, `LessonViewPage.tsx`):**
- `step_exit` → `{ duration_ms: number }` (`:305`).
- `answer_submit` → `{ time_to_answer_ms: number, answer_correct?: boolean }`. `answer_correct` is only set for `multiple_choice` questions, computed by matching the chosen text against the choice flagged `correct` (`:352-358`).
- `lesson_start`, `step_enter`, `reading_complete`, `lesson_complete` → no metadata (null).

**RLS (authoritative ownership):**
- INSERT policy `engagement_insert_own`: `WITH CHECK (auth.uid() = student_id)` — a student may only write their own events.
- SELECT policy `engagement_select_parish`: row visible if its `lesson_id` belongs to a parish where `auth.uid()` has an `admin`/`teacher` membership. (`:29-37`)
- `service_role` has `GRANT ALL`.

### `lessons` (read; `initial.sql`)
Selected columns: `id`, `title`. Full table also has `parish_id` (FK → `parishes`, the tenancy anchor used by RLS), `description`, `discussion_template`, `visibility` (`parish`|`diocese`), `source_lesson_id` (self-FK — fork/copy lineage), `lesson_order`, `created_by`, `published_at`, timestamps.

### `blocks` (read; `initial.sql`)
Selected: `id`, `position`, `type`, `content_json`. `lesson_id` FK → `lessons` ON DELETE CASCADE; `UNIQUE(lesson_id, position)`; `type` is enum `block_type` (`video` | `reading`). `content_json` jsonb — the dashboard reads `content_json.title` to label video/reading steps.

### `questions` (read; `initial.sql` + `20260422000002_question_type.sql`)
Selected: `id`, `position`, `prompt`, `question_type`. `lesson_id` FK → `lessons` ON DELETE CASCADE; `UNIQUE(lesson_id, position)`. `question_type` is enum (`open_ended` | `multiple_choice`); `choices` jsonb is an array of `{ label, correct }`, NULL for open-ended (CHECK constraint enforces this). Note: the dashboard reads `choices` only indirectly — correctness is computed on the student side and stored in `engagement_events.metadata.answer_correct`.

### `cohorts` (read; `initial.sql`)
Selected: `name`. `parish_id` FK → `parishes`. Used only to label the header.

### `profiles` (read; `initial.sql`)
Selected: `id`, `display_name`. `id` PK = `auth.users(id)`. Used to map `student_id` → human name.

### `memberships` (read indirectly via RLS; `initial.sql`)
Not queried by the page directly, but its `(user_id, parish_id, role)` rows back the RLS SELECT policy and `RoleGuard`. `role` enum `membership_role` = `admin` | `teacher` | `student`.

**Relationship summary:** `engagement_events.student_id → profiles.id`; `engagement_events.lesson_id → lessons.id → parishes.id` (the RLS scope chain); `block_id`/`question_id`/`cohort_id` are loose join keys resolved client-side, not enforced FKs.

## Key logic & algorithms

All computed after load, in the render body (`EngagementDashboardPage.tsx:125-258`).

- **Event bucketing** (`:126-129`): filter events into `lessonStarts`, `lessonCompletes`, `stepExits`, `answerSubmits` by `event_type`.

- **Unique students & completion rate** (`:131-133`):
  ```ts
  const uniqueStudents = [...new Set(lessonStarts.map((e) => e.student_id))];
  const completedStudents = new Set(lessonCompletes.map((e) => e.student_id));
  const completionRate = uniqueStudents.length ? completedStudents.size / uniqueStudents.length : 0;
  ```
  "Students" = distinct emitters of `lesson_start`. A student who completed but whose `lesson_start` row is missing/filtered out would inflate `completedStudents` without being in `uniqueStudents` (completion rate can theoretically exceed denominator semantics).

- **Average lesson duration** (`:135-144`): for each completed student, finds the *first* `lesson_start` (`.find`) and *first* `lesson_complete` (`.find`), takes `complete.created_at - start.created_at` in ms, averages. Because events are sorted ascending, `.find` returns the earliest of each. Re-takes of a lesson are not handled — only the first start/complete pair counts.

- **Per-step timing** (`:146-177`): aggregates `step_exit` durations keyed by `"${step_index}-${step_kind}"`. Discards `duration_ms <= 0` or `> 1_800_000` (30-minute cap, to drop tab-left-open outliers). Step labels are resolved client-side: video/reading steps use the matching block's `content_json.title`; question steps use the first 50 chars of the question `prompt`; fallback is `"Step {index+1}"`. Sorted by numeric `step_index` (`parseInt` of the key prefix) — note this is a string `parseInt`, so `"10-video"` parses as 10 correctly.

- **Time by content type** (`:179-197`): same 30-min cap, sums and counts `duration_ms` per `step_kind`, collapsing `feedback` into `question` (`const k = e.step_kind === 'feedback' ? 'question' : e.step_kind;`). Buckets are fixed to `video`/`reading`/`question`; any other kind is dropped. Chart shows the **average** (`v / countByType[k]`).

- **Per-question analytics** (`:199-219`): for each question, gathers `answer_submit` events with matching `question_id`. Average answer time uses `metadata.time_to_answer_ms` filtered to `> 0 && < 600000` (10-min cap). Accuracy is only computed for `multiple_choice`: `correct = submissions where metadata.answer_correct === true`, `accuracyRate = correct / submissions.length` (null for open-ended). UI color-codes accuracy: ≥70% green, ≥40% amber, else red (`:409`).

- **Per-student table** (`:221-247`): for each unique student, counts distinct `step_index` from `step_exit` events (`stepsCompleted`), distinct `question_id` from `answer_submit` (`questionsAnswered`), and total time as `lastEvent.created_at - firstStart.created_at`. Note `totalMs` uses the **last event of any type** as the end, so it differs from the completion-based `avgDurationMs`. Rows are sorted so **in-progress students sort first** (`(a.completed === b.completed ? 0 : a.completed ? 1 : -1)`).

- **`formatMs` helper** (`:49-56`): `<1s` for sub-second, `{n}s` under a minute, `{m}m {s}s` otherwise.

- **Student-side emission** (`LessonViewPage.tsx`, via `lib/engagement.ts`): `lesson_start` fires once per mount (`lessonStartedRef` guard, `:252`); `step_enter` on each step change and `step_exit` in the effect cleanup carrying `duration_ms` (`:268-308`); `answer_submit` after a successful save (`:360`); `reading_complete` when advancing past a reading block, guarded by a `readBlocks` set (`:437`); `lesson_complete` once at the feedback step (`lessonCompletedRef`, `:386`). `trackEngagement` is **fire-and-forget** and **skips emission in preview/review mode** and (mostly) in test mode (`lib/engagement.ts:18` keeps only `reading_complete`/`lesson_complete` in test mode for resume logic).

## External integrations

**None in the dashboard itself.** This feature reads only Supabase/Postgres and renders Recharts. No Mux, no Whisper/OpenAI, no email, no ICS, no YouTube. The only adjacent integration is on the *producer* side: `step_kind === 'video'` events originate from blocks that reference Mux-hosted video in the legacy player — but the dashboard treats "video" purely as a label/category and never touches Mux.

## Edge cases & gotchas

- **Full-table scan to the client.** `engagement_events.select('*')` pulls every matching row to the browser; there is no pagination or LIMIT. A heavily-used lesson/cohort can return tens of thousands of rows. All metrics are JS reductions over that array.
- **No "lesson not found" / "forbidden" distinction.** RLS denial, wrong parish, or genuinely empty all collapse into the same "No engagement data yet" empty state.
- **Fire-and-forget writes can be lost.** Student events are `.insert(...)` without await; a closed tab mid-`step_exit` may drop the duration. `step_exit` is emitted in a React effect *cleanup*, which may not run on hard navigation/close.
- **Duration caps as data hygiene.** `step_exit` durations are clamped to (0, 30min]; answer times to (0, 10min). Outliers are silently dropped, not clamped — they vanish from averages entirely.
- **`feedback` folded into `question`.** Time on the final feedback step is attributed to the "question" content type, which can subtly inflate question time.
- **First-start/first-complete only.** Retakes are not modeled; `avgDurationMs` only ever uses the earliest start and earliest complete per student.
- **Two different "time" definitions.** Summary card "Avg Time" = complete−start (completers only). Per-student "Time" = lastEvent−start (everyone), so a student's row time and the headline average are not directly comparable.
- **`stepsCompleted` counts distinct `step_index`, not distinct steps.** If the timeline changed (lesson edited) between sessions, the same index can mean different content. Soft `block_id`/`question_id` references can also dangle if a block/question was deleted (no FK cascade on these columns).
- **Cohort scoping is by `cohort_id` stamped at emit time.** If a student moves cohorts, historical events keep their original `cohort_id`. The cohort-only route (no lesson) yields sparse charts because blocks/questions aren't loaded.
- **Recharts label collisions.** Per-step labels are truncated to 50 chars; identical truncations for distinct steps are still distinct rows because the key includes `step_index`.
- **RoleGuard is parish-blind.** Any teacher/admin in *any* parish passes the frontend guard; only RLS prevents cross-parish data leakage. The port must not weaken that DB boundary.

## Acceptance criteria

- [ ] A user without an `admin` or `teacher` role is redirected away from all three engagement routes and never sees the dashboard.
- [ ] A teacher/admin viewing a lesson owned by a parish they do NOT belong to sees the empty state (zero rows), not another parish's data.
- [ ] With no events for the lesson/cohort, the page renders the "No engagement data yet" empty state and none of the charts/tables.
- [ ] "Students" count equals the number of distinct `student_id`s that emitted a `lesson_start` event within the active filter.
- [ ] "Completed" count equals distinct `student_id`s with a `lesson_complete` event, and the percentage equals completed ÷ started, rounded.
- [ ] "Avg Time" equals the mean of (first `lesson_complete` − first `lesson_start`) per completed student, formatted by the `<1s`/`{s}s`/`{m}m {s}s` rules.
- [ ] "Events" equals the total number of `engagement_events` rows returned for the active filter.
- [ ] Per-step timing excludes any `step_exit` with `duration_ms <= 0` or `> 1,800,000`, and shows the average per `step_index`+`step_kind`.
- [ ] Step labels use block `content_json.title` for video/reading, truncated question `prompt` for questions, and `Step {index+1}` as fallback.
- [ ] "Avg Time by Content Type" buckets only `video`/`reading`/`question`, folds `feedback` into `question`, and hides buckets with zero total time.
- [ ] Per-question accuracy is computed only for `multiple_choice` (from `metadata.answer_correct`), shown as a percentage with green/amber/red thresholds at 70%/40%; open-ended shows a dash.
- [ ] Per-question average answer time uses `metadata.time_to_answer_ms` filtered to (0, 600000) ms; with no valid times it shows a dash.
- [ ] Per-student `stepsCompleted` counts distinct `step_index` from that student's `step_exit` events; `questionsAnswered` counts distinct `question_id` from their `answer_submit` events.
- [ ] The student table sorts in-progress students before completed students.
- [ ] The lesson-only route ignores cohort filtering; the cohort+lesson route filters events by BOTH `lesson_id` and `cohort_id`.
- [ ] The header subtitle shows the lesson title (or "All Lessons" when none) and appends the cohort name when a cohort is in scope.
- [ ] A student can insert only `engagement_events` rows where `student_id = auth.uid()` (RLS INSERT), and cannot read other students' events.
- [ ] Engagement tracking on the student side is fire-and-forget and never blocks lesson navigation, and emits nothing in preview/review mode.

## Port notes

**Architecture (per ParvaOrdo CLAUDE.md — code boundary, no API service):**

- **`packages/core`** owns all of this. Add an engagement module with:
  - A writer: `recordEngagementEvent(input)` validated by a Zod schema for `event_type` ∈ a known enum, `metadata` discriminated by event type (`step_exit` → `{ duration_ms }`, `answer_submit` → `{ time_to_answer_ms, answer_correct? }`). This replaces the loose `Record<string, unknown>` metadata and the loose `event_type: string`.
  - A reader/aggregator: `getEngagementSummary({ lessonId?, cohortId?, scope })` that returns the *already-reduced* metrics (summary cards, completion pie, per-type, per-step, per-question, per-student). **Do the aggregation in SQL/Postgres, not in the browser** — the legacy "SELECT * then reduce in JS" pattern does not scale and must not be ported as-is. The 30-min/10-min caps, the first-start/first-complete rule, the `feedback→question` fold, and the distinct-index counts become explicit SQL CTEs/`FILTER` clauses inside core.
- **RSC read path (mutations vs reads):** the dashboard is a read, so render it as a React Server Component that calls `core.getEngagementSummary(...)` directly (direct DB read), per the Reads→RSC rule. No tRPC needed unless live-refresh is desired.
- **Student event writes → Server Action.** Each `trackEngagement` call becomes a thin Server Action (`auth → validate → core.recordEngagementEvent → return`). Keep it fire-and-forget on the client (don't block the player). Consider batching `step_enter`/`step_exit` to cut round-trips.
- **infra/workers:** the raw event stream is a good candidate for a **nightly Cron rollup** in `infra/workers` (precompute per-lesson/per-cohort aggregates into a summary table) so the dashboard reads a small rollup instead of scanning raw events. This is optional but recommended given the scan-everything gotcha. Out-of-band only — never in the request path.

**RLS / tenancy (Neon + RLS, diocese → parish → cohort/member):**
- Recreate `engagement_events` with FK `student_id → profiles`/users and `lesson_id → lessons`. Promote `cohort_id`, `block_id`, `question_id` to real FKs (legacy left them as loose uuids).
- INSERT policy: `student_id = current user`. SELECT policy: lesson's `parish_id` is in the caller's admin/teacher parishes. With ParvaOrdo's three-tier content scope (global/diocese/parish), extend the SELECT policy so **diocese** admins can see aggregate engagement for parish-scoped lessons under their diocese, and global/super-admins see all — mirror the `super_admin_diocese_parish_policies` pattern already in the legacy migrations.
- The frontend role check must NOT be the only gate; keep RLS authoritative.

**Mux → Bunny, Whisper → Groq:** the dashboard does not call either. `step_kind === 'video'` is just a label. The only mapping is that video blocks in ParvaOrdo reference **Bunny** assets via the existing media/asset manager (Slice 5) instead of Mux; the engagement schema is unaffected. Transcription (Whisper→Groq) is irrelevant to this feature.

**GAPS vs what ParvaOrdo already has:**
- **Lessons with versioning:** ParvaOrdo lessons are versioned (fork-and-edit, unified `lesson_items`). The legacy dashboard keys steps by `step_index` against a *mutable* timeline, so edits corrupt historical analytics. The port should stamp a `lesson_version_id` (or `lesson_item_id`) onto each event and aggregate per version, instead of by raw integer index. This is new work with no legacy equivalent.
- **Unified `lesson_items` vs split `blocks`/`questions`:** the legacy page joins `blocks` and `questions` separately to label steps; in ParvaOrdo both are `lesson_items`, so step labeling resolves against one table — simplify the labeling logic accordingly. `step_kind` should derive from the item type.
- **Seek-enforcing player + transcript / teacher preview (already built):** ParvaOrdo already has the player with seek enforcement and a teacher preview mode. The legacy emitter already suppresses events in preview/review (`engagement.ts:18`) — preserve that. The seek-enforcing player can emit *richer* video engagement (watched %, seek events) than the legacy `watchedVideos` boolean; the engagement event schema should leave room for that (e.g., a `video_progress` metadata shape) even if v1 only ports the existing event types.
- **Media/asset manager (Slice 5, already built):** no change needed for analytics, but video-step labels should pull titles from the asset/`lesson_item`, not from a Mux-flavored `content_json.title`.
- **No existing aggregate/rollup infra:** there is no precomputed analytics table in either app today; the worker rollup described above is greenfield.
