# Student Lesson View (wizard, gating, progress, dictionary, video)

> Source of truth for the port: Narthex `apps/web/src/routes/student/LessonViewPage.tsx` (1314 lines) plus the video players, dictionary modal, and `lib/` helpers it imports. All `path:line` references below are relative to the Narthex repo root (`/Users/justinmiller/Desktop/Development/repositories/Narthex`).

## Overview

This is the single page a **student** uses to actually *take* a lesson. It renders a lesson as a one-item-at-a-time **wizard**: every reading block, video block, and question is flattened into a single ordered timeline, and the student walks through it step by step with a progress bar (`Step N / M`).

Why it exists / what it does:

- **Sequential consumption with gating.** A student cannot skip ahead. Video blocks must be watched (the player enforces no-seeking-past-furthest-reached); questions must be answered before *Continue* unlocks. Reading blocks are free to pass but are recorded as "read".
- **Resume.** On load it computes the first incomplete step and jumps there, using previously-saved progress (answers, completed video watches, reading-complete events).
- **Cohort sequential lock.** If the student's cohort is in `sequential` mode, a lesson is hard-locked until the *previous scheduled lesson* is marked complete — enforced even against direct URL navigation.
- **Inline dictionary.** Catholic dictionary terms inside reading HTML and inside video transcripts are auto-highlighted (first occurrence only) and clickable, opening a modal with definition, Greek/Hebrew, first-century context, references, and parish-specific overrides.
- **Synced transcript video.** Video blocks show a word-level transcript synced to playback; the active word highlights and auto-scrolls; clicking a word seeks (once the video is watched).
- **Engagement telemetry.** Fires fire-and-forget analytics events (`lesson_start`, `step_enter`/`step_exit` with dwell time, `answer_submit` with correctness + time-to-answer, `reading_complete`, `lesson_complete`).
- **Three modes** of the same component: normal student mode, teacher **preview** (`?preview=true`, no saves, no gating, jump-to dropdown, shows expected answers), and **review** (`?review=true`, read-only list of the student's answers for discussion prep).
- **Final feedback step** (one extra step after the timeline): "Lesson Complete" plus optional "ask your teacher a question" and "leave feedback" forms.

## Roles & access

- **Primary user: `student`.** Normal wizard behavior with gating, saving, telemetry, and the sequential cohort lock.
- **`teacher` / `admin` (parish) via preview:** `?preview=true` is honored only when `isTeacherOrAdmin()` is true (`LessonViewPage.tsx:59`). Preview disables all gating (`canAdvance` returns `true`), saves nothing, skips telemetry/cohort/lock logic, shows expected answers, and exposes a jump-to-step dropdown.
- **Review mode (`?review=true`)** is available to anyone who reaches it (`LessonViewPage.tsx:60`); it lists the student's own saved answers. It also skips telemetry and the lock.
- **Roles in this app are membership-based**, not a single profile role. `useAuth` resolves `memberships` (rows in `memberships` with role `admin|teacher|student`); `isTeacherOrAdmin()` = has `admin` or `teacher` membership (`hooks/useAuth.ts:156-158`). Super-admins can impersonate a parish via a session-stored `parishOverride` that injects a synthetic `admin` membership (`hooks/useAuth.ts:140-167`).
- **DB-level access** is enforced by Supabase RLS (see Data model). A student can only read lessons/blocks/questions in a parish they belong to, and can only read/write *their own* `answers`, `video_watches`, `engagement_events`, `student_questions`, `student_feedback`.

## User flows

### 1. Normal student walkthrough
1. Student navigates to `/lessons/:id` (route param `id`, `LessonViewPage.tsx:55`).
2. `fetchLesson` runs six parallel queries (`LessonViewPage.tsx:99-106`): lesson, blocks, questions, the student's answers, the student's video_watches, and prior `reading_complete` engagement events.
3. If the lesson query errors or returns null → render error/`Lesson not found.` (`:498-500`).
4. Blocks + questions are merged into one `TimelineItem[]` and **sorted by `position`** (`:118-123`). Note: blocks and questions share one `position` number space.
5. Saved state is hydrated: answer drafts, completed videos (only `completed = true` count as watched), per-video `max_reached`, and read reading-blocks.
6. **Resume:** walk the timeline; stop at the first item that's a question without an answer, a video not in the completed set, or a reading block without a `reading_complete` event; resume `step` = that index (`:157-172`).
7. Cohort + sequential-lock resolution runs (see flow 4). Dictionary entries load. `setLoading(false)`. `lesson_start` fires once (`:251-260`).
8. Student reads/watches/answers the current step. **Continue** is disabled until `canAdvance()` passes (`:397-407`).
9. On **Continue** (`handleNext`, `:409-450`): if current is a question, save the answer (insert or update) before advancing; if current is a reading block not yet recorded, mark it read + fire `reading_complete`; then `step++` (capped at `totalSteps-1`).
10. After the last content step, the **feedback step** renders (`isFeedbackStep`, `:380`); `lesson_complete` fires once (`:384-395`).
11. Student optionally sends a question and/or feedback, then **Return to My Lessons** (`navigate('/my-lessons')`).

### 2. Answering a question
- Open-ended → `<textarea>`; multiple-choice → radio list of `choices[].label` (`QuestionView`, `:768-857`).
- *Submit & Continue* (button label switches when no saved answer yet, `:694-701`) trims the draft; empty drafts are rejected (`:421-423`). Save is skipped if unchanged (`:425-429`).
- On successful save, `answer_submit` fires with `time_to_answer_ms`; for MC it also computes `answer_correct` by comparing the chosen label to the `correct` choice (`:354-358`).
- "Answer saved" confirmation shows when a saved answer exists (`:828-833`).

### 3. Watching a video block (`VideoBlockView`, `:976`)
1. Block content JSON carries `{ videoId, startMs, endMs, title }`. The component fetches the `videos` row (`storage_path, transcript_json, mux_playback_id, mux_status`, `:1066-1071`).
2. **Four-tier source priority** (`:1141-1198`):
   - **YouTube** if `storage_path` starts with `youtube://` → embedded iframe with `?start=&end=`; "watched" is faked by a `setTimeout` of the segment duration on iframe load (`:1149-1154`).
   - **Mux clip** if `block.mux_clip_*` is `ready` and the trim matches the block's start/end → `MuxClipPlayer` (scrubber shows only the clip; transcript rebased to 0).
   - **Mux source HLS** if the source video has `mux_playback_id` + `mux_status='ready'` → `SegmentPlayer` over `https://stream.mux.com/{id}.m3u8` with segment enforcement.
   - **Supabase signed URL** fallback (`videos` storage bucket, 1-hour signed URL) → `SegmentPlayer`.
   - Else "Loading video..." placeholder.
3. The player enforces no-skip-ahead until the segment is finished (see Key logic). Progress (`max_reached`) is saved every 10s and on unmount; completion upserts `completed = true`.
4. Below the video, the synced transcript renders; words highlight as they're spoken, auto-scroll within the transcript container, and are clickable to seek (only once `watched`). Dictionary words in the transcript are underlined and clickable to open the modal.
5. An optional "Dictionary terms in this segment (N)" collapsible chip list appears.

### 4. Cohort sequential lock (`:174-237`)
1. Skipped entirely in preview/review.
2. Resolve the student's cohort from `cohort_members` (first row). If none, no lock.
3. Read `cohorts.sequential`. If false, no lock.
4. Read `cohort_schedule` ordered by `discussion_date`. Find this lesson's entry.
5. If this entry has `skip_sequence = true`, never locked.
6. Otherwise find the previous *non-skip* scheduled lesson; check for a `lesson_complete` engagement event for it. If absent → `setSequentialLocked(true)` and render the **lock screen** (`:503-520`) with a "Back to My Lessons" button. This blocks even direct URL access.

### 5. Empty / error states
- Lesson load error or missing lesson → red error text (`:498-500`).
- Locked → lock card (`:503-520`).
- No blocks/questions → timeline length 0; `totalSteps = 1`; student lands directly on the feedback step.
- Review mode with no answers → each question shows italic "No answer submitted" (`:550-552`).
- Video still loading / no playable source → "Loading video..." box; Continue stays disabled (video not watched).
- Dictionary entry not found in modal → "Entry not found for "{headword}"" (`DictionaryEntryModal.tsx:99-108`).

## Data model

All tables are Supabase Postgres with RLS enabled. Tables this section reads/writes:

### `lessons` — read (`select id, title, description ... .single()`)
- `id uuid pk`, `parish_id uuid` (tenant owner), `title text`, `description text`, `discussion_template text`, `visibility lesson_visibility ('parish'|'diocese')`, `source_lesson_id uuid` (fork origin), `lesson_order int`, `created_by`, `published_at`, timestamps.
- RLS: `lessons_select` — readable by any member of `parish_id` (`get_user_parish_ids`). Writes restricted to admin/teacher. (initial migration `:404-422`)

### `blocks` — read (`select id, position, type, content_json, mux_clip_playback_id, mux_clip_status, clip_start_ms, clip_end_ms`)
- `id`, `lesson_id` (owner via lesson→parish), `position int` (unique per lesson), `type block_type ('video'|'reading')`, `content_json jsonb` (`{ title?, markdown? }` for reading; `{ title?, videoId?, startMs?, endMs? }` for video).
- Mux columns (migration `20260430000000_mux_video_columns.sql`): `mux_clip_asset_id`, `mux_clip_playback_id`, `mux_clip_status`, `clip_start_ms int`, `clip_end_ms int`.
- RLS: `blocks_select` — readable if the parent lesson is in the user's parishes.

### `questions` — read (`select id, position, prompt, question_type, choices, expected_answer`)
- `id`, `lesson_id`, `position int` (unique per lesson, **shared position space with blocks at render time**), `prompt text`, `question_type ('open_ended'|'multiple_choice')`, `choices jsonb` (array of `{ label, correct }`; null for open-ended; check constraint enforces presence for MC), `expected_answer text` (migration `20260429000000`).
- RLS: `questions_select` — readable by parish members.

### `answers` — read all-by-student, insert, update
- `id`, `question_id` (cascade), `student_id` (the owner), `text`, `submitted_at`, `edited_at`, `UNIQUE(question_id, student_id)`.
- Read filtered client-side to this lesson's question IDs (`:126-131`).
- RLS: `answers_select_own` / `answers_insert` / `answers_update` use `student_id = auth.uid()`; admin/teacher can read all in parish via `answers_select_parish`. **Ownership = `student_id`.**

### `video_watches` — read, upsert (insert + update), `onConflict: 'student_id,block_id'`
- `id`, `student_id` (owner), `block_id`, `watched_at`, `max_reached real default 0` (relative seconds), `completed boolean default false`.
- `UNIQUE(student_id, block_id)`. Only `completed = true` rows count as "watched" (`:142-144`). `max_reached` powers resume + seek enforcement.
- RLS: select/insert/update all gated on `student_id = auth.uid()` (migrations `20260423000003`, `20260513000002`). **Ownership = `student_id`.**

### `engagement_events` — read (reading_complete + lesson_complete checks), insert (telemetry)
- `id`, `student_id` (owner), `lesson_id`, `event_type text`, `step_index int`, `step_kind text`, `block_id uuid`, `question_id uuid`, `cohort_id uuid`, `metadata jsonb`, `created_at`.
- Event types used here: `lesson_start`, `step_enter`, `step_exit` (`metadata.duration_ms`), `answer_submit` (`time_to_answer_ms`, `answer_correct`), `reading_complete`, `lesson_complete`.
- RLS: `engagement_insert_own` (`auth.uid() = student_id`); teachers/admins read for their parish's lessons. **Ownership = `student_id`.** (Note: the RLS policy text references a `memberships ... role IN ('admin','teacher')` subquery.)

### `cohort_members` — read (`select cohort_id where student_id = me`)
- `id`, `cohort_id`, `student_id`, `joined_at`, `UNIQUE(cohort_id, student_id)`. Used to resolve the student's cohort (first row).

### `cohorts` — read (`select sequential where id = cohortId`)
- `id`, `parish_id`, `name`, `sequential boolean default true` (migration `20260502000000`).

### `cohort_schedule` — read (`select lesson_id, skip_sequence order by discussion_date`)
- `id`, `cohort_id`, `lesson_id`, `release_date`, `due_date`, `discussion_date date`, `discussion_location`, `skip_sequence boolean default false` (migration `20260502000005`), `UNIQUE(cohort_id, lesson_id)`.

### `videos` — read (`select storage_path, transcript_json, mux_playback_id, mux_status`)
- `id`, `parish_id`, `storage_path text` (may be `youtube://<id>` or a Supabase storage key), `duration_ms`, `transcript_text`, `transcript_json jsonb` (array of `{ word, start, end }`), `mux_asset_id`, `mux_playback_id`, `mux_status`, `uploaded_by`.

### `dictionary_entries` — read (`select headword, variants where status='approved'`; modal: `select * ilike headword`)
- `id`, `headword text unique`, `variants text[]`, `pronunciation`, `definition text`, `greek_word`, `greek_definition`, `hebrew_word`, `hebrew_definition`, `first_century_context`, `catechism_references text[]`, `scripture_references text[]`, `category text`, `status text default 'approved'`.
- **Global table — NOT parish-scoped.** RLS `dictionary_entries_read`: any authenticated user can read `status = 'approved'`.

### `dictionary_overrides` — read in modal (`select field_name, override_value, notes where entry_id=? and parish_id=?`)
- Parish-scoped per-entry override. `UNIQUE(parish_id, entry_id)`. RLS read = parish members; manage = admin/teacher.
- ⚠️ **Schema mismatch (real bug to fix on port):** the modal queries columns **`field_name`, `override_value`, `notes`** (`DictionaryEntryModal.tsx:62`), but the migration `20260501000002_dictionary.sql` defines the table with columns `override_definition`, `override_greek_definition`, `override_hebrew_definition`, `override_first_century_context`, `override_notes` (a one-row-per-entry shape, not field/value rows). The legacy override query is therefore broken against the migrated schema. Decide the correct shape during the port (see Port notes).

### `student_questions` — insert
- `id`, `lesson_id`, `student_id` (owner), `text`, `created_at`. RLS: insert own; read own or parish admin/teacher.

### `student_feedback` — insert
- Same shape and RLS as `student_questions`.

### Storage
- Supabase `videos` bucket (private). Signed URLs created client-side with `supabase.storage.from('videos').createSignedUrl(path, 3600)`. Storage RLS keys off the parish-id folder prefix.

## Key logic & algorithms

### Timeline flattening + shared position space
Blocks and questions are independently fetched, mapped to a discriminated union, then merged and sorted by a single `position` field (`LessonViewPage.tsx:118-123`):
```ts
const items: TimelineItem[] = [
  ...blocks.map((b) => ({ kind: 'block' as const, data: b })),
  ...questions.map((q) => ({ kind: 'question' as const, data: q })),
];
items.sort((a, b) => a.data.position - b.data.position);
```
`totalSteps = timeline.length + 1` (the +1 is the feedback step, `:378`).

### Resume-at-first-incomplete (`:157-172`)
Walks items in order; breaks at the first incomplete item (unanswered question, uncompleted video, unread reading), setting `resumeStep` to its index.

### Advance gating (`canAdvance`, `:397-407`)
- Preview → always true.
- Reading → always true (passing it counts as reading).
- Video → `watchedVideos.has(blockId)`.
- Question → answer exists OR a non-empty draft exists.

### Video seek enforcement (`SegmentPlayer.tsx:135-191`, `MuxClipPlayer.tsx:129-173`)
Until `watched`, on every `timeupdate`/`seeking`/`seeked`, if the relative position exceeds `maxReached + 2s` the player snaps back to `maxReached`:
```ts
if (!watchedRef.current && relative > maxReachedRef.current + 2) {
  video.currentTime = startSec + maxReachedRef.current;
  return;
}
```
- "Watched" fires when within the **last 5 seconds** of the segment (checked on every tick for resilience, `SegmentPlayer.tsx:167-169`).
- `SegmentPlayer` also clamps to `[startSec, endSec]`: pauses at `endSec` and resets to `endSec - 0.1`; snaps back up to `startSec` if before start (`:173-180`).
- Resume: on `loadedmetadata`, position = `startSec + maxReached` (`SegmentPlayer.tsx:118`; MuxClipPlayer uses bare `maxReached` since the clip is already trimmed).
- Test mode forces `playbackRate = 16` (`SegmentPlayer.tsx:127-133`).

### Progress persistence (`VideoBlockView`, `:1022-1049`)
- Throttled save: when `maxReached - lastSaved >= 10`, upsert `max_reached` (`:1023-1031`).
- Unmount save: if `maxReachedRef > lastSavedRef`, upsert on cleanup (`:1034-1049`).
- Completion: `onWatched` upserts `completed: true` and adds the block to the watched set (`:651-662`).

### Transcript clipping + rebasing (`:1088-1103`)
Words are filtered to `[startSec - 0.1, endSec + 0.1]`. For Mux clips (only the clip plays), timestamps are rebased to 0 by subtracting `startSec`.

### Dictionary matching (`lib/dictionary.ts`)
- `normalizeWord` lowercases and strips leading/trailing punctuation (incl. smart quotes).
- `buildDictIndex` builds a longest-phrase-first index of headwords + variants, with the set of possible first words and a max phrase length, enabling greedy multi-word matching ("Holy Spirit" before "spirit") (`dictionary.ts:32-63`).
- `matchPhraseAt` checks whether the word list starting at `idx` matches any phrase, longest first (`:87-118`).
- **First-occurrence-only highlighting**: `highlightDictionaryWords` walks HTML text nodes and wraps matched words in `<span class="dictionary-word" data-headword=...>`, highlighting only the first occurrence of each headword (`:144-235`). Transcript highlighting does the same with a `seenHeadwords` set (`:1209-1230`).
- Reading-block click handler reads `target.dataset.headword` to open the modal (`:740-747`).

### Sacred-text normalization (`lib/sacred-text.ts`)
Regex-based capitalization of divine names, sacraments, liturgical terms, etc., applied to reading HTML (`normalizeSacredHtml`, text nodes only) and transcript/dictionary text (`normalizeSacredText`). Longest phrases listed first.

### Engagement telemetry (`lib/engagement.ts`)
Fire-and-forget insert into `engagement_events`. In test mode, only `reading_complete` and `lesson_complete` are sent (the rest are suppressed) because those two drive resume/lock logic. `step_enter`/`step_exit` are paired in a `useEffect` cleanup to measure dwell time (`LessonViewPage.tsx:267-308`).

### Dictionary modal override resolution (`DictionaryEntryModal.tsx:78-86`)
`getField(name, fallback)` returns the parish override value if present, else the global entry value; `getOverrideNote` surfaces a "(parish note)" annotation. Lookup is `ilike` on headword (case-insensitive) `.single()`.

## External integrations

- **Mux (video).** Two paths: pre-cut **Mux clips** (`block.mux_clip_playback_id`, gated on `mux_clip_status='ready'` AND the clip trim matching the block's `startMs/endMs`) and **Mux source HLS** (`videos.mux_playback_id` + `mux_status='ready'`) streamed via `https://stream.mux.com/{playbackId}.m3u8` using `hls.js`. **Mux Data** monitoring is attached when `VITE_MUX_DATA_ENV_KEY` is set and the source is a Mux URL, tagging `viewer_user_id=studentId`, `video_id=blockId`, `custom_1=lessonId`, `custom_2=cohortId` (`SegmentPlayer.tsx:84-101`, `MuxClipPlayer.tsx:76-93`).
- **YouTube.** `storage_path` of form `youtube://<id>` → embedded iframe with `start`/`end` query params; no seek enforcement (cannot inspect playback), so "watched" is faked via a `setTimeout` of the segment duration (`:1149-1154`).
- **Supabase Storage.** Fallback playback via 1-hour signed URLs from the private `videos` bucket.
- **Whisper / transcription.** Not called here directly — this view *consumes* `videos.transcript_json` (a `[{ word, start, end }]` array) produced elsewhere (upload/transcription pipeline). Word-level timestamps are required for the synced transcript.
- **No ICS/ical, email, or calendar** integration in this section.

## Edge cases & gotchas

- **Shared position space.** Blocks and questions are sorted into one timeline by `position`; if a block and a question collide on the same `position`, sort order is unstable. Port should give each timeline item a single global ordering key.
- **Only `completed = true` counts as watched** (`:142-144`); in-progress `video_watches` rows (with `max_reached` but `completed=false`) do *not* satisfy gating — they only drive resume position. Pre-`20260513000003` rows were backfilled `completed=true` where `max_reached=0`.
- **`cohortId` race in `lesson_start`.** `lesson_start` reads `cohortId` from React state, but `setCohortId` was just queued in the same async pass — so the first event often fires with `cohortId = undefined` (`:251-260` vs `:181`). Carry forward as a known quirk or fix by using the local variable.
- **Seek-enforcement +2s grace.** Students can nudge ~2s ahead before being snapped back; "watched" triggers in the last 5s, so the final ~5s need not actually be viewed.
- **YouTube "watched" is time-based, not view-based** — closing/backgrounding the tab still lets the timer complete; trivially bypassable.
- **Sequential lock uses the first cohort only** (`cohortData[0]`); students in multiple cohorts get nondeterministic lock behavior.
- **Lock requires a `lesson_complete` event for the previous lesson** — a student who completed a lesson before telemetry existed (or with telemetry suppressed) could be wrongly locked.
- **Test mode suppresses most telemetry** but deliberately keeps `reading_complete`/`lesson_complete` so resume and lock still work in E2E.
- **`dictionary_overrides` query is broken** against the migrated schema (field/value vs per-column) — see Data model. Overrides currently silently fail.
- **Reading-complete is only recorded on *forward* navigation** past the block (`handleNext`, `:433-447`); jumping backward and forward again won't double-fire (guarded by the `readBlocks` set).
- **Answer save-on-continue only persists if changed** (`:425-429`); editing then navigating back without continuing does not persist the edit.
- **`highlightDictionaryWords` / transcript matching run on the client** and use `document` / `DOM TreeWalker` — they are not SSR-safe as written.
- **Dictionary `.single()`** in the modal will error if two entries share a headword case-insensitively (headword is unique but `ilike` could match a variant collision in theory).
- **Progress is saved on unmount** via a cleanup closure capturing refs — relies on the unmount actually firing (won't fire on a hard tab close mid-segment beyond the last 10s throttle).

## Acceptance criteria

- [ ] A lesson with N reading/video/question items renders a wizard reporting `Step 1 / N+1`, with the extra final step being the feedback/completion screen.
- [ ] Reading, video, and question items are interleaved in ascending `position` order in a single timeline.
- [ ] On load, the wizard resumes at the first item that is an unanswered question, an uncompleted video, or an unread reading block.
- [ ] *Continue* is disabled on a video step until the video is marked watched, and disabled on a question step until an answer/non-empty draft exists; reading steps can always advance.
- [ ] Submitting an open-ended answer inserts a row into `answers` with `student_id = current user`; re-submitting an edited answer updates the same row and sets `edited_at`.
- [ ] A multiple-choice answer records `answer_correct` in the `answer_submit` engagement event by comparing the chosen label to the `correct` choice.
- [ ] A video player prevents seeking more than ~2s beyond the furthest watched point until the segment completes, then allows free seeking and click-to-seek on transcript words.
- [ ] Video "watched" fires when playback reaches within 5 seconds of the segment end, and upserts `video_watches` with `completed = true`.
- [ ] Video `max_reached` is upserted after ~10s of new progress and again on unmount, and is used as the resume position on reload.
- [ ] Passing a reading block forward inserts exactly one `reading_complete` engagement event for that block (idempotent on repeat passes).
- [ ] Reaching the feedback step fires exactly one `lesson_complete` engagement event.
- [ ] In a `sequential` cohort, opening a non-`skip_sequence` lesson whose previous scheduled lesson has no `lesson_complete` event renders the lock screen and blocks the wizard, even via direct URL.
- [ ] A lesson whose `cohort_schedule` entry has `skip_sequence = true` is never locked.
- [ ] Dictionary headwords/variants in reading HTML and in the video transcript are highlighted only on first occurrence and open the entry modal on click.
- [ ] The dictionary modal shows the parish override value (when one exists) in place of the global field, with a "(parish note)" annotation.
- [ ] Preview mode (`?preview=true` for teacher/admin) disables gating, saves nothing, shows expected answers, and exposes a jump-to-step dropdown.
- [ ] Review mode (`?review=true`) lists every question with the student's saved answer or "No answer submitted", and writes nothing.
- [ ] Submitting the final "ask a question" form inserts a `student_questions` row; submitting feedback inserts a `student_feedback` row; both show a transient "Sent!" confirmation.
- [ ] A lesson that fails to load (or doesn't exist) renders an error state instead of the wizard.
- [ ] Multi-word dictionary phrases ("Holy Spirit") match before their single-word substrings ("spirit").

## Port notes

Mapping to the Parvus Ordo stack (`packages/core` backend boundary, Next 16 App Router, Neon + RLS, WorkOS, Bunny, Groq). Parvus Ordo has **already built** the editor-side and several primitives — this section is the **student-facing consumption** side that's still missing.

### What Parvus Ordo already has (reuse, don't rebuild)
- **Lesson versioning** (`infra/db/migrations/0006_lesson_versions.sql`): `lessons` → `lesson_versions` (history; `live_version_id` is what students see; at most one draft) → `lesson_items` (per version). Scope is `content_scope ('global'|'diocese'|'parish')`.
- **Unified `lesson_items`** (`0003_ocia_core.sql`): one table for reading/video/question, content in JSONB — replaces Narthex's split `blocks` + `questions`. Question content = `{ prompt, format: 'open_ended'|'multiple_choice', choices?, expected_answer? }`; video content = `{ asset_id, start_ms, end_ms }`. **This already solves the "shared position space" gotcha** — one ordered table.
- **`lesson_item_progress`** (`0004_lesson_progress.sql`): per-student, per-item `completed` + `max_reached_ms`, parish-scoped with RLS isolation via `app.parish_id`. **Generalizes Narthex `video_watches` to all item kinds** — use it for reading-read, video-watched, and question-answered gating/resume.
- **Seek-enforcing player + transcript** (`apps/web/src/components/ocia/video-player.tsx`): a faithful port of `SegmentPlayer` with the +2s no-skip rule, last-5s "watched", clip clamping, transcript click-to-seek, and an `unlocked` prop for teacher preview. Transcript words are clipped server-side. **Reuse this for the student view.**
- **Teacher preview + jump-to** (`components/ocia/preview-nav.tsx`, `?preview=1&step=&v=`): already implemented for the editor preview.
- **Media/asset manager** (`packages/core/src/media/*`, `0007_assets.sql`): `assets` table; `lesson_items.content (video) = { asset_id, start_ms, end_ms }`; Bunny storage + Groq transcription abstractions (Groq live, Bunny stubbed).

### What goes where (boundary discipline, CLAUDE.md §5)
- **`packages/core` (the backend):**
  - `getLessonForStudent(lessonId, ctx)` → live version + ordered `lesson_items` + the student's `lesson_item_progress`, computing the resume index. (Pure read; mirrors `fetchLesson`.)
  - `saveAnswer`, `markVideoProgress` (throttled `max_reached_ms`), `markItemComplete` (reading/video/question), `submitStudentQuestion`, `submitStudentFeedback` — all validators + DB access live here.
  - `checkSequentialLock(lessonId, studentId, ctx)` → reproduces the cohort/`sequential`/`skip_sequence`/previous-lesson-complete logic against the cohort schedule.
  - Dictionary matching/normalization helpers (`buildDictIndex`, `matchPhraseAt`, `normalizeWord`, sacred-text) move to `core` as pure functions (no DOM). The DOM-walking `highlightDictionaryWords` should be reworked into a pure tokenizer that returns match ranges; the React layer renders spans (keeps it SSR-safe).
  - `getDictionaryEntry(headword, parishId)` resolving parish overrides.
- **RSC reads:** the student lesson page is an RSC that calls `core` directly to render the wizard shell, current item, transcript words (clipped + dictionary-tokenized server-side), and resume step. Per Architecture, reads → RSC (direct DB).
- **Server Actions (≤~10 lines each):** answer save, video progress upsert, item-complete, student question, student feedback. Each: auth check → validate → call `core` → return.
- **tRPC (optional):** only if the wizard needs client-reactive partial updates (e.g., live save state). Otherwise Server Actions suffice.
- **route handlers / `/api/v1`:** not needed for the student UI; only if an external consumer reads progress.
- **infra/workers:** transcription (Groq) and any clip generation are out-of-band jobs that already belong to the media slice — the student view only *reads* `assets`/transcripts. Engagement-event rollups/aggregates (teacher analytics) belong in a Cron/Queue worker, not the request path.

### Mux → Bunny, Whisper → Groq
- **Mux → Bunny.** Replace the four-tier source resolution (Mux clip / Mux HLS / Supabase signed URL / YouTube) with Bunny Stream HLS URLs from the `assets` table. The existing `VideoPlayer` already takes a generic `src` (`.m3u8` → hls.js, else native) so it's source-agnostic. **Drop the "Mux clip" tier**: per Parvus Ordo Architecture §9 the no-skip is enforced **client-side over the full source** (`start_ms/end_ms` window), so server-side cut clips are not created. Decide whether to keep a **YouTube** tier; if so, replicate the time-based "watched" fallback and flag it as non-enforceable. Mux Data telemetry → drop or replace with Bunny analytics if needed.
- **Whisper → Groq.** Already mapped in the media slice (Groq transcription live). The student view just consumes the resulting word-timestamp transcript; ensure Groq output is stored in the same `{ word, start, end }` shape the player expects, and that transcript clipping/rebasing for a `start_ms/end_ms` window happens in `core` (server-side) rather than the client.

### RLS / tenancy
- All student activity tables are **parish-scoped** with `app.parish_id` RLS isolation (see `lesson_item_progress`). Answers, progress, engagement events, student questions/feedback must carry `parish_id` and be owned by `student_id`.
- **Lessons are scoped** `global | diocese | parish` via `lesson_versions.scope`. The student reads the `live_version_id`; gating/progress always key off `parish_id` for the consuming parish (a global lesson consumed by a parish still records parish-scoped progress).
- **Dictionary entries** are effectively global; **overrides** are parish-scoped — preserve the global-entry + parish-override resolution, and pick a single canonical override schema (per-field rows OR per-column) to fix the legacy `field_name`/`override_value` vs `override_definition` mismatch.

### Explicit GAPS vs what Parvus Ordo has built
1. **No student wizard route exists** — only the OCIA teacher/editor side (`apps/web/app/(app)/ocia/lessons/...`). The student consumption page (`/lessons/:id` equivalent), step navigation, progress bar, and Continue-gating UI must be built.
2. **No gating/resume orchestration in `core`** — `lesson_item_progress` exists but there is no `getLessonForStudent`/resume-index or `canAdvance` equivalent yet.
3. **No cohort sequential lock** — no `cohorts.sequential` / `cohort_schedule.skip_sequence` / previous-lesson-complete logic ported (cohort scheduling itself may be a separate slice; confirm it exists before wiring the lock).
4. **No engagement-events telemetry** — no `engagement_events` table or `trackEngagement` equivalent (`lesson_start`, `step_enter/exit` dwell, `answer_submit` correctness, `reading_complete`, `lesson_complete`). Needed both for analytics and as the source of the `lesson_complete` signal the sequential lock depends on.
5. **No dictionary feature** — no entries/overrides tables, no inline highlighting, no entry modal. Matching helpers must be ported to `core` as pure (DOM-free) functions; sacred-text normalization too.
6. **No student question / feedback** capture (`student_questions`, `student_feedback`).
7. **No review mode** (read-only answers list) student view.
8. **Player is built but not wired into a student flow** — `VideoPlayer` exists; needs to be embedded in the wizard, fed Bunny `src` + server-clipped transcript, and connected to `lesson_item_progress` saves (the current component tracks `max_reached` locally but does not persist).
