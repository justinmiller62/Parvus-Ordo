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

## student-lesson-list (largely un-ported)
| Sev | Delta | Notes |
| --- | --- | --- |
| HIGH | ☐ Cohort/schedule/release gating | lists ALL published parish lessons unconditionally (over-exposure) |
| HIGH | ☐ Lesson-level progress status + Due/Completed split + "All caught up!" | per-item progress exists but not aggregated/surfaced |
| HIGH | ☐ Sequential locking + skip_sequence | depends on cohorts |
| MED | ☐ "My Answers"/review + "My Schedule" calendar | depends on review mode + schedule |
| (depends on the Cohorts/Scheduling slice — Slice 4) |

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
