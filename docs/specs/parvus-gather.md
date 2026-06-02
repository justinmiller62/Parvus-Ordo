# ParvusOrdo — Parvus Gather (Ministries, Boards & Events MVP)

*Where many small things are rightly arranged.*

**Module name:** *Parvus Gather* — biblical resonance ("where two or three are gathered"), short, action-flavored. Covers committees, boards, ministries, and event teams as variants of a single **group** primitive, plus event coordination, ministry discovery, meeting management, and a per-parish-leadership health dashboard. Built for parishes whose volunteers skew older — touch-friendly, one primary action per screen, staff can do anything on behalf of a parishioner.

**Mobile app architecture (decided):** Single unified **ParvusOrdo** mobile app for parishioners — all parishioner-facing modules (Parvus Gather, Sacramental Records, the cross-module Forms inbox, Giving handoff, etc.) appear as tabs/surfaces inside the one app. The sole exception is **Parvus Studio** (Youth Teaches recording app), which remains a specialized standalone iOS app because of its Vision/AVFoundation gesture-and-segmentation pipeline.

---

## Scope

**In:** groups (with dynamic per-group role labels), ministry directory + request-to-join, meetings (with recurrence + RSVP/quorum + agenda discussion + iCal feed), schedules, sign-ups (public/private + custom field editor + reusable templates), email + push + read receipts, document vault, events (RSVP + self-check-in, no ticketing), pending-parishioner invite flow, parish-leadership health dashboard, mobile app surface.

**Embeds:** the **Forms Engine** (full definition appended at the bottom of this doc) for any complex application/inquiry/waiver beyond simple sign-up fields (committee membership applications, volunteer applications, ministry interest surveys, photo-release waivers). Submission data lives in this module's schema; the builder/renderer/workflow are provided by the shared engine.

**Out (MVP):** SMS, POS integration, ticketing/QR wallet, paid bidding/silent auction, formal proxy voting, drag-drop visual layout planner, cross-ministry conflict prevention, custom-branded per-parish apps, sponsor payment processing, **certifications & renewals** (add on request — VIRTUS / background checks / CPR tracking).

---

## 1. Groups (the primitive)

- Create group: name, type (`committee` | `board` | `ministry` | `event-team`), optional parent group
- **Dynamic, group-defined roles** — each group defines its own role labels (Knights of Columbus uses Grand Knight / Deputy Grand Knight / Chancellor; a finance council uses Chair / Treasurer / Secretary; a ministry uses Coordinator / Volunteer). Defaults provided per group type but fully renameable, addable, removable per group.
- Each role carries permissions, not just a title (see RBAC)
- Visibility: `public`, `members-only`, `leaders-only` (leaders = anyone in a role flagged as leadership)
- **Role transition / handoff** — one-tap "transfer this role to [member]" with confirmation. Outgoing holder optionally retains a read-only "Past [Role]" badge for one fraternal/council year. All transitions logged.
- Group home page: roster, next meeting, open shifts, shared files, recent announcements

## 2. Ministry Directory & Request-to-Join

- **Parish-wide catalog** of every `public` and `members-only` group
- Per-group public profile: name, blurb, meeting cadence, leader contact, photo
- Filter by type (committee / board / ministry / event-team), by area of interest (liturgy, service, formation, fellowship), by time commitment
- **"Request to join"** button on each card. Request lands in the group admin's queue with the requester's name, contact, and optional message.
- Admin approves → added to roster. Admin declines → requester gets a neutral notice.
- For groups that require an actual application (not just a join request), the request flow routes through a Forms Engine application form (see §10 dependencies) — the group's admin decides per-group whether a simple request or a full application is required
- Auto-suggest 3–5 groups to new parishioners during onboarding based on declared interests

## 3. Meetings

- Schedule a meeting (date, time, location, optional virtual link)
- **Recurring series** — define cadence (weekly, bi-weekly, 2nd Tuesday monthly, quarterly). Generate series. Edit-one vs edit-all dialog on modification. Cancel a single occurrence without breaking the series.
- **iCal feed per group** — every member gets a personal subscribable URL; meetings sync to Apple Calendar / Google Calendar / Outlook
- Agenda builder: standing items + custom items + open action items from prior meeting auto-pulled
- **Per-agenda-item discussion threads** — async comments on individual agenda items before (and after) the meeting; lets boards hash out details outside the live session. Threads close when minutes are finalized.
- **Meeting RSVP** — "attending / not attending / tentative" — visible to chair
- **Quorum tracker** — group defines its quorum count or quorum percentage; live count shown to chair when scheduling and during the meeting itself
- Minutes (typed live or after); finalize → locked PDF
- Action items: assignee, due date, status; surface on assignee's dashboard
- Attendance check-in (tap name or self-check-in via mobile)

## 4. Schedules & Shifts

- Define recurring need: e.g., "Saturday 5pm Mass — Lector, Greeter, Eucharistic Minister"
- Open-slot view; volunteers self-claim from mobile
- Swap request: volunteer offers, system notifies eligible replacements
- 24-hour reminder (email + push)
- Coordinator view: open / filled / no-show

## 5. Sign-Ups

For *claiming a slot or contributing an item*. For *applying, requesting, or submitting structured information* (committee applications, volunteer applications, waivers), reach for the embedded **Forms Engine** instead (full definition appended at the bottom of this doc) — submissions land in Parvus Gather's data with full reviewer workflow.

- **Visibility:** `public` (anyone with the link, no login required), `parish-only` (any parishioner), or `group-only` (members of a specific group)
- **Three formats:**
  - **Slot-based** — fixed slots, first-come (e.g., "20 spots for the men's retreat")
  - **Item-based** — claim an item from a list (e.g., bake sale: cookies / bars / pies; potluck: appetizer / main / dessert)
  - **Open-ended** — collect responses with no slot cap
- **Field editor** — sign-up creator can add custom fields per sign-up: short text, long text, number, dropdown, multi-select, date, file upload, signature
- Required vs optional fields; per-field help text
- Tap to claim, tap to release (where applicable)
- **Recurring sign-up templates** — save a sign-up as a template; re-instantiate next month/cycle with one tap. Templates can carry forward custom fields, item lists, slot counts, eligibility rules.
- Responses export to CSV; coordinator sees a live response table

## 6. Communication

- Email broadcast targeted by group, role, or ad-hoc list
- Push notification with same targeting
- Replies route to a **group inbox**, never to the sender's personal email
- Email failsafe: anything pushed to app also emails if user hasn't opened app within 12h
- **Read receipts** — sender sees per-broadcast counts ("23 of 41 members opened"). Per-recipient detail visible to sender only. Receipts trigger on email open or app inbox view.
- Optional "Important" flag on a broadcast triggers a follow-up nudge (email + push) at 24h to anyone who hasn't acknowledged

## 7. Document Vault (per group)

- Upload PDFs, handbooks, policies, training materials
- Per-document visibility (`group-only` | `leaders-only` | `public`)
- Search by title/tag

## 8. Events (parish fair scale)

- Event setup: name, date(s), location, description, banner image
- **Attendance signal**, not ticketing — parishioners RSVP / mark "I'm going" from the app. No QR tickets, no wallet, no scan-in.
- **Day-of self-check-in via mobile app** — attendee taps "I'm here" at the event; geofenced or short check-in window prevents drive-by check-ins
- Volunteer shifts: define (booth, setup, cleanup, teardown); volunteers self-select
- **Event sign-ups** for contributions (uses §5 sign-up engine):
  - Bake sale item list (cookies / bars / pies / breads)
  - Potluck dishes
  - Donated supplies (paper goods, drinks, decorations)
  - Equipment loans (tents, coolers, tables)
- **Simple booth/location list** (booth 1: bake sale; booth 2: raffle) — no drag-drop map in MVP
- Live alerts: push to all attendees ("Raffle drawing in 10 min", "Weather delay")
- Sponsor list (display only — names, logos, tier; no payment processing)

## 9. Inviting non-parishioners to a group

A roster admin can invite someone who is not yet in the parish directory. The flow protects staff control of the master directory without bottlenecking committee work.

**Flow:**

1. **Admin invites** by email (optional: name, phone). System checks for an existing parishioner with that email.
   - **Match found** → just added to the group; flow ends.
   - **No match** → create `pending_parishioner` record with status `awaiting_staff_approval`; add to the inviting group's roster with status `awaiting_acceptance`; send email invite.
2. **Invitee accepts** via emailed link, sets password, confirms basic info. Account state becomes `pending`.
3. **`pending` parishioner can do (limited surface):**
   - Sign in to the mobile app
   - See and participate **only in the inviting group** (its meetings, sign-ups, document vault, announcements)
   - RSVP to that group's events
4. **`pending` parishioner cannot:**
   - See parish-wide directory, announcements, calendar, or other groups
   - Be added to additional groups (a second admin's invite queues but doesn't activate until staff approval)
   - Give through the giving flow tied to the parish account
5. **Parish staff approval queue** shows: invitee name, inviter, group, date. Staff approves → `pending` → `active`, full parishioner access. Staff rejects → invitee gets a neutral decline, inviting admin is notified.
6. **Auto-expiry:** if staff doesn't act within 30 days, the inviting admin is reminded; at 60 days the pending record is archived (admin can re-invite).

**Audit:** every invite, acceptance, approval, rejection, and expiry is logged with actor + timestamp + group context.

## 10. Health Dashboard for Parish Leadership

Pastor / staff view — surfaces zombie ministries and at-risk groups so parishes don't carry phantom committees on the bulletin.

- **Per-group health card:**
  - Last meeting date
  - Attendance trend (last 6 meetings, sparkline)
  - Active member count + trailing 90-day change
  - Last broadcast sent
  - Last sign-up activity
  - Pending action items past due
  - Open join-requests in queue
  - Pending applications in the Forms Engine queue
- **Sort/filter:** by type, by health flag (dormant / at-risk / healthy), by last activity
- **Dormancy flag:** no meeting + no broadcast + no sign-up activity in 180 days → flagged for review
- **One-tap actions:** message the group's admin; archive the group (preserves history, removes from active directory)

## 11. Mobile App Surface (inside the unified ParvusOrdo app)

- **My Dashboard**: shifts this week, action items, upcoming meetings (with RSVP), RSVP'd events, group activity, pending Forms-Engine items routed to me (submissions awaiting my review + my own submissions awaiting decision)
- **Discovery tab**: browse ministry directory, request to join (or start a Forms-Engine application if the group requires one), see suggestions
- Group pages (read for members, edit for leadership roles)
- Sign-up browsing, claiming, and filling out custom fields
- Meeting agendas/minutes (read for members, edit for leadership roles); RSVP to meetings; participate in per-item discussion threads
- **Subscribe to group calendar** (iCal handoff to system calendar app)
- Events: RSVP, view my volunteer shifts, **"I'm here" day-of check-in**
- Push notification inbox with read-receipt acknowledgment
- Profile & family info edit
- Giving (links into existing Vanco flow)
- Parvus Gather's surfaces appear alongside the cross-module Forms inbox (provided by the embedded Forms Engine) and the global notification inbox — all in the **single unified ParvusOrdo app**. No standalone Parvus Gather app.

---

## RBAC additions

References [[ParvusOrdo_RBAC]] (and the appended Forms Engine section for `form.*` permission definitions). **All permissions below are instance-scoped to the group** unless noted — a KofC Grand Knight has roster admin for the KofC council only, not for the finance committee. Parish admins implicitly hold every group-scoped permission within their parish.

| Permission | Notes |
|---|---|
| `group.create` / `delete` | Parish-scoped, not group-scoped. Typically admin or staff. |
| `group.edit_settings` | Edit group name, type, visibility, description |
| `group.edit_public_profile` | Edit the discovery-tab card (blurb, photo, cadence) |
| `group.roster.add` | Add an existing parishioner to the group |
| `group.roster.invite_new` | Invite someone not yet in the directory (creates `pending_parishioner` — staff approval required; see §9) |
| `group.roster.remove` | Remove a member from the group |
| `group.roster.assign_role` | Assign or change a member's role within the group (gated separately because changing roles changes permissions) |
| `group.roster.transfer_role` | One-tap handoff of a role to another member |
| `group.roster.approve_join_request` | Approve / decline incoming join requests from the discovery tab |
| `group.roles.define` | Create/rename/delete the group's role labels and their permission bundles |
| `group.self_leave` | Implicit for every member — no permission grant required |
| `meeting.draft` / `finalize` | Typically secretary or chair |
| `meeting.define_recurrence` | Create/edit recurring meeting series |
| `meeting.set_quorum` | Set the group's quorum count or percentage |
| `agenda_thread.moderate` | Hide, lock, or delete per-item discussion comments |
| `event.create` / `publish` | Staff or event coordinator |
| `shift.define` / `assign_others` | Ministry leader |
| `signup.create` / `edit` | Author of the sign-up or group leader |
| `signup.save_template` / `instantiate_template` | Save reusable sign-up templates; instantiate them |
| `broadcast.send` | Scoped per group; targets limited to that group's roster |
| `broadcast.view_read_receipts` | See per-recipient read state on broadcasts you sent |
| `document.upload` / `delete` | Per group's document vault |
| `health_dashboard.view` | Parish-scoped. Pastor, staff, parish admin. |
| `group.archive` | Archive a dormant group (preserves history). Parish-scoped. |
| `form.create` / `edit` / `delete` (engine) | Granted scoped to a group when the group requires applications (e.g., committee membership form). Permission strings defined by the embedded Forms Engine (appended below). |
| `form.review_submissions` (engine) | Approve / reject / request-more-info on incoming applications routed to this module. |

**Default bundle for a group's "admin" role** (whatever the group chooses to call it — Chair, Grand Knight, Coordinator): `group.edit_settings`, `group.edit_public_profile`, `group.roster.add`, `group.roster.invite_new`, `group.roster.remove`, `group.roster.assign_role`, `group.roster.transfer_role`, `group.roster.approve_join_request`, `meeting.draft`, `meeting.finalize`, `meeting.define_recurrence`, `meeting.set_quorum`, `agenda_thread.moderate`, `signup.create`, `signup.edit`, `signup.save_template`, `signup.instantiate_template`, `form.create`, `form.edit`, `form.review_submissions`, `broadcast.send`, `broadcast.view_read_receipts`, `document.upload`, `document.delete`.

**New parish-staff permissions:**
- `parishioner.approve_pending` — review and approve/reject pending parishioners invited through group flows (see §9)
- `health_dashboard.view` — see the parish-wide group health view (§10)
- `group.archive` — archive dormant groups
- `form.publish_public` (engine) — gate public-facing forms (since they go on the parish website)

Note that `group.roles.define` is **not** in the default admin bundle — changing what roles exist and what they can do is sensitive enough to gate behind a separate grant (typically parish staff, or explicitly granted to a group's founding admin).

---

## Design rules for older volunteers

- 44pt minimum touch targets
- One primary action per screen
- Default landing after login: **"What's next for me?"** (shifts + action items + meetings this week)
- Email is the failsafe channel — never assume the app was opened
- Staff can do everything on behalf of a parishioner (sign them up, change email, claim a shift for them) so phone-call requests don't require the caller to self-serve

---

## Cross-module dependencies

- **[[ParvusOrdo_Architecture]]** — auth, multi-tenancy, Neon/RLS, push infrastructure, iCal endpoint hosting
- **[[ParvusOrdo_RBAC]]** — permission/role-template engine, instance scoping
- **Forms Engine** — embedded shared infrastructure; full definition appended below
- **Parish Members module** (not yet specced) — owns the master parishioner directory; this module reads from it and creates `pending_parishioner` records into it
- **Vanco giving integration** — linked from mobile app; not implemented in this module
- **Parish website / CMS module** (not yet specced) — embeds public forms (via the Forms Engine) and ministry directory cards (§2)

---

## Embedded module: ParvusOrdo Forms Engine

Parvus Gather embeds the **Forms Engine** for any application/inquiry/waiver beyond simple sign-up fields. The engine is shared ParvusOrdo infrastructure that any module can drop in — **submission data is stored in the consuming module's own schema**. There is no central "all forms" database. A committee membership application's data lives in Parvus Gather's tables; when other modules adopt the engine later, their submission data lives with them.

### What the engine provides

- **Form builder UI** — drag-drop field editor (used by anyone with `form.create` granted by the consuming module)
- **Form types:**
  - **Application** — submitted once per person; routes to one or more approvers; trackable status
  - **Survey** — collect responses; no approval workflow
  - **Waiver / Release** — requires e-signature; finalized submission preserved as PDF
  - **Inquiry** — open-ended intake; routes to designated reviewer
- **Field types:** short text, long text, number, dropdown, multi-select, radio, date, time, file upload, signature, rating scale, address block, section break
- **Conditional logic** — show/hide questions based on prior answers
- **Multi-page rendering** with progress bar
- **Resumable drafts** — auto-saved; resume from any device
- **Reviewer workflow primitives** — approve / reject / request more info; status notifications
- **E-signature capture** + PDF generation for waiver-type forms
- **Submission export** — CSV table or per-submission PDF bundle
- **Embed widget** for parish website (no-login public forms)
- **Starter template library** — shipped with the engine (see below)

### What the consuming module (Parvus Gather) owns

| Concern | Owner |
|---|---|
| Submission data tables | Parvus Gather schema (e.g., `gather.group_applications`, `gather.volunteer_applications`) |
| Form definition storage | Parvus Gather decides — store schemas alongside its data, or fork from the shared starter library |
| Routing rules | Parvus Gather (which group's admin/chair reviews this form type) |
| Lifecycle / retention | Parvus Gather (archival policy per committee's bylaws) |
| RBAC scoping | Parvus Gather scopes `form.*` permissions to the group instance |
| Cross-references | Parvus Gather links a submitted application to the resulting roster entry on approval |

The engine does **not** own a master forms database. It owns code (builder, renderer, workflow primitives), starter templates, and shared UI components.

### Forms-Engine RBAC contribution

Permission strings are declared by the engine; Parvus Gather grants them within group scope. Already included in Parvus Gather's RBAC table above:

| Permission | Notes |
|---|---|
| `form.create` / `edit` / `delete` | Build forms within a group's scope |
| `form.review_submissions` | Approve / reject / request-more-info on incoming submissions |
| `form.publish_public` | Make a form publicly accessible (no-login); staff-gated since these surface on the parish website |
| `form.use_starter_template` | Fork a template from the shared library |
| `form.export_submissions` | CSV or PDF bundle export |

### Mobile-app surface (inside unified ParvusOrdo app)

The Forms inbox aggregates across every module that embeds the engine. For the Parvus-Gather-only MVP this means:

- **Submitted by me** — every application I've submitted (committee applications, volunteer applications, etc.) with live status and reviewer messages
- **To review** — submissions awaiting my action as a group admin/reviewer
- Future modules embedding the engine surface in the same inbox automatically; no separate UI

### Starter templates relevant to Parvus Gather

Shipped with the engine — fork and customize per group:

- Volunteer application
- Ministry interest survey
- Committee membership application
- Photo release waiver
- Parental consent (youth ministry)
- Scholarship application
- Generic contact / inquiry

### Architectural rationale (why per-module ownership)

- **Data sovereignty per module** — each module's data has its own lifecycle and retention rules (committee applications follow bylaws; future sacramental forms will follow Canon 535 §2). Centralizing storage would force one policy to fit all.
- **Migration safety** — if any module ever splits out to a dedicated database (Pattern C in [[ParvusOrdo_Architecture]]), its forms move with it because they live in its schema.
- **Cross-module evolution** — the engine can ship new field types or workflow primitives without touching any consuming module's data.
- **Single mental model for users** — the unified Forms inbox in the app hides the multi-module architecture entirely. Parishioners never need to know which module owns which form.
