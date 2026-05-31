# Video Library & Pipeline (Mux, transcription, youtube)

> Source repo paths in this doc are relative to the Narthex repo root:
> `/Users/justinmiller/Desktop/Development/repositories/Narthex/`

## Overview

This section is the teacher-facing **Video Library** plus the **media pipeline** that backs every video block in a lesson. It does three things:

1. **Ingest** source video — either an uploaded file (sent directly to **Mux** for streaming) or a **YouTube** video (referenced by ID, never uploaded).
2. **Transcribe** the audio — uploaded files are transcribed with **OpenAI Whisper** (`whisper-1`, word-level timestamps); YouTube videos reuse YouTube's own caption tracks. The resulting `transcript_text` + word-timestamp `transcript_json` are what the student-side clickable transcript and the "jump to word" seek behavior are built on.
3. **Clip** — when a lesson author trims a video into a block (`startMs`/`endMs`), a Mux **clip asset** is cut from the source so students stream only the trimmed segment. Clips are re-cut when trim points change.

The library lives on the teacher route `/teacher/videos`. Playback and transcript consumption happen on the student side (`LessonViewPage`), via two player components (`MuxClipPlayer`, `SegmentPlayer`) that enforce no-skip-ahead viewing and report progress.

Key files:
- `apps/web/src/routes/teacher/VideoLibraryPage.tsx` — the library UI + the entire upload/transcribe/delete client orchestration.
- `apps/web/src/components/video/MuxClipPlayer.tsx` — HLS player for a pre-cut Mux clip (whole asset = the segment).
- `apps/web/src/components/video/SegmentPlayer.tsx` — HLS/direct player that enforces a `[startSec,endSec]` window on a full source asset (fallback when no clip exists).
- `apps/web/src/lib/extract-audio.ts` — browser-side WAV extraction (16 kHz mono) for Whisper.
- `apps/web/src/lib/youtube-captions.ts` — browser-side YouTube caption fetch via the Vite dev proxy.
- `supabase/functions/mux-clip/index.ts` — Mux Edge Function: upload-url, check-upload, status, ingest, clip, sync-clips, delete.
- `supabase/functions/transcribe/index.ts` — Whisper Edge Function (downloads audio from Storage, chunks WAV, calls Whisper).
- `supabase/functions/youtube-transcript/index.ts` — server-side YouTube caption fetch (InnerTube + web-page fallback).

## Roles & access

- **Route gating:** `/teacher/videos` is wrapped in `RoleGuard allowedRoles={['admin', 'teacher']}` (`apps/web/src/App.tsx:143-149`). Only **admin** and **teacher** see the Video Library.
- **Tenancy:** the page scopes everything to a single parish — `const parishId = memberships[0]?.parishId` (`VideoLibraryPage.tsx:40`). There is no diocese/global scope here; videos are strictly per-parish.
- **DB RLS (`supabase/migrations/20260422000000_initial.sql`):**
  - `videos_select` — any authenticated parish member can read videos in their parish (`parish_id IN get_user_parish_ids(auth.uid())`).
  - `videos_insert` / `videos_update` — only `admin`/`teacher` via `user_has_role(auth.uid(), parish_id, ['admin','teacher'])`.
  - `videos_delete` — admin/teacher only (`20260423000001_video_delete_grant.sql`).
- **Storage RLS:** `videos` bucket — parish members can read (`storage_videos_select`), admin/teacher can insert/delete (`storage_videos_insert`, `storage_videos_delete`). Folder name = `parish_id` (first path segment).
- **Edge Functions** authenticate the caller's Supabase JWT (`supabase.auth.getUser(token)`) and otherwise run with the **service role** key, so they bypass RLS. `mux-clip` additionally accepts a `x-service-key` header to allow a cron job to call `sync-clips` without a user JWT (`mux-clip/index.ts:298-312`).

## User flows

### 1. Upload a video file (`handleUpload`, `VideoLibraryPage.tsx:79-200`)
1. Teacher clicks **Upload Video** (hidden `<input type="file" accept="video/*">`). Disabled while `uploading`.
2. A `videos` row is inserted first to get an ID, with `storage_path: ''`, `mux_status: 'preparing'`, `transcription_status: 'pending'`, `uploaded_by`, `file_size_bytes`, `mime_type`. If insert fails → error shown, abort.
3. Client calls `mux-clip` op `upload-url` (passing `corsOrigin: window.location.origin`) → returns a Mux **direct upload URL** + `upload_id`. On error: the just-created row is **deleted** and abort.
4. Client `PUT`s the file directly to the Mux upload URL. On non-OK / throw: row deleted, abort.
5. **Poll** `check-upload` every 3 s up to 30 times (~90 s) until Mux reports `asset_id`. If `status` is `errored`/`timed_out` → error, break (row is NOT deleted here).
6. Updates the row: `storage_path = buildVideoStoragePath(parishId, videoId)` (= `${parishId}/${videoId}.mp4`), `mux_asset_id`, `mux_status` = `preparing` (or `errored` if no asset).
7. **Audio extraction:** `extractAudioFromVideo(file)` decodes audio in-browser, resamples to 16 kHz mono, encodes WAV. On failure it logs a warning and continues (transcription will fall back to the video file).
8. If audio produced, uploads WAV to Storage `videos/${parishId}/${videoId}.wav` (`upsert:true`) and sets `audio_path`. Upload failure is non-fatal (logged).
9. UI returns to idle, file input cleared, `fetchVideos()` re-renders.
10. **`triggerTranscription(videoId)`** fires (see flow 4).
11. **`pollMuxStatus(videoId, assetId)`** runs in background: every 5 s up to 20 times (~100 s) calls `status`; on `ready` writes `mux_status:'ready'` + `mux_playback_id`; on `errored` writes `mux_status:'errored'`; then `fetchVideos()`.

### 2. Add a YouTube video (`addYoutubeVideo`, `VideoLibraryPage.tsx:313-361`)
1. Teacher clicks **Add YouTube**, enters a URL or 11-char ID + optional title.
2. `extractYoutubeId` parses `youtube.com/watch?v=`, `youtu.be/`, `/embed/`, or a bare 11-char ID. Invalid → "Invalid YouTube URL".
3. Captions fetched **in-browser** via `fetchYouTubeCaptions(ytId)` (uses the Vite proxy `/api/youtube` → `youtube.com`).
4. Inserts a `videos` row: `storage_path = 'youtube://<id>'`, `transcription_status = 'completed'` if captions found else `'failed'`, `transcript_text`, `transcript_json` (word/segment array). No Mux, no Storage.
5. Form resets, `fetchVideos()`.

### 3. List / rename / delete / download transcript
- **List** (`fetchVideos`, `:46-60`): selects videos for the parish ordered by `created_at desc`. Empty state: dashed box "No videos yet…". Each row shows a Film/Play icon, an inline-editable name, size/duration/date, a transcription badge, a Mux status badge (non-YouTube only), a download button (when transcribed), and a delete button.
- **Rename** (`updateVideoName`, `:423-426`): updates `name` on **every keystroke** (`onChange`) — no debounce.
- **Download transcript** (`downloadTranscript`, `:377-421`): re-fetches `transcript_text`/`transcript_json`; if word timestamps exist, groups words into ~10-second `[m:ss]` blocks; otherwise dumps plain text. Downloads `"<name> - transcript.txt"`.
- **Delete** (`deleteVideo`, `:266-299`):
  1. Fetch `mux_asset_id`; if set, call `mux-clip` op `delete` on the source asset.
  2. Find all `blocks` where `content_json->>videoId == video.id` with non-null `mux_clip_asset_id`; delete each clip asset via Mux.
  3. If a real `storage_path` and not YouTube, remove the Storage object.
  4. Delete the `videos` row (cascade deletes dependent blocks/segments via FK).

### 4. Transcription trigger + polling (`triggerTranscription`, `:224-264`)
1. Optimistically sets the row's `transcription_status` to `processing` in local state.
2. `POST`s to the `transcribe` Edge Function with `{ videoId }` and the user's bearer token. Non-OK / throw → local state set to `failed`, return.
3. Polls `videos.transcription_status` every 5 s; when it leaves `processing`, clears interval + `fetchVideos()`. Hard stop after **5 minutes**.

### 5. Re-transcribe / retry (`TranscriptionBadge` onRetry, `:539-549`)
- The badge is a button for `pending`/`failed`/`completed` states. Clicking it:
  - YouTube video → `addYoutubeRetry(id, ytId)` re-fetches captions and rewrites transcript columns.
  - Uploaded video → `triggerTranscription(id)` again.

### 6. Student playback + progress (consumer side, `apps/web/src/routes/student/LessonViewPage.tsx`)
1. Loads blocks (`mux_clip_playback_id, mux_clip_status, clip_start_ms, clip_end_ms`) and the student's `video_watches` (`block_id, max_reached, completed`) (`LessonViewPage.tsx:101-104`).
2. A block is treated as **watched only if `completed === true`** (`:142-143`); `max_reached > 0` populates a resume point (`:147`).
3. Player choice (`:1055-1060`): if `mux_clip_playback_id` exists AND `mux_clip_status === 'ready'` → **`MuxClipPlayer`** (the clip asset IS the segment). Otherwise fall back to **`SegmentPlayer`** over the source `mux_playback_id` (HLS) enforcing `[clip_start_ms, clip_end_ms]`.
4. Both players **enforce no-skip-ahead**: seeking past `maxReached + 2s` snaps back. Progress upserts to `video_watches` with `max_reached`; on completion (last 5 s reached) `completed:true` is upserted (`:656-659`, `:1027-1043`).

## Data model

### `videos` (per-parish source/library record)
Defined in `schema.sql` + migrations. Effective columns:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes(id)` ON DELETE CASCADE | **ownership / RLS key** |
| `name` | text NOT NULL default `'Untitled Video'` | inline-editable |
| `storage_path` | text | `${parishId}/${id}.mp4` for uploads, `youtube://<id>` for YouTube, `''` initially. **Note: original schema declared NOT NULL; insert passes `''` for uploads (`VideoLibraryPage.tsx:94`).** No longer used for playback (Mux is), kept for legacy/audio-path derivation. |
| `audio_path` | text | `${parishId}/${id}.wav` in Storage; source for Whisper (`20260423000002`). |
| `duration_ms` | integer | written by `transcribe` from the **Mux** duration, not Whisper. |
| `file_size_bytes` | bigint | uploads only. |
| `mime_type` | text | |
| `transcription_status` | enum `transcription_status` `('pending','processing','completed','failed')` NOT NULL default `pending` | `20260423000000`. |
| `transcript_text` | text | full transcript. |
| `transcript_json` | jsonb | array of `{ word, start, end }` (seconds). For YouTube, each "word" is actually a caption segment. |
| `mux_asset_id` | text | source Mux asset (`20260430000000`). |
| `mux_playback_id` | text | source HLS playback id. |
| `mux_status` | text | `preparing` / `ready` / `errored`. |
| `uploaded_by` | uuid NOT NULL → `profiles(id)` | |
| `created_at` | timestamptz default now() | |

### `blocks` (lesson content; video block holds clip state)
Relevant columns (others belong to the lessons section):
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `lesson_id` | uuid → `lessons(id)` ON DELETE CASCADE | |
| `type` | `block_type` | video blocks are `type = 'video'`. |
| `content` / `content_json` | jsonb | for video blocks: `{ videoId, startMs, endMs }`. (Schema column is `content`; client/edge code reads `content_json` — same JSON column, aliased.) |
| `mux_clip_asset_id` | text | the cut clip's Mux asset (`20260430000000`). |
| `mux_clip_playback_id` | text | clip HLS playback id (what the player streams). |
| `mux_clip_status` | text | `preparing`/`ready`/`errored`. |
| `clip_start_ms` / `clip_end_ms` | int | the trim points the current clip was cut at — compared against `content_json` to detect **stale** clips. |

A `videos` row is referenced from many `blocks` via `content_json->>videoId` (a soft reference, **not** an FK). There is also a legacy `segments` table (`schema.sql:83-92`) referencing `videos(id)` directly, but the live pipeline uses block-level clip columns, not `segments`.

### `video_watches` (per-student progress; RLS-owned by student)
`20260423000003` + `20260513000001/2/3`:
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `student_id` | uuid NOT NULL → `profiles(id)` ON DELETE CASCADE | **owner** |
| `block_id` | uuid NOT NULL → `blocks(id)` ON DELETE CASCADE | |
| `watched_at` | timestamptz default now() | |
| `max_reached` | real default 0 | furthest second reached (resume point + skip-ahead ceiling). |
| `completed` | boolean NOT NULL default false | true = fully watched. |
| UNIQUE `(student_id, block_id)` | | upsert key. |

RLS: student reads/writes own rows (`video_watches_select/insert/update`); admin/teacher can read all rows for blocks in their parish (`video_watches_select_parish`, `20260428000004`).

## Key logic & algorithms

### Mux direct-upload then poll for asset id
The client never knows the asset id until after the file finishes uploading, so it polls `check-upload`:
```
// VideoLibraryPage.tsx:144-155
for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 3000));
  const uploadStatus = await callMuxEdge({ op: 'check-upload', uploadId: uploadResult.upload_id });
  if (uploadStatus.asset_id) { muxAssetId = uploadStatus.asset_id; break; }
  if (uploadStatus.status === 'errored' || uploadStatus.status === 'timed_out') { ... break; }
}
```

### Browser audio extraction for Whisper (`extract-audio.ts:8-26`)
Decodes the file's audio via `OfflineAudioContext`, **resamples to 16 kHz mono**, and hand-encodes a 44-byte-header PCM16 WAV. Comment: "~1.9MB per minute". This keeps files small and gives the transcribe function a chunkable format.

### Whisper call + WAV chunking (`transcribe/index.ts`)
- Calls OpenAI `audio/transcriptions` with `model=whisper-1`, `response_format=verbose_json`, `timestamp_granularities[]=word` (`:84-92`).
- **25 MB Whisper limit** → `MAX_WHISPER_BYTES = 24MB`. If the audio exceeds it AND is WAV, it splits into N self-contained WAV chunks (recomputing the header each time, byte-aligned to `bytesPerSample`) and **stitches word timestamps** by adding a running `timeOffset` per chunk (`:244-265`):
```
start: Math.round((w.start + timeOffset) * 1000) / 1000,
...
const chunkDurationSec = dataLength / (header.sampleRate * header.bytesPerSample);
timeOffset += chunkDurationSec;
```
- A non-WAV file over the limit **fails loudly** rather than truncating (`:268-274`).
- Source preference order: M4A (if a sibling `.m4a` exists) → WAV (`audio_path`) → video file at `storage_path` (legacy) (`:179-213`).
- **Duration comes from Mux, not Whisper** — it fetches the Mux asset's `duration` and stores `duration_ms` (`:156-173`, `:276-277`) because Whisper duration can be truncated.

### Mux clip cut + staleness (`mux-clip/index.ts:120-188`, `190-255`)
- `clip(blockId)` reads `content_json.{videoId,startMs,endMs}`, requires the **source** `mux_status === 'ready'`, deletes any existing clip asset, then creates a new asset from `mux://assets/<sourceAssetId>` with `start_time`/`end_time` in seconds, and writes `mux_clip_*` + `clip_start_ms/clip_end_ms` back to the block.
- `sync-clips()` scans all `type='video'` blocks and recuts when `!mux_clip_playback_id` (missing) OR `clip_start_ms/clip_end_ms !== content_json.startMs/endMs` (**stale**, i.e., author changed the trim). It polls each new clip up to 24×5 s (~2 min) for `ready`. Designed to be cron-driven via the `x-service-key` header.

### Seek-enforcing players
`MuxClipPlayer` (whole asset = segment) and `SegmentPlayer` (window `[startSec,endSec]` on a full asset) both:
- Attach HLS via `hls.js` (`stream.mux.com/<id>.m3u8`) or native HLS; optionally wire **Mux Data** monitoring with `viewer_user_id`, `video_id=blockId`, `custom_1=lessonId`, `custom_2=cohortId`.
- **Resume** from saved `maxReached` on `loadedmetadata`.
- **Enforce** on `timeupdate`/`seeking`/`seeked`: if not yet `watched` and current position > `maxReached + 2`, snap back (`MuxClipPlayer.tsx:134-148`, `SegmentPlayer.tsx:140-156`). `SegmentPlayer` also clamps to `[startSec,endSec]` and pauses at `endSec` (`:172-180`).
- Fire `onWatched()` when within the last 5 s, on every tick (redundant firing is intentional to avoid missed events).
- **Test mode** forces 16× playback (`isTestMode()`).

### YouTube caption fetching (two paths)
- **Browser** (`youtube-captions.ts`): fetches the watch page through the Vite dev proxy `/api/youtube/watch?v=<id>`, regexes `"baseUrl":"…/api/timedtext…"`, fetches each track (also proxied), parses **srv3** (`<p t d>`) then **classic** (`<text start dur>`) XML, decodes HTML entities. This is what `VideoLibraryPage` actually calls.
- **Server** (`youtube-transcript/index.ts`): tries the **InnerTube** Android-client API (`youtubei/v1/player`), falls back to scraping `ytInitialPlayerResponse` from the watch page (with brace-depth JSON extraction and a captcha/rate-limit guard). Parses the same XML formats. Can either update an existing `videoId` or insert a new `videos` row. **Note:** the live YouTube add flow uses the browser path; this Edge Function appears to be the production-intended path (the browser proxy only exists in Vite dev) but is not wired into `VideoLibraryPage`.

## External integrations

- **Mux Video** (`api.mux.com/video/v1`, Basic auth `MUX_TOKEN_ID:MUX_TOKEN_SECRET`): direct uploads, asset create/status/delete, clip assets (`mux://assets/<id>` with `start_time`/`end_time`), `playback_policy: ['public']`. Playback via HLS `stream.mux.com/<playbackId>.m3u8`.
- **Mux Data** (`mux-embed`, `VITE_MUX_DATA_ENV_KEY`): client-side QoE/engagement monitoring attached in both players.
- **OpenAI Whisper** (`api.openai.com/v1/audio/transcriptions`, `whisper-1`, `OPENAI_API_KEY`): word-timestamped transcription.
- **YouTube**: caption tracks via timedtext (browser proxy in dev) and InnerTube/web-page scraping (Edge Function). No official API key; relies on undocumented endpoints + a desktop/Android User-Agent.
- **Supabase Storage** (`videos` bucket): stores extracted `.wav` audio (and legacy video files); signed URLs (1 h) feed the legacy `ingest` path.
- No ICS/ical or email in this section.

## Edge cases & gotchas

- **Two-phase upload with partial cleanup:** the `videos` row is created before the file exists in Mux; on Mux upload-URL failure or PUT failure the row is deleted, but on `check-upload` timeout/`errored` (step 5) the row is **kept** with `mux_status:'errored'` and no asset id.
- **Polling is client-side only.** All Mux readiness and transcription completion polling happens in the browser. Closing the tab mid-upload abandons the polling (the asset still processes in Mux, but the row may stay `preparing` and transcription may never fire).
- **`triggerTranscription` runs before audio upload is guaranteed.** If audio upload failed, `audio_path` is null and the transcribe function falls back to the (large) video file from Storage — but uploaded videos write `storage_path` only as `${parishId}/${id}.mp4` and the **video file is never uploaded to Storage** (it went to Mux). So the legacy "download video from storage" fallback in `transcribe` will generally fail for new uploads; transcription depends on the WAV having uploaded successfully.
- **`storage_path` NOT NULL vs `''`:** the live insert sends an empty string; the original schema marked it NOT NULL. A migration must have relaxed/defaulted it or the empty string satisfies NOT NULL (empty ≠ null).
- **Rename writes on every keystroke** — no debounce; spams `UPDATE videos`.
- **`transcript_json` shape differs by source:** Whisper = true per-word `{word,start,end}`; YouTube = per-caption-segment (the `word` field holds a whole phrase). The transcript download's 10-second grouping and the student-side word-seek assume word granularity and will behave coarsely for YouTube.
- **Stale-clip detection is exact-equality on ms.** Any change to `startMs`/`endMs` re-cuts; clips are cut lazily (on `clip`/`sync-clips`), so a freshly edited block may stream the old window until synced. The player falls back to `SegmentPlayer` enforcing the *new* `clip_start_ms/clip_end_ms` if the clip isn't `ready`.
- **Seek enforcement uses a 2-second tolerance** and fires both on `seeking`/`seeked` and on every `timeupdate` (because some seeks skip the seeking event). `watched` (completed) videos are exempt.
- **Mux assets are `public`** playback policy — playback IDs are unguessable but unsigned; no per-viewer auth on the stream itself.
- **Service-role key + project URL are hard-coded** into the Edge Functions (`transcribe`, `youtube-transcript`, `mux-clip`). Must NOT be carried over.
- **YouTube scraping is fragile**: captcha/rate-limit guard exists; InnerTube client version (`20.10.38`) and User-Agent strings are pinned and will rot.
- **`delete` orphan risk:** deleting a video deletes its Mux source + all clip assets found via `content_json->>videoId`, then deletes the row. Blocks still referencing the video by JSON are cascade-deleted only if there's an FK from blocks to lessons (there is) but **not** via the soft `videoId` JSON reference — those blocks will have dangling `videoId`s unless they were the clip-bearing ones removed.

## Acceptance criteria

- [ ] `/teacher/videos` (or its Parvus Ordo equivalent) is reachable only by users with role `admin` or `teacher`; a `student` is blocked/redirected.
- [ ] The video list shows only videos whose `parish_id` matches the active parish, ordered by `created_at` descending; with none, an empty-state message renders.
- [ ] Uploading a file creates a video record, sends bytes to the video provider (Mux→Bunny), and the record's stream status transitions `preparing → ready` once the provider finishes.
- [ ] If the provider upload URL request fails OR the byte upload fails, the just-created video record is deleted and an error is surfaced.
- [ ] Audio is extracted to 16 kHz mono PCM16 WAV in the browser and stored; transcription is triggered after upload.
- [ ] Transcription of a file produces non-empty `transcript_text` and a `transcript_json` array of `{word,start,end}` with monotonically increasing `start` times, and sets `transcription_status='completed'`.
- [ ] An audio file larger than the provider limit is split into multiple chunks and the per-word timestamps in later chunks are offset so the stitched transcript is continuous (no resets to ~0).
- [ ] `duration_ms` is taken from the video provider's reported duration, not from the transcriber's (possibly truncated) duration.
- [ ] A transcription failure sets `transcription_status='failed'` and the badge offers a working **Retry** that re-runs transcription.
- [ ] Adding a YouTube video by URL or 11-char ID creates a record with `storage_path='youtube://<id>'`, no provider upload, and `transcription_status='completed'` when captions are found, `'failed'` when not.
- [ ] A YouTube video with no available captions yields `transcript_json=null` and a retry path that re-attempts caption fetch.
- [ ] Creating/editing a lesson video block with `{videoId,startMs,endMs}` produces a clip whose stored `clip_start_ms/clip_end_ms` match the block's trim points.
- [ ] Changing a block's `startMs`/`endMs` marks the clip stale and a re-cut produces a new clip matching the new trim points; the old clip asset is deleted.
- [ ] In the player, a not-yet-completed viewer who seeks beyond `max_reached + 2s` is snapped back to `max_reached` (for a segment, to `startSec + max_reached`).
- [ ] Reaching the final 5 seconds upserts `video_watches` with `completed=true`; the block is then treated as watched and seek enforcement is disabled.
- [ ] Reopening a partially watched video resumes playback at the saved `max_reached` position.
- [ ] A video block uses the pre-cut clip player when `mux_clip_status='ready'`, otherwise falls back to the segment-windowed player over the source stream.
- [ ] Deleting a video deletes its provider source asset and all clip assets for blocks referencing that `videoId`, removes stored audio, and deletes the DB row.
- [ ] Downloading a transcript of a word-timestamped video produces `[m:ss]`-prefixed ~10-second blocks; a plain-text-only transcript downloads verbatim.
- [ ] `video_watches` rows are readable/writable only by their owning student, while admin/teacher can read all watches for blocks in their parish.

## Port notes

### Layering (per `packages/core` boundary rule)
- **`packages/core`** owns ALL business logic and data access:
  - `videos` / video-asset queries (list by parish, create, rename, set status, soft refs), `video_watches` progress upsert + completion logic, clip-staleness detection (`clip_start_ms/end_ms` vs block trim), transcript grouping for download.
  - Provider abstractions already exist per the Media Module (Slice 5): an **asset/storage** abstraction (Bunny live- /stubbed) and a **transcription** abstraction (**Groq** live). Wire this pipeline to those, not directly to Mux/Whisper.
- **Server Actions** (≈10 lines each: auth → validate → call core → return): "add YouTube video", "rename video", "delete video", "trigger (re)transcription", "create/update video block clip request". No orchestration logic in the action.
- **RSC reads:** the library list and a video's transcript are direct DB reads in a Server Component, scoped by the resolved parish.
- **Route handler / `/api/v1`:** only if an external consumer or the provider needs a **webhook** endpoint (see below).
- **`infra/workers` (Queues/Cron):** this is where the heavy, currently-client-side polling belongs. Specifically:
  - **Upload → asset-ready** should be a provider **webhook → Queue job**, not browser polling.
  - **Transcription** (Groq) is a Queue job (out-of-band), updating `transcription_status`.
  - **Clip cutting / `sync-clips`** becomes a Cron job (replacing the `x-service-key` cron call) plus an on-demand Queue job triggered when a block's trim changes.
  - **Audio extraction**: today it's browser WAV via Web Audio. With Groq + Bunny, decide whether the worker extracts audio server-side (ffmpeg) or sends the source to Groq directly — the browser-WAV step is a Narthex workaround for Whisper's 25 MB limit and should not be ported verbatim.

### Provider mapping
- **Mux → Bunny Stream:** direct upload URL → Bunny upload; `mux_asset_id/mux_playback_id/mux_status` → Bunny video GUID + status; HLS `stream.mux.com/<id>.m3u8` → Bunny pull-zone HLS URL; **clip assets** — Bunny has no native server-side trim equivalent to Mux clip assets, so clips likely become **playback windows enforced client-side** (the existing seek-enforcing player) rather than separately-cut assets. This is a real behavioral change to flag: the whole `clip`/`sync-clips`/`mux_clip_*` machinery may collapse into "store start/end on the block and enforce in the player," dropping per-clip Mux assets. Mux Data monitoring has no Bunny equivalent unless replaced.
- **Whisper → Groq:** `whisper-1` `verbose_json` + word timestamps → Groq Whisper-large transcription. Preserve the `{word,start,end}` JSON contract so the player's clickable transcript / word-seek keeps working. Chunking may be unnecessary if Groq's limits differ — re-derive, don't copy the 24 MB constant.
- **OpenAI/Mux secrets:** drop the hard-coded Supabase service key + project URL entirely; use env/secret bindings.

### RLS / tenancy
- Narthex is **parish-only** for videos. Parvus Ordo's tenancy is diocese → parish; videos here map to **parish scope**. Confirm whether a video library should also exist at **diocese** scope (shared across parishes) — Narthex has no such concept, so this is a product decision, not a port.
- `video_watches` ownership (student) and teacher-parish read are straightforward to replicate with WorkOS-derived membership + Neon RLS.

### Explicit GAPS vs what Parvus Ordo already has
- **Lessons + versioning (built):** Narthex stores trim points in `blocks.content_json.{videoId,startMs,endMs}` with no versioning. Parvus Ordo's versioned lessons mean a clip/window is tied to a lesson **version** — clip-staleness must key off the versioned block, and re-cuts/window changes must respect fork-and-edit (global/diocese/parish scope) so editing a forked lesson doesn't mutate the parent's clips.
- **Media/asset manager (built):** Parvus Ordo already has the assets table + storage/transcription abstractions (Slice 5). The Narthex `videos` table should be reconciled with that asset manager rather than recreated — `videos` is essentially "an asset of kind video with transcript + provider status." YouTube "videos" are a different asset kind (external reference, transcript only, no stored bytes).
- **Seek-enforcing player + transcript (built):** the no-skip-ahead behavior, resume-from-`max_reached`, last-5s completion, and clickable transcript already exist in Parvus Ordo's player. Port the **clip-window vs separate-clip-asset** decision into that player; do not reimplement enforcement.
- **Teacher preview (built):** ensure teacher preview bypasses seek enforcement (teachers shouldn't be gated by `video_watches`), matching the existing preview mechanism.
- **Mux clip assets have no built equivalent** — the biggest gap. Either implement server-side clipping on Bunny (if available) or formally adopt client-enforced windows and migrate the `mux_clip_*`/`clip_*ms` columns into block-level trim metadata only.
- **Webhook-driven status** — Narthex polls in the browser; Parvus Ordo should add a provider webhook + Queue, which has no Narthex analog to copy.
