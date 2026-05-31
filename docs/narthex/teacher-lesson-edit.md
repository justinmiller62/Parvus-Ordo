# Teacher Lesson Builder/Editor

> Faithful re-port spec for the legacy Narthex "Teacher Lesson Builder/Editor" section.
> Source repo paths below are relative to `apps/web/src/` in the Narthex repo unless noted otherwise.
> Target stack: Parvus Ordo (Next.js 16 App Router, `packages/core` backend boundary, Neon Postgres + RLS, WorkOS auth, Bunny video, Groq transcription).

## Overview

This section is where a teacher/admin **authors a lesson**: a titled, optionally-described container holding an **ordered timeline** of content items. There are three item kinds:

- **Reading blocks** — rich text (TipTap/HTML).
- **Video blocks** — a reference to a `videos` row plus a trimmed `[startMs, endMs]` segment.
- **Questions** — `open_ended` (free text) or `multiple_choice` (radio choices, exactly one correct) with an optional teacher-only `expected_answer`.

Two routes make up the section:

- `routes/teacher/LessonCreatePage.tsx` — a minimal "title + description" form that inserts a `lessons` row and redirects to the editor.
- `routes/teacher/LessonEditPage.tsx` — the full editor: edit title/description, publish/unpublish, and embed the `LessonTimeline` builder. Also links out to **Preview** (`/lessons/:id/view?preview=true`) and **Engagement** (`/lessons/:id/engagement`).

The timeline itself (`components/lesson/LessonTimeline.tsx`) is the heart of the section: it adds/edits/deletes/reorders items, persists each change directly to Supabase (mostly debounced), and computes an estimated lesson duration. Video selection happens through `components/lesson/VideoPickerModal.tsx` (library tab + YouTube tab). Reading editing happens through `components/lesson/RichTextEditor.tsx` (TipTap).

It exists because a parish teacher needs to assemble OCIA/catechesis lessons from their own uploaded videos, YouTube videos, written readings, and comprehension questions, then publish them to students.

## Roles & access

- Auth comes from `lib/AuthContext.tsx` → `hooks/useAuth.ts`. A user has `memberships` (`{ id, userId, parishId, role }`, role ∈ `admin | teacher | student`) and a `profile` (with `isSuperAdmin`).
- **The section's UI does no explicit role gating of its own.** `LessonCreatePage` simply uses `memberships[0]?.parishId` as the parish to create under (`LessonCreatePage.tsx:14`). There is no `isTeacherOrAdmin()` check in the create or edit pages themselves; gating is expected at the router/layout level (the `/teacher/*` route grouping) and is ultimately **enforced by Supabase RLS**.
- **RLS is the real gate** (`supabase/migrations/20260422000000_initial.sql`):
  - `lessons_insert/update/delete`, `blocks_*`, `questions_*`, `videos_*` all require `user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher'])`. A student's writes simply fail at the DB.
  - Reads (`*_select`) are open to any parish member, so a student *could* read a draft lesson's blocks/questions if they had the URL (see Edge cases).
- **Super-admin parish override**: `useAuth` supports a `parishOverride` stored in `sessionStorage` (`narthex_parish_override`). When active it injects a synthetic `{ role: 'admin' }` membership so a super-admin can author within any parish (`useAuth.ts:139-148`). Only `isSuperAdmin()` users may call `switchParish` (`useAuth.ts:162`).
- `memberships[0]` is used throughout — **the section assumes a single active parish** and silently picks the first membership.

## User flows

### Flow A — Create a lesson
1. Teacher opens the New Lesson form (`LessonCreatePage`). Fields: **Title** (required), **Description** (optional).
2. Submit is disabled while `saving` or when `title.trim()` is empty (`LessonCreatePage.tsx:86`).
3. On submit, if `!user || !parishId` the handler silently returns (no error shown) — **empty/no-parish state is a silent no-op** (`LessonCreatePage.tsx:18`).
4. Inserts into `lessons` with `{ title (trimmed), description (trimmed or null), parish_id, created_by: user.id }`, selecting `id` (`LessonCreatePage.tsx:23-32`).
5. **Error state**: an insert error sets `error` and shows a red banner; `saving` resets to false.
6. **Success**: navigate to `/lessons/:id` (the edit page). The new lesson is a **draft** (`published_at` is null).

### Flow B — Load the editor
1. `LessonEditPage` reads `:id` from the route and fires three queries in parallel (`LessonEditPage.tsx:50-54`): `lessons` (single), `blocks` (ordered by `position`), `questions` (ordered by `position`).
2. **Loading state**: "Loading lesson..." while `loading`.
3. **Error/not-found state**: if the lesson query errors → red error message; if no lesson → "Lesson not found." (`LessonEditPage.tsx:111-117`).
4. On success, local state is seeded: `title`, `description`, `blocks`, `questions`, and the `lesson` object (which carries `published_at`).

### Flow C — Edit metadata & save
1. Title/description are controlled inputs.
2. **Save** button calls `saveLesson` → `update lessons set title, description where id` (`LessonEditPage.tsx:79-85`). Title/description are **not** auto-saved; they require the explicit Save button. (Timeline items, by contrast, auto-save — see Flow E.)
3. Errors set the red banner. Status line shows "Published" or "Draft".

### Flow D — Publish / unpublish
1. **Publish/Unpublish** toggles `published_at` between `now()` ISO string and `null` (`LessonEditPage.tsx:93-109`).
2. Button label/style flips: Publish (green) when draft, Unpublish (yellow) when published.
3. On success, local `lesson.published_at` is updated optimistically after the DB write returns.

### Flow E — Build the timeline (add items)
The timeline merges blocks + questions into one list sorted by `position` (`LessonTimeline.tsx:62-69`). Toolbar buttons:
1. **Reading** → inserts a `blocks` row `{ type:'reading', content_json:{ title:'', markdown:'' }, position: nextPosition }`, appends to local blocks, opens the editor modal for it (`LessonTimeline.tsx:98-118`).
2. **Video** → opens `VideoPickerModal`. Selecting a video inserts a `blocks` row `{ type:'video', content_json:{ title: videoName, videoId, startMs:0, endMs: durationMs ?? 0 } }` (`LessonTimeline.tsx:150-176`).
3. **Open-Ended** / **Multiple Choice** → inserts a `questions` row `{ prompt:'', question_type }`; for MC it also seeds `choices:[{label:'',correct:true},{label:'',correct:false}]` (`LessonTimeline.tsx:120-148`). Opens the editor modal.
4. **Empty state**: when the timeline is empty, a dashed-border placeholder reads "No content yet. Add reading blocks and questions to build your lesson." (`LessonTimeline.tsx:329-332`).
5. While `adding`, all add buttons are disabled.
6. `nextPosition` = `max(position) + 1`, or `0` if empty (`LessonTimeline.tsx:75-78`).

### Flow F — Edit a timeline item (modal)
1. Clicking the pencil (or auto-open after add) sets `editingId = "<kind>-<id>"`; a full-screen (mobile) / centered (desktop) modal opens with the right sub-editor (`LessonTimeline.tsx:352-406`).
2. **Reading** → `ReadingBlockEditor`: a block-title input + `RichTextEditor` (TipTap). Changes update local state immediately and **debounced-save** (500ms) the whole `content_json` `{ title, markdown }` to `blocks` (`LessonTimeline.tsx:558-616`).
3. **Video** → `VideoBlockEditor`: title input, a video preview (HLS via hls.js if Mux, else Supabase signed URL), and a **Trim Segment** UI with start/end sliders, ±1s/±1f (frame ≈ 42ms) nudge buttons, precise `M:SS.mmm` text inputs, and "Jump to Start/End" + "Set Start/End to Playhead" buttons. Debounced-saves `content_json` `{ ...title, startMs, endMs }` (`LessonTimeline.tsx:620-819`).
4. **Question** → `QuestionItemEditor`: prompt textarea; for MC a list of radio+text choices (add choice; remove allowed only when >2 choices); plus an `expected_answer` textarea ("not shown to students"). Each field debounce-saves to `questions` independently (prompt / choices / expected_answer) (`LessonTimeline.tsx:895-1025`).
5. Closing the modal (backdrop click or X) sets `editingId = null`. There is **no explicit "save" in the modal** — all persistence is via debounce; closing immediately does not flush a pending save (see Gotchas).

### Flow G — Reorder (drag & drop)
1. Powered by `@dnd-kit` with a `PointerSensor` (5px activation distance) (`LessonTimeline.tsx:92`).
2. On drag end, the item is spliced to its new index in the merged timeline; **every item whose index changed** gets a new `position` equal to its array index, applied to local state and then persisted one-by-one with sequential `update ... set position` calls (`LessonTimeline.tsx:209-249`).
3. Items already at their index are skipped (`if (item.data.position === i) continue`).

### Flow H — Delete an item
1. Trash button calls `deleteItem`: deletes the `blocks`/`questions` row, removes from local state on success, and clears `editingId` if the deleted item was open (`LessonTimeline.tsx:190-205`).
2. **Positions are NOT renumbered after delete** — gaps remain (see Gotchas).

### Flow I — Add a YouTube video (inside VideoPickerModal)
1. Modal has two tabs: **Library** and **YouTube** (`VideoPickerModal.tsx:23`).
2. Library tab lists `videos` for `parishId` ordered by `created_at desc`, showing name, duration, and a transcription status icon (green check = completed, spinner = processing) (`VideoPickerModal.tsx:33-45,152-174`). Empty state: "No videos uploaded yet. Go to Videos in the sidebar to upload."
3. YouTube tab: paste URL or 11-char ID (regex extraction, `VideoPickerModal.tsx:47-57`), optional title, live `<iframe>` preview.
4. On "Add YouTube Video": fetch captions in-browser via `lib/youtube-captions.ts`, then **insert a `videos` row** with `storage_path: "youtube://<id>"`, `transcription_status: captions ? 'completed' : 'failed'`, `transcript_text`, `transcript_json`, then call `onSelect(videoRow.id, name, null, ytId)` which creates the video block (`VideoPickerModal.tsx:59-103`).
5. **Error states**: invalid URL → "Invalid YouTube URL or video ID"; insert error → the DB message; missing parish → silent return.

### Flow J — Preview / Engagement (links out of this section)
- **Preview** → `/lessons/:id/view?preview=true` (teacher sees the student player without consuming progress; the player is a separate section).
- **Engagement** → `/lessons/:id/engagement` (analytics; separate section).

## Data model

All tables live in the parish-scoped Narthex Supabase schema. Definitions consolidated from `supabase/migrations/20260422000000_initial.sql` plus later ALTERs.

### `lessons` (read/insert/update)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes` | **ownership for RLS** |
| `title` | text NOT NULL | |
| `description` | text | |
| `discussion_template` | text | not touched by this section |
| `visibility` | enum `lesson_visibility` (`parish`\|`diocese`) default `parish` | not set by this section |
| `source_lesson_id` | uuid → `lessons` | fork provenance; not set here |
| `lesson_order` | int default 0 | not set here |
| `created_by` | uuid NOT NULL → `profiles` | set on create |
| `published_at` | timestamptz NULL | null = draft; toggled by publish |
| `created_at`, `updated_at` | timestamptz | `updated_at` via trigger |

Writes here: `INSERT {title, description, parish_id, created_by}` (create); `UPDATE {title, description}` and `UPDATE {published_at}` (edit).

### `blocks` (read/insert/update/delete)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `lesson_id` | uuid NOT NULL → `lessons` (ON DELETE CASCADE) | RLS via parent lesson's parish |
| `position` | int NOT NULL | UNIQUE(lesson_id, position) |
| `type` | enum `block_type` (`video`\|`reading`) | |
| `content_json` | jsonb NOT NULL default `{}` | reading: `{title, markdown}`; video: `{title, videoId, startMs, endMs}` |
| `mux_clip_asset_id`, `mux_clip_playback_id`, `mux_clip_status` | text | added `20260430000000_mux_video_columns.sql`; clip render tracking |
| `clip_start_ms`, `clip_end_ms` | int | the start/end the rendered clip was cut at; compared to `content_json` to detect a **stale clip** |
| `created_at` | timestamptz | |

Note the editor reads `content_json` but the *initial* schema sketch (`schema.sql`) calls it `content` — the migration is authoritative: it is **`content_json`**.

### `questions` (read/insert/update/delete)
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `lesson_id` | uuid NOT NULL → `lessons` (CASCADE) | RLS via parent |
| `position` | int NOT NULL | UNIQUE(lesson_id, position) |
| `prompt` | text NOT NULL | |
| `question_type` | enum `question_type` (`open_ended`\|`multiple_choice`) default `open_ended` | `20260422000002_question_type.sql` |
| `choices` | jsonb | array of `{label, correct}`; **CHECK**: null for open_ended, NOT NULL for multiple_choice |
| `expected_answer` | text | `20260429000000_expected_answer.sql`; teacher-only |
| `created_at` | timestamptz | |

### `videos` (read/insert) — owned by Video/asset section, consumed here
| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes` | RLS ownership |
| `name` | text NOT NULL default 'Untitled Video' | `20260423000000_video_metadata.sql` |
| `storage_path` | text NOT NULL | Supabase storage key, or `youtube://<id>` for YouTube |
| `duration_ms` | int | |
| `mime_type`, `file_size_bytes` | | |
| `transcription_status` | enum (`pending`\|`processing`\|`completed`\|`failed`) | |
| `transcript_text` | text | |
| `transcript_json` | jsonb | caption words `[{word,start,end}]` |
| `uploaded_by` | uuid → `profiles` | |
| `mux_asset_id`, `mux_playback_id`, `mux_status` | text | source Mux asset; the video editor prefers `mux_playback_id` HLS when `mux_status='ready'` |
| `created_at` | timestamptz | |

### `segments` (defined, NOT used by this section's code)
`segments` (block_id, video_id, position, start_ms, end_ms, transcript_slice) exists in the schema as a normalized representation of video trims, but **the builder stores trim state inside `blocks.content_json` instead** and never writes `segments`. Note this divergence when porting.

### Relationships / RLS-relevant ownership
- `lessons.parish_id` is the tenancy anchor. `blocks` and `questions` inherit RLS through `lesson_id → lessons.parish_id`. `videos.parish_id` directly.
- All write policies require `admin` or `teacher` membership in that `parish_id`; all read policies allow any parish member.
- Storage bucket `videos` is private; read requires parish membership; upload requires admin/teacher (`20260422000000_initial.sql:709-723`). Path convention: first folder segment is the parish UUID.

## Key logic & algorithms

**Merged, position-sorted timeline.** Blocks and questions share a single `position` integer space and are merged client-side:
```ts
// LessonTimeline.tsx:62-69
const items = [...blocks.map(b => ({kind:'block', data:b})),
               ...questions.map(q => ({kind:'question', data:q}))];
items.sort((a, b) => a.data.position - b.data.position);
```
There is **no DB-level guarantee** that a block and a question won't share the same `position` (the UNIQUE constraints are per-table: `UNIQUE(lesson_id, position)` on blocks *and* separately on questions). Two items from different tables can therefore collide on a position; sort order between them is then unstable.

**Reorder reassigns dense indices.** `handleDragEnd` recomputes `position = arrayIndex` for changed items and persists them with **sequential, unguarded** `update` calls (`LessonTimeline.tsx:243-248`). Because blocks and questions are separate tables, the dense reindex spans both — so positions stay globally consistent across the merged list as long as the whole reorder succeeds.

**Stale-clip detection (Mux).** In the collapsed video row, a clip is "ready" only if the rendered clip's `clip_start_ms/clip_end_ms` equal the current `content_json.startMs/endMs`; otherwise it's "outdated" (amber) (`LessonTimeline.tsx:490-512`):
```ts
const clipReady = mux_clip_status === 'ready' && clip_start_ms === startMs && clip_end_ms === endMs;
const clipStale = mux_clip_status === 'ready' && (clip_start_ms !== startMs || clip_end_ms !== endMs);
```

**Duration estimate** (`LessonTimeline.tsx:253-273`): video = `(endMs-startMs)/1000`; reading = `wordCount/200*60` (200 wpm, HTML stripped); question = `60s` flat. Rounded up to minutes.

**Trim clamping** (`LessonTimeline.tsx:675-689`): start clamped to `[0, endMs-1000]` (start always ≥1s before end); end clamped to `[_, videoDuration||contentJson.endMs]`. Frame nudge = 42ms (≈24fps). Text parse accepts `M:SS.mmm | M:SS | SS.mmm | SS` (`parseMsPrecise`, `LessonTimeline.tsx:882-891`).

**Video source resolution** (`LessonTimeline.tsx:636-659`): query `videos` for the block's `videoId`; if `mux_playback_id && mux_status==='ready'` use `https://stream.mux.com/<id>.m3u8`; else `supabase.storage.from('videos').createSignedUrl(storage_path, 3600)`. HLS played via hls.js (`VideoPreview`, `LessonTimeline.tsx:837-880`).

**Debounced save** (`useDebouncedSave`, `LessonTimeline.tsx:539-554`): 500ms trailing debounce; cleared on unmount. Each editable field has its own debounced saver writing only its column(s).

**Two-layer state.** The timeline keeps blocks/questions in `LessonEditPage` state (lifted via `onBlocksChange/onQuestionsChange`); editors keep their own local copy and `useEffect`-sync from props (e.g. `QuestionItemEditor`, `LessonTimeline.tsx:907-909`) so external updates (drag reorder) propagate into an open editor.

**YouTube caption scraping** (`lib/youtube-captions.ts`): fetches the watch page through a dev proxy `/api/youtube/watch?v=<id>` (CORS), regex-extracts `"baseUrl":"...timedtext..."` caption track URLs, fetches each through the proxy, parses `srv3` (`<p t d>`) then classic (`<text start dur>`) formats, decodes HTML entities. Returns `{words:[{word,start,end}], text}` or null. **Comment explicitly notes prod needs a server-side proxy/Edge Function** (`youtube-captions.ts:4`).

**RichTextEditor** (`RichTextEditor.tsx`): TipTap StarterKit (headings 1–3), Underline, Placeholder, TextAlign, Tables. Emits HTML via `onChange` + triggers `onDebouncedSave`. External-content sync guarded by `setContent(..., {emitUpdate:false})` to avoid feedback loops (`RichTextEditor.tsx:64-72`).

## External integrations

- **Mux** (video host/transcode): source videos can have a Mux asset (`videos.mux_*`); the editor prefers Mux HLS for preview. Block-level Mux **clips** (`blocks.mux_clip_*`, `clip_start_ms/clip_end_ms`) are rendered out-of-band (not in this section's code — likely an Edge Function/webhook) and surfaced here only as a status dot. This section never *triggers* clip rendering; it only writes the desired `startMs/endMs` into `content_json` and reads back clip status.
- **Supabase Storage** (`videos` bucket): signed URLs (1h TTL) for non-Mux source playback.
- **YouTube**: client-side caption scraping via watch-page + timedtext, proxied (`/api/youtube`). Also `<iframe>` embed for preview. No YouTube Data API key; relies on HTML scraping.
- **hls.js**: HLS playback in the trim preview.
- **Whisper/OpenAI/Groq**: NOT invoked from this section directly. Transcription of uploaded videos happens in the Video section; this section only reads `videos.transcription_status`. (YouTube path bypasses transcription entirely by scraping captions.)
- **Email / ICS / iCal**: none in this section.

## Edge cases & gotchas

- **Debounced save not flushed on modal close.** Closing the editor modal (or unmounting) cancels the pending 500ms timer (`useDebouncedSave` cleanup) — a change typed <500ms before closing is **lost** for that field. Reading title saves on the same debounce.
- **Title/description require explicit Save**, but timeline items auto-save — inconsistent mental model; teacher can lose metadata edits by navigating away.
- **No optimistic-failure rollback.** Add/delete update local state only on success, but debounced field edits update local state immediately and ignore the DB result; a failed `update` leaves UI and DB diverged silently.
- **Positions are not renumbered on delete** → sparse positions (e.g. 0,2,3). Sorting still works; `nextPosition` uses `max+1` so no collision, but indices aren't contiguous until the next drag-reorder densifies them.
- **Cross-table position collisions.** Blocks and questions can share a `position`; merged sort between a colliding block and question is order-undefined.
- **Reorder persistence is non-transactional**: N sequential awaited `update` calls; a mid-sequence failure leaves positions partially updated (DB inconsistent with local state).
- **`memberships[0]` assumption**: a user in multiple parishes always authors/searches under the first; no parish selector in this section.
- **Silent no-ops** when `parishId`/`user` missing (create page, YouTube add) — no user feedback.
- **Students can read drafts.** Read RLS is parish-wide; an unpublished lesson's blocks/questions are readable by any parish member with the URL. Publish only flips `published_at`; it is not an access boundary at the row level (the *student app* presumably filters on it).
- **Video block seeds `endMs` from `durationMs ?? 0`.** If the picked library video has unknown duration, the block starts with a zero-length segment until the preview loads `onLoadedMetadata` and the teacher adjusts.
- **YouTube failure still creates a video row** (`transcription_status:'failed'`, null transcript) and proceeds to create the block — a video with no usable transcript.
- **`segments` table is dead** for this section; trims live in `content_json` only.
- **Stale clip vs. live edit**: editing the trim makes the rendered clip "outdated" (amber) but does not re-trigger a re-render here.

## Acceptance criteria

- [ ] Creating a lesson with a non-empty title inserts a `lessons` row with `{title (trimmed), description (trimmed→null), parish_id = active parish, created_by = current user}` and redirects to the editor for the new id.
- [ ] The Create submit button is disabled when the title is empty or whitespace-only.
- [ ] Submitting Create with no active parish (or no user) performs no insert and no navigation.
- [ ] A Create insert error renders the error banner and re-enables the form (no navigation).
- [ ] The editor loads lesson, blocks (ordered by position), and questions (ordered by position) and renders them as a single timeline sorted by `position`, interleaving blocks and questions.
- [ ] An unknown/missing lesson id renders "Lesson not found." and a query error renders the error message.
- [ ] Saving metadata issues `UPDATE lessons SET title, description WHERE id` and is the **only** path that persists title/description (no auto-save).
- [ ] Publish sets `published_at` to a timestamp and the button flips to "Unpublish"; Unpublish sets it back to null and flips to "Publish".
- [ ] Adding a reading block inserts `{type:'reading', content_json:{title:'',markdown:''}, position:max+1}` and opens its editor.
- [ ] Adding a multiple-choice question inserts `choices:[{label:'',correct:true},{label:'',correct:false}]`; adding open-ended inserts no choices.
- [ ] Selecting a library video inserts `{type:'video', content_json:{title,videoId,startMs:0,endMs:duration??0}}`.
- [ ] Editing a reading block debounce-saves the full `content_json {title, markdown}` ~500ms after the last keystroke.
- [ ] In the video trim editor, start is clamped to `[0, endMs-1000]` and end is clamped to `≤ video duration`; the `M:SS.mmm` text input round-trips with the slider.
- [ ] A multiple-choice question enforces exactly one `correct` choice (selecting one clears the others) and forbids removing a choice when only two remain.
- [ ] Deleting a timeline item removes the row and the local entry, and closes the editor if that item was open.
- [ ] Drag-reordering reassigns dense `position = index` to every moved item and persists each changed item to its table.
- [ ] The estimated-duration badge computes video = (end-start)/1000s, reading = words/200*60s (HTML stripped), question = 60s, rounded up to whole minutes.
- [ ] An empty timeline shows the "No content yet" placeholder; an empty video library shows the "No videos uploaded yet" empty state.
- [ ] Adding a YouTube video extracts the 11-char id, inserts a `videos` row with `storage_path:'youtube://<id>'` and `transcription_status` reflecting whether captions were found, then creates a video block.
- [ ] A video block whose `clip_start_ms/clip_end_ms` differ from current `content_json.startMs/endMs` (with `mux_clip_status='ready'`) shows the "outdated" (amber) status dot.

## Port notes

### Where each piece lands (Parvus Ordo)

- **`packages/core` (the backend, no React/Next):** all lesson authoring logic.
  - `core/ocia` (lessons already exist) gains: create-lesson, update-lesson-metadata, publish/unpublish, and lesson-item CRUD + reorder. These must be **pure functions that take an auth/tenant context and call the DB**, with Zod validators for `lesson_items.content` per kind (reading `{html}`, question `{prompt, format, choices?, expected_answer?}`, video `{asset_id, start_ms, end_ms}`).
  - Reorder must be a **single transaction** (fixing the legacy non-transactional N-update bug) — densify positions for the version and write atomically.
  - Duration estimate, trim clamping, and YouTube-id extraction are pure helpers → `core`.
- **Server Actions (thin, ~10 lines):** the editor's mutations — create lesson, save metadata, publish, add/edit/delete/reorder item, attach video, add YouTube source. Each: auth check (WorkOS session → membership/role) → validate → call `core` → return. The legacy code's **direct `supabase.from(...).insert/update/delete` from the browser must NOT be reproduced**; move every write behind an action.
- **RSC reads:** the editor's initial load (lesson + ordered items + asset metadata) is a direct DB read in the server component. The video-picker library list is also an RSC/`core` read.
- **tRPC (client-reactive):** the debounced item editors want low-latency, frequent writes — model these as tRPC mutations (still thin shims over `core`) so the client editor stays reactive. Keep the 500ms debounce client-side.
- **infra/workers (out-of-band):** video transcode (Bunny) and transcription (Groq) — NOT in the request path. YouTube caption fetching, which the legacy app explicitly flagged as needing a server proxy in prod, becomes a Worker/route-handler job, not browser scraping.
- **route handler `/api/v1`:** only if an external consumer needs lesson content; not required for the editor itself.

### Schema mapping (Narthex → Parvus Ordo)

- **`blocks` + `questions` → one `lesson_items` table** (already built, `infra/db/migrations/0003_ocia_core.sql`): `kind ∈ reading|video|question`, single `position` sequence per lesson, `content jsonb`. This **fixes the cross-table position-collision bug** by construction (one `UNIQUE(version_id, position)`).
- **`content_json` → `lesson_items.content`** with documented shapes. Reading uses `{html}` (legacy `{title, markdown}` → fold the block title into the HTML or add a `title` key; decide during port — legacy stored a separate `title`). Question uses `{prompt, format, choices?, expected_answer?}` (legacy `question_type`→`format`). Video uses `{asset_id, start_ms, end_ms}` (legacy `{videoId, startMs, endMs}`).
- **Versioning (already built, `0006_lesson_versions.sql`):** content now hangs off `lesson_versions`, not `lessons` directly; `lesson_items.version_id` is the FK; `lessons.live_version_id` is what students see; **at most one draft version per lesson** (partial unique index). The legacy "publish = set `published_at`" maps to **promoting the draft version to live** (`live_version_id`), a richer model. The editor must operate on the **draft version's** items, not the live ones.
- **`videos` → `assets` (already built, `0007_assets.sql`):** the asset manager backs all media. Video block references `assets.id` via `content.asset_id`. `assets` has split lifecycles `status` (Bunny transcode) and `transcription_status` (Groq).
- **Tenancy/RLS:** Parvus Ordo lessons/lesson_items/assets use the **three-tier `content_scope` (global ∪ diocese ∪ own-parish read; parish-only write)**, unlike Narthex's flat single-parish model. The editor must author into `scope='parish'` rows for the active parish. Note RLS here read-gates by scope but **does not** hide drafts from students at the row level — keep the legacy gotcha in mind: filter on published/live-version in the student app, and consider an explicit policy so unpublished versions aren't student-readable.

### Mux → Bunny

- **No server-side clip cutting.** Parvus Ordo enforces clips **client-side via a seek-gating player** (`infra/db/migrations/0007_assets.sql` header, Architecture §9). So `blocks.mux_clip_*` / `clip_start_ms` / `clip_end_ms` and the **stale-clip status dot logic have no Bunny equivalent and should be dropped** — the video item just stores `start_ms/end_ms` and the player enforces the window.
- Source playback: legacy `stream.mux.com/<id>.m3u8` → `assets.playback_url` (Bunny HLS manifest). The signed-URL fallback maps to a `StorageProvider` resolving a playback URL.
- hls.js preview in the trim editor still applies (Bunny serves HLS).

### Whisper → Groq

- Legacy video transcription was Mux/Whisper-adjacent in the Video section; Parvus Ordo uses the **Groq Whisper `TranscriptionProvider`** (`packages/core/src/media/transcription.ts`, live per memory). The editor only reads `assets.transcription_status` / `transcript_json`; transcription runs in `infra/workers`.
- YouTube captions: the legacy in-browser scraper should become a Worker/route-handler that fetches captions server-side (the legacy code itself flagged this). Alternatively, treat a YouTube add as an `assets` row of a YouTube provider and run transcription through Groq if captions are unavailable.

### Explicit GAPS vs. what Parvus Ordo already has

- **Already built:** lessons + versioning (`lesson_versions`, draft/live, history); unified `lesson_items`; the `assets` media manager with Bunny/Groq provider abstractions (stubs locally); a seek-enforcing player + transcript; teacher preview. So the **data model and media layer are ahead of Narthex** — the port is mostly about building the **authoring UI + Server Actions/tRPC** on top of them.
- **Gap — the builder UI itself is not yet ported:** the timeline (dnd-kit reorder, add/edit/delete, full-screen item editor modal), the TipTap reading editor, the trim UI, and the video picker (library + YouTube tabs) are Narthex-only and must be rebuilt against the new model.
- **Gap — version-aware editing:** Narthex edits content in place; Parvus Ordo must edit the **draft version** and publish by promoting it to `live_version_id`. The "Publish/Unpublish" button maps to version promotion/retraction, not a single timestamp toggle.
- **Gap — reading content shape:** legacy `{title, markdown(HTML)}` vs. target `{html}` — decide whether to keep a separate item title.
- **Gap — segments table:** unused in Narthex and absent in the new model; trims live in `lesson_items.content`. No port needed; just don't recreate it.
- **Gap — transactional reorder & no-flush-on-close bugs:** fix during port (transaction for reorder; flush pending debounce before closing the editor modal / navigating).
- **Gap — multi-parish/scope selector:** Narthex used `memberships[0]`; Parvus Ordo needs the active-parish/tenant context from WorkOS + scope-aware authoring (parish vs. fork-from-global/diocese).
