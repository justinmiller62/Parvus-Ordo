# RFC-005 — Parvus Gather (Parish Ministries, Boards, Events & Requests)

**Status:** Draft — 4 decisions pending (see §18); rfc-ready held until the foundational ones (esp. Q1 Members) resolve · **Addresses:** po-2whw (RFC) from **po-h99 / PRD-001** (`prd-approved`) · **Source spec:** `docs/specs/parvus-gather.md` (11 sections) + LOCKED `requests-requestables.md`
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
| Members directory | `core/people` (`listParishMembers`/`setMemberRole`/…) over `users`+`memberships` | interim source for Gather; master Members module "not yet specced" (Q1) |
| Invites | `core/onboarding/invite.ts` (`inviteMember`) | extend for group invites + **`pending_parishioner`** (§11) |
| Files | `assets` (0007: scope/provider bunny-r2/kind/status) | **Document Vault** + group photos = new asset kinds (§9) |
| Out-of-band jobs | only `infra/workers/clip-cutter` | push, email-broadcast, scheduled reminders/expiry → **net-new workers** (Q3) |

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
- **`infra/workers/`** — net-new scheduled/queue workers for push, email broadcast, and time-based nudges.

**Enablement.** Add to `MODULES` (shared): `gather` — `toggleable: true`, `roles: every role`
(parishioner-facing community module), **`defaultEnabled: false`** *(recommended — a net-new major module
is opt-in per parish; existing modules stay `true` for zero-change, Gather ships dark and each parish turns
it on via the RFC-004 systems-admin toggle)*. `enabledModules(parishId)` already gates nav + every shim.

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
  source_type   text,                            -- 'join_request'|'meeting_followup'|'shift'|'signup'|'pending_parishioner'|'form_submission'|'manual'
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
- **Parish-staff view** (Q4, §18): an optional office/pastor view of all open Requests parish-wide.

### 4.4 Emission — every Gather flow becomes a Requestable
A single core `createRequestable({source_type, source_id, …})` is called by each flow instead of
re-inventing pending/assign/track: **Request-to-Join** approval (§5), **meeting follow-ups** (§6),
**shift/sign-up needs** (§7), **pending-parishioner** approval (§11), **form submissions to review** (§10),
and staff-initiated asks. Acting on the Requestable updates the source via its owning flow (welcome a
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
- **Application route (pending Q2):** groups requiring an application route through a Forms-Engine
  Application (§10) instead of a simple request; admin chooses per group. *Designed against the minimal
  forms slice (Q2).* Auto-suggest 3–5 groups by declared interest on onboarding.

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
  VEVENTs (net-new) reusing `core/calendar` primitives + the existing ICS conventions. (Infra: hosting an
  authenticated feed URL — Q3 confirm.)

## 7. Schedules & Shifts + Sign-Ups  *(T4)*
- **Shifts:** `gather_shift_needs` (recurring need: role, datetime pattern) → materialized
  `gather_shift_slots` (open/claimed/no_show); volunteers self-claim; **swap request** notifies eligible
  replacements; coordinator open/filled/no-show view; **24h reminder** (worker — Q3). Unfilled needs can
  **emit a Requestable** to the group pool.
- **Sign-Ups:** `gather_signups` (visibility public|parish|group, format slot|item|open) +
  `gather_signup_fields` (the **custom field editor**: short/long text, number, dropdown, multi-select,
  date, file, signature; required/help-text) + `gather_signup_responses` (claim/release) +
  `gather_signup_templates` (**reusable**, one-tap re-instantiate carrying fields/items/slots/eligibility).
  Live response table; **CSV export**. Public no-login claim via `/api/v1/gather/signups/:id`.
- *Sign-ups are for claiming/contributing; structured applications/waivers use the Forms Engine (§10).*

## 8. Communication  *(T5)*
- `gather_broadcasts` (group_id, channels[email,push], target {group|role|ad-hoc list}, important bool) +
  `gather_broadcast_receipts` (per-recipient open/ack). Replies route to a **group inbox**
  (`gather_group_inbox`), never the sender's personal email. **Read receipts** (per-broadcast counts;
  per-recipient to sender only). **Email failsafe:** anything pushed also emails if the app isn't opened in
  12h (worker). **"Important"** → 24h gentle follow-up to non-acknowledgers (worker, capped). *All of this
  needs the push + email-broadcast infra — Q3.*

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
by me" / "To review") aggregates across modules. *Engine code is reusable shared infra; flagged for a
possible **minimal Application slice at T2** (Q2) so Request-to-Join applications aren't blocked on full T7.*

## 11. Non-parishioner invites + Health Dashboard + Mobile  *(T8)*
- **Pending-parishioner flow** (spec §9, verbatim values): `inviteMember` (reuse) match-or-create; no match
  → `pending_parishioner(parish_id, email, status awaiting_staff_approval, inviter, group_id, expires)` +
  group roster `awaiting_acceptance`. The `pending` account has a **limited surface** — only the inviting
  group; **enforced in core** (a `pending`-scoped read guard, not just nav). **Staff approval emits a
  Requestable** (§4.4). **A second group's invite queues** until staff approval. **30-day** reminder,
  **60-day** archive. Full **audit** (every invite/accept/approve/reject/expiry). *(Lands the master-Members
  seam — Q1: where `pending_parishioner` ultimately lives.)*
- **Health dashboard** (`health_dashboard.view`, parish-staff): per-group health card (last meeting,
  attendance sparkline, member count + 90-day change, last broadcast, last sign-up, **overdue Requestables**,
  open join-requests, pending form submissions). Computed via SQL aggregates per group. **Dormancy flag**
  at 180 days (no meeting/broadcast/sign-up). One-tap: message admin; **archive** (`archived_at`, history
  preserved).
- **Mobile surface:** the unified ParvusOrdo app — "What's next for me?" + Requests as primary surfaces,
  Discovery, group pages, sign-up claim, meeting agendas/RSVP/threads, iCal subscribe, Events RSVP/shifts/
  check-in, push inbox, profile/family, Giving (Vanco link-out). *Whether the unified app shell exists or
  is part of this work — Q3; web-first RSC is the primary surface regardless.*

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
- **Pending-parishioner** limited surface is enforced in core (a capability guard keyed on account state),
  not merely hidden in nav — the same defense-in-depth rule as `requireModule`.
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
```
T1 (P0)  Groups primitive + group RBAC engine + ministries reconcile      ┐ foundation —
+        Requests pillar (requestables/comments/subtasks + emission spine) ┘ built together, everything depends on them
T2  Directory + Request-to-Join (+ minimal Forms Application slice, pending Q2)
T3  Meetings (+ iCal feed generation; push/feed infra pending Q3)
T4  Schedules & Shifts + Sign-Ups
T5  Communication (push + email broadcast infra pending Q3)
T6  Document Vault (assets reuse)
T7  Events + full Forms Engine
T8  Non-parishioner invites + Health Dashboard + Mobile surface (shell pending Q3; Members seam Q1)
```
Inter-tier deps: T2–T8 all consume **Groups (T1)** and emit **Requestables**. Forms (T7) is referenced by
T2 (applications) — hence the Q2 minimal-slice question. Mobile (T8) depends on Q3. Decompose per tier into
build beads only after the **foundational** §18 questions resolve (esp. Q1) and the user approves (2nd gate).

## 18. Decisions & open questions
Four genuine decisions are mailed to the rector (`QUESTION[po-2whw]`); the RFC is written around the
**recommended** answers with dependent sections isolated. The rest are decide-and-noted.

- **Q1 (biggest) — Parish Members master directory.** Spec says it's "not yet specced," yet Gather reads
  members and writes `pending_parishioner`. *Recommend:* **T1 builds against the existing `users` +
  `memberships` + `core/people` as the interim directory**, and `pending_parishioner` ships as a
  Gather-owned table the future Members module absorbs. Or: spec a minimal Members capability first
  (blocks T1). **Need the call before decomposing T1.**
- **Q2 — Forms Engine timing.** T2 Request-to-Join can require an application (a form). *Recommend:* land a
  **minimal Forms slice (Application type + reviewer workflow → Requestable) with T2**, full builder/types at
  T7. Or keep all forms at T7 (T2 applications use a simple request only until then).
- **Q3 — Infra availability (push, email-broadcast, scheduled-job worker, unified mobile app shell).** iCal
  parsing exists in `core/calendar`; **push, an email/broadcast provider, a scheduled/cron worker, and the
  unified app shell are net-new.** *Recommend:* stand up a single scheduled-job worker + confirm a push +
  email provider as a T3/T5 infra prerequisite; web-first RSC is the primary surface and the native shell is
  a separate track. **Confirm what exists vs. what this work stands up** (gates T3/T5/T8 delivery, not design).
- **Q4 — Requests board scope.** Per-group boards + personal inbox are locked. *Recommend:* **also add a
  parish-wide staff view** of all open Requests (cheap; staff need who-owes-what oversight, which the health
  dashboard already implies). Or keep group-scoped + personal only.

**Decide-and-noted** (reversible, in-doc): `gather` `defaultEnabled:false` (opt-in per parish, §2); **ministries
renamed+extended into `gather_groups`** touching 3 readers (§3.4 — flag if you want the parallel-table
approach); Requests stays exactly the locked-lightweight shape (§4.1, no SLA/automation/custom-fields);
pending-parishioner **30/60-day** windows + second-group-queues-until-approval per spec §9; Giving = Vanco
**link-out only**; public surfaces served under the parish subdomain now, **independent of the full CMS**
(seam noted); full scope, the spec's Out list (§4.15) are deliberate **non-goals** (none pulled in).

## 19. Risks
- **Members dependency (Q1)** is the critical path — decomposing T1 against the wrong directory assumption is
  expensive; resolve first.
- **Group-scoped RBAC is a new authz subsystem** layered inside the parish tenant — the Censor security pass
  must verify visibility + `requireGroupPermission` can't be bypassed (esp. via `/api/v1` and public routes).
- **Requests is the coordination spine** — if each flow re-invents pending/assign/track instead of calling
  `createRequestable`, the module fractures; enforce the single emission path in review.
- **Net-new infra (Q3)** (push/email/workers) gates T3/T5/T8 *delivery*; sequence the infra prerequisite so
  tiers aren't blocked late.
- **`ministries` rename touches existing surfaces** (§3.4) — coordinate with in-flight OCIA/people beads;
  prove `next build` + the people/home reads still pass.
- **Tone regression risk** — "lightweight + invitation-first" must be defended every tier (it's the product's
  soul); the shared copy constants + the locked field set are the guardrails.
