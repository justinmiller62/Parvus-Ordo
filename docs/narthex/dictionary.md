# Dictionary

## Overview

The Dictionary is a catechetical glossary of Catholic terms (the "universal dictionary") with optional per-parish customization. Each entry is a headword (e.g., `believe`, `eucharist`, `holy spirit`) carrying a liturgical/Catholic definition plus optional Greek and Hebrew roots and a "first-century context" note describing how a first-century Jew would have understood the term. Entries are categorized (biblical / sacramental / liturgical / doctrinal) and can declare spelling/inflection `variants` (e.g., `believes, believing, belief`).

It exists for two reasons:

1. **A standalone reference page** (`/dictionary`) where any signed-in user can browse, search, and filter terms alphabetically, and open a detail modal.
2. **In-context highlighting inside lessons.** The lesson reader (`LessonViewPage`) loads the dictionary word set and underlines the first occurrence of any matched headword/variant in reading blocks and video transcripts; clicking an underlined word opens the same detail modal. (See `lib/dictionary.ts` and `LessonViewPage.tsx` — that highlighting is part of the lesson reader, not duplicated in this section, but it consumes the dictionary data this section defines.)

There are three layers of data, in precedence order for what a parish sees:
- **Universal entries** (`dictionary_entries`, `status='approved'`) — global, managed only by the platform owner via the MCP server (`service_role`). All users read these.
- **Parish overrides** (`dictionary_overrides`) — a parish admin/teacher can override individual fields (definition, greek/hebrew definition, first-century context) of a universal entry for their parish only.
- **Parish submissions** (`dictionary_submissions`, `status='pending'`) — net-new terms proposed by a parish admin/teacher. They are visible locally to that parish (badged "Parish") and await approval into the universal dictionary via MCP.

## Roles & access

Roles come from `memberships.role` (`admin` | `teacher` | `student`), resolved in `apps/web/src/hooks/useAuth.ts`. The page uses:
- `parishId = memberships[0]?.parishId` — the user's first membership's parish (no explicit parish picker on this page; relies on the active membership / parish override).
- `canEdit = isTeacherOrAdmin()` — `hasRole('admin') || hasRole('teacher')` (`useAuth.ts:156`).

Access matrix:
- **All authenticated users** (including `student`): can view the page, search, filter, and open the detail modal. RLS lets any authenticated user `SELECT` approved universal entries (`dictionary_entries_read`).
- **Students**: read-only. They never see the "Add Entry" button, the per-row edit/delete controls, or any parish submission. RLS blocks students from `dictionary_submissions` entirely (insert + select policies require role in `('admin','teacher')`), and from `dictionary_overrides` writes.
- **Teacher / Admin**: see the "Add Entry" button, can create parish submissions, edit parish submissions, edit universal entries (which creates a parish override rather than mutating the universal entry), and delete their own parish submissions. They can read their parish's submissions and overrides.
- **Platform owner (service_role, via MCP server only)**: the only actor that can create/update/delete universal entries and approve/reject submissions. There is no in-app UI for this.

Note: `parishes.dictionary_enabled` (boolean, default true) exists in the migration as a per-parish feature toggle, but **it is not enforced anywhere in the web client** — the route is always mounted (`App.tsx:182`) and `fetchEntries` never checks it. This is a latent/unused gate (see Gotchas).

## User flows

### 1. Browse & search (any role)
1. User navigates to `/dictionary`. `fetchEntries()` runs on mount and whenever `parishId` changes (`DictionaryPage.tsx:54`).
2. It fetches universal approved entries (`dictionary_entries` where `status='approved'`, ordered by `headword`) and, if the user has a `parishId`, the parish's `pending` submissions from `dictionary_submissions`.
3. Entries are merged into a `Map` keyed by lowercased headword; a local submission is added **only if no universal entry already has that headword** (universal wins on collision — `DictionaryPage.tsx:96-100`). The merged list is sorted by `headword.localeCompare`.
4. The list renders grouped by first letter (uppercased), with a sticky letter header per group. Headwords and definition previews are passed through `normalizeSacredText` for display capitalization. Each row shows: capitalized headword, optional `/pronunciation/`, a "Parish" badge if `is_local`, a 100-char definition preview, the category pill (color-coded), and "Greek"/"Hebrew" tags if those fields exist.
5. The header shows a count badge of `entries.length` (the full merged list, not the filtered subset).
6. **Loading state**: while fetching, renders `Loading dictionary...`.
7. **Search**: typing in the search box filters client-side (memoized) by headword, definition, or any variant containing the lowercased query (`DictionaryPage.tsx:106-118`).
8. **Category filter**: the pills (`All / Biblical / Sacramental / Liturgical / Doctrinal`) filter by exact `category` match. Note: parish submissions have `category = null`, so any non-"all" category filter hides all parish submissions.
9. **Empty states**: if the merged list is empty → `No dictionary entries yet.`; if the list is non-empty but the filter/search yields nothing → `No entries match your search.`

### 2. Open detail modal (any role)
1. Clicking a row sets `selectedHeadword` and mounts `DictionaryEntryModal` (`DictionaryEntryModal.tsx`).
2. The modal re-fetches the entry from `dictionary_entries` by `ilike('headword', headword)` `.single()`, then (if `parishId`) fetches matching `dictionary_overrides` rows for that entry+parish.
3. Fields are resolved via `getField(fieldName, fallback)`: if a parish override exists for that field it wins, else the universal value. Override notes render as "(parish note) …".
4. Sections shown when present: Definition, Greek (word + def), Hebrew (word + def), First-Century Context, Catechism References (joined by `, `), Scripture References (joined by `, `). Definition and first-century text are `normalizeSacredText`-ed.
5. **Loading state**: "Loading..." card. **Not-found state**: `Entry not found for "{headword}"` with a Close button — happens for a parish-submission headword (those live in `dictionary_submissions`, not `dictionary_entries`, so the `.single()` lookup fails).
6. Clicking the backdrop or the X closes (`onClose`); clicks inside the card are stopped from propagating.

### 3. Add a new entry (teacher/admin)
1. Click "Add Entry" → toggles inline `DictionaryEntryForm` (no `entry` prop = create mode).
2. Fields: Headword (required), Variants (comma-separated), Definition (required), and a collapsible "Greek, Hebrew & Historical Context" section (Greek word/def, Hebrew word/def, First-Century Context).
3. On submit, with empty headword or definition the handler returns silently (no submit). Otherwise the headword is lowercased+trimmed; variants are split on `,`, trimmed, empties filtered (or `null`); empty optional fields become `null`.
4. Insert goes to `dictionary_submissions` with `parish_id`, `submitted_by = userId`, `status='pending'` (`DictionaryPage.tsx:327-332`). It does NOT go to the universal dictionary.
5. On success → form closes and `fetchEntries()` re-runs; the new term appears with a "Parish" badge.

### 4. Edit an entry (teacher/admin)
1. Click the pencil on a row → inline `DictionaryEntryForm` in edit mode (`entry` prop set).
2. **If the entry is a parish submission** (`is_local`): `UPDATE dictionary_submissions … WHERE id = entry.id` with the new field values.
3. **If the entry is a universal entry** (not local): the Headword field is disabled, a "Editing creates a parish override" hint shows, and on submit an `upsert` into `dictionary_overrides` runs keyed on `(parish_id, entry_id)`, writing only fields that changed vs the universal value (unchanged fields stored as `null`) (`DictionaryPage.tsx:335-343`).
4. On success → exits edit mode and refetches.

### 5. Delete an entry (teacher/admin)
1. The trash icon appears **only** on parish submissions (`is_local`). Clicking it `DELETE`s the row from `dictionary_submissions` and refetches.
2. Universal entries have no delete control in-app; the inline comment states they "can only be deleted via MCP (service_role)" (`DictionaryPage.tsx:134`).

## Data model

Defined in `supabase/migrations/20260501000002_dictionary.sql`.

### `dictionary_entries` (universal glossary)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| headword | text NOT NULL **UNIQUE** | lowercased on write |
| variants | text[] | inflections/synonyms |
| pronunciation | text | |
| definition | text NOT NULL | |
| greek_word | text | |
| greek_definition | text | |
| hebrew_word | text | |
| hebrew_definition | text | |
| first_century_context | text | |
| catechism_references | text[] | displayed only in modal |
| scripture_references | text[] | displayed only in modal |
| category | text | `biblical`/`sacramental`/`liturgical`/`doctrinal` (free text, not constrained) |
| status | text NOT NULL DEFAULT `'approved'` | page reads only `'approved'` |
| created_by | uuid FK → `profiles(id)` | |
| created_at / updated_at | timestamptz NOT NULL DEFAULT now() | |

Indexes: `idx_dictionary_headword(headword)`, `idx_dictionary_status(status)`.
RLS: `dictionary_entries_read` — `authenticated` may SELECT where `status='approved'`. Writes granted only to `service_role` (authenticated has SELECT only). **No ownership/tenancy column — universal and global.**

### `dictionary_overrides` (per-parish field overrides)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| parish_id | uuid NOT NULL FK → `parishes(id)` ON DELETE CASCADE | tenancy key |
| entry_id | uuid NOT NULL FK → `dictionary_entries(id)` ON DELETE CASCADE | |
| override_definition | text | |
| override_greek_definition | text | |
| override_hebrew_definition | text | |
| override_first_century_context | text | |
| override_notes | text | |
| created_at | timestamptz | |
| | | **UNIQUE(parish_id, entry_id)** |

RLS: read where `parish_id IN (memberships of auth.uid())`; manage (ALL) where `parish_id IN (memberships of auth.uid() with role in ('admin','teacher'))`. **Ownership = parish membership.**

> **SCHEMA/CODE MISMATCH (load-bearing bug):** The migration defines overrides as wide columns (`override_definition`, …). The Form writes that wide shape via `upsert(..., { onConflict: 'parish_id,entry_id' })` (`DictionaryPage.tsx:336-343`). But `DictionaryEntryModal` reads a **different, narrow EAV shape** — `.select('field_name, override_value, notes')` and resolves overrides by `field_name`/`override_value` (`DictionaryEntryModal.tsx:60-86`). Those columns do not exist in the migrated table. So as migrated, **parish overrides are written but never successfully read back by the modal** (the select references nonexistent columns). The port must pick ONE shape. (See Port notes.)

### `dictionary_submissions` (parish-proposed new terms)
| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| parish_id | uuid NOT NULL FK → `parishes(id)` ON DELETE CASCADE | tenancy key |
| headword | text NOT NULL | |
| variants | text[] | |
| definition | text NOT NULL | |
| greek_word / greek_definition / hebrew_word / hebrew_definition / first_century_context | text | |
| submitted_by | uuid NOT NULL FK → `profiles(id)` | |
| status | text NOT NULL DEFAULT `'pending'` | page reads only `'pending'`; MCP sets `'accepted'`/`'rejected'` |
| created_at | timestamptz | |

RLS: insert + select both require `parish_id IN (memberships of auth.uid() with role in ('admin','teacher'))`. **Students cannot read or write submissions at all** (enforced by RLS; e2e TC-44 verifies anon/student gets `[]`). No update/delete policy is declared, but `GRANT ALL ON dictionary_submissions TO authenticated` is granted — the in-app delete relies on the ALL grant plus there being no restrictive policy beyond insert/select (note: with RLS enabled and no UPDATE/DELETE policy, those operations should actually be denied by Postgres RLS — see Gotchas).

### `parishes.dictionary_enabled`
`BOOLEAN NOT NULL DEFAULT true` added to `parishes`. Intended feature toggle; not read by the client.

### Related (read-only consumers)
- `memberships(user_id, parish_id, role)` — drives RBAC and tenancy in all policies.
- `profiles(id, is_super_admin)` — FK target for `created_by`/`submitted_by`.

## Key logic & algorithms

**Three-layer merge (universal + local, universal wins).** `DictionaryPage.tsx:95-102`:
```ts
const universalMap = new Map((universal ?? []).map((e) => [e.headword.toLowerCase(), { ...e, is_local: false }]));
for (const local of localEntries) {
  if (!universalMap.has(local.headword.toLowerCase())) {
    universalMap.set(local.headword.toLowerCase(), local);
  }
}
```
A parish submission with the same headword as a universal entry is silently dropped from the list (the universal one shows instead).

**Edit-creates-override (no in-app mutation of universal entries).** `DictionaryPage.tsx:335-343`: editing a universal entry upserts a per-parish override storing only the *diff* (changed fields), leaving unchanged fields `null`.

**Headword normalization on write.** Always `headword.trim().toLowerCase()` (`DictionaryPage.tsx:313`); display re-capitalizes the first letter and runs `normalizeSacredText`.

**Sacred-text capitalization** (`lib/sacred-text.ts`): an ordered list of `[RegExp, replacement]` pairs force-capitalizes divine names, sacraments, liturgical terms, etc., case-insensitively, with multi-word phrases listed before single words so "Holy Spirit" is fixed before "spirit". Applied to displayed headwords, definition previews, and modal text. `normalizeSacredHtml` applies it only to text between `>` and `<` so tags/attributes are untouched.

**Modal field resolution** (`DictionaryEntryModal.tsx:78-81`): `getField` returns the parish override value if one exists for that `field_name`, else the universal fallback (currently broken per the schema mismatch above).

**Phrase-aware highlighting in lessons** (`lib/dictionary.ts`, consumed by `LessonViewPage.tsx`):
- `buildDictIndex` builds: a set of first-words that could start a match, a `phrase → headword` map (headword + each variant, all `normalizeWord`-ed: lowercased, leading/trailing punctuation incl. smart quotes stripped), and the phrase list sorted **longest-first** (`dictionary.ts:51`) for greedy multi-word matching.
- `matchPhraseAt` (`dictionary.ts:87`) tries the longest phrases first so `spirit` does not match inside `Holy Spirit`.
- `highlightDictionaryWords` (`dictionary.ts:144`) walks DOM text nodes, and **only highlights the first occurrence of each headword** (`highlightedHeadwords` set, `dictionary.ts:152,187`), wrapping it in `<span class="dictionary-word" data-headword=...>` with a dotted rose underline. Click handling reads `dataset.headword` to open the modal (`LessonViewPage.tsx:742-745`).

**MCP approval flow** (`packages/mcp-server/src/tools.ts:1087-1113`): `approveDictionarySubmission` reads the submission, inserts a new `dictionary_entries` row (headword lowercased, `status='approved'`, `created_by = submitted_by`), then sets the submission `status='accepted'`. `rejectDictionarySubmission` just sets `status='rejected'`. MCP also exposes create/update/delete/list/get universal-entry tools (`tools.ts:1020-1080`), all via `service_role`.

## External integrations

None directly. This section is pure Supabase Postgres (Vite client `lib/supabase`). No Mux, Whisper/OpenAI, ICS, email, or YouTube.

Indirect: the same dictionary data feeds the lesson reader's transcript/reading highlighting (`LessonViewPage.tsx`), and that page consumes Mux video + Whisper-generated transcripts elsewhere — but the dictionary itself touches none of those services. The only privileged "integration" is the **MCP server** (`packages/mcp-server`) acting as the platform-owner admin surface over `service_role` for managing universal entries and approving/rejecting submissions.

## Edge cases & gotchas

- **Overrides write/read schema mismatch** (see Data model): the migrated `dictionary_overrides` table has wide columns; the modal reads a nonexistent `field_name`/`override_value`/`notes` shape. As shipped, parish overrides do not display. Must be reconciled on port.
- **Parish submissions can't open in the modal:** the modal queries `dictionary_entries` only. A `is_local` submission row is not in that table, so clicking it yields the "Entry not found" state.
- **Category filter hides all parish entries:** submissions have `category = null`, so selecting any category other than "All" drops every parish submission.
- **Header count vs filtered count:** the count badge uses `entries.length` (merged total), not the filtered/visible count.
- **First-letter grouping of non-letters:** grouping uses `headword[0].toUpperCase() ?? '#'`; a headword starting with a digit/symbol groups under that char (or `#` if empty), and `localeCompare` ordering may place it oddly.
- **Headword uniqueness is global only:** `dictionary_entries.headword` is UNIQUE platform-wide. Two parishes can submit the same headword (submissions aren't unique), and approving the second would violate the universal UNIQUE constraint (insert fails).
- **Delete relies on grants over policy:** `dictionary_submissions` has only INSERT and SELECT policies but `GRANT ALL`. Under Postgres RLS with no UPDATE/DELETE policy, those operations are normally denied — the in-app edit (UPDATE) and delete (DELETE) of submissions may silently fail under RLS. Verify and add explicit policies on port.
- **No optimistic UI / no error surfacing:** every Supabase call ignores the returned `error`; failures are silent and only a refetch reflects (or fails to reflect) the change.
- **`parishId` from `memberships[0]`:** a multi-parish user only ever sees their first membership's parish data; there is no per-page parish switcher (relies on the global parish override in `useAuth`).
- **`dictionary_enabled` toggle is dead:** defined but never checked, so the feature can't actually be disabled per parish as the schema implies.
- **First-occurrence-only highlighting** in lessons means later mentions of the same term are not underlined; this is intentional but can surprise.

## Acceptance criteria

- [ ] A signed-in student can load `/dictionary` and see approved universal entries grouped alphabetically by first letter with sticky letter headers.
- [ ] A student sees no "Add Entry" button and no per-row edit/delete controls.
- [ ] Searching filters the visible list by headword, definition, OR any variant (case-insensitive substring), client-side.
- [ ] Selecting a category pill shows only entries whose `category` matches exactly; "All" shows everything; parish submissions (category null) are hidden under any non-"All" filter.
- [ ] Empty database shows "No dictionary entries yet."; a non-empty list with no matches shows "No entries match your search."
- [ ] Clicking an entry opens a modal that fetches the entry by case-insensitive headword and renders only the sections that have data (definition, greek, hebrew, first-century, catechism refs, scripture refs).
- [ ] When a parish override exists for a field, the modal displays the override value instead of the universal value and shows the override note as "(parish note) …". (Port must fix the read/write schema so this actually works.)
- [ ] A teacher/admin sees "Add Entry"; submitting a new term inserts into `dictionary_submissions` with `status='pending'`, `parish_id`, and `submitted_by`, NOT into the universal dictionary.
- [ ] A new submission appears in the list badged "Parish" and is deduped out if a universal entry shares its (lowercased) headword.
- [ ] Submitting with an empty headword or empty definition performs no write.
- [ ] Editing a universal entry (teacher/admin) disables the headword field and upserts a `dictionary_overrides` row keyed on `(parish_id, entry_id)`, storing only changed fields and leaving unchanged fields null.
- [ ] Editing a parish submission updates the `dictionary_submissions` row in place.
- [ ] The delete (trash) control appears only on parish submissions and deletes the `dictionary_submissions` row; universal entries have no in-app delete.
- [ ] RLS: an anonymous/student client querying `dictionary_submissions` receives an empty result (or 4xx), never another parish's submissions (e2e TC-44).
- [ ] RLS: a teacher/admin can read/write only their own parish's `dictionary_submissions` and `dictionary_overrides`.
- [ ] Headwords are stored lowercased+trimmed; variants are split on commas, trimmed, and empties removed.
- [ ] Display capitalizes the first letter and applies sacred-text normalization (e.g., "god" → "God", "holy spirit" → "Holy Spirit").
- [ ] In the lesson reader, only the first occurrence of each matched headword/variant is underlined, longest-phrase-first (e.g., "Holy Spirit" matches as a phrase, not "Spirit" inside it), and clicking it opens the entry modal.

## Port notes

Map to Parvus Ordo (Next.js 16 App Router, `packages/core` backend boundary, Neon + RLS, WorkOS, Bunny, Groq).

**Tables / tenancy.** Recreate three tables in Neon with RLS:
- `dictionary_entries` — global scope (no tenancy column). This is the natural home for the **three-tier lesson scope** model already in Parvus Ordo: treat universal entries as the `global` scope, and consider adding optional `diocese_id` for a future `diocese` scope. Read policy: any authenticated user reads `status='approved'`.
- `dictionary_overrides` — parish-scoped (`parish_id` tenancy). **Decide the shape and stop the mismatch:** prefer the **wide-column** shape from the migration (matches the Form's diff-based upsert and is simpler), and rewrite the modal read to consume wide columns + `override_notes`. Drop the EAV `field_name/override_value` read path entirely.
- `dictionary_submissions` — parish-scoped. Add explicit UPDATE and DELETE RLS policies (the legacy version relied on a GRANT and would likely be RLS-denied). Tie ownership to parish membership with role in `('admin','teacher')`, consistent with Parvus Ordo's diocese→parish→ministry RBAC.

**Where logic lives (packages/core is the only place for business logic):**
- `packages/core` gets: `listDictionary({ parishId })` (universal-approved + parish pending submissions, with the merge/dedup-by-lowercased-headword/universal-wins rule), `getEntry({ headword, parishId })` (universal + override resolution), `createSubmission`, `updateSubmission`, `deleteSubmission`, `upsertOverride`, plus validators (Zod) enforcing required headword/definition, lowercase+trim of headword, variant parsing. Also move `normalizeWord`, `buildDictIndex`, `matchPhraseAt`, `findDictionaryTerms` here as pure functions (no DOM). `highlightDictionaryWords` is DOM-dependent and should be split: the matching/indexing in `core`, the span-wrapping in a client component.
- **RSC reads:** the `/dictionary` list and the entry-detail load are reads → render in a Server Component calling `core.listDictionary` / `core.getEntry` directly against the DB (RLS-scoped to the request's parish). Search/category filtering stays client-side over the fetched set (it's small) or becomes a query param.
- **Server Actions (thin, ~10 lines: auth → validate → call core → return):** "Add Entry", "Edit" (submission update or override upsert), "Delete submission". Each checks `isTeacherOrAdmin` for the active parish, validates, calls the matching `core` function.
- **tRPC:** only if the page needs client-reactive refetch after mutations; otherwise Server Actions + revalidate is enough.
- **Route handler (`/api/v1`):** none needed unless an external consumer wants the glossary.
- **infra/workers:** none required. If a future feature pre-computes a per-parish merged dictionary or builds a search index, that belongs in a Worker, not a request path.
- **MCP/admin surface:** the platform-owner operations (create/update/delete universal entries, approve/reject submissions) should be Server Actions guarded by super-admin (`profiles.is_super_admin` equivalent / WorkOS role), all calling `core`. `approveSubmission` = insert into `dictionary_entries` (lowercased headword, `status='approved'`) + mark submission `accepted`; enforce the global headword UNIQUE and handle the duplicate-headword conflict explicitly (legacy silently fails the insert).

**Media mapping (Mux→Bunny, Whisper→Groq).** The dictionary section itself uses neither. The mapping is only relevant to its *consumer*, the lesson reader: transcript words feed `findDictionaryTerms`. In Parvus Ordo, transcripts come from **Groq** (replacing Whisper) and video from **Bunny** (replacing Mux); the dictionary's term-matching is transport-agnostic and just needs the transcript word list. No change to dictionary logic for the media swap.

**Explicit GAPS vs what Parvus Ordo already has:**
- **Lessons with versioning:** Parvus Ordo already has versioned lessons + fork-and-edit and three-tier scope. The dictionary's "edit universal → create parish override" pattern is conceptually the *same* fork-and-edit idea; consider reusing the existing override/fork primitives rather than a bespoke `dictionary_overrides` table, OR keep the simple wide-column override and document why it diverges. Decide before building.
- **Media/asset manager, seek-enforcing player + transcript, teacher preview:** all already built and unrelated to the dictionary's own CRUD; the only touchpoint is that the transcript surface should call `core` dictionary matching to underline terms. No dictionary work needed in those modules beyond wiring the highlight call.
- **Per-parish feature toggle:** `dictionary_enabled` was dead in Narthex. If Parvus Ordo wants it, enforce it in the RSC/route gate, not just the schema.
- **Error handling:** Narthex swallowed all Supabase errors. Parvus Ordo Server Actions/`core` must return and surface errors (validation + DB).
- **Overrides modal bug:** must be fixed on port (single chosen shape); do not carry the EAV read path forward.
