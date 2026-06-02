# Port Deltas — built sections vs. Narthex docs

Generated from a delta-review pass (one agent per built section) comparing the
current Parvus Ordo implementation against `docs/narthex/*.md` acceptance criteria.
Intentional stack remaps (Supabase→Neon/RLS, Mux→Bunny, Whisper→Groq, Vite→Next,
versioning/fork/trimmer enhancements) are NOT counted as deltas.

Status: ☐ open · ☑ fixed. Update as we close them.

## student-lesson-view (~35–40% fidelity)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Video gating not enforced | `advanceAction` marks any item complete on Continue regardless of watch; player `watched` is cosmetic |
| HIGH | ☑ Watch progress never persisted | `lesson_item_progress.max_reached_ms` (exists since 0004) never written/read; no resume, enforcement resets on reload |
| MED | ☑ Engagement telemetry absent | now emitted from the player (see engagement-dashboard below): `lesson_start` (beacon) + `step_complete`/`answer_submit`(+correct)/`lesson_complete` (server actions, via `after()`) |
| MED | ☑ Student question + feedback forms on completion step | `student_questions`/`student_feedback` mutations + UI absent |
| MED | ☑ Review mode (`?review=true`) | read-only answers list; not built |
| MED | ☐ Sequential cohort lock | blocks lessons w/o prior `lesson_complete`; depends on cohorts slice |
| MED | ☐ Dictionary term highlighting + modal (reading + transcript) | no dictionary subsystem |
| LOW | ☐ Step count N vs N+1 (feedback step) | cosmetic |

## video-pipeline (happy path faithful)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Persist + resume watch progress | same root as lesson-view; headline gap |
| HIGH | ☑ Completion tied to actual watching | only the manual Continue writes completion |
| HIGH | ☑ Transcription Retry control | `failed` renders a dead label, no re-run |
| HIGH | ☑ Orphan asset cleanup on upload failure | failed TUS/createUpload leaves the asset row behind |
| HIGH/MED | ☐ YouTube ingest | external asset kind + caption import; entirely absent |
| MED | ☑ Transcript download (`[m:ss]` 10s grouping) | no export |
| MED | ☐ Student-own / teacher-parish RLS on progress | `lesson_item_progress` parish-isolated but not row-owned |
| LOW | ☐ Provider duration authoritative over transcriber | `setTranscript` COALESCE can overwrite |
| LOW | ☐ Webhook+Queue for transcode/transcribe (vs client poll + in-request) | scaling debt; `infra/workers` not created |

## teacher-lesson-edit (high fidelity)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Flush debounced autosave on modal-close/publish/version-switch | data-loss gotcha the spec said to fix |
| MED | ☑ MC choice invariants | seed 2 choices; forbid removing below 2 (can hit zero/no-correct) |
| MED | ☑ Estimated-duration badge | video=(end−start), reading=words/200·60s, question=60s, ceil to min |
| MED | ☐ YouTube video support in picker | only Bunny asset select |
| LOW | ☐ Reading per-item title dropped; TipTap subset (no underline/align/tables/H1/H3); MC `expected_answer` | conscious simplifications to ratify |

## teacher-lesson-list
| Sev | Delta | Notes |
| --- | --- | --- |
| MED | ☑ In-row Preview link | core ready (`?preview=1`), not wired to rows |
| MED | ☑ In-row Publish/Unpublish | `publishVersion`/`unpublishLesson` exist, not on rows |
| MED | ☑ In-row Delete + real confirm dialog | `deleteLesson` exists; replace native confirm |
| LOW | ☐ `lesson_order` selected but unused | drop or wire |

## student-lesson-list (list surface ported — `po-dzwc`; calendar/review deferred)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Cohort/schedule/release gating | learner branch now calls `getStudentLessons` instead of `getPublishedLessons` (which listed every published parish lesson — the over-exposure leak); only schedule-released lessons appear |
| HIGH | ☑ Progress status + Due/Completed split + "All caught up!" | `partitionStudentLessons` buckets by status; per-lesson badge (Not started / In progress / Completed); empty `due` on a non-empty list → `lesson-all-caught-up`; collapsed-by-default Completed section |
| HIGH | ☑ Sequential locking (list side) + skip_sequence | locked rows render visibly locked (`lesson-locked`: lock icon, non-link). The read model already resolves `locked` incl. skip_sequence. The lock card uses a GENERIC "Complete the previous lesson first" message — the blocking lesson's title isn't surfaced by the read model and re-deriving it would re-implement gating, so it's intentionally omitted (vs Narthex's titled message) |
| HIGH | ☐ Sequential-lock SERVER enforcement (deep-link) | NOT this surface — lives on the lesson VIEW page (sibling bead student-lesson-view) |
| MED | ☐ "My Answers"/review affordances + "My Schedule" calendar | review-mode links + the react-big-calendar "My Schedule" view deferred to a follow-up; completed lessons link to the player |
| _Tests_ | unit (`partitionStudentLessons` split/order/all-caught-up) + int (`cohorts.int` over-exposure contrast: a `getPublishedLessons` lesson is absent from `getStudentLessons` for a not-enrolled / pre-release student) + e2e (`student-lessons.spec`: learner sees the empty state, the two published e2e lessons don't leak). Populated Due/Completed/locked RENDERING is covered by the unit/int layer rather than e2e to avoid mutating the shared e2e seed (its student has no cohort_members/schedule). | |

## auth-onboarding + home-dashboard
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ OCIA public application (`/apply` + `ocia_applicants`) | done (mig 0011/0012); hostname-resolved parish + apex picker; trimmed v1 form w/ Catholic-sacraments conditional; honeypot + throttle |
| HIGH | ☑ Invite-member flow (`core.inviteMember` + WorkOS invitation) | done; org-less WorkOS invitation (fetch); authz 403 + dedupe 409; SSO orgs deferred |
| HIGH | ☑ First-login membership claim | automatic — `login_lookup` keys by email, so the seeded membership resolves on first WorkOS login |
| MED | ☑ Applicant review → convert/dismiss | done — `/ocia/applicants` review queue (convert/dismiss/remove + invite-by-email) |
| MED | ☑ Super-admin override (ROLE impersonation) + banner | role view-as + Exit done (is_super_admin flag); parish/diocese switching + /admin deferred |
| MED | ☑ Per-parish signup/apply toggle | done — `parishes.applications_enabled` + admin toggle; diocese-level cascade deferred |
| LOW | ☑ `login_lookup` loads ALL memberships | resolved — multi-parish chooser/switcher + hostname (slug) resolution |
| N/A | home is a role-router by design | dashboard-as-page is an enhancement to ratify |

## weekly-export (ported — `po-et5`)
Teacher Weekly Export: per-path week lesson material + path-filtered answers/questions/feedback →
copyable Markdown bundle. `core.buildWeeklyExport` (RLS-scoped, set-based — collapses Narthex's N+1)
+ pure `assembleWeeklyExport`/`renderWeeklyExportMarkdown`/`htmlToPlainText`; RSC page at
`/ocia/cohorts/:cohortId/week/:weekNumber/export` with a `'use client'` copy panel. No migration needed
(cohorts/learning_paths/members/path_lessons/answers/student_questions/student_feedback all exist).
| Sev | Delta / decision | Notes |
| --- | --- | --- |
| HIGH | ☑ Cross-tenant isolation | answers/SQ/SF/cohort/path tables are parish-isolated by RLS via `getDb(parishId)`; integration test asserts another parish gets an empty export for the same cohort |
| HIGH | ☑ Teacher-only gate at the boundary | RSC page redirects non-`catechist`/`admin`/`super_admin` to `/ocia` — same posture as the student-responses inbox (`feedback.ts` relies on RLS for isolation; role is gated at the page). Any future `/api/v1` export endpoint MUST reproduce this gate |
| MED | ☑ Versioning semantics (Narthex gap) | each path's week lesson resolves to its **live** version (`lessons.live_version_id`) for material/questions; answers match that live version's question items. Offline lesson (no live version) → path skipped like a missing one. Answers to superseded versions aren't shown (they're not the current lesson) |
| MED | ☑ Discussion template (Narthex gap) | Parvus Ordo has no parish-level template; it lives on `lesson_versions.discussion_template`. Honored only when the week resolves to a **single distinct lesson** across all paths; multi-lesson weeks use the system default (which itself says to weave themes). `SYSTEM_DEFAULT_DISCUSSION_TEMPLATE` authored for the port (original text not in repo) |
| MED | ☑ Reading HTML→plain text upgraded | block tags → newlines, `<li>` → bullets, common entities decoded (Narthex's `tag→''` glued words & left entities); `<p>Hi</p>`→`Hi` preserved |
| LOW | ☑ Video blocks excluded | Narthex parity (no Bunny/Groq work needed). Enriching the export with transcripts from the media/asset manager is a noted enhancement, not a port requirement |
| MED | ☐ Entry point (cohort detail page) | Narthex reached this from per-week rows on the cohort detail page; Parvus Ordo has no cohort-management UI yet, so the export is currently reached by direct URL (e2e navigates directly). Wire per-week "Export" links + a "Back to cohort" target when the Cohorts/Scheduling slice lands |
| LOW | ☐ Programmatic `/api/v1` export | not built (no external consumer needs it for parity); `renderWeeklyExportMarkdown(buildWeeklyExport(...))` is the one-liner if one appears — must add the catechist/admin gate |

## cohorts + scheduling (keystone — po-mf1)
The keystone slice of cohorts.md + the Cohorts list of schedule-calendar.md. Provides the
write/read model + pure gating the student surfaces depend on.
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Cohort CRUD + roster + schedule (auto-generate/add/edit/remove) | `core/cohorts`; auto-generate is a single transaction (Narthex did two); cross-parish roster add blocked |
| HIGH | ☑ Pure gating single source of truth | `core/cohorts/gating` (release/due/hidden/locked) + `dates` (tz-immune calendar math); resolves Narthex's `'2000-01-01'` vs `−6d` split → first-no-start = always-released; unit-tested |
| HIGH | ☑ Student read model (`getStudentLessons`) | cohort/release/sequential/path gating, schedule-ordered; **unblocks student-lesson-list + the sequential-lock in student-lesson-view** (their PAGES remain follow-ups) |
| HIGH | ☑ Learning paths (per-cohort lesson sub-sequences + membership) | `core/cohorts/learning-paths`; destructive set-lessons in one txn |
| MED | ☑ Cohorts UI (list + 5-tab detail) | `/ocia/cohorts` + `/ocia/cohorts/[id]` (Lessons/Schedule/Students/Learning Paths/Settings); nav wired live |
| MED | ☑ Single completion signal | sequential lock = lesson's live-version items all complete (`lesson_item_progress`); teacher progress = answered/total questions — no new `engagement_events` table |
| MED | ☑ Dropped `cohort_schedule.discussion_location` flag | fixed: 0023 adds `time_override`/`location_override`; effective time/location = `COALESCE(override, cohort default)` |
| — | ◐ Unified Calendar + iCal | backend + security foundation LANDED in **po-oa5n** (see below); the React UI (Calendar page, Calendar tab, modal, sources admin, e2e) is the follow-up `phase=port` bead **po-d98g**. Both flagged fixes are resolved in the backend slice (`observed_date` column; no leaked `service_role` key) |

## engagement-dashboard (Slice 1: lesson-level, SQL-aggregated — po-on7)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☑ Aggregate in SQL, not the browser | `core.getEngagementSummary` reduces in Postgres (window functions + `FILTER`/CTEs); the legacy `SELECT *`→JS scan is deliberately NOT ported |
| HIGH | ☑ Stamp `version_id` + promote soft-refs to real FKs | events carry the lesson version → aggregate PER VERSION so a later edit can't corrupt per-step/per-question history; legacy loose `block_id`/`question_id`/`cohort_id` are now real FKs (`item_id`/`cohort_id`) |
| MED | ☑ Event stream wired into the player | `lesson_start` (client beacon, idempotent) + `step_complete`/`answer_submit`(+`answer_correct`)/`lesson_complete` (server actions via Next `after()`); per-step durations derived from `created_at` deltas, not a client `step_exit` timer (fixes the lost-on-close gotcha) |
| MED | ☑ Idempotent bookends | partial unique index `(student_id, version_id, event_type)` → fire-and-forget can't double-count `lesson_start`/`lesson_complete` (legacy dup bug not ported) |
| LOW | — Supabase `auth.uid()` RLS → Neon parish-fence RLS + core gate | parish isolation stays in RLS (`app.parish_id`); role-gate (admin/catechist/super_admin) + student-ownership enforced in `packages/core` above the fence (the documented house pattern, 0011). No `app.user_id` GUC introduced |
| LOW | — No Zod (repo has none) | spec suggested a Zod writer schema; validated instead with native TS discriminated unions + the Postgres enum/CHECK as the authoritative runtime guard, matching house style |
| LOW | — Step labels | reading/video items have no `title` in ParvaOrdo content, so labels are kind-based ("Reading"/"Video"); questions show the truncated prompt (≤50). Video asset-title labels deferred with the asset join |
| MED | ☐ Cohort-scoped routes | `cohorts/[id]/engagement` + `cohorts/[id]/lessons/[id]/engagement`: schema + `getEngagementSummary` already accept `cohortId`; deferred until the player stamps `cohort_id` (Cohorts/Scheduling slice) — follow-up `phase=port` bead |
| MED | ☐ Diocese-admin / super-admin cross-parish rollup | new ParvaOrdo enhancement (no legacy equiv); needs a cross-parish read path (`getDb` pins one parish). v1 is per-active-parish — every acceptance criterion is per-parish |
| LOW | ☐ Nightly Cron rollup table (`infra/workers`) | optional scaling; raw-event SQL is fine at parish scale today |
| LOW | ☐ Richer video telemetry (watched %, seeks) | `metadata` jsonb + enum are extensible; v1 video timing uses step deltas, and `lesson_item_progress.max_reached_ms` already records watch depth |

## unified-calendar — backend & security (po-oa5n)
The data + pure-logic + security half of the calendar surface of schedule-calendar.md
(Cohorts list already shipped in po-mf1). All three event streams normalize to one pure
`MergedEvent`; the React layer (follow-up `po-d98g`) only concatenates, hides by source,
and renders. `core/calendar`: `ical` (SSRF-guarded `fetchFeed` + `parseIcal` RRULE/EXDATE),
`events` (CRUD + pure ghost/observed `expandCalendarEvent`), `sources` (enabled read + admin
CRUD), `overlay` (cohort-schedule → events, reusing po-mf1 `getCohortSchedule`). Migration
0026 adds `calendar_events`/`calendar_sources` on the three-tier scope model.
| Sev | Delta / decision | Notes |
| --- | --- | --- |
| HIGH | ☑ Flagged fix — missing `observed_date` column | added as a real column on `calendar_events` (Narthex read/wrote it with no migration → silently broken); drives the transferred-feast ghost split |
| HIGH | ☑ Flagged fix — leaked `service_role` JWT | NOT carried over; `proxy-ical` is `GET /api/v1/calendar/ical`, authed by the WorkOS session (any parish member), hardening in `core/calendar/ical.fetchFeed` |
| HIGH | ☑ SSRF/host-whitelist/HTTPS/size+time guard | `fetchFeed`: https-only, host suffix whitelist (+`ICAL_ALLOWED_HOSTS`), private/loopback-IP rejection re-checked on every redirect hop, 10 s timeout, 5 MB streamed cap; unit-tested with injected fetch/DNS |
| HIGH | ☑ Cross-tenant + diocese-cascade RLS | three-tier (global/diocese/parish) READ cascade via the `app.diocese_id` GUC, parish-scope WRITE — like lessons; int test proves AJ↔Erie isolation both ways + global cascade on the RLS DB |
| MED | ☑ Diocese-scoped feasts/feeds (new capability) | a diocese publishes its liturgical calendar / feeds once → every parish inherits (Narthex was parish-only); diocese/global rows are seeded/managed out of band like diocese lessons |
| MED | ☑ Pure RRULE/EXDATE + ghost + time parsing | `parseIcal` (ical.js+rrule, range-bounded to month ±1), `expandCalendarEvent` (ghost on actual date + full on observed), `parseTimeString` (1-h block / all-day) — all pure + unit-tested |
| MED | ☑ "Students see only enabled sources" | enforced on the read path (`listEnabledSources` filters `enabled`); the full list + CRUD are reached only via admin/catechist-gated actions (PO gates role at the boundary, not in RLS) |
| MED | ☐ Calendar UI (deferred → po-d98g) | unified Calendar page (decide react-big-calendar vs custom month/agenda), per-source filter chips, sacred-text-normalized titles, ghost rendering, Add/edit/detail modals, Calendar tab in cohort detail, `calendar_sources` admin UI, Playwright e2e |
| LOW | ☐ Annual recurrence projection | `recurrence='annual'` is stored + returned but not projected across years (Narthex defined no algorithm + no AC covers it); a feast shows on its stored date. Project in the UI follow-up if desired |
