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
| MED | ☐ Engagement telemetry absent | no `lesson_start`/`answer_submit`(+correct)/`reading_complete`/`lesson_complete` events |
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
