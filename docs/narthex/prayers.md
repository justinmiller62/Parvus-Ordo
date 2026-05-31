# Prayers

## Overview

The Prayers section is a **two-tab feature** inside Narthex:

1. **Prayer Book** — an alphabetized, searchable, categorized catalogue of Catholic prayers (e.g. Hail Mary, Our Father, the Memorare). Each prayer has a title, full prayer text, optional Latin text, a category, a "when to pray it" context, and an attribution (e.g. "St. Francis of Assisi"). Prayers come from two sources merged at runtime: a **universal/global** catalogue (`prayer_entries`, status `approved`) shared by every tenant, plus **parish-local submissions** (`prayer_submissions`, status `pending`) visible only inside the submitting parish. A parish can also create **overrides** (`prayer_overrides`) that locally rewrite the text/context of a universal prayer without forking the title.

2. **Rosary Guide** — an interactive 3D physics-based rosary (Three.js + cannon-es) embedded as a sandboxed `<iframe>` pointing at the static asset `/rosary.html` (which loads `/rosary.js`). It walks the user bead-by-bead through the Rosary with the correct prayer text and mystery for each bead. It is entirely client-side static content; it does **not** read or write Supabase.

The architecture deliberately mirrors the Dictionary feature ("Prayer book feature (same architecture as dictionary)" — `supabase/migrations/20260501000003_prayers.sql:1`): a global approved table + a per-parish submissions table + a per-parish overrides table.

This section exists so that OCIA/catechesis participants have a single normalized, doctrinally-correct prayer reference (with sacred-word capitalization enforced by `normalizeSacredText`) and so each parish can extend or locally adapt that catalogue without polluting the shared global set.

## Roles & access

Roles come from `memberships.role`, typed as `Role = 'admin' | 'teacher' | 'student'` (`packages/shared/src/constants.ts:1`).

- **All authenticated users** (any role) can **view** the Prayer Book and the Rosary Guide. The page reads `prayer_entries` where `status = 'approved'` — RLS policy `prayer_entries_read` grants `SELECT` to all `authenticated` users when `status = 'approved'` (`supabase/migrations/20260501000003_prayers.sql:23-25`).
- **Teachers and admins** (`isTeacherOrAdmin()`, `apps/web/src/routes/PrayersPage.tsx:44`) additionally see:
  - the **"Add Prayer"** button (`PrayersPage.tsx:179`),
  - the inline **edit** (pencil) control on every card (`PrayersPage.tsx:275-279`),
  - the **delete** (trash) control, but **only on parish-local entries** (`is_local`) (`PrayersPage.tsx:280-284`).
  - `canEdit` is computed once as `isTeacherOrAdmin()` with no parish argument, so it checks whether the user is admin/teacher in *any* of their memberships (`useAuth.ts:156-158`).
- **Students** see a read-only Prayer Book (no add/edit/delete controls render).
- **Super-admin / parish override:** A super-admin who has "switched parish" gets a synthetic `admin` membership for that parish injected into `memberships` (`useAuth.ts:139-148`). `parishId` used by the page is always `memberships[0]?.parishId` (`PrayersPage.tsx:43`), so an active parish override makes the page operate as an admin of the overridden parish.
- **Universal entries are read-only from the UI.** Insert/update/delete of `prayer_entries` is reserved for `service_role` (the MCP server). RLS grants `authenticated` only `SELECT` on `prayer_entries`; `GRANT ALL` is `service_role` only (`migrations/...:27-28`). The UI comment makes this explicit: "Universal entries can only be deleted via MCP (service_role)" (`PrayersPage.tsx:129`).

RLS for the writable tables:
- `prayer_submissions`: INSERT and SELECT both require the user to be `admin` or `teacher` in that `parish_id` (`migrations/...:76-86`). Note: there is **no UPDATE or DELETE policy** in the migration even though the UI issues those operations (see Edge cases).
- `prayer_overrides`: SELECT for any member of the parish; `FOR ALL` (manage) requires `admin`/`teacher` of the parish (`migrations/...:43-54`).

## User flows

### Flow A — View prayers (any user)
1. User opens the Prayers page. `activeTab` defaults to `'book'` (`PrayersPage.tsx:46`).
2. `fetchEntries()` runs on mount and whenever `parishId` changes (`PrayersPage.tsx:55`).
3. It loads universal approved prayers ordered by title, then (if a `parishId` exists) the parish's pending submissions, merges them, dedupes by lowercased title, and sorts by `localeCompare` (`PrayersPage.tsx:57-99`).
4. While loading, the Prayer Book shows "Loading prayers..." (`PrayersPage.tsx:172`).
5. Entries render grouped by first-letter headings (A, B, C…) with a count badge of total `entries.length` (`PrayersPage.tsx:177`, `115-123`, `236-238`).
6. **Empty state:** if `filtered.length === 0`, a dashed box shows. The message differentiates: `"No prayers yet."` when `entries.length === 0`, otherwise `"No prayers match your search."` (`PrayersPage.tsx:230-233`).

### Flow B — Search & filter
1. Typing in the search box filters by case-insensitive substring match against **title OR prayer_text** (`PrayersPage.tsx:105-111`).
2. Clicking a category chip (All / Basic / Marian / Devotional / Liturgical / Saints) filters by exact `category` equality; `'all'` disables the filter (`PrayersPage.tsx:102-104`, `22-29`).
3. Search and category compose (both apply). Results regroup by first letter.

### Flow C — Open a prayer (any user)
1. Clicking a prayer card sets `selectedTitle` and opens `PrayerModal` (`PrayersPage.tsx:254`, `297-303`).
2. The modal re-fetches the canonical entry **by title** via `ilike('title', title).single()` against `prayer_entries` (`PrayerModal.tsx:44-48`).
3. If `parishId` is present, it also fetches the parish override row for that entry id (`PrayerModal.tsx:53-60`).
4. Render precedence: override text/context wins over the base entry (`override?.override_prayer_text ?? entry.prayer_text`) (`PrayerModal.tsx:96-97`). When an override text is shown, a "(parish version)" note appears (`PrayerModal.tsx:142-144`).
5. All displayed text is run through `normalizeSacredText` for capitalization, except `latin_text` which is shown verbatim, italic (`PrayerModal.tsx:96-97, 111, 134, 141, 151`).
6. **Loading state:** modal shows "Loading..." (`PrayerModal.tsx:73-80`).
7. **Not-found state:** if no entry matches the title, modal shows `Prayer not found for "{title}"` with a Close link (`PrayerModal.tsx:83-94`). This happens for parish-local (`is_local`) prayers, because the modal only queries `prayer_entries`, never `prayer_submissions` (see Edge cases).
8. Clicking the backdrop or X closes the modal (`PrayerModal.tsx:101, 117`).

### Flow D — Add a parish prayer (teacher/admin)
1. Click "Add Prayer" → toggles `showAddForm` and renders `PrayerEntryForm` with no `entry` (`PrayersPage.tsx:179-198`).
2. User fills Title + Prayer Text (both required; submit is no-op if either is blank-after-trim) plus optional Latin, Category, Context, Attribution (`PrayersPage.tsx:334-336`, `382-425`).
3. On submit, a new row is inserted into `prayer_submissions` with `parish_id`, `submitted_by = userId`, `status = 'pending'` (`PrayersPage.tsx:352-357`).
4. On success the form closes and `fetchEntries()` re-runs; the new prayer appears tagged with a yellow **"Parish"** badge and is marked `is_local` (`PrayersPage.tsx:262-264`, `76-87`).

### Flow E — Edit a prayer (teacher/admin)
1. Click the pencil on a card → sets `editingId`; that card renders inline as `PrayerEntryForm` pre-filled with the entry (`PrayersPage.tsx:242-249`).
2. **Two distinct behaviors based on origin:**
   - **Parish-local entry** (`is_local`): an UPDATE is issued against `prayer_submissions` with the edited fields (`PrayersPage.tsx:348-349`). Title is editable.
   - **Universal entry** (not local): the form's Title input is **disabled** (`PrayersPage.tsx:385`), a hint "Editing creates a parish override" shows (`PrayersPage.tsx:377-379`), and on submit an **upsert** into `prayer_overrides` is made keyed on `(parish_id, entry_id)`. Only changed fields are stored: `override_prayer_text` is set only if the text differs from the base; `override_context` only if context differs (`PrayersPage.tsx:360-367`).
3. On success the inline form closes (`editingId = null`) and `fetchEntries()` re-runs.

### Flow F — Delete a prayer (teacher/admin)
1. The trash icon only renders for `is_local` entries (`PrayersPage.tsx:280`).
2. `deleteEntry` deletes from `prayer_submissions` by id, then re-fetches. For non-local entries it does nothing (the comment notes universal deletes require MCP/service_role) (`PrayersPage.tsx:125-131`). There is **no confirmation dialog**.

### Flow G — Rosary Guide
1. Click the "Rosary Guide" tab → renders `RosaryGuide`, an `<iframe src="/rosary.html">` (`PrayersPage.tsx:170`, `RosaryGuide.tsx:8-14`).
2. `rosary.html` loads `rosary.js`, builds a 61-bead 3D rosary (7-bead tail + 54-bead loop = 5 decades + 4 large beads), and lets the user advance bead-by-bead. Each bead shows its prayer (Sign of the Cross, Apostles' Creed, Our Father, Hail Mary, Glory Be, Fatima Prayer, Hail Holy Queen, Final Prayer) and, on the loop, the current Mystery (Joyful/Sorrowful/Glorious/etc.) with scripture and fruit (`public/rosary.js:5-40`).
3. Navigation: click a bead to jump, drag to swing, Space/Arrow to advance; Prev/Next/Reset buttons (`public/rosary.html:46-51`). The iframe has `allow="microphone"`.

## Data model

All three writable tables are defined in `supabase/migrations/20260501000003_prayers.sql`. Foreign keys reference `parishes(id)` and `profiles(id)` and `memberships` (for RLS).

### `prayer_entries` (GLOBAL / universal catalogue)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `title` | TEXT NOT NULL **UNIQUE** | global uniqueness; the join key used by the modal via `ilike` |
| `prayer_text` | TEXT NOT NULL | |
| `latin_text` | TEXT | optional |
| `category` | TEXT | free text; UI uses basic/marian/devotional/liturgical/saints |
| `context` | TEXT | "when to pray it" |
| `attribution` | TEXT | e.g. saint name |
| `display_order` | INTEGER NOT NULL DEFAULT 0 | present in schema + selected, but the UI sorts by title and never uses it |
| `status` | TEXT NOT NULL DEFAULT `'approved'` | RLS only exposes `approved` rows |
| `created_by` | UUID → `profiles(id)` | |
| `created_at`, `updated_at` | TIMESTAMPTZ DEFAULT now() | |

Indexes: `idx_prayer_title(title)`, `idx_prayer_status(status)`, `idx_prayer_category(category)`.
RLS: SELECT to `authenticated` when `status='approved'`; `GRANT SELECT` to `authenticated`, `GRANT ALL` to `service_role`. **No tenant scoping — this table is global to every diocese/parish.**

### `prayer_overrides` (PER-PARISH local override of a universal entry)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `parish_id` | UUID NOT NULL → `parishes(id)` ON DELETE CASCADE | tenant scope (parish) |
| `entry_id` | UUID NOT NULL → `prayer_entries(id)` ON DELETE CASCADE | the universal prayer being overridden |
| `override_text` | TEXT | **schema name** |
| `override_notes` | TEXT | **schema name** |
| | | **UNIQUE(parish_id, entry_id)** — one override per parish per prayer |

RLS: SELECT for any membership of the parish; `FOR ALL` manage for `admin`/`teacher` of the parish. `GRANT ALL` to `authenticated` and `service_role`.

> **CRITICAL SCHEMA/CODE MISMATCH (gotcha):** the migration defines columns `override_text` and `override_notes` (`migrations/...:35-36`), but **all application code uses `override_prayer_text` and `override_context`** — the upsert in `PrayerEntryForm` (`PrayersPage.tsx:361-366`) and the select in `PrayerModal` (`PrayerModal.tsx:54-60`). With the migration as written these reads/writes would fail. This implies either an undocumented later migration/manual ALTER renamed the columns, or override functionality is currently broken in the legacy app. Treat `override_prayer_text`/`override_context` as the **intended** column names for the port. Ownership/RLS is parish-scoped.

### `prayer_submissions` (PER-PARISH local prayers)
| Column | Type | Notes |
|---|---|---|
| `id` | UUID PK | |
| `parish_id` | UUID NOT NULL → `parishes(id)` ON DELETE CASCADE | tenant scope |
| `title` | TEXT NOT NULL | NOT globally unique (unlike `prayer_entries.title`) |
| `prayer_text` | TEXT NOT NULL | |
| `latin_text` | TEXT | |
| `category` | TEXT | |
| `context` | TEXT | |
| `attribution` | TEXT | |
| `submitted_by` | UUID NOT NULL → `profiles(id)` | |
| `status` | TEXT NOT NULL DEFAULT `'pending'` | UI only ever shows/creates `pending` |
| `created_at` | TIMESTAMPTZ DEFAULT now() | |

RLS: INSERT + SELECT for `admin`/`teacher` of the parish only. **No UPDATE/DELETE policy defined** despite the UI calling both. `GRANT ALL` to `authenticated` and `service_role`.

### Relationships
- A `prayer_override` belongs to exactly one `prayer_entry` (`entry_id`) and one `parish` (`parish_id`); unique per pair.
- `prayer_submissions` and `prayer_overrides` both cascade-delete when their `parish` is deleted.
- There is **no foreign key** between `prayer_submissions` and `prayer_entries`; a local submission is an independent prayer, deduped against universal prayers only at runtime by lowercased title.
- Read-side dependency: `memberships` (user_id, parish_id, role) drives all RLS for the parish-scoped tables.

## Key logic & algorithms

**Merge + dedup of universal and parish prayers** (`PrayersPage.tsx:90-98`):
```ts
const universalMap = new Map((universal ?? []).map((e) => [e.title.toLowerCase(), { ...e, is_local: false }]));
for (const local of localEntries) {
  if (!universalMap.has(local.title.toLowerCase())) {
    universalMap.set(local.title.toLowerCase(), local);
  }
}
setEntries([...universalMap.values()].sort((a, b) => a.title.localeCompare(b.title)));
```
Universal wins on title collision — a parish submission with the same (lowercased) title as a universal prayer is silently hidden. Local entries are tagged `is_local: true`, universal `is_local: false`.

**Override diffing on edit** (`PrayersPage.tsx:360-366`): when editing a universal entry, only the *changed* fields are persisted as overrides; unchanged fields are written as `null`, so the modal falls back to the base entry. Title is immutable for universal entries.

**Override precedence at read** (`PrayerModal.tsx:96-97`):
```ts
const prayerText = normalizeSacredText(override?.override_prayer_text ?? entry.prayer_text);
const contextText = normalizeSacredText(override?.override_context ?? entry.context ?? '');
```

**Sacred-text normalization** (`apps/web/src/lib/sacred-text.ts:81-87`): a regex pass that force-capitalizes ~50 divine names, sacraments, and sacred terms (God, Jesus, Christ, Holy Spirit, Eucharist, Rosary, etc.), applied longest-phrase-first. Applied to titles, prayer text, and context on display — **not** to Latin text. `normalizeSacredHtml` exists for HTML strings but is not used by this section.

**First-letter grouping** (`PrayersPage.tsx:115-123`): groups filtered entries by `title[0].toUpperCase()` (falls back to `'#'`), then sorts group keys via `localeCompare`.

**Modal lookup by title (not id)** (`PrayerModal.tsx:44-48`): the card passes `entry.title` (not id); the modal re-queries `prayer_entries` with `ilike('title', title).single()`. This means the modal always shows the *universal* prayer for that title.

## External integrations

- **Three.js + cannon-es** (Rosary Guide): loaded from `https://esm.sh/three@0.160.0` and `https://esm.sh/cannon-es@0.20.0` directly in `public/rosary.js:1-2`. The 3D rosary is rendered/physics-simulated in a sandboxed static `<iframe>` (`/rosary.html`) to keep the physics engine isolated from React (`RosaryGuide.tsx:1-4`).
- **MCP server / `service_role`** (`packages/mcp-server/src/tools.ts:1116-1175`): the only writer of universal `prayer_entries`. Tools: `createPrayerEntry`, `updatePrayerEntry`, `deletePrayerEntry`, `listPrayerEntries`, `getPrayerEntry`. These bypass RLS via the service-role client and are how the global catalogue is curated/seeded.
- **No Mux, no Whisper/OpenAI, no ICS/ical, no email, no YouTube.** This section has zero media, transcription, calendar, or email integrations. (The iframe declares `allow="microphone"` but no microphone code is present in the inspected files.)

## Edge cases & gotchas

- **Schema vs code column mismatch on `prayer_overrides`** (see Data model): code uses `override_prayer_text`/`override_context`; migration defines `override_text`/`override_notes`. Override save and the modal's override read would error against the migration as written. Resolve this explicitly in the port.
- **Missing RLS policies on `prayer_submissions` for UPDATE/DELETE:** the UI issues `update(...)` (edit local, `PrayersPage.tsx:349`) and `delete()` (`PrayersPage.tsx:127`), but the migration only defines INSERT and SELECT policies. Under strict RLS these mutations would be denied (Postgres RLS defaults to deny for unlisted commands). Either there is an undocumented additional policy, or local edit/delete is silently failing in legacy.
- **Local prayers can't be opened in the modal:** clicking a parish-local card sets `selectedTitle`, but the modal only queries `prayer_entries`; a local-only title yields the "Prayer not found" state (`PrayerModal.tsx:83-94`). Local prayers are effectively list-only.
- **Title dedup hides parish prayers:** a parish submission whose title matches a universal title is dropped from the list entirely (universal wins, `PrayersPage.tsx:91-96`).
- **No optimistic UI / refetch-on-every-write:** every mutation calls `fetchEntries()` which re-queries both tables. No race-condition guard; rapid edits can interleave.
- **No delete confirmation** (`PrayersPage.tsx:125`).
- **`display_order` is dead in the UI:** stored and selected but never used for ordering; everything sorts by title.
- **`canEdit` is global, not per-parish:** `isTeacherOrAdmin()` is called with no `parishId`, so a teacher in *any* parish sees edit controls, but writes always target `memberships[0].parishId` (`PrayersPage.tsx:43-44`). With multiple memberships this can target the wrong parish.
- **Non-null assertions** `parishId!` and `user!.id` are passed to the form (`PrayersPage.tsx:193-194, 245-246`); if a teacher has no parish membership these would be undefined at runtime.
- **`ilike('title', title).single()`** will throw if two `prayer_entries` rows differ only by case — prevented in practice by the `UNIQUE` constraint on `title`, but case-insensitive collisions are still possible.
- **Submissions never surface to students or get an approval flow in the UI:** `status` stays `pending`; there is no in-app promotion of a submission to a universal entry (that would be an MCP/service_role action).

## Acceptance criteria

- [ ] An authenticated student can view the Prayer Book and see all `prayer_entries` rows with `status='approved'`, and cannot see Add/Edit/Delete controls.
- [ ] A teacher or admin sees the "Add Prayer" button, a pencil (edit) control on every card, and a trash (delete) control only on parish-local entries.
- [ ] The Prayer Book merges universal approved prayers with the current parish's `pending` submissions, and when a local title matches (case-insensitively) a universal title, the universal entry is shown and the local one is hidden.
- [ ] Parish-local prayers render with a "Parish" badge; universal prayers do not.
- [ ] Searching filters entries by case-insensitive substring match against both title and prayer_text; clearing the search restores the full list.
- [ ] Selecting a category chip filters to that exact `category`; selecting "All" removes the category filter; search and category filters compose.
- [ ] Entries are grouped under first-letter headings and sorted alphabetically by title.
- [ ] With zero entries the empty state reads "No prayers yet."; with entries present but none matching the filter it reads "No prayers match your search."
- [ ] Clicking a universal prayer opens a modal that loads the entry by title and displays category, context ("When to Pray"), prayer text, and Latin text when present.
- [ ] When a parish override exists for the opened prayer, the modal shows the override text/context instead of the base, and renders a "(parish version)" note.
- [ ] Adding a prayer inserts into `prayer_submissions` with `parish_id`, `submitted_by`, and `status='pending'`, and the new prayer appears in the list after save.
- [ ] Submitting the Add/Edit form with an empty title or empty prayer text (after trim) performs no write.
- [ ] Editing a parish-local entry issues an UPDATE on `prayer_submissions`; editing a universal entry disables the title field and upserts a row into `prayer_overrides` keyed on `(parish_id, entry_id)`.
- [ ] When editing a universal entry, only changed fields are written to the override (unchanged fields stored as null so the base value still shows).
- [ ] Deleting a parish-local entry removes it from `prayer_submissions` and the list refreshes; no delete control or action exists for universal entries.
- [ ] `normalizeSacredText` capitalizes divine/sacred terms (e.g. "god"→"God", "rosary"→"Rosary") in titles, prayer text, and context, but Latin text is displayed verbatim.
- [ ] The Rosary Guide tab renders an iframe to `/rosary.html` and is viewable by any authenticated user without touching Supabase.
- [ ] RLS denies a student (or a teacher of a different parish) from inserting into `prayer_submissions` or `prayer_overrides` for a parish they do not have admin/teacher membership in.
- [ ] Universal `prayer_entries` cannot be inserted, updated, or deleted by an `authenticated` client (only `service_role`/MCP).

## Port notes

**Boundary placement (per ParvaOrdo CLAUDE.md — logic in `packages/core`, thin callers elsewhere):**

- **`packages/core`** owns all prayer logic and data access:
  - `listPrayers({ parishId })` — fetch global approved prayers + parish submissions, perform the merge/dedup-by-title and alphabetical sort server-side. This is the merge currently in `PrayersPage.tsx:90-98`; move it into core.
  - `getPrayer({ title, parishId })` — load the global entry + parish override, apply override precedence.
  - `createParishPrayer`, `updateParishPrayer`, `deleteParishPrayer` (submissions), `upsertPrayerOverride` (override diff logic from `PrayersPage.tsx:360-366`).
  - `normalizeSacredText` is pure and should move into core as a shared utility (used by both reads and any future seeding/import).
  - Zod validators for the prayer form fields (title/prayer_text required, the rest optional).
- **Reads → RSC** calling `core.listPrayers` / `core.getPrayer` directly (the Prayer Book list and the modal detail are reads).
- **Mutations → Server Actions** (~10 lines each: WorkOS auth → role check → validate → call core → return): add/edit/delete parish prayer, upsert override. Role gate = admin/teacher of the target parish.
- **Client-reactive bits** (search box, category filter, tab switching, modal open/close) stay client-side; filtering can remain client-side over the RSC-provided list, or move to a tRPC query if the catalogue grows large.
- **External-consumer REST** and **infra/workers** are **not needed** for this section — there is no out-of-band work (no transcription, embeddings, email). Curating the global catalogue (today's MCP `service_role` tools) maps to an **admin-only / super-admin Server Action or a small internal route**, not a worker.

**RLS / tenancy mapping (Neon + RLS, diocese → parish → ministry → member):**
- `prayer_entries` is **global scope** in Narthex (no tenant column). ParvaOrdo has a three-tier content model (global / diocese / parish). **Decision needed:** keep prayers purely global, or promote to the lesson-style three-tier scope so a *diocese* can also maintain a catalogue. The faithful 1:1 port is **global + per-parish overrides + per-parish submissions**; adding a diocese tier is an enhancement, not a port requirement.
- `prayer_overrides` and `prayer_submissions` are **parish-scoped**; map directly to ParvaOrdo's parish RLS. Reproduce the `(parish_id, entry_id)` unique constraint on overrides.
- **Fix the schema/code column mismatch** during the port: standardize on `override_prayer_text` / `override_context` (what the code actually uses) and **add the missing UPDATE/DELETE RLS policies on `prayer_submissions`** (admin/teacher of the parish) so edit/delete actually work under RLS.

**Mux→Bunny / Whisper→Groq:** **Not applicable.** This section has no video and no audio/transcription. The `allow="microphone"` on the rosary iframe is unused; drop it unless a future voice feature is planned.

**Explicit GAPS vs. what ParvaOrdo already has:**
- **Lessons-with-versioning / fork-and-edit:** ParvaOrdo already has a three-tier lesson scope with fork-and-edit and versioning. The prayer "override" pattern is a *simpler, ad-hoc* version of fork-and-edit (one override row per parish per prayer, only text/context, no version history). The port can either (a) reuse the existing fork-and-edit/versioning machinery for prayer overrides (gaining history + diocese tier) or (b) keep the lightweight override table. Reusing the lesson versioning is the higher-leverage choice but is a behavior change, not a faithful port.
- **Media/asset manager, seek-enforcing player + transcript, teacher preview:** **None apply** to Prayers — there is no media. No work needed.
- **Rosary Guide is a self-contained static asset.** Port it as a static `/rosary.html` + `/rosary.js` (or a route serving the same) embedded via iframe; pin Three.js/cannon-es versions (currently esm.sh CDN — consider bundling for offline/CSP reasons). It needs no backend, no auth beyond page access, and no core logic.
- **Approval workflow for submissions does not exist in the UI.** If ParvaOrdo wants parish submissions to be promotable to the global catalogue, that flow must be built new (a super-admin Server Action), since Narthex only creates `pending` rows and curates globals out-of-band via MCP.
