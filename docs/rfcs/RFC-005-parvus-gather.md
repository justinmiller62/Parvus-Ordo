# RFC-005 — Parvus Gather (Parish Ministries, Boards, Events & Requests)

**Status:** **Final — all 4 decisions resolved** (user, 2026-06-02; see §18) · **rfc-ready**, awaiting the user's approval gate before decomposition · **Addresses:** po-2whw (RFC) from **po-h99 / PRD-001** (`prd-approved`) · **Source spec:** `docs/specs/parvus-gather.md` (11 sections) + LOCKED `requests-requestables.md`
**Builds on:** RFC-001 (module registry/`parish_modules` — Gather is a new toggleable module) · RFC-004 (systems-admin toggles it) · reuses `core/calendar` (iCal), `core/people` (interim directory), `core/onboarding` (invites), `core/media`+`assets` (vault/photos)
**Author:** platform-architect · **Directive:** full module, no shortcuts, iterative T1–T8 (T1 = Groups+RBAC = P0), full 4-lens Censor review per bead

> Parvus Gather is the **community-life** pillar of ParvusOrdo (alongside OCIA formation and Parvus Studio
> youth-media). It makes committees, boards, ministries, and event-teams **variants of one Group
> primitive**, and makes every ask — to join, to help, to follow up — a gentle, trackable **Request**.
> This RFC is the technical design: module boundaries, data model + numbered migrations, multi-tenant RLS,
> per-parish enablement, the group-scoped RBAC engine, the Requests todo/ticketing mechanics, the
> API/entry-point surface, UX (invitation-first voice + older-volunteer rules as hard requirements), a test
> plan, and a T1–T8 delivery sequence. Depth is greatest where the brief demands it: **§3 Groups+RBAC** and
> **§4 Requests**.

---

## 1. Summary & what exists today

Parishes run their people-life on paper, group texts, and a leader's spreadsheet; continuity dies at every
handoff. Gather replaces that with one warm, touch-friendly home. Grounding in the live codebase:

| Need | Exists today | Gap (this RFC) |
|---|---|---|
| Group primitive | **thin** `ministries` (id, parish_id, name, kind) — RLS-isolated (`0001`), read by `getMinistries`, the people-directory join (`people/members.ts:32`), and the home page (`(app)/page.tsx`) | rich Group: type/parent/visibility/dynamic roles/archive → **reconcile `ministries`** (§3.4) |
| Per-parish module on/off | `MODULES` registry + `parish_modules` + `resolveEnabled` (RFC-001, built) — toggleable = ocia/studio | add **`gather`** as a 3rd toggleable module (§2) |
| Group RBAC | parish `membership_role` enum only (coarse) | **group-scoped dynamic roles + permission bundles** (§3.2) — net-new |
| Meetings calendar | `core/calendar/ical.ts` (parse/fetch/window) | iCal **feed generation** per group (§6) — net-new, reuses the lib |
| Members directory | `core/people` (`listParishMembers`/`setMemberRole`/…) over `users`+`memberships` | **interim directory = `users`+`memberships`+`core/people`** (Q1 ✓); a future Members module absorbs the Gather-owned `pending_parishioner` later |
| Invites | `core/onboarding/invite.ts` (`inviteMember`) | extend for group invites + **`pending_parishioner`** (§11) |
| Files | `assets` (0007: scope/provider bunny-r2/kind/status) | **Document Vault** + group photos = new asset kinds (§9) |
| Out-of-band jobs | only `infra/workers/clip-cutter` | push, email-broadcast, scheduled reminders/expiry → **net-new infra the user + chief-of-staff stand up separately** (Q3); Gather **designs against** it but ships no bead that depends on it (§17.1) |

**Migration tip is `0030`** (RFC-001/004 migrations are landing now); Gather's migrations are **`0031+`,
numbered next-free at build time** (collision rule — never hardcode).

## 2. Module boundaries & enablement

Respecting CLAUDE.md §5 (all logic in `packages/core`; entry points are thin shims; reads→RSC,
mutations→Server Actions, external/iOS→`/api/v1`, AI→MCP):

- **`packages/core/src/gather/`** — all Gather logic, sub-namespaced: `groups/`, `rbac/`, `requests/`,
  `directory/`, `meetings/`, `shifts/`, `signups/`, `comms/`, `vault/`, `events/`, `forms/`, `invites/`,
  `health/`. Pure functions take `parishId` (+ `userId`/`groupId`), call `getDb(parishId)`, return data.
- **`packages/shared/src/`** — the `gather` `ModuleKey` entry; the **`GatherPermission`** union + default
  role bundles (pure, isomorphic, unit-tested — UI and core share one definition); the Requestable status
  union; the invitation-first **copy constants** (so tone lives in shared, not scattered in components).
- **`apps/web/app/(app)/gather/`** — route group, gated by `requireModule("gather")` (RFC-001 enforcement,
  redirect-home when disabled) + `requireGroupPermission` per action. RSC reads + thin Server Action shims.
- **`apps/web/app/api/v1/gather/`** — external/iOS + public no-login surfaces (public sign-ups, directory
  cards, public forms), the per-group **iCal feed**, and day-of check-in.
- **`infra/workers/`** — push, email-broadcast, and scheduled time-based-nudge workers are **net-new external
  infra** (stood up separately by the user + chief-of-staff, Q3); Gather's worker-touching code sits behind a
  thin notification **port** so the scheduled slices light up when that infra lands — **no Gather build bead
  depends on it** (§17.1).

**Enablement.** Add to `MODULES` (shared): `gather` — `toggleable: true`, `roles: every role`
(parishioner-facing community module), **`defaultEnabled: false`** *(recommended — a net-new major module
is opt-in per parish; existing modules stay `true` for zero-change, Gather ships dark and each parish turns
it on via the RFC-004 systems-admin toggle)*. `enabledModules(parishId)` already gates nav + every shim.

### 2.1 Navigation & IA — top-level sidebar module with its own shell  *(human req po-wisp-moi45)*
Gather is a **top-level module in the main left sidebar** (alongside OCIA, Parvus Studio, People). Clicking
it **enters the module**; from there every Gather sub-section — Discovery/Directory, My Groups, Requests,
Meetings, Sign-Ups, Events, Documents, Health Dashboard — is navigated from a **persistent left sub-nav
inside the Gather module shell**. Implementation: a single `(app)/gather/layout.tsx` renders the module
shell + its sidebar sub-nav, is gated once by `requireModule("gather")`, and **all** Gather routes nest
under it so they always render **inside** the shell with "Gather" highlighted/active in the main sidebar.
**Pitfall to avoid (po-s2lm):** Dictionary/Prayers once rendered *outside* the OCIA shell, popping the user
to a bare nav — Gather pages must never escape the module shell. This IA (module shell + consistent sidebar
sub-nav) is a **hard requirement, not styling**; design it once at the layout level so no sub-route can
break it.

## 3. The Groups primitive + RBAC  *(T1 — foundation — P0)*

Everything else hangs off Groups. This is the deepest section; it must be stable before T2+ build.

### 3.1 Data model
```sql
-- A Group is the single primitive: committee | board | ministry | event-team.
CREATE TABLE gather_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id    uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES gather_groups(id) ON DELETE SET NULL,   -- optional nesting
  type         text NOT NULL CHECK (type IN ('committee','board','ministry','event_team')),
  name         text NOT NULL,
  visibility   text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','members_only','leaders_only')),
  profile      jsonb,                       -- discovery card: blurb, cadence, leader_contact, photo_asset_id, interests[]
  quorum       jsonb,                       -- {kind:'count'|'percent', value:int} for meetings (§6)
  archived_at  timestamptz,                 -- archive preserves history (§11 health)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Dynamic, per-group role labels, each carrying a permission bundle. (Grand Knight, Chair, Coordinator…)
CREATE TABLE gather_group_roles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,   -- denormalized for RLS
  group_id      uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  label         text NOT NULL,                       -- the parish's own word
  is_leadership boolean NOT NULL DEFAULT false,      -- drives 'leaders_only' visibility
  permissions   text[] NOT NULL DEFAULT '{}',        -- subset of the GatherPermission enum (§3.2)
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The group roster: a user holds one role within a group, with a status + optional honorary badge.
CREATE TABLE gather_group_members (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id   uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES gather_groups(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid REFERENCES gather_group_roles(id) ON DELETE SET NULL,
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','awaiting_acceptance','past')),
  past_badge  text,                                  -- "Past Grand Knight" honor, time-boxed (§3, role handoff)
  badge_until timestamptz,
  joined_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- Append-only audit of role transitions / handoffs (spec §1 "all transitions logged").
CREATE TABLE gather_group_role_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parish_id uuid NOT NULL, group_id uuid NOT NULL,
  actor_user_id uuid, subject_user_id uuid, from_role uuid, to_role uuid, action text, created_at timestamptz NOT NULL DEFAULT now()
);
```
Every table carries `parish_id` and gets the standard isolation policy `USING (parish_id =
current_setting('app.parish_id', true)::uuid)` (RFC; same as `ministry_isolation`). `parish_id` is
denormalized onto child tables so RLS never needs a join.

### 3.2 Permission model (group-instance-scoped)
The full permission set is a **fixed `GatherPermission` union in shared** (from spec RBAC): `group.*`
(edit_settings, edit_public_profile, roster.add/invite_new/remove/assign_role/transfer_role/
approve_join_request, roles.define), `meeting.*` (draft/finalize/define_recurrence/set_quorum),
`agenda_thread.moderate`, `signup.*` (create/edit/save_template/instantiate_template),
`broadcast.send/view_read_receipts`, `document.upload/delete`, `form.*` (create/edit/delete/
review_submissions/publish_public/use_starter_template/export_submissions), `request.*` (create/assign/
manage_board), plus **parish-scoped** `group.create/delete/archive`, `health_dashboard.view`,
`parishioner.approve_pending`. Invariants:
- **Instance-scoped:** a permission is held *within one group* (a Grand Knight administers the KofC council
  only). Carried by the member's `role_id → permissions[]`.
- **Parish staff implicitly hold every group-scoped permission** in their parish and can **act on behalf**
  of any parishioner (older-volunteer rule). `STAFF_ROLES` (shared) → implicit-all.
- **`group.roles.define` is NOT in the default admin bundle** — changing what roles exist/can do is gated
  behind a separate grant (staff or founding-admin). Default bundles per group type live in shared.
- **`group.self_leave`** needs no grant (implicit for every member).

### 3.3 Resolution & enforcement
```ts
// packages/core/src/gather/rbac — the new group-authz primitive every Gather shim calls.
export async function requireGroupPermission(
  ctx: { parishId: string; userId: string; role: Role }, groupId: string, perm: GatherPermission
): Promise<void>;   // throws → 403; staff short-circuit to allow; else load member.role_id.permissions
```
Composition order (mirrors RFC-004's getViewer discipline): **module-enabled (`requireModule("gather")`)
→ parish RLS (`getDb(parishId)`) → group permission**. Core stays pure (takes `parishId`/`userId`); the
shim enforces. Group visibility (`public`/`members_only`/`leaders_only`) is a *read* filter layered on top.

### 3.4 Reconciling the legacy `ministries` table  *(decide-and-flag)*
The spec mandates **one** group primitive, but `ministries` exists and is read in 3 places. **Recommended:**
within T1, `ALTER TABLE ministries RENAME TO gather_groups` + add the rich columns (the
`memberships.ministry_id` FK follows the rename automatically; `kind`→`type` backfill), then update the 3
readers (`getMinistries`, `people/members.ts:32` join, `(app)/page.tsx`) to the new shape. This preserves
data + the FK and yields a single primitive. **This is a T1 change that touches existing OCIA/people
surfaces** — flagged so the build bead owns those edits and the Censor panel expects them. *(Alternative:
a parallel `gather_groups` + a compat path; rejected — two group concepts is exactly what the spec forbids,
and a view can't carry the `ministry_id` FK.)* If the rector prefers the parallel approach, only §3.1's
table name + the migration change; the rest stands.

## 4. Requests & Action Items pillar  *(foundational — built with T1)*

The depth lives here (PRD §4.0 stayed product-level by design). A **Requestable** is a gentle ticket:
someone asks a person *or* a group to do a thing; it appears in their requests; they do it or decline;
the asker can see it's handled. **Tone is part of the model** — invitation-first, never a work order.

### 4.1 Data model
```sql
CREATE TABLE gather_requestables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parish_id     uuid NOT NULL REFERENCES parishes(id) ON DELETE CASCADE,
  group_id      uuid REFERENCES gather_groups(id) ON DELETE CASCADE,   -- the owning board (NULL = ad-hoc staff ask)
  requester_id  uuid NOT NULL REFERENCES users(id),
  -- Assignee is a person XOR a group/role pool (whoever-can-help claims it):
  assignee_user_id uuid REFERENCES users(id),
  assignee_role_id uuid REFERENCES gather_group_roles(id),             -- pool: anyone holding this role may claim
  status        text NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','assigned','in_progress','done','declined','cancelled')),
  priority      text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','soon')),  -- gentle, 3 levels
  title         text NOT NULL,                  -- "Could you bring the readings on Sunday?"
  detail        text,
  due_on        date,                            -- optional "hoped-for" date (never "deadline" in UI)
  -- polymorphic tap-back to whatever spawned it (no hard FK — source lives in many tables):
  source_type   text,                            -- 'join_request'|'meeting_followup'|'shift'|'signup'|'form_submission'|'manual'
  source_id     uuid,
  recurrence    jsonb,                            -- {freq,interval,until} → regenerates a fresh open Requestable
  completed_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (assignee_user_id IS NULL OR assignee_role_id IS NULL)        -- person XOR pool
);
CREATE TABLE gather_request_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parish_id uuid NOT NULL, requestable_id uuid NOT NULL REFERENCES gather_requestables(id) ON DELETE CASCADE,
  author_id uuid NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE gather_request_subtasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), parish_id uuid NOT NULL, requestable_id uuid NOT NULL REFERENCES gather_requestables(id) ON DELETE CASCADE,
  label text NOT NULL, done boolean NOT NULL DEFAULT false, position int NOT NULL DEFAULT 0);
```
RLS: parish-isolated; reads/writes via `getDb(parishId)`. **Keep it exactly this lightweight** — no SLAs,
custom fields, automation rules, or approval chains (locked).

### 4.2 Lifecycle & state machine
`open → assigned → in_progress → done`, plus `declined` / `cancelled`. Pure transition function in shared
(`nextRequestStatus(cur, action, actor)`), unit-tested:
- **Assign** (requester→person): `open→assigned`. **Claim** (member pulls from a role-pool board):
  `open→assigned` with `assignee_user_id=claimant`. **Start:** `assigned→in_progress`. **Done:**
  `→done`, set `completed_at`, fire a small **thank-you** to requester. **Decline / hand-back:**
  `assigned→open` (re-offers to the pool) or `→declined` (with grace, no guilt). **Cancel:** requester only.
- **Recurring:** on `done`, if `recurrence` set, a worker (or the done-transition) inserts a fresh `open`
  Requestable for the next occurrence. No nagging; it simply "comes back around."

### 4.3 Surfaces
- **Group board** (`requestable WHERE group_id=…`): a usable working list grouped by status, **filter/sort
  by status, priority, due, person**; triage, claim, reassign, re-prioritize. Warm, never a leaderboard.
- **Personal "my requests"** (`WHERE assignee_user_id=$me OR requester_id=$me OR (assignee_role_id ∈ my
  group roles)` across all my parish groups): everything involving me, sortable by due/priority, each with a
  kind next step. **"What's next for me?" (the daily landing) is its friendliest face.**
- **Leader who-owes-what overview** (per group): outstanding grouped by person + status, **overdue
  surfaced kindly** — framed as care, never a ledger.
- **No parish-wide staff view** *(Q4 resolved — deferred):* Requests stay **per-group boards + personal
  inbox only** this pass. A parish-wide office/pastor Requests view is intentionally **out of scope for now**
  — the per-group leader who-owes-what overview + the §11 health dashboard cover the near-term staff need;
  revisit later if demand appears.

### 4.4 Emission — every Gather flow becomes a Requestable
A single core `createRequestable({source_type, source_id, …})` is called by each flow instead of
re-inventing pending/assign/track: **Request-to-Join** approval (§5), **meeting follow-ups** (§6),
**shift/sign-up needs** (§7), **form submissions to review** (§10), and staff-initiated asks. *(The former
pending-parishioner approval no longer emits a Requestable — the staff gate was removed, po-wisp-8qsb8.)*
Acting on the Requestable updates the source via its owning flow (welcome a
join-request → roster; finish a follow-up → meeting record). The health dashboard (§11) reads the same
open items. This is the **single coordination spine** of the module.

### 4.5 Tone enforced in the model
Status/labels and all surfaced copy come from shared **invitation-first constants** ("asked you to help",
"can you?", "not this time", "thank you") — never "task/queue/overdue/assigned-to-you". Priority is a
**gentle 3-level** sense (low/normal/soon), not P1–P4. Reminders are gentle nudges (§8), capped, mutable.

## 5. Ministry Directory & Request-to-Join  *(T2)*
- **Reads** `gather_groups WHERE visibility IN ('public','members_only')` → parish-wide catalog; public
  profile from `profile` jsonb (blurb, cadence, leader_contact, photo). Filter by type / interest /
  time-commitment. Public no-login cards served via `/api/v1/gather/directory` (per parish subdomain).
- **Request-to-Join:** `gather_join_requests(parish_id, group_id, user_id, message, status)` → on create,
  **emits a Requestable** to the group's `approve_join_request` role-pool. Approve → `gather_group_members`
  row + warm welcome; decline → neutral notice.
- **Application route (Q2 ✓):** groups requiring an application route through the **minimal Forms Application
  slice that ships with T2** (Application type + reviewer workflow → Requestable, §10) instead of a simple
  request; admin chooses per group. The full builder/field-types land at T7. Auto-suggest 3–5 groups by
  declared interest on onboarding.

## 6. Meetings  *(T3)*
- `gather_meetings` (group_id, starts_at, location, virtual_link, series_id, quorum snapshot, status) +
  `gather_meeting_series` (cadence rule) — **recurrence** with edit-one/edit-all + single-occurrence
  cancel (store exceptions on the series; materialize occurrences). `gather_meeting_rsvps`
  (attending/not/tentative), `gather_agenda_items` (+ auto-pulled prior open follow-ups),
  `gather_agenda_comments` (per-item threads, close on minutes finalize), `gather_attendance`.
- **Quorum tracker** = live count of `attending` RSVPs vs the group's `quorum` (count|percent).
- **Minutes → locked PDF** (reuse the PDF path used elsewhere; store as an `assets` row, kind `document`).
- **Follow-ups → Requestables** (§4.4) with optional due date, on the board + each person's inbox.
- **iCal feed:** per-group personal subscribable URL `/api/v1/gather/groups/:id/calendar.ics` — **generate**
  VEVENTs (net-new) reusing `core/calendar` primitives + the existing ICS conventions. This is a plain
  `/api/v1` GET route (no push, no worker) — **not infra-blocked; ships with T3.**
- **Meeting reminders** (time-based nudges before a meeting) need the **scheduled-job worker = external infra
  (Q3) → this slice is BLOCKED ON EXTERNAL INFRA** and excluded from the T3 build beads; the rest of T3
  (agenda, RSVP, quorum, minutes, follow-up Requestables, iCal feed) proceeds (§17.1).

## 7. Schedules & Shifts + Sign-Ups  *(T4)*
- **Shifts:** `gather_shift_needs` (recurring need: role, datetime pattern) → materialized
  `gather_shift_slots` (open/claimed/no_show); volunteers self-claim; **swap request** notifies eligible
  replacements; coordinator open/filled/no-show view; unfilled needs **emit a Requestable** to the group
  pool. The **24h shift reminder** needs the scheduled-job worker → **BLOCKED ON EXTERNAL INFRA (Q3)**, so
  that one nudge is excluded from the T4 beads; everything else in T4 (claim/swap, sign-ups, templates, CSV)
  proceeds (§17.1).
- **Sign-Ups:** `gather_signups` (visibility public|parish|group, format slot|item|open) +
  `gather_signup_fields` (the **custom field editor**: short/long text, number, dropdown, multi-select,
  date, file, signature; required/help-text) + `gather_signup_responses` (claim/release) +
  `gather_signup_templates` (**reusable**, one-tap re-instantiate carrying fields/items/slots/eligibility).
  Live response table; **CSV export**. Public no-login claim via `/api/v1/gather/signups/:id`.
- *Sign-ups are for claiming/contributing; structured applications/waivers use the Forms Engine (§10).*

## 8. Communication  *(T5 — BLOCKED ON EXTERNAL INFRA, Q3)*
**This entire tier depends on the push + email-broadcast providers + the scheduled-job worker, which the user
+ chief-of-staff stand up separately (Q3).** Gather **designs** T5 in full now but produces **no build bead**
for it until that infra exists (§17.1); the data model + core are written behind a `notify.*` port so T5
lights up by swapping the adapter when the providers land.
- `gather_broadcasts` (group_id, channels[email,push], target {group|role|ad-hoc list}, important bool) +
  `gather_broadcast_receipts` (per-recipient open/ack). Replies route to a **group inbox**
  (`gather_group_inbox`), never the sender's personal email. **Read receipts** (per-broadcast counts;
  per-recipient to sender only). **Email failsafe:** anything pushed also emails if the app isn't opened in
  12h (worker). **"Important"** → 24h gentle follow-up to non-acknowledgers (worker, capped).

## 9. Document Vault  *(T6)*
Per-group files **reuse the `assets` table** (0007) — add asset kinds `document`/`group_photo`; add
`gather_documents(parish_id, group_id, asset_id, title, tags[], visibility group_only|leaders_only|public)`
for the Gather-specific metadata + per-doc visibility. Search by title/tag. Upload via the existing
asset/provider (R2/Bunny) pipeline.

## 10. Events + Forms Engine  *(T7)*
**Events (parish-fair scale):** `gather_events` (name, dates, location, banner, sponsor list jsonb),
`gather_event_rsvps` ("I'm going" — attendance signal, **no ticketing/QR**), `gather_event_checkins`
(day-of "I'm here", **geofenced or time-windowed** — store lat/long or window guard),
`gather_event_shifts` (self-select; reuse §7 shift engine), contribution sign-ups (reuse §7 sign-ups),
a **simple booth/location list** (jsonb, no drag-drop map), **live alerts** (reuse §8 push broadcast to
attendees), **sponsor list** (display-only, no payments).

**Forms Engine (shared infrastructure, embedded):** the builder/renderer/workflow are shared code; **each
module owns its submission data** (no central forms DB — Gather submissions live in Gather tables, e.g.
`gather_form_definitions`, `gather_form_submissions`). Provides: form **types** (Application/Survey/Waiver
w/e-sign→PDF/Inquiry), rich **field types**, **conditional logic**, **multi-page** + **resumable drafts**,
**reviewer workflow** (approve/reject/request-info → **submissions emit Requestables** to the reviewer),
**e-signature + PDF**, **CSV/PDF export**, **public embed widget** (no-login, on the parish site), and a
**starter-template library** (volunteer application, ministry-interest survey, committee application,
photo-release waiver, parental consent, scholarship, generic inquiry). Unified **Forms inbox** ("Submitted
by me" / "To review") aggregates across modules. *Engine code is reusable shared infra; the **minimal
Application slice (Application type + reviewer workflow → Requestable) ships at T2** (Q2 ✓) so Request-to-Join
applications aren't blocked on the full T7 engine.*

## 11. Non-parishioner invites + Health Dashboard + Mobile  *(T8)*
- **Non-parishioner invite — DIRECT, no staff-approval gate** *(human override po-wisp-8qsb8 of PRD §3.7/§4.9
  + spec §9):* a group manager with `group.roster.invite_new` invites by email; `inviteMember` (reuse)
  match-or-create; **no match → `gather_invited_member(parish_id, email, inviter, group_id, accepted_at)`
  and the invite goes out immediately — no `awaiting_staff_approval` queue.** On acceptance the account is
  **scoped: Gather capability + that one group only** — a hard **limited surface enforced in core** (an
  account-scope guard keyed on the `invited` state, not just nav: no parish-wide directory/calendar/other
  groups, no Giving). A second group's invite simply **adds that group** to the same scoped account (no
  queue). **Staff oversight is post-hoc** — via the People manager (see/remove these scoped members); staff
  do **not** gate the invite. Full **audit** (invite/accept/remove). *No approval Requestable is emitted —
  the gate is gone.* **(Q1 ✓:** the invited/pending record is a **Gather-owned `pending_parishioner` table**
  over the interim `users`+`memberships`+`core/people` directory; the future Members module absorbs it later —
  keep it self-contained so that migration is a lift, not a rewrite.)
- **Health dashboard** (`health_dashboard.view`, parish-staff): per-group health card (last meeting,
  attendance sparkline, member count + 90-day change, last broadcast, last sign-up, **overdue Requestables**,
  open join-requests, pending form submissions). Computed via SQL aggregates per group. **Dormancy flag**
  at 180 days (no meeting/broadcast/sign-up). One-tap: message admin; **archive** (`archived_at`, history
  preserved).
- **Mobile surface:** the unified ParvusOrdo app — "What's next for me?" + Requests as primary surfaces,
  Discovery, group pages, sign-up claim, meeting agendas/RSVP/threads, iCal subscribe, Events RSVP/shifts/
  check-in, push inbox, profile/family, Giving (Vanco link-out). **The unified native app shell is external
  infra the user + chief-of-staff stand up separately (Q3) → BLOCKED ON EXTERNAL INFRA; no Gather build bead
  this pass.** **Web-first RSC is the primary surface and ships every tier regardless** (fully usable in a
  phone browser); the native shell later consumes the same `/api/v1/gather/**` surface (§17.1).

## 12. Data model & migrations (append-only, `0031+`, RLS on every table)
One migration per tier keeps the build aligned to the delivery sequence; numbers are **next-free at build
time** (tip 0030; collision rule):
1. **T1+Requests:** `gather_groups` (rename+extend `ministries`, §3.4) + `gather_group_roles` /
   `_members` / `_role_log`; `gather_requestables` / `_comments` / `_subtasks`. + add `gather` to `MODULES`.
2. **T2:** `gather_join_requests` (+ directory reads need no new table). 3. **T3:** meetings/series/rsvps/
   agenda/threads/attendance. 4. **T4:** shift needs/slots + signups/fields/responses/templates. 5. **T5:**
   broadcasts/receipts/group_inbox. 6. **T6:** `gather_documents` (+ asset kinds). 7. **T7:** events/rsvps/
   checkins/shifts + form_definitions/submissions. 8. **T8:** `pending_parishioner` + health is read-only
   (aggregates). **Every table:** `parish_id NOT NULL` + `ENABLE ROW LEVEL SECURITY` + the standard
   `parish_id = app.parish_id` isolation policy. Group-scoping is enforced in core **within** the parish
   tenant (RLS is the tenant boundary; group permission is the in-tenant boundary).

## 13. Multi-tenant RLS & security
- **Tenant isolation** is RLS via `getDb(parishId)` on every table — cross-parish access is a bug (unchanged
  invariant). **Group isolation** is *not* RLS (groups share a parish tenant); it's the `requireGroupPermission`
  + visibility filter layer (§3.3) — so a parish member can't reach a `leaders_only` group's data without a role.
- **Public no-login surfaces** (public sign-ups, directory cards, public forms, iCal feed) run through
  `/api/v1` with parish resolved from host (`resolveParishIdForHost`) and a **read-only, visibility-gated**
  core path — never the authed mutation path. CMS seam (Q-note §18): served under the parish subdomain now,
  independent of the full CMS.
- **Invited-member scoped surface** (Gather + single group only) is enforced in core (an account-scope guard
  keyed on the `invited` state), not merely hidden in nav — this scope **is the safeguard** now that invites
  are direct (no staff gate, po-wisp-8qsb8); same defense-in-depth rule as `requireModule`.
- **Audit** for role transitions (§3.1), invites/approvals (§11), and staff-on-behalf actions.

## 14. API / entry-point surface
- **RSC reads:** group home, directory, board, my-requests, meeting agendas, health dashboard.
- **Server Actions:** all mutations (create group, define roles, join-request, RSVP, claim shift, sign-up
  claim, broadcast, requestable transitions, …) — `requireModule("gather") → requireGroupPermission →
  validate → core → revalidate`.
- **`/api/v1/gather/**`:** iOS app, public no-login (sign-ups/directory/forms), per-group **iCal feed**,
  day-of check-in. **MCP:** optional later (AI "what's next for me?" summaries) — not in scope now.

## 15. UX — polish, delight, and the invitation-first voice (hard requirements)
Gather must feel like a **welcoming parish hall**, not a dashboard — built for volunteers who skew older.
- **Voice is non-negotiable** (locked): every ask is an **invitation, never an order**; gratitude on
  completion; gentle nudges, never nagging. Enforced by shared copy constants (§4.5) so no corporate task UI
  can be built on the model.
- **Older-volunteer rules** (cross-cutting): **44pt+ touch targets**, **one primary action per screen**,
  default landing **"What's next for me?"**, **email is the failsafe channel**, **staff can do anything on a
  parishioner's behalf** (an explicit, audited on-behalf mode).
- **Interaction states everywhere:** skeleton loaders matching final layout; inviting empty states ("No
  groups yet — start the first" with a primary CTA); plain, recoverable errors (never a swallowed 0); a
  small genuine **thank-you** on success. Claiming a slot animates + updates a live count; quorum fills
  visibly as RSVPs arrive; role handoff is one tap + a kind confirmation + the "Past [Role]" badge.
- **`prefers-reduced-motion`** honored globally (animations degrade to instant); WCAG, full keyboard +
  assistive-tech support, strong contrast; fast on modest phones; ParvusOrdo design language with Gather's
  warmer personality.
- **Consistent module shell (IA):** every Gather page renders inside the Gather shell with its left sub-nav
  and the main-sidebar "Gather" entry active — never popping out to a bare nav (§2.1; the po-s2lm pitfall).

## 16. Test plan
- **unit (shared):** `GatherPermission` default bundles + `requireGroupPermission` decision table (staff
  short-circuit, instance scoping, `roles.define` gate); `nextRequestStatus` state machine (all
  transitions, illegal ones rejected); recurrence generation; quorum (count vs percent).
- **integration (real PG):** RLS — parish A can't read/write parish B's any `gather_*` row; **group
  visibility** — a non-member can't read a `leaders_only` group; Requestable board scoping + personal-inbox
  cross-group query; **pending-parishioner** sees only the inviting group; join-request/meeting-followup/
  form-submission each **emit a Requestable**; archive preserves history.
- **e2e (per tier):** create group + define roles + handoff (T1); request-to-join→approve (T2);
  recurring meeting→RSVP→quorum→minutes→follow-up Requestable + iCal subscribe (T3); claim/swap shift +
  sign-up claim + template re-instantiate (T4); targeted broadcast + read receipt + email failsafe (T5);
  vault upload + visibility (T6); event RSVP + check-in + contribution sign-up + Forms application→review
  (T7); invite non-parishioner→staff approve + health dashboard + dormancy/archive (T8). **Requests** thread
  through every tier's e2e (each flow's ask appears in "my requests").

## 17. Delivery sequence (T1–T8) — order, not scope
Every tier ships **in full**, each bead under **full 4-lens Censor review** (directive). **T1 beads = P0.**
Annotations reflect the **resolved** §18 decisions: **✅ proceeds now**; **⛔ infra** = a slice **blocked on
external infra** (Q3) — designed here, but **not** decomposed into a build bead until that infra lands (§17.1).
```
T1 (P0)  Groups primitive + group RBAC engine + ministries reconcile      ┐ foundation —      ✅
+        Requests pillar (requestables/comments/subtasks + emission spine) ┘ all depends on it  ✅
T2  Directory + Request-to-Join + minimal Forms Application slice (Q2)                          ✅
T3  Meetings: agenda / RSVP / quorum / minutes / follow-ups + iCal feed                         ✅
       └ meeting reminders (time-based push)                                                    ⛔ infra
T4  Schedules & Shifts + Sign-Ups                                                               ✅
       └ 24h shift reminder (scheduled worker)                                                  ⛔ infra
T5  Communication (push + email broadcast)                                          ⛔ ENTIRE TIER infra
T6  Document Vault (assets reuse)                                                               ✅
T7  Events (RSVP / check-in / shifts / sign-ups / booths) + full Forms Engine                  ✅
       └ event live-alert push                                                                  ⛔ infra
T8  Non-parishioner invites (Q1 pending_parishioner) + Health Dashboard                         ✅
       └ unified native mobile app shell                                                        ⛔ infra
```
Inter-tier deps: T2–T8 all consume **Groups (T1)** and emit **Requestables**. The minimal **Forms Application
slice ships with T2** (Q2); the full Forms Engine is T7. Decompose per tier into build beads **after the user
approves this final RFC** (the 2nd gate) — all foundational §18 questions are now resolved.

### 17.1 External-infra isolation (Q3) — decomposition rule
The user + chief-of-staff stand up the net-new infra **separately**: **push notifications, an email/broadcast
provider, a scheduled-job (cron) worker, and the unified native mobile app shell.** Hard rule for the rector's
decomposition: **design these now, but emit NO build bead that depends on a service that doesn't exist yet.**
- **Blocked on external infra** (designed, not beaded yet): **T5 Communication in full** (push + email
  broadcast); every **time-based nudge** that needs the scheduled worker — meeting reminders (T3), the 24h
  shift reminder (T4), event live-alerts (T7), and the broadcast email-failsafe / "important" follow-up (T5);
  and the **native mobile app shell** (T8).
- **Proceeds now** (no external-infra dependency): **T1, T2, T4, and the non-push core of T3** (agenda, RSVP,
  quorum, minutes, follow-up Requestables, **iCal feed** — a plain `/api/v1` route), plus **T6**, **T7**
  (events + Forms, minus live-alert push), and **T8** (invites + health dashboard, minus the native shell).
- **Isolation mechanics:** recurring-Requestable regeneration runs **synchronously on the `done` transition**
  (§4.2), so recurrence is **not** worker-blocked — only *time-based* reminders are. All notification sends go
  through a thin **port interface** (`notify.push` / `notify.email`) with a no-op stub until the providers
  land, so core compiles and ships now and each blocked slice lights up by swapping the adapter — no rework.
  When the infra exists, the blocked slices are filed as their **own follow-up beads**, blocked-on those infra
  deliverables — so the unblocked work is never gated behind a service that isn't there yet.

## 18. Decisions — all four resolved (user, 2026-06-02)
The four genuine decisions are **closed** by the user; the RFC above is finalized around them. Recorded here
for the rector's decomposition.

- **Q1 — Parish Members master directory → RESOLVED (interim directory).** T1 builds against the **existing
  `users` + `memberships` + `core/people`** as the interim parish directory; **`pending_parishioner` ships as
  a Gather-owned table** the future Members module absorbs later. No Members module is specced and **nothing
  blocks T1.** (§1, §5, §11, §12.)
- **Q2 — Forms Engine timing → RESOLVED (minimal slice at T2).** A **minimal Forms slice — the Application
  type + reviewer workflow → Requestable — ships with T2**; the full builder + field-types + other form types
  land at **T7.** T2 Request-to-Join applications are therefore not blocked on T7. (§5, §10, §17.)
- **Q3 — Net-new infra → RESOLVED (external; stood up separately; do NOT bead).** The **push, email/broadcast
  provider, scheduled-job worker, and unified native mobile app shell are stood up separately by the user +
  chief-of-staff** — the Gather fleet does **not** build them. The infra-dependent slices (T5 in full, all
  time-based reminders, the native shell) are **designed but marked BLOCKED ON EXTERNAL INFRA**, and **no
  build bead may depend on a service that doesn't exist yet.** Decomposition is **isolated** so **T1 / T2 / T4
  / the non-push core of T3** (and the non-push parts of T6/T7/T8) proceed now (§17.1). The blocked slices
  become their own follow-up beads when the infra lands.
- **Q4 — Requests board scope → RESOLVED (group + personal only).** Requests stay **per-group boards +
  personal inbox only**; **no parish-wide staff view** this pass (revisit later). The per-group leader
  who-owes-what overview + the §11 health dashboard cover the near-term staff need. (§4.3.)

**Decide-and-noted** (reversible, in-doc): `gather` `defaultEnabled:false` (opt-in per parish, §2); **ministries
renamed+extended into `gather_groups`** touching 3 readers (§3.4 — flag if you want the parallel-table
approach); Requests stays exactly the locked-lightweight shape (§4.1, no SLA/automation/custom-fields);
non-parishioner invite is **DIRECT — no staff-approval gate** (human override po-wisp-8qsb8; the Gather +
single-group scope is the safeguard, staff oversight post-hoc via the People manager; PRD §7-8's 30/60-day
queue policies are now **moot**); Giving = Vanco **link-out only**; public surfaces served under the parish subdomain now, **independent of the full CMS**
(seam noted); full scope, the spec's Out list (§4.15) are deliberate **non-goals** (none pulled in).

## 19. Risks
- **Members dependency (Q1 — resolved):** T1 builds on the interim `users`+`memberships`+`core/people`
  directory with a Gather-owned `pending_parishioner`; the future Members module must absorb that table
  cleanly — keep `pending_parishioner` self-contained (no cross-table coupling) so the later migration is a
  lift, not a rewrite.
- **Group-scoped RBAC is a new authz subsystem** layered inside the parish tenant — the Censor security pass
  must verify visibility + `requireGroupPermission` can't be bypassed (esp. via `/api/v1` and public routes).
- **Direct non-parishioner invites** (no staff gate, po-wisp-8qsb8) let a group manager grant scoped parish
  access — the **single-group + Gather-only scope guard is the sole safeguard**; the Censor security pass
  must verify it can't be widened (no parish-wide reads, no second-group escalation, staff-removable).
- **Requests is the coordination spine** — if each flow re-invents pending/assign/track instead of calling
  `createRequestable`, the module fractures; enforce the single emission path in review.
- **External infra (Q3 — resolved external):** push / email / scheduled-worker / native-shell are stood up by
  the user + chief-of-staff, **not** the Gather fleet. The risk shifts to **leakage** — a build bead must
  never depend on a service that doesn't exist yet; keep every notification send behind the `notify.*` port
  (§17.1) and file the blocked slices as separate infra-gated follow-ups, so the unblocked majority ships
  uninterrupted.
- **`ministries` rename touches existing surfaces** (§3.4) — coordinate with in-flight OCIA/people beads;
  prove `next build` + the people/home reads still pass.
- **Tone regression risk** — "lightweight + invitation-first" must be defended every tier (it's the product's
  soul); the shared copy constants + the locked field set are the guardrails.
