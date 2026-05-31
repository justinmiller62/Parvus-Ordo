# Teacher Responses / Grading

> Source of truth for this section: `apps/web/src/routes/teacher/LessonResponsesPage.tsx` in the Narthex repo (single component, 577 lines), its test (`LessonResponsesPage.test.tsx`), the shared helper `packages/shared/src/discussion-template.ts` + `packages/shared/src/constants.ts`, the route wiring in `apps/web/src/App.tsx`, the gate `apps/web/src/components/layout/RoleGuard.tsx`, and the Supabase schema in `supabase/migrations/20260422000000_initial.sql` (+ `..._question_type.sql`, `..._expected_answer.sql`, `..._mux_video_columns.sql`).

## Overview

This is the teacher-facing **"Lesson Responses"** screen — the closest thing Narthex has to a grading/review surface. For a single lesson viewed in the context of one cohort, it aggregates everything students produced and lays it out for the catechist to review before a live discussion:

- Every **teacher-authored question** (`questions`) and, collapsed/expanded beneath each, every **student answer** (`answers`), attributed by student display name.
- All **student-asked questions** (`student_questions`) for the lesson.
- All **student feedback** (`student_feedback`) for the lesson.
- A header summary: count of unique students who answered, and total answer count.
- A **"Copy Export"** button that assembles a single large Markdown document (agent prompt + lesson material + transcripts + Q&A + student questions + feedback) and writes it to the clipboard. The intent is that the teacher pastes this into an LLM/agent to generate a discussion guide.
- An inline **"Agent Prompt" editor** (`DiscussionTemplateEditor`) that lets the teacher view, customize, save, or reset the per-lesson `discussion_template`.

Crucially, **this is NOT numeric grading**. There is no score, rubric, pass/fail, or per-answer feedback write-back. "Grading" here means *qualitative review + export to an AI discussion-guide generator*. The only thing a teacher can write on this page is the lesson's `discussion_template`. Answers, student questions, and feedback are strictly read-only on this screen. `expected_answer` exists on the question and is surfaced in the export (so the teacher/agent can compare), but the page never compares answers against it automatically.

## Roles & access

- The route is `cohorts/:cohortId/lessons/:id/responses`, wired in `apps/web/src/App.tsx:126-133`, wrapped in `<RoleGuard allowedRoles={['admin', 'teacher']}>`. So only **admin** and **teacher** memberships reach it; **students** are redirected to `/` (`RoleGuard.tsx:25-27`).
- **Gotcha — the guard is NOT parish-scoped.** `RoleGuard` checks `memberships.some((m) => allowedRoles.includes(m.role))` (`RoleGuard.tsx:21-23`). A user who is a teacher in *any* parish passes the guard for *any* lesson URL. The real tenancy enforcement is RLS in Postgres (see Data model): the Supabase queries only return rows in parishes where the caller has an `admin`/`teacher` membership, so a teacher from parish A who hand-edits the URL to a parish-B lesson will be allowed into the page but see empty/blocked data (and `lessons.select(...).single()` will error → the page shows "Lesson not found").
- A comment at `App.tsx:108` notes responses are intended to be reached "via cohort context" — i.e. from the cohort detail page, always with a `cohortId`. There is no registered route for responses without a cohort, even though the component supports `cohortId` being absent (see User flows / Key logic).
- `useAuthContext()` is called (`LessonResponsesPage.tsx:50`) but its return value is unused — the component does no client-side role logic of its own; it relies entirely on the RoleGuard wrapper and on RLS.

## User flows

1. **Open responses for a lesson in a cohort.** Teacher navigates (from the cohort detail screen) to `/cohorts/:cohortId/lessons/:id/responses`. On mount, `fetchData()` runs (`LessonResponsesPage.tsx:64-205`). While loading, the page shows `Loading responses...` (`:335`).
2. **Data loads.** Five queries fire in parallel (`Promise.all`, `:67-73`): lesson, blocks, questions, student_questions, student_feedback. Then conditional follow-up queries: video transcripts, parish template, cohort members (only if `cohortId` present), answers, and profile name lookup.
3. **Review header.** Header shows lesson title, and `{uniqueStudents} students · {totalAnswers} answers` (`:354-356`). `uniqueStudents` is computed from distinct student *names* across all answers (`:339`), `totalAnswers` is the sum of all answers (`:338`).
4. **Review questions & answers.** Each question renders as a collapsible card (`:378-413`) prefixed `Q{position+1}: {prompt}`, with an answer-count badge. **All questions are expanded by default** (`:182`). Expanding shows each answer as a card with the student's display name and answer text. Empty per-question state: `No answers yet.` (`:398`).
5. **Review student questions.** If any exist, a "Student Questions ({n})" section lists them with attributed names (`:417-432`). If none, the whole section is omitted (not shown as empty).
6. **Review student feedback.** Same pattern as student questions (`:435-450`).
7. **Edit the agent prompt.** The "Agent Prompt" section (`:452-464`) renders `DiscussionTemplateEditor`. Default view shows the resolved template in a `<pre>` with a label: "Custom prompt for this lesson" vs "Using default prompt" (`:522-524`). Clicking **Customize** opens a 16-row textarea seeded with the resolved template (`:526`). **Save** writes `discussion_template` (trimmed; empty → `null`) to `lessons` (`:488-501`). **Cancel** discards. If a custom template is set, a **Reset to default** button writes `null` and reseeds the draft from the parish/system fallback (`:503-516`).
8. **Copy export.** Clicking **Copy Export** (`:358-373`) runs `generateExport()` (`:213-315`), writes the resulting Markdown to the clipboard via `navigator.clipboard.writeText`, and flips the button to "Copied!" for 2 seconds (`:317-322`).
9. **Error state.** If the lesson query errors (or returns no lesson), the page renders `{error ?? 'Lesson not found.'}` in red and stops (`:75-79`, `:336`). Errors on the *other* queries are silently ignored (they use `?? []` fallbacks); the page renders with whatever loaded.

## Data model

All tables live in the single Supabase Postgres DB. Tenancy root is `parishes` (under `dioceses`). RLS is keyed on `memberships` (user_id → parish_id → role). Tables this section reads/writes:

### `lessons` (read `.select`, write `.update`)
- `id uuid pk`, `parish_id uuid not null → parishes(id) on delete cascade`, `title text not null`, `description text`, `discussion_template text` (nullable; per-lesson agent prompt override), `visibility lesson_visibility ('parish'|'diocese') default 'parish'`, `source_lesson_id uuid → lessons(id)` (fork-and-edit lineage), `lesson_order int`, `created_by uuid → profiles(id)`, `published_at`, `created_at`, `updated_at` (auto via trigger).
- Page reads: `id, title, description, discussion_template, parish_id` (`:68`). Page writes: `discussion_template` only (`:493`, `:506`).
- **RLS:** select for any parish member; insert/update/delete require `admin`/`teacher` in `lessons.parish_id` (`initial.sql:405-422`). Ownership = parish.

### `blocks` (read)
- `id`, `lesson_id → lessons(id) on delete cascade`, `position int`, `type block_type ('video'|'reading')`, `content_json jsonb not null default '{}'`, plus Mux clip columns (`mux_clip_asset_id`, `mux_clip_playback_id`, `mux_clip_status`, `clip_start_ms`, `clip_end_ms` — added in `..._mux_video_columns.sql`).
- Page reads: `id, position, type, content_json` ordered by `position` (`:69`).
- `content_json` shape is **untyped jsonb**. The page treats reading blocks as `{ title?, markdown? }` and video blocks as `{ title?, videoId?, startMs?, endMs? }` (`:21-23`, `:252`). Note `videoId`/`startMs`/`endMs` live *inside* `content_json`, NOT in the dedicated `segments` table — this page does not touch `segments` at all.
- **RLS:** select/insert/update/delete gated via the parent lesson's parish (`initial.sql:440-471`).

### `videos` (read)
- `id`, `parish_id → parishes(id)`, `storage_path text`, `duration_ms int`, `transcript_text text`, `transcript_json jsonb` (array of `{ word, start, end }` with **seconds** timestamps), `uploaded_by`, plus Mux columns `mux_asset_id`, `mux_playback_id`, `mux_status`.
- Page reads: `id, transcript_text, transcript_json` for the set of `content_json.videoId`s found in video blocks (`:92-95`).
- **RLS:** select for parish members; insert/update for `admin`/`teacher` (`initial.sql:425-437`).

### `questions` (read)
- `id`, `lesson_id → lessons(id) on delete cascade`, `position int`, `prompt text`, `question_type question_type ('open_ended'|'multiple_choice') default 'open_ended'`, `choices jsonb` (array of `{ label, correct }`; null for open-ended, required for MC — CHECK constraint in `..._question_type.sql`), `expected_answer text` (nullable; `..._expected_answer.sql`), `created_at`. `UNIQUE(lesson_id, position)`.
- Page reads: `id, position, prompt, question_type, expected_answer` ordered by `position` (`:70`). Page does **not** read `choices`.
- **RLS:** select for parish members; write for `admin`/`teacher` via lesson parish (`initial.sql:511-542`).

### `answers` (read)
- `id`, `question_id → questions(id) on delete cascade`, `student_id → profiles(id) on delete cascade`, `text text not null`, `submitted_at timestamptz default now()`, `edited_at timestamptz`. `UNIQUE(question_id, student_id)` — **one answer per student per question** (upsert semantics on the student side; this page only reads).
- Page reads: `question_id, student_id, text, submitted_at` filtered `.in('question_id', qIds)` (`:133-136`).
- **RLS — the key bit:** a student may select only their own (`answers_select_own`, `student_id = auth.uid()`), but `admin`/`teacher` may select **all answers whose question's lesson is in their parish** (`answers_select_parish`, `initial.sql:555-562`). That parish-scoped teacher-read policy is what makes this whole page possible. Ownership: row owner = student; visibility broadened to parish teachers.

### `student_questions` (read)
- `id`, `lesson_id → lessons(id) on delete cascade`, `student_id → profiles(id)`, `text text`, `created_at`.
- Page reads: `id, text, student_id` `.eq('lesson_id', id)` (`:71`). No `.order()` — DB-default ordering.
- **RLS:** student inserts/sees own; `admin`/`teacher` see all for lessons in their parish (`initial.sql:565-577`).

### `student_feedback` (read)
- Identical shape/policies to `student_questions` (`id`, `lesson_id`, `student_id`, `text`, `created_at`; `initial.sql:200-208`, `:580-592`). Page reads `id, text, student_id` (`:72`).

### `profiles` (read, for names)
- `id uuid pk → auth.users(id)`, `display_name text not null`, `email text not null`, `avatar_url`, timestamps.
- Page reads `id, display_name` `.in('id', allStudentIds)` to build a name map (`:156-159`). Missing names fall back to `'Unknown'` (`:174`, `:190`, `:200`).
- **RLS:** own profile, plus teachers/admins can read profiles of users sharing a parish membership (`initial.sql:335-348`).

### `parishes` (read, for template fallback)
- `id`, `diocese_id → dioceses(id)`, `name`, `discussion_template text` (parish-level default agent prompt; `initial.sql:37-43`).
- Page reads `discussion_template` `.eq('id', lesson.parish_id).single()` (`:109-114`).
- **RLS:** select for members (`initial.sql:331-332`).

### `cohort_members` (read, only when `cohortId` present)
- `id`, `cohort_id → cohorts(id) on delete cascade`, `student_id → profiles(id)`, `joined_at`. `UNIQUE(cohort_id, student_id)`.
- Page reads `student_id` `.eq('cohort_id', cohortId)` to build a filter set (`:124-128`).
- **RLS:** select for parish members of the cohort's parish (`initial.sql:387-393`).

**Relationship summary:** `parishes 1—* lessons 1—* { blocks, questions, student_questions, student_feedback }`; `questions 1—* answers`; `answers.student_id / student_questions.student_id / student_feedback.student_id → profiles`; video blocks reference `videos` *by id embedded in `content_json`* (no FK). Cohort filtering joins via `cohort_members.student_id`.

## Key logic & algorithms

- **Parallel-then-dependent fetch.** Five base queries run via `Promise.all` (`LessonResponsesPage.tsx:67-73`); the dependent queries (transcripts, parish template, cohort members, answers, profiles) run sequentially after, because they need IDs from the first batch. Only the `lessons` query's error is checked; all others use `?? []`/`?? null` fallbacks.

- **Cohort filtering is applied client-side, not in SQL.** When `cohortId` is present, the page fetches the cohort's `student_id`s into a `Set` (`:122-129`) and then filters answers, student questions, and student feedback in JS:
  ```ts
  if (cohortStudentIds && !cohortStudentIds.has(a.student_id)) continue;   // answers, :140
  .filter((sq) => !cohortStudentIds || cohortStudentIds.has(sq.student_id)) // SQ, :186
  ```
  Answers/SQ/SF are fetched for the *whole lesson* (all cohorts/parish) and narrowed afterward. If `cohortId` is absent, no filtering happens and *all* parish-visible rows show.

- **Two-step name resolution.** There is no FK join in the queries; instead the page collects every `student_id` appearing in answers, student questions, and feedback into one `Set` (`:147-152`), does a single `profiles.in(...)` lookup (`:156-159`), builds `nameMap`, and stitches names in (`:174`, `:190`, `:200`). Unknown → `'Unknown'`.

- **`uniqueStudents` counts by display name, not id.** `new Set(questions.flatMap(q => q.answers.map(a => a.studentName)))` (`:339`). Two distinct students with the same display name collapse to one; all `'Unknown'`s collapse to one. This is a real (minor) miscount bug to preserve-or-fix on port.

- **Template resolution cascade.** `resolveDiscussionTemplate(lessonTemplate, parishTemplate)` (`discussion-template.ts:3-14`): returns lesson template if non-empty (after trim), else parish template if non-empty, else `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE` (`constants.ts:10-49`, the full Catholic OCIA discussion-guide prompt). "Is custom" = lesson template non-empty after trim (`:483`). Save trims and coerces empty → `null` (`:490`); reset writes `null` (`:506`).

- **Transcript segment extraction for the export.** For each video block the page slices the full word-timed transcript to the block's window (`:257-267`):
  ```ts
  const startSec = (vc.startMs ?? 0) / 1000;
  const endSec = (vc.endMs ?? Infinity) / 1000;
  const segmentWords = words
    .filter((w) => w.start >= startSec - 0.1 && w.end <= endSec + 0.1)
    .map((w) => w.word);
  ```
  Note the **±0.1s tolerance** and the unit mismatch: block `startMs/endMs` are **milliseconds**, transcript `start/end` are **seconds**. Missing `endMs` → `Infinity` (whole rest of transcript).

- **Export document assembly** (`generateExport`, `:213-315`) builds, in order: resolved template → `---` → `# title` + description → `## Lesson Material` (reading blocks with HTML stripped via `content.replace(/<[^>]*>/g, '')`, video blocks with extracted transcript) → `## Questions & Student Answers` (`### Q{position+1}: prompt`, optional `**Expected Answer:**`, then each `**name:** text`, or `*No answers submitted.*`) → optional `## Student Questions` → optional `## Student Feedback`. (Note: `packages/shared/src/export.ts::generateLessonExportMarkdown` is a *separate, segment-based* export used elsewhere — `WeeklyExportPage` — and is **not** used by this page, which inlines its own variant.)

- **Reading-block HTML stripping is naive** (`:243`): a single regex `replace(/<[^>]*>/g, '')`. It does not decode entities or preserve structure.

## External integrations

- **Mux (video) — indirect.** This page does not call Mux. It reads `transcript_json`/`transcript_text` off `videos`, which were populated upstream (upload/transcription pipeline). Video blocks carry Mux clip columns (`mux_clip_*`, `clip_start_ms/end_ms`) and `content_json.videoId/startMs/endMs`, but this page only uses them to slice transcript text for the export — no playback, no Mux API.
- **Whisper / transcription — indirect.** `videos.transcript_json` is an array of `{ word, start, end }` (word-level timestamps in seconds), the shape Whisper-style word timestamps produce. Generated elsewhere; consumed read-only here.
- **Clipboard (`navigator.clipboard.writeText`)** — the only "integration" the page itself calls (`:319`). It's the hand-off to an external LLM/agent (the teacher pastes the export elsewhere). There is **no** in-app AI/OpenAI call, no email, no ICS/calendar, no YouTube in this section.

## Edge cases & gotchas

- **RoleGuard is not tenant-scoped** (see Roles & access): role check is global across memberships; real isolation is RLS. A cross-parish URL yields "Lesson not found" via the failed `lessons` single-row query, not a guard redirect.
- **Q numbering is `position + 1`** in UI and export (`:278`, `:388`), but `position` is 0-based in `questions`. The unused `export.ts` uses raw `position`. Keep `+1` for parity with the live UI.
- **`uniqueStudents` collapses same-named / unknown students** (counts by name). Likely a bug; decide on port.
- **Unit mismatch ms vs s** in transcript slicing; the ±0.1s tolerance hides boundary rounding. Off-by-window risk if ported carelessly.
- **Cohort filter is post-fetch in JS** — for a large parish this over-fetches answers/SQ/SF then discards. Also means without a `cohortId` the page shows *all* parish rows (but no route exposes that case).
- **Only the lesson query's error surfaces.** Transcript/parish/answers/profiles failures are swallowed; the page renders partial data (e.g. all names "Unknown" if `profiles` is blocked).
- **One answer per (question, student)** — enforced by `UNIQUE(question_id, student_id)`; the page assumes at most one answer per student per question.
- **`expected_answer` and MC `choices` are not used for auto-grading.** `expected_answer` only appears as a line in the export; `choices` isn't read at all. No correctness scoring exists.
- **No realtime / no refetch** after saving the template beyond local `onUpdate` state; answers don't live-update if a student submits while the teacher views.
- **Reading HTML strip is lossy** (regex only).
- **Template Save/Reset failures are silent** — `if (!error)` guards the success path; on error the editor just stays open with no message (`:496-501`, `:510-516`).
- **Video transcript fetch only runs if at least one video block has a `content_json.videoId`** (`:86-90`); blocks lacking `videoId` contribute no transcript to the export.

## Acceptance criteria

- [ ] A user with an `admin` or `teacher` membership can load `/cohorts/:cohortId/lessons/:id/responses`; a `student` is redirected away from it.
- [ ] The header shows the lesson title and a summary line `{uniqueStudents} student(s) · {totalAnswers} answer(s)` with correct pluralization.
- [ ] Each question renders as `Q{position+1}: {prompt}` with an answer-count badge, and all questions are expanded by default on first load.
- [ ] Expanding a question with answers shows each answer with the answering student's display name; a question with no answers shows "No answers yet."
- [ ] Answers are attributed via a `profiles.display_name` lookup, and an answer whose student profile is missing renders as "Unknown".
- [ ] When `cohortId` is present, answers / student questions / student feedback from students NOT in that cohort are excluded from the view and export.
- [ ] When `cohortId` is absent (or no cohort filter applies), all parish-visible answers/questions/feedback for the lesson are shown.
- [ ] The "Student Questions" and "Student Feedback" sections are hidden entirely when there are zero rows, and show a count header when non-empty.
- [ ] Clicking "Copy Export" writes a Markdown document to the clipboard and the button shows "Copied!" for ~2 seconds, then reverts.
- [ ] The exported Markdown begins with the resolved discussion template, then `---`, the lesson title/description, `## Lesson Material`, `## Questions & Student Answers`, and (only if present) `## Student Questions` and `## Student Feedback`.
- [ ] In the export, a question with `expected_answer` set emits an `**Expected Answer:**` line; a question with no answers emits `*No answers submitted.*`.
- [ ] In the export, reading-block markdown has HTML tags stripped, and video-block transcript text is sliced to the block's `[startMs, endMs]` window (converting ms→s, ±0.1s tolerance, missing endMs = to end).
- [ ] `resolveDiscussionTemplate` returns the lesson template when non-empty, otherwise the parish template when non-empty, otherwise the system default — treating whitespace-only strings as empty.
- [ ] The editor label reads "Custom prompt for this lesson" when a non-empty lesson template exists and "Using default prompt" otherwise.
- [ ] Clicking "Customize" opens an editable textarea seeded with the resolved template; "Save" persists `discussion_template` (whitespace-only → null) and "Cancel" discards without persisting.
- [ ] "Reset to default" is shown only when a custom lesson template exists, and writes `discussion_template = null`.
- [ ] If the lesson fails to load, the page shows an error/"Lesson not found." message and does not render the question list.
- [ ] RLS: a teacher in parish A querying answers/questions for a parish-B lesson receives no rows (enforced by Postgres policy, not the route guard).

## Port notes

**Boundary mapping (per ParvaOrdo CLAUDE.md — logic in `packages/core`, thin callers everywhere else):**

- **`packages/core`** owns all of it:
  - A read function, e.g. `core/responses.getLessonResponses({ lessonId, cohortId? }, ctx)`, returning the fully-assembled view model (questions+answers+names, student questions, feedback, transcripts-for-export, resolved template, summary counts). This replaces the entire `fetchData` body. Move the cohort filter, the name-map stitch, the `uniqueStudents` count, and the transcript slicing into core (pure functions, unit-testable). Port `resolveDiscussionTemplate` and `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE` verbatim into core.
  - `core/responses.buildExportMarkdown(viewModel)` — pure function; port `generateExport`. Fix or consciously keep the `uniqueStudents`-by-name and ms/s nuances. Decide whether to reuse `core`'s existing lesson export instead of the inlined variant.
  - `core/lessons.setDiscussionTemplate(lessonId, value, ctx)` — the only mutation; trims, empty→null, returns updated lesson.
- **RSC read** (App Router page): the responses screen is a read surface → render as a React Server Component that calls `core.getLessonResponses` directly (direct DB read), per the "Reads → RSC" rule. No tRPC needed unless live updates are wanted.
- **Server Action**: the template Save/Reset is a mutation → one ~10-line Server Action: auth check → validate (zod: string|null) → `core.lessons.setDiscussionTemplate` → return. No business logic in the action.
- **Route handler / `/api/v1`**: not needed for this section (no external consumer). The clipboard export stays client-side (it's just `writeText` of a string the RSC/action produced).
- **`infra/workers`**: nothing here is out-of-band. Transcription/embeddings that *produce* `transcript_json` belong in workers, but that's the media module, not this section.

**RLS / tenancy:** keep the exact dual-policy on answers — student sees own; `admin`/`teacher` sees all answers whose question's lesson is in a parish where they hold that role. Same parish-scoped teacher-read on `student_questions`/`student_feedback`. In ParvaOrdo's Neon+RLS+WorkOS model, the membership/role lookup that Narthex did via `get_user_parish_ids`/`user_has_role` maps onto ParvaOrdo's tenancy hierarchy (diocese → parish → ministry → member); this section is **parish-scoped** (lessons belong to a parish). Honor lesson `visibility ('parish'|'diocese')` and `source_lesson_id` (fork lineage) if the responses view ever spans diocese-shared lessons — Narthex's queries assume a single parish lesson. **Fix the cross-tenant guard gap**: don't rely on a global role check like Narthex's `RoleGuard`; the RSC/Server Action must verify the caller's role *in the lesson's parish* (defense in depth on top of RLS).

**Mux → Bunny:** this section never calls Mux directly; it only reads `transcript_json`/`transcript_text` and `content_json.{videoId,startMs,endMs}`. On port, the transcript shape (`{ word, start, end }`, seconds) and the block window fields come from ParvaOrdo's media/asset manager. Map `videos.mux_*` columns onto Bunny asset identifiers; the responses export only needs the transcript words + the block's time window, so as long as the asset manager exposes word-timed transcripts, this code is integration-agnostic.

**Whisper → Groq:** same — transcript generation is upstream (Groq in ParvaOrdo, live per the media-module memory). This section is a pure consumer of the stored transcript JSON; no transcription call here.

**Explicit GAPS vs what ParvaOrdo has already built:**
- **Lessons with versioning** — ParvaOrdo already has versioned lessons. Narthex used flat `lessons` + `source_lesson_id` fork-and-edit + `visibility`. The responses view must resolve answers/questions against the *correct lesson version* a cohort was assigned; Narthex has no version concept, so define which version answers attach to.
- **Media/asset manager** — exists in ParvaOrdo (Slice 5: `assets` table + storage/transcription abstractions). Narthex stored `videoId/startMs/endMs` *inside `content_json`* (untyped jsonb) and ignored the `segments` table. On port, video blocks should reference the asset manager's typed assets/segments rather than embedding ids in jsonb.
- **Seek-enforcing player + transcript** — ParvaOrdo already has this. Narthex's responses page only *slices* transcript text for export; it has no player. No conflict, but the transcript-slice logic should source from the same transcript representation the player uses.
- **Teacher preview** — ParvaOrdo has a teacher-preview surface. Narthex's responses page is review-only and assumes real submitted answers; ensure preview/test answers (Narthex had `profiles.test_run_id`) are excluded from real responses, or the cohort filter handles it.
- **No grading primitives anywhere** — neither Narthex nor (per available docs) ParvaOrdo has scores/rubrics. If ParvaOrdo wants real grading, it's net-new: `expected_answer` and MC `choices.correct` exist in the data model but are unused for scoring. This doc documents the as-is "qualitative review + AI export" behavior; true grading is out of scope for a faithful port.
