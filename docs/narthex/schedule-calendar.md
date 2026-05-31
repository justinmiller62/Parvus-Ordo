# Schedule & Calendar

> Source app: **Narthex** (Vite + React + Supabase). Paths below are relative to
> `Narthex/` unless noted. This doc covers the two routes that make up the
> "Schedule & Calendar" surface: the **Cohorts** list (`SchedulePage`) and the
> **unified Calendar** (`CalendarPage`), plus the `proxy-ical` Supabase Edge
> Function they depend on.

## Overview

This section gives a parish two related, but distinct, time-oriented views:

1. **Cohorts list** (`apps/web/src/routes/SchedulePage.tsx`, titled "Cohorts" in
   the UI). A card grid of the parish's cohorts (catechesis class groups). Each
   card summarizes a cohort's recurring discussion day/time, student count,
   number of scheduled lessons, and the date of the next upcoming discussion.
   Admins can create a new cohort inline. Cards link to `/cohorts/:id` (the
   cohort detail page, which is a separate section and owns the actual
   per-lesson scheduling UI — see "Edge cases").

2. **Unified Calendar** (`apps/web/src/routes/CalendarPage.tsx`). A
   `react-big-calendar` month/week/agenda view that **merges three event
   sources** into one grid:
   - **Narthex Events** — rows from the `calendar_events` table (parish feast
     days, holy days of obligation, custom events like baptism rehearsals).
   - **Cohort Schedule** — upcoming lesson discussions for the cohorts the
     *current student* belongs to (only shown to non-editors).
   - **External iCal feeds** — one or more `calendar_sources` rows (Google
     Calendar, diocesan feeds, etc.), live-fetched through the `proxy-ical`
     Edge Function and parsed client-side. These are **never persisted**.

The calendar exists so a parish can present liturgical/parish events alongside
externally-maintained diocesan calendars and a student's own class schedule, in
one place, without manually re-entering anything. The `proxy-ical` function
exists because browsers cannot fetch arbitrary cross-origin iCal URLs (CORS) and
because the app needs SSRF protection and a host whitelist around outbound
fetches.

## Roles & access

Roles come from `memberships.role` (`admin`, `teacher`, `student`) resolved by
`apps/web/src/hooks/useAuth.ts`. The active parish is `memberships[0].parishId`
(first membership; no explicit parish picker on these pages). Super-admins get a
synthetic `admin` membership for an overridden parish via
`sessionStorage` (`useAuth.ts:139`–`148`).

- **SchedulePage (Cohorts list)**
  - Any authenticated parish member can view the cohort cards
    (`cohorts_select` RLS allows all parish members).
  - The "Create Cohort" input + button render only when `hasRole('admin')`
    (`SchedulePage.tsx:103`). Note: gated on **admin only**, not teacher, even
    though the RLS `cohorts_insert` policy allows teachers too. So a teacher is
    *allowed by the DB* to create cohorts but the UI hides the control.

- **CalendarPage**
  - `canEdit = isTeacherOrAdmin()` (`CalendarPage.tsx:331`). Admin **or** teacher.
  - `canEdit` controls: the "Add Event" button (`:762`), double-click-to-edit on
    Narthex DB events (`:853`), and whether `onDelete` is wired into the modal
    (`:882`).
  - **Cohort Schedule events are only fetched for non-editors**: `fetchCohortEvents`
    early-returns if `!user || canEdit` (`:453`). A teacher/admin therefore never
    sees the blue "Cohort Schedule" overlay on their own calendar — only students do.
  - Narthex DB events and external iCal feeds are visible to everyone in the parish
    (`calendar_events_select` and `calendar_sources_read` RLS allow all parish
    members; students additionally only see `enabled = true` sources).

## User flows

### Flow A — View & create cohorts (SchedulePage)

1. Member navigates to the Schedule/Cohorts route. `useEffect` fires
   `fetchCohorts()` once `parishId` is known (`SchedulePage.tsx:27`–`29`).
2. While loading, the page shows `Loading...` (`:97`).
3. `fetchCohorts` queries `cohorts` for the parish ordered by `created_at`, then
   for each cohort issues parallel count/lookup queries (see Key logic). Cards
   render in a responsive grid.
4. **Empty state:** if there are zero cohorts, a dashed-border placeholder with a
   calendar icon and "No cohorts yet." is shown (`:124`–`128`).
5. **Admin create:** admin types a name, presses Enter or clicks "Create Cohort".
   `createCohort` trims the name, bails if empty, inserts
   `{ parish_id, name }` into `cohorts`, clears the input, and re-runs
   `fetchCohorts` (`:82`–`90`). Button is disabled while `creating` or when the
   name is blank.
6. Each card links to `/cohorts/:id`. Day/time line only renders if
   `discussion_day` is set; "Next: <date>" line only renders if there is an
   upcoming `cohort_schedule.discussion_date` (`:139`, `:151`).
7. **Error handling:** none beyond `if (!rows) { setLoading(false); return; }`
   (`:38`). A failed insert is silently swallowed (no try/catch, no toast).

### Flow B — View the unified calendar (CalendarPage)

1. Page mounts; default view is `agenda` on mobile (`window.innerWidth < 1024`)
   and `month` on desktop (`:345`, `useIsMobile` at `:207`).
2. On `parishId` resolve, three loaders fire in parallel via one `useEffect`
   (`:582`–`587`): `fetchDbEvents`, `fetchCohortEvents`, `fetchIcalSources`.
3. Shows "Loading calendar..." until `fetchDbEvents` flips `loading=false`
   (`:447`). Note: only the DB-events loader controls the global spinner; iCal
   and cohort loads continue in the background after the grid renders.
4. iCal sources load **per-source, in parallel** (`Promise.allSettled`). While a
   source is in flight a "Loading: <names>..." line shows (`:789`). On success
   the source's events are appended; on failure an amber dismissible warning
   "Could not load \"<name>\"" appears (`:775`–`786`) and that source's filter
   chip stays present but contributes no events.
5. Events from all sources are merged and color-coded. A left sidebar (desktop)
   or collapsible panel (mobile) lists **source filter checkboxes**; unchecking
   hides that source's events (`:296`, `:604`).
6. **Click an event** → `EventDetailModal` shows title (sacred-text normalized),
   source dot+name, when (all-day vs timed range), where, and details (`:232`).
7. **Empty state:** no events → `react-big-calendar` renders an empty grid /
   "no events in range" agenda; there is no custom empty placeholder.

### Flow C — Add / edit / delete a Narthex event (editors only)

1. Editor clicks "Add Event" → `CalendarEventModal` opens blank
   (`event_type` defaults to `custom`).
2. Form fields: Title (required), Date (required), Time (optional free text e.g.
   "7:00 PM"), Location (optional), Event Type (Liturgical Feast Day / Holy Day
   of Obligation / Custom), optional "Celebrated on" date (only for liturgical/
   obligation types), Description, and an "Repeats annually" checkbox that maps to
   `recurrence = 'annual' | ''`.
3. Submit is blocked unless `title.trim()` and `event_date` are present
   (`CalendarEventModal.tsx:58`, `:204`). On submit `handleSave` builds a payload
   and either `update`s by id or `insert`s with `created_by = user.id`
   (`CalendarPage.tsx:656`–`678`), then re-runs `fetchDbEvents`.
4. **Edit:** editor double-clicks a Narthex DB event on the grid; if
   `canEdit && event.dbEventId`, `handleEditDbEvent` re-fetches the single row by
   id and opens the modal pre-filled (`:685`–`709`). (Note: single-click always
   opens the read-only detail modal; editing requires a double-click.)
5. **Delete:** in edit mode, "Delete Event" calls `onDelete(id)` then closes;
   `handleDelete` deletes by id and re-fetches (`:680`–`683`). No confirmation
   dialog.
6. **Transferred feast (ghost) flow:** if `observed_date` differs from
   `event_date`, the calendar renders **two** entries — a faded dashed "ghost" on
   the actual date and the full event on the observed date (see Key logic).

## Data model

All tables are parish-scoped; ownership for RLS is via `memberships`/`cohorts.parish_id`.

### `calendar_events` — `supabase/migrations/20260501000000_calendar_and_overrides.sql:2`
Parish-wide events surfaced as the "Narthex Events" source.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes(id)` ON DELETE CASCADE | RLS owner key |
| `title` | text NOT NULL | |
| `event_date` | date NOT NULL | actual date |
| `event_time` | text (nullable) | free-text like "7:00 PM"; parsed client-side |
| `location` | text (nullable) | |
| `event_type` | text NOT NULL | `liturgical` / `obligation` / `custom` (app-enforced, no DB enum) |
| `description` | text (nullable) | |
| `recurrence` | text (nullable) | only value used by UI is `'annual'` |
| `created_by` | uuid NOT NULL → `profiles(id)` | set on insert |
| `created_at` | timestamptz default now() | |

Index: `idx_calendar_events_parish_date (parish_id, event_date)`.

**RLS** (same migration): SELECT = any parish member; INSERT/UPDATE/DELETE =
members with role in `('admin','teacher')` for that `parish_id`.

> **GAP / discrepancy:** the calendar code reads and writes a column
> **`observed_date`** (`CalendarPage.tsx:363`, `:668`; `CalendarEventModal.tsx`),
> but **no migration defines `observed_date`** on `calendar_events`. The only
> `grep` hits for `observed_date` are in `.tsx` files, never `.sql`. Either a
> migration is missing from the repo or this feature is silently broken in the
> current schema. The port must explicitly add this column.

### `calendar_sources` — `supabase/migrations/20260501000001_calendar_sources.sql:2`
External iCal feeds. **Live-fetched, never synced to the DB.**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes(id)` CASCADE | RLS owner key |
| `name` | text NOT NULL | CHECK length 1–200 |
| `url` | text NOT NULL | CHECK `~* '^https://'` and length 12–2048 |
| `color` | text NOT NULL default `#3b82f6` | hex used for event dots/bg |
| `enabled` | bool NOT NULL default true | |
| `display_order` | int NOT NULL default 0 | sort key |
| `created_at` / `updated_at` | timestamptz default now() | |
| `created_by` | uuid → `profiles(id)` (nullable) | |

Index: `calendar_sources_parish (parish_id, enabled, display_order)`.

**RLS:** `calendar_sources_manage` = admin/teacher full ALL access for their
parish; `calendar_sources_read` = SELECT for any parish member but only where
`enabled = true`. (The CalendarPage select already filters `.eq('enabled', true)`.)

> Note: the **CRUD UI for `calendar_sources` is not in this section** — CalendarPage
> only *reads* sources. Adding/editing feeds lives in a settings screen (out of
> scope here). The port should locate/build that admin UI separately.

### `cohorts` — `supabase/migrations/20260422000000_initial.sql:75`, scheduling cols added in `20260426000003_cohort_schedule_redesign.sql:2`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `parish_id` | uuid NOT NULL → `parishes(id)` CASCADE | RLS owner key |
| `name` | text NOT NULL | |
| `created_at` | timestamptz default now() | order key on SchedulePage |
| `start_date` | date | added by redesign |
| `end_date` | date | added by redesign |
| `discussion_day` | text | e.g. "Tuesday"; drives card day line |
| `discussion_time` | text | e.g. "7:00 PM" |
| `discussion_location` | text | moved here from `cohort_schedule` |

**RLS:** `cohorts_select` = any parish member; `cohorts_insert`/`cohorts_update`
= admin/teacher (`initial.sql:372`–`384`).

### `cohort_members` — `initial.sql:85`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `cohort_id` | uuid NOT NULL → `cohorts(id)` CASCADE | |
| `student_id` | uuid NOT NULL → `profiles(id)` CASCADE | |
| `joined_at` | timestamptz default now() | |
| UNIQUE(`cohort_id`, `student_id`) | | |

**RLS:** `cohort_members_select` = any parish member (via cohort's parish);
`cohort_members_insert` = admin/teacher (`initial.sql:387`–`402`).

### `cohort_schedule` — `initial.sql:211`, heavily altered by later migrations
Per-lesson scheduling within a cohort.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `cohort_id` | uuid NOT NULL → `cohorts(id)` CASCADE | |
| `lesson_id` | uuid NOT NULL → `lessons(id)` CASCADE | |
| `release_date` | date | originally NOT NULL; made nullable + default null (`20260426000005`) |
| `discussion_date` | date NOT NULL | the date shown on the calendar |
| `due_date` | date (nullable) | dropped in redesign, re-added optional in `20260505000001`; NULL ⇒ `discussion_date − 1 day` |
| `week_number` | int | added `20260426000003` |
| `is_date_override` | bool NOT NULL default false | added `20260426000003` |
| `skip_sequence` | bool NOT NULL default false | added `20260502000005` |
| `time_override` | text | added `20260501000000` |
| `location_override` | text | added `20260501000000` |
| UNIQUE(`cohort_id`, `lesson_id`) | | |

**RLS:** `cohort_schedule_select` = any parish member (via cohort's parish);
INSERT/UPDATE/DELETE = admin/teacher (`initial.sql:595`–`618`,
`20260426000002_schedule_grants.sql`).

**Joined table:** `lessons` (`initial.sql:97`) — calendar reads `lessons(title)`
via the `cohort_schedule.lesson_id` FK for the event label.

## Key logic & algorithms

### Cohort card aggregation (N+1 query fan-out)
`SchedulePage.tsx:43`–`76`: for each cohort, three count/lookup queries run.
This is an N+1 pattern (3 round-trips per cohort, all client-side):
- student count: `cohort_members` head count by `cohort_id`.
- next discussion: first `cohort_schedule.discussion_date >= today` ordered asc,
  limit 1. Today is `new Date().toISOString().split('T')[0]` (UTC date string).
- lesson count: total `cohort_schedule` rows for the cohort.

```ts
nextDiscussion: schedule.data?.[0]?.discussion_date ?? null,
```
Date display uses `new Date(dateStr + 'T00:00:00')` to force local-midnight
parsing and avoid UTC off-by-one (`:92`–`95`).

### Merging three event streams
`CalendarPage.tsx:604`–`616`: `filteredEvents` concatenates `dbEvents`,
`cohortEvents`, `icalEvents`, then filters out any whose source key is in
`hiddenSources`. iCal events are matched back to their source **by `name`**
(`calendarSources.find(s => s.name === ev.source)`) — so two sources with the
same display name would collide in filtering.

### Transferred-feast "ghost" entries
`CalendarPage.tsx:384`–`443`: when `observed_date` is set and differs from
`event_date`, two `MergedEvent`s are emitted:
- `narthex-ghost-<id>` on `event_date`, `isGhost: true`, all-day.
- `narthex-<id>` on `observed_date` (the celebrated date), timed if
  `event_time` parses.

Styling: ghost events render at `opacity: 0.4` with a dashed border
(`eventPropGetter`, `:634`–`646`).

### Free-text time parsing
`parseTimeString` (`:194`–`203`) accepts `"7:00 PM"` style strings via regex
`^(\d{1,2}):(\d{2})\s*(am|pm)?$`, handling 12/24h and the 12 AM/PM edge.
Events with an unparseable/absent time become all-day; parseable times get a
**hardcoded 1-hour duration** (`+ 3600000`, e.g. `:379`, `:483`).

### Client-side iCal parsing + RRULE expansion
`parseIcal` (`:75`–`159`) uses `ical.js` to read VEVENTs. For recurring events it:
1. reads `RRULE`, builds an `rrule` `RRule` from
   `DTSTART:<formatRRuleDate>\nRRULE:<rrulestr>` (`:123`),
2. computes occurrences only **within the visible range**
   `rule.between(rangeStart, rangeEnd, true)` (`:125`),
3. honors `EXDATE` exclusions by date key `YYYY-MM-DD` (`:111`–`129`),
4. derives event end from VEVENT `DURATION` (default 1h) (`:107`),
5. on any RRULE error, falls back to a single-instance event (`:145`–`149`).

`rangeStart`/`rangeEnd` are the current month ± 1 month
(`subMonths(startOfMonth)…addMonths(endOfMonth)`, `:353`–`354`), so navigating
months re-fetches/re-expands (the `fetchIcalSources` callback depends on the
range).

### proxy-ical Edge Function (`supabase/functions/proxy-ical/index.ts`)
A Deno `Deno.serve` HTTP function that fetches an iCal URL server-side and
returns the raw `text/calendar` body. Hardening:
- **Auth** (`:84`–`101`): accepts a service-key header *or* a valid Supabase user
  bearer token; otherwise 401.
- **HTTPS only** (`:132`); rejects non-`https:`.
- **Host whitelist** (`:18`–`36`): only `*.calendar.google.com`,
  `*.googleapis.com`, `*.ical-feeds.com`, `*.faithlife.com`,
  `*.churchofjesuschrist.org`, `*.dioceseaj.org`, plus comma-separated extras
  from `ICAL_ALLOWED_HOSTS`. Non-whitelisted host → 403.
- **SSRF guard** (`:40`–`68`, `:148`): resolves A/AAAA and rejects private/loopback
  ranges (127/8, 10/8, 172.16–31, 192.168, 169.254, ::1, fc00/fd/fe80). If DNS
  can't resolve it "fails open" and lets `fetch` handle it.
- **Limits:** 10s fetch timeout via `AbortController` (`:73`, `:157`); 5 MB max
  body, streamed and aborted if exceeded (`:72`, `:200`–`210`).
- Responds with `Cache-Control: public, max-age=600` (`:227`) — 10-minute CDN cache.

> **Security note for the port:** the function file hardcodes a `service_role`
> JWT as a fallback default (`index.ts:5`). That is a leaked secret and must NOT
> be carried over.

## External integrations

- **iCal / ICS** — primary integration. `ical.js` for parsing, `rrule` for
  recurrence expansion, both client-side. Outbound fetch is brokered by the
  `proxy-ical` Deno Edge Function. Known upstreams (per whitelist): Google
  Calendar, Google APIs, ical-feeds.com, Faithlife, churchofjesuschrist.org,
  Diocese of AJ. No write-back / two-way sync — read-only.
- **react-big-calendar** + **date-fns** localizer for the grid UI
  (`CalendarPage.tsx:3`–`22`).
- **Mux / Whisper / OpenAI / YouTube / email — none.** This section has no video,
  transcription, or email integration. (`lessons(title)` is the only join into
  lesson content, and that's just a title string.)
- **sacred-text** (`apps/web/src/lib/sacred-text.ts`) — `normalizeSacredText`
  capitalizes divine names / sacraments / liturgical terms; applied to event
  titles in the grid cell and the detail modal.

## Edge cases & gotchas

- **`observed_date` schema mismatch** — read/written by code, defined in **no**
  migration. Likely broken in the shipped schema; port must add the column. (See Data model.)
- **`cohort_schedule.discussion_time` / `discussion_location` mismatch** —
  `fetchCohortEvents` selects `discussion_time, discussion_location` *from
  `cohort_schedule`* (`CalendarPage.tsx:465`), but the redesign migration
  (`20260426000003`) **dropped `discussion_location` from `cohort_schedule`**
  (moved it to `cohorts`) and introduced `time_override`/`location_override`
  instead. So the calendar query references columns that don't exist post-redesign
  — another latent break to fix in the port (read from cohort + per-entry override).
- **Spinner only tracks DB events** — `loading=false` is set by `fetchDbEvents`
  only (`:447`); iCal/cohort loads finish after the grid is interactive, so
  events can pop in.
- **iCal source filtering keyed by name** — `filteredEvents` matches iCal events
  to sources by display name (`:612`); duplicate names break per-source hide.
- **Range-bounded RRULE expansion** — recurring events only materialize for the
  visible month ±1; this is correct for display but means there is no global
  occurrence cache; each month nav re-fetches all feeds.
- **Hardcoded 1-hour duration** for timed DB/cohort events; real end time is not stored.
- **Cohort events only for students** — editors never see the blue overlay
  (`!user || canEdit` early return, `:453`).
- **No optimistic UI / no error toasts** on event or cohort writes; failures are
  swallowed (no try/catch around inserts/updates/deletes).
- **N+1 cohort card queries** — 3 queries × N cohorts on every SchedulePage load.
- **UTC "today" boundary** — `new Date().toISOString().split('T')[0]`
  (`SchedulePage.tsx:54`) uses UTC date, which can be off by one near midnight in
  western timezones for the "next discussion" computation.
- **Delete has no confirmation** (`CalendarEventModal.tsx:192`).
- **proxy-ical fails open on DNS** — if DNS resolution is unavailable the SSRF
  check is bypassed (`resolveAndCheck` returns `true`).
- **Admin-only create on SchedulePage** vs **admin/teacher allowed by RLS** — UI
  is stricter than DB for cohort creation.

## Acceptance criteria

- [ ] A parish member with no cohorts sees the "No cohorts yet." empty state on the Cohorts page.
- [ ] An admin can create a cohort by entering a name and pressing Enter or clicking Create; a blank/whitespace-only name is rejected and the button stays disabled.
- [ ] A non-admin (student/teacher) does not see the cohort-create input on the Cohorts page.
- [ ] Each cohort card shows the correct student count, lesson count, and the next discussion date computed as the earliest `discussion_date >= today`.
- [ ] A cohort card omits the day/time line when `discussion_day` is null and omits the "Next" line when there is no upcoming discussion.
- [ ] The calendar merges `calendar_events`, the current student's cohort schedule, and all enabled iCal sources into one grid, each color-coded by source.
- [ ] Unchecking a source filter hides exactly that source's events and re-checking restores them.
- [ ] A teacher/admin sees an "Add Event" button; a student does not.
- [ ] A teacher/admin does NOT see "Cohort Schedule" (blue) events; a student who belongs to a cohort does.
- [ ] Creating a Narthex event with `event_type` liturgical/obligation and an `observed_date` different from `event_date` renders two entries: a faded dashed ghost on the actual date and the full event on the observed date.
- [ ] A timed event ("7:00 PM") renders as a 1-hour timed block; an event without a parseable time renders all-day.
- [ ] Submitting the event modal is blocked unless both title (non-empty) and date are provided.
- [ ] Double-clicking a Narthex DB event as an editor opens the pre-filled edit modal; single-click opens a read-only detail modal.
- [ ] Deleting an event removes it from the grid after refetch.
- [ ] A recurring iCal event (RRULE) expands into multiple occurrences only within the visible month ±1, and `EXDATE`-excluded dates are omitted.
- [ ] `proxy-ical` returns 403 for a non-whitelisted host, 400 for a non-HTTPS URL, and 401 when unauthenticated.
- [ ] `proxy-ical` rejects URLs resolving to private/loopback IPs and aborts responses over 5 MB or 10 s.
- [ ] When an iCal source fails to load, a dismissible "Could not load \"<name>\"" warning is shown and the rest of the calendar still renders.
- [ ] Event titles are sacred-text normalized (e.g. "easter mass" → "Easter Mass") in both the grid cell and the detail modal.

## Port notes

**Stack mapping (Parvus Ordo = Next.js 16 App Router, `packages/core` backend
boundary, Neon + RLS, WorkOS auth, Bunny video, Groq transcription).**

### Where the logic goes
- **`packages/core`** owns all business logic and data access. Add modules:
  - `core/calendar/events` — CRUD over `calendar_events`, including the
    ghost/observed-date expansion (move the `MergedEvent` expansion in
    `CalendarPage.tsx:384`–`443` into core as a pure function returning the two
    entries; the React layer should never compute this).
  - `core/calendar/sources` — read enabled `calendar_sources`; CRUD lives behind
    admin-only functions.
  - `core/calendar/ical` — the `parseIcal` + RRULE/EXDATE expansion and
    `parseTimeString` as pure functions (no React, no Next). Keep `ical.js` +
    `rrule` here.
  - `core/cohorts/schedule` — cohort card aggregation and the student cohort-event
    builder. **Fix the N+1**: implement the card summary as a single SQL query
    (counts + next-discussion via lateral/aggregate), not per-cohort fan-out.
- **RSC reads (direct DB):** the Calendar page and Cohorts list are
  read-dominant — render them as Server Components that call `core` directly for
  the DB-backed events, cohort cards, and source list. No tRPC needed for the
  initial paint.
- **Server Actions (≈10 lines each):** add/edit/delete `calendar_events`, create
  cohort. Each = auth check → validate (Zod) → call `core` → return. The current
  inline `handleSave`/`handleDelete`/`createCohort` logic must move into `core`.
- **Route handler (`/api/...`) or Server Action for iCal proxy:** re-implement
  `proxy-ical` as a Next route handler (or Worker) that calls a
  `core/calendar/ical.fetchFeed(url)` helper carrying the **host whitelist + SSRF
  guard + HTTPS-only + size/time limits**. Do **not** port the hardcoded
  `service_role` JWT. Auth via WorkOS session instead of Supabase bearer token.
  Keep the 10-minute cache (Next `revalidate` / `Cache-Control`).
- **infra/workers:** out-of-band feed prefetch/caching could move here (a Cron
  job that warms a per-source cache) *if* live-fetch latency becomes a problem —
  defer until there's a real trigger. The current design's live, range-bounded
  fetch is fine to keep initially.

### RLS / tenancy
- Narthex is single-level parish tenancy via `memberships.parish_id`. Parvus Ordo
  is **diocese → parish → ministry**. Map:
  - `calendar_events`, `calendar_sources`, `cohorts*`, `cohort_schedule` are all
    **parish-scoped**. Carry RLS as: SELECT = parish member; write = parish
    admin/teacher. Add **diocese-scope** as a real new capability: diocesan feast
    days / diocesan iCal feeds should live at diocese scope and **cascade** down
    to parishes (matches the branding-cascade memory and the lessons three-tier
    model). This is a deliberate extension — Narthex had no diocese-scoped events.
  - Keep the "students see only `enabled` sources" rule.
  - Resolve role from WorkOS/Neon membership, not `memberships[0]`. Drop the
    `sessionStorage` super-admin parish-override hack; use proper org switching.

### Media/transcription mappings
- **Mux → Bunny, Whisper → Groq: not applicable here.** This section touches no
  video and no transcription. The only content link is `lessons(title)` for the
  cohort event label, which maps to Parvus Ordo's existing lessons table.

### Explicit GAPS vs. what Parvus Ordo already has
- **Lessons w/ versioning** — already built. The cohort schedule references a
  lesson by id for its event title; in PO, point this at the versioned lesson
  (use the lesson's current/published version's title). No new lesson work needed.
- **Media/asset manager, seek-enforcing player + transcript, teacher preview** —
  already built and **unrelated** to this section; nothing here consumes them.
- **Calendar itself is net-new** — Parvus Ordo has no calendar/events module yet.
  Net-new core modules + tables required: `calendar_events` (with the missing
  `observed_date` column added properly), `calendar_sources`, and the iCal
  fetch/parse pipeline.
- **`calendar_sources` admin UI** is not part of this section in Narthex and must
  be built (or located) separately in PO.
- **Schema bugs to fix in the port (do not faithfully reproduce):**
  (1) add `observed_date` to `calendar_events`; (2) read cohort discussion
  time/location from `cohorts` + `cohort_schedule.time_override/location_override`,
  not the dropped `cohort_schedule.discussion_location`.
- **Cohort scheduling generation** (week numbers, skip-sequence, date overrides,
  due-date derivation) lives in the separate Cohort Detail section — this section
  only *reads* `cohort_schedule`. Coordinate the port so the calendar read model
  matches whatever the cohort-scheduling write model produces.
