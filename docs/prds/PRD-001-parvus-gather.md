# PRD-001 — Parvus Gather (Parish Ministries, Boards & Events)

- **Status:** `prd-ready` — awaiting user approval (first gate, before any architect/RFC work)
- **Owner:** Product Manager (product-manager)
- **Bead:** po-h99
- **Source spec:** `docs/specs/parvus-gather.md` (the approved vision; this PRD is its product-level expression)
- **Module:** Parvus Gather — a parish module inside the unified ParvusOrdo app, alongside OCIA, Parvus Studio, and the CMS
- **Date:** 2026-06-02

> *This PRD is the product expression (the WHAT and the WHY) of the approved spec. It deliberately contains no technical design — no data models, permissions strings, schemas, or APIs. Per the human directive (po-wisp-48n9i): build the **full module, no shortcuts**, with iterative delivery in tiers **T1–T8** (T1 = foundation, P0). "Full scope" means every capability the spec marks **in** ships; the items the spec marks **out** (Section 4, Non-Goals) are deliberate product decisions, not cuts to revisit now.*

---

## 1. Problem / Opportunity

A parish runs on its people — its committees, boards, ministries, and the event teams that pull off the parish fair. Today that life runs on paper bulletins, clipboard sign-up sheets, group texts, a leader's personal spreadsheet, and institutional memory that walks out the door when a volunteer steps down. The result:

- **Parishioners can't find where they belong.** "How do I get involved?" has no good answer; the ministry list is a bulletin insert, if it exists at all.
- **Ministry and committee leaders drown in admin.** They re-key rosters, chase RSVPs by text, run sign-ups on paper, schedule by phone tree, and lose all continuity at every leadership change.
- **Boards lack structure and memory.** Agendas, minutes, quorum, and decisions live in someone's inbox; when the chair changes, the history is gone.
- **The parish fair is a coordination nightmare.** Booths, shifts, bake-sale items, donated supplies, and volunteers are scattered across email threads and a master spreadsheet only one person understands.
- **Volunteers — who skew older — are underserved by clunky tools.** Tiny buttons, multi-step flows, and "figure it out yourself" software lose exactly the people parishes depend on most.
- **Pastors and staff fly blind.** They have no view of which ministries are thriving and which are "zombie" committees still printed in the bulletin but long dormant.

**The opportunity:** Parvus Gather becomes the single, warm, touch-friendly home for parish involvement — where committees, boards, ministries, and event teams are all variants of one simple **group**, and where it is effortless to **discover, join, organize, meet, schedule, sign up, communicate, and serve.** It is the "community life" pillar of ParvusOrdo, completing the platform alongside **formation** (OCIA) and **youth media** (Parvus Studio). It is explicitly built for parishes whose volunteers skew older: big touch targets, one primary action per screen, email as the failsafe, and staff who can do anything on a parishioner's behalf when they call the office.

---

## 2. Users & Their Goals

| User | Who they are | Their goals (jobs to be done) |
|---|---|---|
| **Parishioner / prospective member** | Anyone in the parish, often older and phone-first | Discover what groups exist, find where they belong, join in a tap, see "what's next for me," show up, sign up, and serve — without fighting the software |
| **Group admin / leader** | The volunteer (Coordinator, Chair, Grand Knight…) who runs a committee, board, ministry, or event team | Run their group with minimal admin: roster, roles, meetings, sign-ups, broadcasts, documents — and hand it off cleanly when their term ends |
| **Board / committee chair & secretary** | Officers of governance groups (parish council, finance council, KofC) | Run structured meetings with agendas, quorum, attendance, minutes, and per-item discussion — with a durable archive that survives leadership turnover |
| **Volunteer** | A parishioner in "serving" mode | See and self-claim shifts and sign-up slots, swap when life happens, get reminders, check in day-of, and feel their service is seen |
| **Event coordinator** | The chair of a large event (the parish fair) | Orchestrate an event end-to-end — RSVPs, volunteer shifts, contribution sign-ups, booths, live alerts, sponsors — and run a smooth day-of |
| **Parish staff / clergy / admin** | The office, the pastor, the parish admin | Toggle and oversee the module, approve pending parishioners, see ministry health, archive zombie groups, and act on any parishioner's behalf |
| **Pending (invited non-parishioner)** | Someone a leader invited who isn't in the parish directory yet | Accept an invite and participate in the one group they were invited to, while staff vet them for full access |

---

## 3. User Stories / Key Flows

### 3.1 A parishioner finds their place and joins
> *As a parishioner, I want to browse the ministries and request to join one in a tap, so that I finally get involved.*
1. From the app's **Discovery tab**, they browse the parish-wide catalog of public and members-only groups — each a card with photo, blurb, meeting cadence, and leader contact.
2. They filter by type (committee / board / ministry / event-team), area of interest (liturgy, service, formation, fellowship), or time commitment.
3. They tap **Request to Join** with an optional message. (If the group requires a real application, they're handed a short application form instead.)
4. The group admin sees the request in a queue, approves, and the parishioner lands on the roster with a warm welcome. A decline sends a neutral, kind notice.
5. New parishioners are auto-suggested 3–5 groups during onboarding based on declared interests.

### 3.2 A leader sets up a group with its own roles
> *As a Grand Knight (or Chair, or Coordinator), I want my group to use our real titles and run itself, so that the tool fits how we actually work.*
1. The leader creates a group (committee / board / ministry / event-team), optionally nested under a parent group.
2. They **name their own roles** — Grand Knight, Deputy Grand Knight, Chancellor; or Chair, Treasurer, Secretary; or Coordinator, Volunteer — each carrying its own bundle of capabilities, not just a title.
3. They build the roster, set group visibility (public / members-only / leaders-only), and fill out the public discovery card.
4. When their term ends, they **transfer a role in one tap**; the outgoing holder can keep a read-only "Past [Role]" badge for the year, and every transition is logged.

### 3.3 A board runs a real meeting
> *As a committee chair, I want agendas, quorum, attendance, and minutes in one place, so that nothing is lost and meetings run well.*
1. The chair schedules a meeting (one-off or a **recurring series** — e.g., 2nd Tuesday monthly), with edit-one/edit-all handling and single-occurrence cancellation.
2. Members **RSVP** (attending / not / tentative); the chair watches a **live quorum tracker** against the group's defined quorum.
3. The agenda builder pulls standing items, custom items, and **open action items from the prior meeting**; members hash out details in **per-agenda-item discussion threads** before the meeting.
4. Attendance is captured (tap or self-check-in); minutes are typed live or after and **finalized to a locked PDF**; action items get assignees and due dates that surface on each person's dashboard.
5. Every member can **subscribe to the group's calendar** (iCal) so meetings sync to Apple/Google/Outlook automatically.

### 3.4 A ministry fills its weekly serving roster
> *As a liturgy coordinator, I want volunteers to claim and swap their own slots, so that I stop making phone calls.*
1. The coordinator defines a recurring need (e.g., "Saturday 5pm Mass — Lector, Greeter, Eucharistic Minister").
2. Volunteers see the **open-slot view** and self-claim from their phone; they get a 24-hour reminder.
3. If someone can't make it, they post a **swap request** and the system notifies eligible replacements.
4. The coordinator sees open / filled / no-show at a glance.

### 3.5 A leader runs a sign-up
> *As a leader, I want to post a sign-up and let people claim slots or items, so that organizing a potluck or retreat takes minutes.*
1. The leader creates a sign-up — **slot-based** (20 retreat spots), **item-based** (bake sale: cookies / bars / pies), or **open-ended** — and sets visibility (public no-login / parish-only / group-only).
2. They add **custom fields** (text, number, dropdown, multi-select, date, file, signature) with help text and required/optional flags.
3. Parishioners tap to claim (and tap to release); the leader watches a live response table and exports to CSV.
4. The leader **saves the sign-up as a reusable template** and re-instantiates it next cycle in one tap.

### 3.6 The parish fair, end to end
> *As the fair coordinator, I want RSVPs, shifts, contribution sign-ups, booths, and day-of alerts in one place, so that the biggest event of the year runs smoothly.*
1. The coordinator creates the event (name, dates, location, banner) and parishioners **RSVP / "I'm going."**
2. They define **volunteer shifts** (booth, setup, cleanup, teardown) that volunteers self-select, and **contribution sign-ups** (bake-sale items, potluck dishes, donated supplies, equipment loans).
3. A **simple booth/location list** organizes the grounds; a **sponsor list** displays names/logos/tier (no payments).
4. Day-of, attendees tap **"I'm here"** (geofenced/short window to prevent drive-by check-ins); the coordinator pushes **live alerts** ("Raffle drawing in 10 min", "Weather delay") to all attendees.

### 3.7 A leader invites someone who isn't in the parish yet
> *As a committee admin, I want to invite a new helper by email without waiting on the office, while staff still control the master directory.*
1. The admin invites by email; if a matching parishioner exists, they're simply added.
2. If not, a **pending parishioner** record is created (awaiting staff approval) and the invitee is emailed.
3. The invitee accepts, sets a password, and can participate **only in the inviting group** — its meetings, sign-ups, documents, announcements, and events — and nothing parish-wide.
4. **Staff review the approval queue** and promote them to full access (or decline). Unacted invites are reminded at 30 days and archived at 60. Every step is audited.

### 3.8 The pastor checks parish health
> *As the pastor, I want to see which groups are thriving and which are dormant, so that we stop carrying phantom committees.*
1. Staff open the **health dashboard** — a health card per group: last meeting, attendance trend, member count and 90-day change, last broadcast, last sign-up, overdue action items, open join-requests, pending applications.
2. Groups inactive for 180 days are **flagged dormant**; staff sort/filter by health and, in one tap, message the admin or **archive** the group (history preserved, removed from the active directory).

### 3.9 "What's next for me?" (the daily landing)
> *As a parishioner, I want one calm screen that tells me what I need to do, so that staying involved is effortless.*
1. After login, the default landing is **"What's next for me?"** — my shifts this week, my action items, my upcoming meetings (with RSVP), my RSVP'd events, group activity, and any forms awaiting me.
2. Everything I need is one tap away; email backs up anything I miss in the app.

---

## 4. Requirements & Scope

**Full module, no shortcuts.** Requirements are organized by the spec's eleven areas, plus the embedded Forms Engine, the group roles & permissions model, and the older-volunteer design rules. A **delivery sequence (T1–T8)** is flagged at the end — that governs *order*, not scope. **Non-Goals** (the spec's explicit MVP exclusions) are listed so reviewers see what is deliberately out.

### 4.1 Groups — the primitive *(T1, foundation, P0)*
Committees, boards, ministries, and event teams are all variants of one **group**.
- Create a group with a name, type (committee / board / ministry / event-team), and optional parent group.
- **Group-defined, renameable roles:** each group names its own roles (sensible defaults per type), and each role carries a bundle of capabilities, not just a title.
- Group visibility: public, members-only, leaders-only.
- **Role transition / handoff:** one-tap transfer with confirmation; optional read-only "Past [Role]" badge for a year; all transitions logged.
- Group home: roster, next meeting, open shifts, shared files, recent announcements.

### 4.2 Ministry Directory & Request-to-Join *(T2)*
- A parish-wide catalog of every public and members-only group, with a public profile card (name, blurb, cadence, leader contact, photo).
- Filter by type, area of interest (liturgy / service / formation / fellowship), and time commitment.
- **Request to Join** lands in the admin's queue (name, contact, optional message); approve → roster, decline → neutral notice.
- Groups that need a real application route the request through a Forms Engine application (admin chooses per group: simple request vs. full application).
- Auto-suggest 3–5 groups to new parishioners based on declared interests.

### 4.3 Meetings *(T3)*
- Schedule meetings (date, time, location, optional virtual link).
- **Recurring series** with cadence rules; edit-one vs. edit-all; cancel a single occurrence without breaking the series.
- **Per-group iCal feed** — a personal subscribable URL that syncs to Apple / Google / Outlook.
- Agenda builder: standing + custom items + auto-pulled open action items from the prior meeting.
- **Per-agenda-item discussion threads** (async, before/after); close when minutes are finalized.
- **Meeting RSVP** (attending / not / tentative) visible to the chair.
- **Quorum tracker** — group-defined count or percentage; live during scheduling and the meeting.
- Minutes typed live or after; finalize to a **locked PDF**.
- Action items with assignee, due date, and status, surfaced on the assignee's dashboard.
- Attendance check-in (tap or self-check-in).

### 4.4 Schedules & Shifts *(T4)*
- Define a recurring need (e.g., "Saturday 5pm Mass — Lector, Greeter, EMHC").
- Open-slot view; volunteers self-claim from mobile.
- **Swap requests** notify eligible replacements.
- 24-hour reminders (email + push).
- Coordinator view: open / filled / no-show.

### 4.5 Sign-Ups *(T4)*
For claiming a slot or contributing an item (anything requiring a structured application uses the Forms Engine instead).
- Visibility: public (no login), parish-only, or group-only.
- Three formats: **slot-based**, **item-based**, **open-ended**.
- **Custom field editor** (short/long text, number, dropdown, multi-select, date, file upload, signature); required/optional; per-field help text.
- Tap to claim / release.
- **Reusable templates** — save and re-instantiate in one tap (carrying fields, item lists, slot counts, eligibility).
- Live response table; CSV export.

### 4.6 Communication *(T5)*
- Email **and** push broadcast, targeted by group, role, or ad-hoc list.
- Replies route to a **group inbox**, never to the sender's personal email.
- **Email failsafe:** anything pushed also emails if the user hasn't opened the app within 12 hours.
- **Read receipts** — per-broadcast counts ("23 of 41 opened"); per-recipient detail to the sender only.
- Optional **"Important"** flag triggers a 24-hour follow-up nudge to anyone who hasn't acknowledged.

### 4.7 Document Vault (per group) *(T6)*
- Upload handbooks, policies, training materials.
- Per-document visibility (group-only / leaders-only / public).
- Search by title/tag.

### 4.8 Events — parish-fair scale *(T7)*
- Event setup (name, date(s), location, description, banner).
- **Attendance signal, not ticketing** — RSVP / "I'm going" (no QR, wallet, or scan-in).
- **Day-of self-check-in** ("I'm here"), geofenced or time-windowed to prevent drive-by check-ins.
- **Volunteer shifts** (booth, setup, cleanup, teardown) — self-select.
- **Event contribution sign-ups** (via 4.5): bake-sale items, potluck dishes, donated supplies, equipment loans.
- **Simple booth/location list** (no drag-drop map).
- **Live alerts** push to all attendees.
- **Sponsor list** (display only — names, logos, tier; no payment processing).

### 4.9 Inviting non-parishioners *(T8)*
- The full **pending-parishioner** flow (Section 3.7): match-or-create, limited single-group participation, staff approval queue, 30/60-day expiry, and complete audit of every invite/acceptance/approval/rejection/expiry.

### 4.10 Health Dashboard for Parish Leadership *(T8)*
- Per-group **health card** (last meeting, attendance trend sparkline, member count + 90-day change, last broadcast, last sign-up, overdue action items, open join-requests, pending applications).
- Sort/filter by type, health flag (dormant / at-risk / healthy), last activity.
- **Dormancy flag** at 180 days of no activity.
- One-tap actions: message the admin; **archive** the group (history preserved).

### 4.11 Mobile App Surface (inside the unified ParvusOrdo app) *(T8)*
- **My Dashboard / "What's next for me?"**: shifts, action items, upcoming meetings (RSVP), RSVP'd events, group activity, forms awaiting me.
- **Discovery tab:** browse the directory, request to join / start an application, see suggestions.
- Group pages (read for members, edit for leadership); sign-up browsing/claiming/filling; meeting agendas/minutes (read/edit by role) with RSVP and per-item threads.
- Subscribe to a group's calendar (iCal handoff); Events RSVP, my shifts, "I'm here" check-in.
- Push inbox with read-receipt acknowledgment; profile & family edit; Giving (links into the existing Vanco flow).
- Parvus Gather lives alongside the cross-module Forms inbox and the global notification inbox in the **single unified ParvusOrdo app**. *(The sole standalone app remains Parvus Studio; there is no separate Parvus Gather app.)*

### 4.12 Embedded Forms Engine *(T7 — shared infrastructure)*
A shared form capability Parvus Gather embeds for any application/inquiry/waiver beyond simple sign-up fields (committee membership applications, volunteer applications, photo-release waivers, ministry interest surveys).
- **Form builder** (drag-drop field editor) and **form types**: Application (single submission, routes to approvers, trackable status), Survey (no approval), Waiver/Release (e-signature → preserved PDF), Inquiry (open intake → reviewer).
- Rich field types, **conditional logic**, **multi-page** with progress bar, **resumable drafts** across devices.
- **Reviewer workflow** (approve / reject / request more info, with status notifications); **e-signature + PDF** for waivers; **CSV/PDF export**; **public embed widget** for the parish website (no login).
- **Starter templates:** volunteer application, ministry interest survey, committee membership application, photo-release waiver, parental consent (youth ministry), scholarship application, generic inquiry.
- **Unified Forms inbox** in the app: "Submitted by me" (live status) and "To review" (awaiting my action); future modules embedding the engine appear here automatically.
- *Product note:* each module owns its own submission data and its retention/routing — there is no central "all forms" database. (Implementation detail for the architect; called out only so reviewers understand applications submitted in Gather belong to Gather.)

### 4.13 Group Roles & Permissions (product model)
- Permissions are **scoped to the group instance** — a Grand Knight administers the KofC council only, not the finance committee.
- **Parish admins/staff implicitly hold every group-scoped capability** within their parish (and can act on any parishioner's behalf).
- Each group's "admin" role (whatever it's named) gets a sensible default bundle: edit settings & public profile, manage roster (add / invite-new / remove / assign & transfer roles / approve join-requests), run meetings (draft / finalize / recurrence / quorum / moderate threads), run sign-ups & templates, build & review forms, send broadcasts & view receipts, manage documents.
- **Sensitive capabilities are gated separately:** *defining what roles exist and what they can do* is not in the default admin bundle (typically staff, or explicitly granted to a founding admin). Parish-staff-only capabilities include approving pending parishioners, viewing the health dashboard, archiving groups, and publishing public-facing forms.

### 4.14 Design rules for older volunteers (cross-cutting requirement)
- **44pt minimum touch targets**; **one primary action per screen.**
- Default landing after login is **"What's next for me?"**
- **Email is the failsafe channel** — never assume the app was opened.
- **Staff can do everything on a parishioner's behalf** (sign them up, change their email, claim a shift) so phone-call requests don't force the caller to self-serve.

### 4.15 Non-Goals (deliberately out for this delivery)
Per the spec's explicit MVP exclusions — out now, "add on request" later: SMS; POS integration; ticketing / QR wallet; paid bidding / silent auction; formal proxy voting; drag-drop visual layout planner; cross-ministry scheduling-conflict prevention; custom-branded per-parish apps; sponsor payment processing; and **certifications & renewals** (VIRTUS / background checks / CPR tracking).

### 4.16 Delivery sequence (T1–T8) — order, not scope
Per po-wisp-48n9i, decompose per section and deliver iteratively; **mark T1 beads P0** so developers pull the foundation first. Every tier still ships in full, each bead under full review.
1. **T1 — Groups primitive + Roles/Permissions model** (foundation; everything depends on it) — **P0**
2. **T2 — Ministry Directory + Request-to-Join**
3. **T3 — Meetings**
4. **T4 — Sign-Ups + Schedules & Shifts**
5. **T5 — Communication**
6. **T6 — Document Vault**
7. **T7 — Events + Forms Engine**
8. **T8 — Non-parishioner invites + Health Dashboard + Mobile surface**

---

## 5. UX Intent — Polished, Delightful, and Built for Older Hands

Parvus Gather must feel **warm, calm, and effortless** — a welcoming parish hall, not a corporate dashboard. Its defining constraint is also its soul: it is built for volunteers who skew older, so clarity and dignity beat density and cleverness every time.

**The feel**
- Pastoral and encouraging; gratitude-forward; celebrates service.
- Spacious and uncluttered — **one primary action per screen**, large 44pt+ touch targets, plain language, high contrast.
- **Mobile-first and phone-friendly**, inside the one unified ParvusOrdo app.

**Moments of delight**
- **"What's next for me?"** greets every login — a calm, personal answer to "what do I need to do?" that makes staying involved feel light.
- **Discovery that invites belonging** — beautiful group cards, a one-tap Request to Join, and a warm confirmation; new parishioners are gently suggested a few groups that fit them.
- **Satisfying sign-ups & shifts** — tapping to claim a slot animates and updates a live count; releasing or swapping is just as easy; a friendly 24-hour reminder feels like a thoughtful nudge, never spam.
- **Meetings that run themselves** — quorum fills visibly as RSVPs arrive; agenda threads let a board arrive already aligned; finalizing minutes feels like closing a chapter cleanly.
- **The fair, alive** — RSVPs and shift fill-status update in real time; a simple booth list and day-of "I'm here" check-in; live alerts that reach everyone instantly.
- **Dignified handoffs** — transferring a role is one tap and a kind confirmation, with a "Past [Role]" badge that honors the outgoing leader.

**Craft & states**
- Every state designed: loading (skeletons), empty (inviting, never a dead end), error (plain, recoverable), success (a small, genuine thank-you).
- **Email failsafe everywhere** — anything important also arrives by email if the app goes unopened.
- **Staff-on-behalf mode** is graceful and obvious — the office can do anything for a parishioner who calls, without making them self-serve.
- Accessibility as a requirement (WCAG, full keyboard and assistive-tech support, strong contrast); fast on modest phones and connections.
- Consistent with the ParvusOrdo design language while carrying Gather's warmer, community-centered personality.

---

## 6. Success Criteria

**Adoption & belonging**
- Share of active parishioners who belong to ≥1 group; time-to-first-join for new parishioners.
- Request-to-join conversion (requests → approved members) and use of onboarding group suggestions.

**Engagement & service**
- Active groups vs. dormant; meetings scheduled and minuted; quorum met rate.
- **Shift and sign-up fill rates**; swap-request resolution; share of events with shifts filled ahead of time.
- Broadcast reach (read-receipt open rates); "Important" acknowledgment rates.

**Leader efficiency & continuity**
- Time to set up a group and run a first meeting; reduction in manual roster/sign-up/phone-tree work (survey + qualitative).
- Share of groups with finalized minutes; **clean role handoffs with zero history loss.**

**Parish-health outcomes**
- Reduction in "zombie" groups (dormant groups identified and archived or revived via the dashboard).
- Pending-parishioner approval throughput and time-to-decision; invite acceptance rate.

**Built-for-older-volunteers quality bar (first-class)**
- Task success and completion time for users 60+ on the core flows (find & join, claim a shift, RSVP, check in).
- Support-call volume for "how do I…?" trending down; staff-on-behalf actions available and used where needed.
- Meets the 44pt / one-primary-action / email-failsafe rules across every primary screen; all states polished.

---

## 7. Open Product Questions (decisions only the user can make)

*The spec already settles many earlier unknowns (no ticketing/payments; iCal for calendars; email+push, no SMS; certifications out). The remaining questions are about dependencies and sequencing.*

1. **Parish Members module (master directory) is "not yet specced."** Parvus Gather reads from it and writes `pending_parishioner` records into it. Can T1 proceed against an interim/placeholder directory, or must a minimal Members capability be specced/built first? This is the biggest sequencing dependency.
2. **Parish website / CMS module is "not yet specced,"** yet it hosts the public-facing surfaces (embedded public forms and directory cards). Do we ship Gather's public surfaces (no-login sign-ups/forms, public directory) now via a temporary host, or defer the public-web pieces until the CMS exists?
3. **Forms Engine ownership & timing.** The spec embeds the Forms Engine and the directive slots it in T7. Confirm the Forms Engine is **built as part of this effort** (not assumed pre-existing), and that T7 is the right time — several earlier tiers reference applications (e.g., Request-to-Join in T2 can route to an application). If T2 needs applications, does a minimal Forms capability need to land earlier?
4. **Mobile app shell.** The unified ParvusOrdo parishioner app — does its shell/navigation already exist (so Gather adds surfaces), or is standing up the app container part of this work? Affects T8 sizing and whether any surface is needed earlier for demos.
5. **Platform infrastructure readiness.** The spec lists push notifications and **iCal endpoint hosting** as Architecture dependencies. Confirm these exist (or are in-scope) so Meetings (T3, iCal) and Communication (T5, push) aren't blocked.
6. **Giving handoff.** Confirm the Giving surface is purely a **link into the existing Vanco flow** (no in-module payment behavior), consistent with the no-payments stance.
7. **"MVP" vs. "full module."** The spec titles itself an MVP with an explicit Out list, while the directive says "full module, no shortcuts." Confirm the reconciliation in this PRD: ship **all in-scope sections in full**, treat the Out list as deliberate non-goals (not near-term backlog). Flag any Out item you actually want pulled in now (e.g., VIRTUS/certifications, which some dioceses mandate).
8. **Pending-parishioner edge policies.** Confirm the 30-day reminder / 60-day archive windows and the "second group invite queues but doesn't activate until staff approval" rule are exactly as desired.

---

*End of PRD-001. This document is `prd-ready` for the user's review and approval. Per the product flow, no architect/RFC or build decomposition begins until the user marks it `prd-approved`. Once approved, the architect can decompose per section along the T1–T8 sequence with T1 (Groups + Roles/Permissions) as P0.*
