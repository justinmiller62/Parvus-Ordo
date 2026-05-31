# Weekly Export

## Overview

The **Weekly Export** is a teacher-facing tool that assembles everything needed to prepare a single week's group discussion for a cohort, and renders it as one Markdown blob that the teacher copies (via the clipboard) into an external LLM (e.g. ChatGPT/Claude) to generate a discussion guide.

For a given `cohortId` and `weekNumber`, it walks every **learning path** in that cohort, finds the lesson assigned to that path for that week, and gathers:

- the lesson title + description,
- the lesson's **reading** content blocks (HTML-stripped to plain text),
- each question in the lesson together with the answers submitted **by students who are members of that path**,
- student-submitted questions for that lesson (path-filtered),
- student feedback for that lesson (path-filtered),

then prepends a **discussion-guide prompt template** (lesson override → parish override → system default) and concatenates the whole thing into a Markdown document. The output is shown as a live preview and exposed via a single "Copy Export" button. There is no server-side persistence — the export is computed client-side on every render and never written back to any table.

The point is to give the catechist a one-click bundle of "here is the material plus what the students actually said this week" formatted for an AI to turn into a 30-minute discussion plan (opening prayer, review, discussion questions, student questions, application, closing prayer — see the system default template).

Route: `cohorts/:cohortId/week/:weekNumber/export` (see `apps/web/src/App.tsx:118`). Reached from the cohort detail page's per-week rows (`apps/web/src/routes/teacher/CohortDetailPage.tsx:356` and `:506`).

## Roles & access

- The route is wrapped in `<RoleGuard allowedRoles={['admin', 'teacher']}>` (`apps/web/src/App.tsx:121`). `RoleGuard` (`apps/web/src/components/layout/RoleGuard.tsx:21`) checks the user's `memberships` from `AuthContext`; if none of the user's membership roles is in the allowed list it `<Navigate to="/" replace />`s away. So **students cannot reach this page**; only `admin` or `teacher` members can.
- Roles come from the `memberships` table (`role membership_role`, one row per user/parish/role). There is no per-cohort or per-path role — membership is parish-scoped.
- The page itself does **no additional parish/cohort ownership check in JS**; data isolation is enforced entirely by Supabase RLS (see Data model). A teacher of parish A who manually navigates to a cohort URL in parish B would simply get empty/blocked rows from RLS, not an error page.
- The sensitive reads (student answers, student questions, student feedback) are visible to this user only because of the `*_select_parish` RLS policies that grant read to `admin`/`teacher` members of the lesson's parish. A plain `student` role would be denied those reads even if they reached the page.

## User flows

1. **Open the export.** From the cohort detail page, the teacher clicks the per-week "export" link (`CohortDetailPage.tsx:356`/`:506`), navigating to `/cohorts/:cohortId/week/:weekNumber/export`. The page parses `weekNumber` with `parseInt(weekNumber ?? '1', 10)` (`WeeklyExportPage.tsx:22`).
2. **Loading.** While `loading` is true the page renders `Loading week export...` (`WeeklyExportPage.tsx:251`). `fetchData` runs on mount via `useEffect`/`useCallback` keyed on `[cohortId, week]` (`:158`,`:160`).
3. **Data assembly.** `fetchData` (`:30`) loads the cohort name + `parish_id`, resolves the discussion template, loads all learning paths for the cohort ordered by `created_at`, and for each path loads that path's week lesson + its blocks/questions/answers/student-questions/feedback (see Key logic).
4. **Header + summary.** Once loaded, the header shows `Week {week} Discussion Export`, the cohort name, the path count (`{n} path{s}`), and total answer count across all paths/questions (`:264`–`:267`).
5. **Per-path cards.** For each path, a card shows the lesson title (prefixed with the path name in rosegold **only when there is more than one path**, `:286`), and counts of content blocks / questions / answers (`:289`–`:293`).
6. **Preview.** A `<pre>` shows the full generated Markdown (`generateExport()`, `:300`–`:306`), scrollable, max height ~96 (`max-h-96`).
7. **Copy.** Clicking "Copy Export" calls `navigator.clipboard.writeText(generateExport())`, sets `copied=true`, and the button label/icon flips to "Copied!" for 2000ms before reverting (`:245`–`:249`,`:269`–`:274`).
8. **Back.** A "Back to Cohort" link returns to `/cohorts/${cohortId}` (`:257`).

Empty / error states:

- **Cohort not found / not readable** (`cohortData` falsy): `fetchData` sets `loading=false` and returns early (`:39`). `cohortName` stays `''`, `pathData` stays `[]` → renders the "No learning paths..." empty card (`:277`). There is **no distinct error UI** for a missing/forbidden cohort; it collapses into the empty state.
- **No learning paths** (`paths` empty): early return, empty state shown (`:57`).
- **No lesson assigned to this path/week** (`learning_path_lessons` row missing): that path is skipped via `continue` (`:71`); other paths still render.
- **Lesson row missing** (orphaned `lesson_id`): path skipped via `continue` (`:80`).
- **No paths produced any data** → `pathData.length === 0` → dashed empty card: `No learning paths have lessons assigned for week {week}.` (`:278`–`:279`).
- **Question with no answers**: renders `*No answers submitted.*` in the export (`:212`).
- **Student name not resolvable**: falls back to literal `Unknown` (`:145`,`:149`,`:152`).

## Data model

All reads go through the browser Supabase client (`apps/web/src/lib/supabase.ts`) as the authenticated user, so every query is subject to RLS. Tables touched (all defined in `supabase/migrations/20260422000000_initial.sql` except learning-path tables in `20260428000002_learning_paths.sql`):

- **`cohorts`** — `id`, `parish_id` (FK → `parishes`), `name`, `created_at`. Read: `name, parish_id` by `id` (`WeeklyExportPage.tsx:33`). Ownership: scoped to a parish via `parish_id`.
- **`parishes`** — `id`, `diocese_id` (FK → `dioceses`), `name`, `discussion_template` (nullable text), `created_at`. Read: `discussion_template` by `id` (`:42`). The parish-level discussion template fallback.
- **`learning_paths`** — `id`, `cohort_id` (FK → `cohorts`), `name`, `created_at`. Read: `id, name` where `cohort_id = cohortId`, ordered by `created_at` (`:51`). RLS: `learning_paths_select` allows SELECT to any authenticated user whose parish (via the cohort) is in `get_user_parish_ids(auth.uid())`.
- **`learning_path_lessons`** — `id`, `path_id` (FK → `learning_paths`), `lesson_id` (FK → `lessons`), `week_number` int. Uniques: `(path_id, lesson_id)` and `(path_id, week_number)` — so at most one lesson per path per week. Read: `lesson_id` where `path_id` + `week_number` via `.single()` (`:64`).
- **`learning_path_members`** — `id`, `path_id` (FK → `learning_paths`), `student_id` (FK → `profiles`). Unique `(path_id, student_id)`. Read: `student_id` where `path_id` (`:99`). Used to build the set of "students on this path" for answer/question/feedback filtering.
- **`lessons`** — `id`, `parish_id` (FK → `parishes`), `title`, `description` (nullable), `discussion_template` (nullable — note: this section reads the parish template, **not** the lesson's own `discussion_template`; see gotchas), `visibility` (`'parish'|'diocese'`), `source_lesson_id` (self-FK for fork lineage), `lesson_order`, `created_by`, `published_at`, timestamps. Read: `id, title, description` by `id` (`:74`). RLS `lessons` read is parish-scoped via `get_user_parish_ids`.
- **`blocks`** — `id`, `lesson_id` (FK → `lessons`), `position` int (unique per lesson), `type` (`block_type` = `'video'|'reading'`), `content_json` jsonb (default `{}`), `created_at`. Read: `type, content_json` where `lesson_id`, ordered by `position` (`:83`). For `reading` blocks, `content_json` has shape `{ title?: string, markdown?: string }` (confirmed in `LessonTimeline.tsx:108` and tests). The export reads `.title` and `.markdown` (`:138`–`:139`). RLS `blocks_select` parish-scoped via lesson.
- **`questions`** — `id`, `lesson_id` (FK → `lessons`), `position` int (unique per lesson), `prompt` text, `created_at`. Read: `id, prompt` where `lesson_id`, ordered by `position` (`:90`). RLS `questions_select` parish-scoped via lesson.
- **`answers`** — `id`, `question_id` (FK → `questions`), `student_id` (FK → `profiles`), `text`, `submitted_at`, `edited_at`. Unique `(question_id, student_id)` (one answer per student per question). Read: `question_id, student_id, text` where `question_id IN (qIds)` (`:109`), then filtered in JS to path members. **RLS-relevant ownership:** `answers_select_own` lets a student read their own; `answers_select_parish` lets `admin`/`teacher` of the lesson's parish read all answers for that lesson's questions — this is why the teacher can see them.
- **`student_questions`** — `id`, `lesson_id` (FK → `lessons`), `student_id` (FK → `profiles`), `text`, `created_at`. Read: `student_id, text` where `lesson_id` (`:118`). RLS: own + parish-teacher (`student_questions_select_parish`).
- **`student_feedback`** — `id`, `lesson_id` (FK → `lessons`), `student_id` (FK → `profiles`), `text`, `created_at`. Read: `student_id, text` where `lesson_id` (`:119`). RLS: own + parish-teacher (`student_feedback_select_parish`).
- **`profiles`** — `id` (= `auth.users.id`), `display_name`, `email`, `avatar_url`, timestamps. Read: `id, display_name` where `id IN (studentIds)` (`:125`). RLS: `profiles_select_authenticated` makes all profiles readable to any authenticated user (`20260428000003_profiles_read_all.sql`), in addition to own + parish policies.

Relationships exercised: `parish → cohort → learning_path → {learning_path_lessons → lesson → {blocks, questions → answers}, learning_path_members → profile}` plus `lesson → {student_questions, student_feedback} → profile`. Answers/student-questions/feedback are stored against the **lesson** (parish-wide), not against the path/cohort — so the path-membership filter in JS is essential to attribute responses to the right discussion group.

## Key logic & algorithms

- **Template resolution cascade.** `setDiscussionTemplate(resolveDiscussionTemplate(null, parish?.discussion_template ?? null))` (`WeeklyExportPage.tsx:48`). `resolveDiscussionTemplate` (`packages/shared/src/discussion-template.ts:3`) returns the lesson template if non-blank, else the parish template if non-blank, else `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE`. **The page passes `null` for the lesson template**, so today only parish-or-default is ever used, even though lessons have their own `discussion_template` column. Whitespace-only strings count as blank (`.trim().length > 0`).

- **Per-path loop is sequential and N+1-heavy.** For each path it issues ~6 separate awaited Supabase queries in series inside a `for...of` loop (`:62`–`:154`). Paths are processed in `created_at` order.

- **Path-scoped response filtering.** Answers are fetched lesson-wide (`.in('question_id', qIds)`, `:109`) then filtered client-side to `pathStudentIds` (`:113`):
  ```ts
  const pathStudentIds = new Set((pathMembers ?? []).map((m) => m.student_id));
  answers = (answerData ?? []).filter((a) => pathStudentIds.has(a.student_id));
  ```
  Same membership filter is applied to `student_questions` and `student_feedback` (`:120`–`:121`,`:148`,`:151`). This matters when two paths share a lesson: each path's card shows only that path's members' responses.

- **Name resolution.** Builds a `studentIds` set from answers + path-filtered SQ/SF, then one `profiles` lookup → `nameMap` (`:117`–`:130`). Missing → `'Unknown'`.

- **HTML stripping of reading content.** Reading-block content is rendered as plain text: `(block.content ?? '').replace(/<[^>]*>/g, '').trim()` (`:199`). The stored `markdown` field is actually rich-text/HTML; this regex strips tags. Only `type === 'reading'` blocks are emitted — **`video` blocks are silently omitted** from the export (`:197`).

- **Markdown assembly (`generateExport`, `:164`–`:243`).** Order: template → `---` → `# Week N Discussion — {cohort}` → optional multi-path note (only when `pathData.length > 1`, `:175`) → per path: optional `## Path: {name}` (multi-path only) → `### {lessonTitle}` → description → `#### Lesson Material` (reading blocks) → `#### Questions & Student Answers` (each `**Q: ...**` then bullet answers or `*No answers submitted.*`) → optional `#### Student Questions` → optional `#### Student Feedback`. Recomputed on every render (called both in the preview JSX and on copy).

- **Copy interaction.** `handleCopy` (`:245`) writes `generateExport()` to clipboard and shows a 2s "Copied!" confirmation.

## External integrations

- **Clipboard API** — `navigator.clipboard.writeText` (`WeeklyExportPage.tsx:246`). The only browser integration.
- **LLM (out-of-band, manual)** — the export's whole purpose is to be pasted into an external AI; the `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE` (`packages/shared/src/constants.ts:10`) is the system prompt. There is **no** in-app LLM call here.
- **No Mux / Whisper / OpenAI / ICS / email / YouTube** are used by this section. Video blocks (which elsewhere use Mux + transcription) are deliberately excluded from the export.

## Edge cases & gotchas

- **Lesson `discussion_template` is ignored.** The cascade is wired to ignore the per-lesson override because the page hard-codes `null` as the first arg (`:48`). If the port wants lesson-level templates to win, it must pass the lesson template — but note this page deals with up to N lessons (one per path), so "the lesson template" is ambiguous when multiple paths/lessons exist.
- **Per-week uniqueness vs. multiple paths.** `learning_path_lessons` is unique on `(path_id, week_number)`, so one lesson per path per week, but multiple paths can map different lessons to the same week — the export concatenates them and adds the multi-path "weave together themes" note (`:176`).
- **Answers fetched lesson-wide then JS-filtered.** A lesson shared across cohorts/paths returns all parish answers for that lesson's questions; correctness depends entirely on the `pathStudentIds` filter. A student who answered but is no longer a path member is dropped from this path's view (and not shown anywhere).
- **`studentIds` for name map omits students who only have answers but not SQ/SF, and vice versa** — actually it unions answers + path-filtered SQ/SF, but SQ/SF before filtering are added to `studentIds` only when `pathStudentIds.has` (`:120`–`:121`); a non-member's SQ/SF won't get a name (and is filtered out of output anyway).
- **N+1 query waterfall** (~1 + 1 + 1 + paths × ~6 sequential queries) — slow for cohorts with many paths; no batching, no pagination, no limit on answers/questions.
- **No ordering of answers** within a question (answers come back in arbitrary DB order; only questions and blocks are explicitly `.order(...)`).
- **Silent failures.** Every query ignores its `error`; a forbidden/failed read just yields empty arrays and degrades to the empty state — no error surfaced to the teacher.
- **HTML-strip is naive.** `replace(/<[^>]*>/g, '')` does not decode entities (`&amp;` stays) and would mangle literal `<`/`>` in prose; acceptable for the rich-text HTML it targets.
- **`weekNumber` not validated.** A non-numeric segment yields `NaN`→ defaults aside, `parseInt` of garbage is `NaN`, producing a query for `week_number = NaN` (no rows) → empty state.
- **Recompute on render.** `generateExport()` runs twice per render (preview + would-be copy) and on every state change; pure but unmemoized.

## Acceptance criteria

- [ ] A user whose memberships include neither `admin` nor `teacher` is redirected to `/` and cannot view the export page.
- [ ] An `admin` or `teacher` of the cohort's parish can load the page and see student answers, student questions, and feedback.
- [ ] For a cohort with one learning path, the export omits the `## Path:` heading and the multi-path "covers N learning paths" note.
- [ ] For a cohort with two or more paths, the export includes the multi-path note and a `## Path: {name}` heading per path, and each path's lesson card is prefixed with the path name.
- [ ] Each path shows the lesson assigned to it for the given `weekNumber` via `learning_path_lessons`, and at most one lesson per path per week is rendered.
- [ ] A path with no `learning_path_lessons` row for the week is skipped without breaking other paths' output.
- [ ] When no path has a lesson for the week, the page shows "No learning paths have lessons assigned for week {week}." and the copy/preview are hidden.
- [ ] Only `reading` blocks appear under "Lesson Material"; `video` blocks are excluded.
- [ ] Reading-block HTML tags are stripped so the preview shows plain text (e.g. `<p>Hi</p>` → `Hi`).
- [ ] Answers shown for a path include only answers authored by that path's members (`learning_path_members`), excluding members of other paths who answered the same lesson.
- [ ] Student questions and feedback are likewise filtered to the path's members.
- [ ] A question with zero (path-member) answers renders `*No answers submitted.*`.
- [ ] A student whose profile/display_name cannot be resolved renders as `Unknown`.
- [ ] The discussion template equals the parish's `discussion_template` when non-blank, otherwise the system default; a whitespace-only parish template falls back to the system default.
- [ ] The generated Markdown begins with the resolved template, then `---`, then `# Week {week} Discussion — {cohortName}`.
- [ ] The header answer count equals the sum of all path-member answers across all questions of all paths.
- [ ] Clicking "Copy Export" writes the exact `generateExport()` string to the clipboard and shows "Copied!" for ~2 seconds before reverting.
- [ ] Navigating with a cohortId the user cannot read (RLS-blocked) results in the empty state, not a crash or error page.

## Port notes

**Boundary placement (per CLAUDE.md §5).**

- **`packages/core`**: add a single read-only function, e.g. `buildWeeklyExport({ cohortId, week }, ctx)` returning a structured `WeeklyExport` object (`{ cohortName, template, paths: PathWeekData[] }`) — NOT a pre-rendered string. All the Supabase queries (`cohorts`, `parishes`, `learning_paths`, `learning_path_lessons`, `lessons`, `blocks`, `questions`, `answers`, `student_questions`, `student_feedback`, `profiles`) become Neon/Drizzle queries here, ideally collapsed from the current N+1 waterfall into a few set-based joins (one query per path-level table using `path_id IN (...)`, or a couple of joined queries for the whole cohort). The path-member filter becomes a SQL `JOIN`/`WHERE student_id IN (path members)` instead of JS `.filter`.
- **Markdown rendering (`generateExport`) and HTML-strip** are pure functions — put them in `packages/core` too (e.g. `renderWeeklyExportMarkdown(data)`), and reuse the existing `resolveDiscussionTemplate` logic (port `packages/shared/src/discussion-template.ts` + `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE` into core/constants). Keep them separately testable.
- **RSC read**: this is a pure read with a copy button, so render it as a Server Component that calls `core.buildWeeklyExport(...)` directly (Reads → RSC per CLAUDE.md), passing the resolved object to a tiny client component that owns the copy-to-clipboard `useState`. No Server Action and no `/api` route are needed for the in-app flow.
- **Route handler (`/api/v1`)**: only if an external consumer needs the export programmatically — then a thin REST handler returns `renderWeeklyExportMarkdown(core.buildWeeklyExport(...))`. Not required for parity.
- **infra/workers**: not needed — this is request-time, cheap, and synchronous. No queue/cron work.

**RLS / tenancy.** Replace the implicit Supabase RLS with the Parvus Ordo tenancy model (diocese → parish → cohort). `core` must enforce: (1) the caller is an `admin`/`teacher` member of the cohort's parish before returning any student responses; (2) all rows are scoped to that parish. The dangerous reads are student answers/questions/feedback — in Narthex these were gated by `*_select_parish` RLS for teachers and `*_select_own` for students; the port must reproduce the teacher-only-for-others'-data rule in core (or RLS) so students can never hit this path. Lessons carry `visibility` (`parish`/`diocese`) — when porting onto the three-tier lesson scope (global/diocese/parish), ensure a diocese- or global-scoped lesson used by a path still resolves its blocks/questions correctly while answers remain parish-scoped to the cohort.

**Media mapping.** Today the export deliberately ignores `video` blocks, so **no Mux→Bunny or Whisper→Groq work is required for parity**. If the port wants to enrich the export with video transcripts (a likely improvement), pull from the already-built media/asset manager: the seek-enforcing player stores Bunny video refs and Groq transcripts — `buildWeeklyExport` could include transcript excerpts for video blocks instead of dropping them. That is net-new, not a port requirement; flag it as an enhancement.

**Explicit GAPS vs. what Parvus Ordo already has:**

- **Lesson versioning**: Narthex points a path-week at a single `lesson_id` with no version pinning; answers attach to the live lesson's questions. Parvus Ordo lessons have versioning + fork-and-edit — decide whether the export pins to the lesson version a student actually answered, or always uses the latest. The Narthex code assumes "latest"; document the chosen semantics.
- **Media/asset manager + seek-enforcing player + transcript**: exist in Parvus Ordo; the Narthex export uses none of it (video blocks dropped). Gap = an opportunity, not a missing dependency.
- **Teacher preview**: Parvus Ordo already has teacher preview of lessons; the export's per-path "card + preview" UI overlaps conceptually but is distinct (it previews the *AI prompt bundle*, not the lesson). Reuse layout primitives, not logic.
- **Learning paths**: confirm Parvus Ordo has an equivalent of `learning_paths`/`learning_path_members`/`learning_path_lessons`. If the new tenancy model doesn't yet model "paths within a cohort," this is a prerequisite table set the export depends on — flag as a blocking gap.
- **Per-lesson `discussion_template`**: Narthex ignores it (passes `null`). The port should consciously decide whether to honor lesson-level templates; if multiple paths/lessons exist in one week, define which lesson's template wins (recommend: keep parish-level, since the export spans multiple lessons).
