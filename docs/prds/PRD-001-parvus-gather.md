# PRD-001 — Parvus Gather (Parish Ministries, Boards & Events)

- **Status:** `prd-ready` — awaiting user approval (first gate, before any architect/RFC work)
- **Owner:** Product Manager (product-manager)
- **Bead:** po-h99
- **Source spec:** `docs/specs/parvus-gather.md` (confirmed byte-identical to the Desktop copy `parvus-gather-vision.md`)
- **Scope addition:** `requests-requestables.md` (LOCKED) — **Requests** (Requestables): a lightweight, invitation-first to-do pillar inside Gather (group request-boards + a personal inbox) (§4.0)
- **Module:** Parvus Gather — a parish module inside the unified ParvusOrdo app, alongside OCIA, Parvus Studio, and the CMS
- **Date:** 2026-06-02

> *This PRD is the product expression (the WHAT and the WHY) of the approved spec. No technical design — no data models, permission strings, schemas, or APIs. Per the human directive (po-wisp-48n9i): build the **full module, no shortcuts**, iterative delivery in tiers **T1–T8** (T1 = foundation, P0). "Full scope" = every capability the spec marks **in** ships; the spec's **out** items (§4.15 Non-Goals) are deliberate decisions, not cuts. A net-new **Requests** capability (§4.0) — a lightweight, invitation-first to-do pillar inside Gather (group request-boards + a personal inbox), locked per `requests-requestables.md` — its two remaining open questions are in §7.*

---

## 1. Problem / Opportunity

A parish runs on its people — its committees, boards, ministries, and the event teams that pull off the parish fair. Today that life runs on paper bulletins, clipboard sign-up sheets, group texts, a leader's spreadsheet, and memory that walks out the door at every leadership change. The result:

- **Parishioners can't find where they belong.** "How do I get involved?" has no good answer.
- **Leaders drown in admin.** They re-key rosters, chase RSVPs by text, run sign-ups on paper, and lose continuity at every handoff.
- **Boards lack structure and memory.** Agendas, minutes, quorum, and decisions live in someone's inbox.
- **The parish fair is a coordination nightmare** — booths, shifts, bake-sale items, supplies, and volunteers scattered across email threads.
- **Volunteers — who skew older — are underserved by clunky tools.** Tiny buttons and multi-step flows lose exactly the people parishes depend on.
- **Pastors fly blind** — no view of which ministries thrive and which are "zombie" committees still in the bulletin.
- **There's no kind, shared way to ask for help.** Asking someone to do something — approve a join-request, bring the readings, follow up after a meeting — happens by text and memory; nothing gentle holds the ask, lets the person say yes or "not this time," and quietly shows the requester it's handled.

**The opportunity:** Parvus Gather becomes the single, warm, touch-friendly home for parish involvement — where committees, boards, ministries, and event teams are all variants of one **group**; where it is effortless to **discover, join, organize, meet, schedule, sign up, communicate, and serve**; and where every ask — to join, to help, to follow up — is a gentle, trackable **Request** so nothing falls through and help always feels like an invitation, never a demand. It is the "community life" pillar of ParvusOrdo, alongside **formation** (OCIA) and **youth media** (Parvus Studio), and it is built for older volunteers: big touch targets, one primary action per screen, email as the failsafe, and staff who can act on a parishioner's behalf.

---

## 2. Users & Their Goals

| User | Who they are | Their goals (jobs to be done) |
|---|---|---|
| **Parishioner / prospective member** | Anyone in the parish, often older and phone-first | Discover groups, find where they belong, join in a tap, see "what's next for me," show up, sign up, and serve — without fighting the software |
| **Group admin / leader** | The volunteer (Coordinator, Chair, Grand Knight…) running a committee, board, ministry, or event team | Run their group with minimal admin: roster, roles, meetings, sign-ups, broadcasts, documents — **ask members for help with a gentle Request and see what their group has picked up** — and hand it off cleanly |
| **Board / committee chair & secretary** | Officers of governance groups | Run structured meetings with agenda, quorum, attendance, minutes, per-item discussion — with a durable archive and follow-ups that don't get lost |
| **Volunteer** | A parishioner in "serving" mode | See and self-claim shifts and slots, swap when life happens, get reminders, check in day-of, feel their service is seen and appreciated |
| **Event coordinator** | The chair of a large event (the parish fair) | Orchestrate RSVPs, shifts, contribution sign-ups, booths, live alerts, sponsors — and run a smooth day-of |
| **Parish staff / clergy / admin** | The office, the pastor, the parish admin | Toggle and oversee the module, approve pending parishioners, see ministry health, **ask for help and gently keep track of what's been offered**, and act on any parishioner's behalf |
| **Pending (invited non-parishioner)** | Someone a leader invited who isn't in the directory yet | Accept an invite and participate in the one group they were invited to, while staff vet them |

---

## 3. User Stories / Key Flows

### 3.1 A parishioner finds their place and joins
> *As a parishioner, I want to browse the ministries and request to join one in a tap.*
1. From the **Discovery tab**, browse the parish-wide catalog (cards: photo, blurb, cadence, leader contact).
2. Filter by type, area of interest (liturgy / service / formation / fellowship), or time commitment.
3. Tap **Request to Join** with an optional message (or a short application if the group requires one).
4. The admin sees the request **in their Requests list**, approves → roster + warm welcome; decline → neutral notice.
5. New parishioners are auto-suggested 3–5 groups during onboarding from declared interests.

### 3.2 A leader sets up a group with its own roles
> *As a Grand Knight (or Chair, or Coordinator), I want my group to use our real titles and run itself.*
1. Create a group (committee / board / ministry / event-team), optionally nested under a parent.
2. **Name their own roles** — each role carries a bundle of capabilities, not just a title.
3. Build the roster, set visibility (public / members-only / leaders-only), fill out the discovery card.
4. At term's end, **transfer a role in one tap**; the outgoing holder keeps a read-only "Past [Role]" badge for the year; all transitions logged.

### 3.3 A board runs a real meeting
> *As a chair, I want agenda, quorum, attendance, and minutes in one place.*
1. Schedule a meeting (one-off or **recurring series** with edit-one/edit-all and single-occurrence cancel).
2. Members **RSVP**; the chair watches a **live quorum tracker**.
3. The agenda pulls standing items, custom items, and **open follow-ups from the prior meeting**; members discuss in **per-agenda-item threads**.
4. Attendance captured; minutes finalized to a **locked PDF**; **follow-ups become gentle Requests** — an invitation with an optional due date — on the group's board and in each person's "my requests."
5. Members **subscribe to the group's calendar** (iCal → Apple/Google/Outlook).

### 3.4 A ministry fills its weekly serving roster
> *As a liturgy coordinator, I want volunteers to claim and swap their own slots.*
1. Define a recurring need ("Saturday 5pm Mass — Lector, Greeter, EMHC").
2. Volunteers see the **open-slot view** and self-claim; 24-hour reminder.
3. **Swap requests** notify eligible replacements.
4. Coordinator sees open / filled / no-show at a glance.

### 3.5 A leader runs a sign-up
> *As a leader, I want to post a sign-up and let people claim slots or items.*
1. Create a sign-up — **slot-based**, **item-based**, or **open-ended** — with visibility (public no-login / parish-only / group-only).
2. Add **custom fields** with help text and required/optional flags.
3. Parishioners tap to claim / release; leader watches a live response table; CSV export.
4. **Save as a reusable template**, re-instantiate next cycle in one tap.

### 3.6 The parish fair, end to end
> *As the fair coordinator, I want RSVPs, shifts, contribution sign-ups, booths, and day-of alerts in one place.*
1. Create the event; parishioners **RSVP / "I'm going."**
2. Define **volunteer shifts** (self-select) and **contribution sign-ups** (bake-sale, potluck, supplies, equipment).
3. A **simple booth/location list**; a **sponsor list** (display only).
4. Day-of, attendees tap **"I'm here"** (geofenced/short window); coordinator pushes **live alerts** to all attendees.

### 3.7 A leader invites someone who isn't in the parish yet
> *As a committee admin, I want to invite a new helper by email without waiting on the office.*
1. Invite by email; a matching parishioner is simply added.
2. If no match, a **pending parishioner** record is created (awaiting staff approval) and the invitee emailed.
3. The invitee accepts and participates **only in the inviting group**, nothing parish-wide.
4. **Staff see the approval in their Requests list** and welcome or decline; unacted invites get a gentle reminder at 30 days, archived at 60; every step audited.

### 3.8 The pastor checks parish health
> *As the pastor, I want to see which groups are thriving and which are dormant.*
1. Staff open the **health dashboard** — a health card per group (last meeting, attendance trend, member count + 90-day change, last broadcast/sign-up, overdue follow-ups, open join-requests, pending applications).
2. Groups inactive 180 days are **flagged dormant**; staff sort/filter by health and, in one tap, message the admin or **archive** the group (history preserved).

### 3.9 "What's next for me?" (the daily landing)
> *As a parishioner, I want one calm screen telling me what I've been asked to help with.*
1. After login, the default landing is **"What's next for me?"** — the warm, personal view of my Requests: things people have asked of me, shifts this week, upcoming meetings (RSVP), RSVP'd events, group activity, forms awaiting me.

### 3.10 Requests — being asked, asking, and tending the list, gently
> *As anyone, I want one warm place showing what I've been asked to help with and an easy way to work through it; as a leader, I want to ask for help and see what's still open without it ever feeling like a work order.*
1. A chair turns a meeting follow-up into a Request — *"Could you bring the readings on Sunday?"* — and either asks Maria directly or posts it to the group's **board** for whoever can help.
2. Maria sees it in her personal **"my requests"** alongside everything else asked of her, sorted by what's soonest, each with a clear, kind next step.
3. She opens it: reads the details, asks a quick question in **comments**, ticks off a **subtask** or two, and either says **yes** or **"not this time,"** with no guilt. If she can't, she **hands it back** and the board offers it to someone else.
4. As she works it, its **status** moves open → in-progress → done; the requester sees it's handled and a small **thank-you** appears.
5. The coordinator scans the **board** — filtered to what's still open, sorted by due date — for a gentle overview of what's outstanding by person, so they know where a kind nudge or a re-ask would help. Nothing quietly slips; no one is made to feel they "owe."

---

## 4. Requirements & Scope

**Full module, no shortcuts.** Requirements mirror the spec's eleven sections (4.1–4.11, numbered to match spec §1–§11 for traceability), plus the embedded Forms Engine (4.12), the roles/permissions model (4.13), older-volunteer design rules (4.14), Non-Goals (4.15), and the delivery sequence (4.16). The net-new **Requests** capability leads as **4.0** because most Gather flows create Requests. Tier labels (T1–T8) reflect the human's delivery directive.

### 4.0 Requests (Requestables) — a lightweight, invitation-first to-do pillar *(group request-boards + personal inbox; net-new beyond the base spec)*

**Plain definition:** a **Request** is a to-do that someone asks of a person or a group. A leader, another member, or a system flow asks someone to do a thing; it appears in their requests; they do it or decline; the requester can see whether it's done. Mechanically it behaves like a gentle ticket (open → assigned → worked → done, tracked) and it works **group-wide** — each group has a shared board of Requests that members are asked to take or can claim.

**Tone is the whole point — non-negotiable.** These are **volunteers, not employees.** Every word a volunteer sees is an **invitation, never an order**: "request," "asked," "can you help" — *never* "task assigned," "your queue," "overdue ticket," or "action required." Completion is met with **gratitude**; reminders are **gentle nudges, never nagging**. The soft framing lives in the model itself so no one ever builds a corporate productivity UI on top of it. (This pairs with the older-volunteer design rules in 4.14.)

**A Request carries exactly these — and stays this lightweight:**
- **Requester and assignee** — who's asking, and who's asked: a single **person**, OR a **group/role** (whoever-can-help claims it).
- **Status** — open → assigned → in-progress → done (plus declined / cancelled).
- **Priority** — a gentle sense of how soon it matters.
- **Due date** — optional, when it's hoped for.
- **Comments / discussion** — a small thread to ask a question or coordinate.
- **Recurring** — for asks that come around again on a schedule.
- **Subtasks** — a small checklist within a Request.
- **Source link** — a tap back to whatever it came from (the join-request, meeting, sign-up, or application that spawned it).

> **Keep it lightweight — those capabilities and nothing more.** No SLAs, no custom fields, no automation rules, no approval-chain workflows, no enterprise ticketing cruft. Simple, warm, fast.

**The working experience — a real, gentle to-do / ticketing flow (just soft-toned and lightweight):**

- **The group board — a usable working list.** Each group (ministry / board / committee) has a shared board of its Requests, organized by status (**open → assigned → in-progress → done**, plus declined / cancelled). **Filter and sort by status, priority, due date, or person**; tend the list — pick something up, ask a member, re-prioritize, or hand it on. A shared list the group works together, warm and never a leaderboard.
- **Working a Request.** Open one to see its **details** and a tap back to its **source**; talk it through in **comments**, tick off its **subtasks**, move its **status** along, **hand it to someone else** (reassign) if you can't, and **mark it done** — with a small thank-you. Recurring Requests quietly come back around on schedule.
- **A leader's overview — so nothing slips.** Leaders and staff get a gentle overview of everything still open across the group, **grouped by person and by status, with anything past its hoped-for date surfaced kindly** — so a coordinator can see at a glance where a gentle nudge or a re-ask would help. A clear picture of what's outstanding, framed as care — never a scoreboard or a ledger of who "owes."
- **Personal "my requests" — a real, friendly to-do list.** Every person has one place with every Request involving them across their groups: what they've said yes to, what's been asked, what's coming back around — **sortable by due or priority**, each with a clear, kind next step, and worked the same way (open, comment, subtasks, status, done). **"What's next for me?" (3.9) is its friendliest face.**

**Every Gather flow becomes a Request** (instead of each reinventing pending/assign/track logic): Request-to-Join approvals (4.2), meeting follow-ups (4.3), sign-up & shift needs (4.4 / 4.5), pending-parishioner approvals (4.9), Forms-Engine submissions to review (4.12), and staff-initiated asks. The health dashboard (4.10) reflects the same open items.

*Acting on a Request updates whatever it came from via the owning flow (welcome a join-request → roster; finish a follow-up → meeting record). It stays a lightweight pillar inside Gather — group request-boards + a personal inbox — not a separate platform. Remaining choices are in §7.*

### 4.1 Groups — the primitive *(T1, foundation, P0)*
- Create a group: name, type (committee / board / ministry / event-team), optional parent.
- **Group-defined, renameable roles**, each carrying a capability bundle (defaults per type).
- Visibility: public / members-only / leaders-only.
- **Role transition / handoff:** one-tap transfer with confirmation; optional "Past [Role]" badge for a year; transitions logged.
- Group home: roster, next meeting, open shifts, shared files, recent announcements.

### 4.2 Ministry Directory & Request-to-Join *(T2)*
- Parish-wide catalog of public and members-only groups; public profile card (name, blurb, cadence, leader contact, photo).
- Filter by type, area of interest, time commitment.
- **Request to Join** → appears in the admin's Requests (name, contact, optional message); approve → roster; decline → neutral notice.
- Groups needing an application route through a Forms-Engine application (admin chooses simple request vs. full application per group).
- Auto-suggest 3–5 groups to new parishioners by interest.

### 4.3 Meetings *(T3)*
- Schedule meetings (date, time, location, optional virtual link).
- **Recurring series** with cadence; edit-one vs. edit-all; cancel a single occurrence.
- **Per-group iCal feed** (personal subscribable URL → Apple/Google/Outlook).
- Agenda builder: standing + custom items + auto-pulled prior follow-ups.
- **Per-agenda-item discussion threads**; close on minutes finalization.
- **Meeting RSVP** (attending / not / tentative) visible to chair.
- **Quorum tracker** (group-defined count or %), live.
- Minutes typed live or after; finalize to a **locked PDF**.
- **Follow-ups** become gentle Requests (4.0) — an invitation with an optional due date — on the group board and in each person's "my requests."
- Attendance check-in (tap or self).

### 4.4 Schedules & Shifts *(T4)*
- Define a recurring need (e.g., "Saturday 5pm Mass — Lector, Greeter, EMHC").
- Open-slot view; self-claim from mobile.
- **Swap requests** notify eligible replacements.
- 24-hour reminders (email + push).
- Coordinator view: open / filled / no-show.

### 4.5 Sign-Ups *(T4)*
- Visibility: public (no login), parish-only, group-only.
- Three formats: **slot-based**, **item-based**, **open-ended**.
- **Custom field editor** (short/long text, number, dropdown, multi-select, date, file, signature); required/optional; help text.
- Tap to claim / release.
- **Reusable templates** (one-tap re-instantiate, carrying fields/items/slots/eligibility).
- Live response table; CSV export.

### 4.6 Communication *(T5)*
- Email **and** push broadcast, targeted by group, role, or ad-hoc list.
- Replies route to a **group inbox**, never the sender's personal email.
- **Email failsafe:** pushed items also email if the app isn't opened within 12 hours.
- **Read receipts** (per-broadcast counts; per-recipient detail to sender only).
- Optional **"Important"** flag → 24-hour gentle follow-up to non-acknowledgers.

### 4.7 Document Vault (per group) *(T6)*
- Upload handbooks, policies, training materials.
- Per-document visibility (group-only / leaders-only / public).
- Search by title/tag.

### 4.8 Events — parish-fair scale *(T7)*
- Event setup (name, date(s), location, description, banner).
- **Attendance signal, not ticketing** — RSVP / "I'm going" (no QR/wallet/scan).
- **Day-of self-check-in** ("I'm here"), geofenced or time-windowed.
- **Volunteer shifts** (booth, setup, cleanup, teardown) — self-select.
- **Event contribution sign-ups** (via 4.5): bake-sale items, potluck dishes, supplies, equipment.
- **Simple booth/location list** (no drag-drop map).
- **Live alerts** to all attendees.
- **Sponsor list** (display only — names, logos, tier; no payments).

### 4.9 Inviting non-parishioners *(T8)*
- The full **pending-parishioner** flow (3.7): match-or-create, limited single-group participation, **staff approval appears as a Request**, 30/60-day expiry, complete audit.

### 4.10 Health Dashboard for Parish Leadership *(T8)*
- Per-group **health card** (last meeting, attendance trend sparkline, member count + 90-day change, last broadcast, last sign-up, overdue follow-ups, open join-requests, pending applications).
- Sort/filter by type, health flag (dormant / at-risk / healthy), last activity.
- **Dormancy flag** at 180 days.
- One-tap actions: message the admin; **archive** the group (history preserved).

### 4.11 Mobile App Surface (inside the unified ParvusOrdo app) *(T8)*
- **My Dashboard / "What's next for me?"** and the **Requests** view (4.0) as primary surfaces.
- **Discovery tab**; group pages (read/edit by role); sign-up browse/claim/fill; meeting agendas/minutes with RSVP and per-item threads.
- Subscribe to group calendar (iCal handoff); Events RSVP, my shifts, "I'm here" check-in.
- Push inbox with read-receipt acknowledgment; profile & family edit; Giving (links into existing Vanco flow).
- Lives alongside the cross-module Forms inbox and the global notification inbox in the **single unified ParvusOrdo app**. *(The sole standalone app remains Parvus Studio.)*

### 4.12 Embedded Forms Engine *(T7 — shared infrastructure)*
- **Form builder** + **types** (Application, Survey, Waiver/Release with e-sign→PDF, Inquiry).
- Rich field types, **conditional logic**, **multi-page**, **resumable drafts**.
- **Reviewer workflow** (approve / reject / request more info) → submissions appear as Requests for the reviewer; **e-signature + PDF**; **CSV/PDF export**; **public embed widget** for the parish website.
- **Starter templates:** volunteer application, ministry interest survey, committee membership application, photo-release waiver, parental consent (youth), scholarship application, generic inquiry.
- **Unified Forms inbox** ("Submitted by me" / "To review"); future modules adopting the engine appear automatically.
- *Product note:* each module owns its own submission data and retention/routing (architect detail; flagged only so applications submitted in Gather belong to Gather).

### 4.13 Group Roles & Permissions (product model)
- Permissions **scoped to the group instance** (a Grand Knight administers the KofC council only).
- **Parish admins/staff implicitly hold every group-scoped capability** and can act on any parishioner's behalf.
- Each group's "admin" role gets a sensible default bundle: edit settings/profile, manage roster (add / invite-new / remove / assign & transfer roles / approve join-requests), run meetings (draft / finalize / recurrence / quorum / moderate threads), **send Requests (invite members to help) and manage the group's board**, run sign-ups & templates, build & review forms, send broadcasts & view receipts, manage documents.
- **Sensitive capabilities gated separately:** defining what roles exist/can do is **not** default (staff or founding-admin grant). Parish-staff-only: approve pending parishioners, view health dashboard, archive groups, publish public-facing forms.

### 4.14 Design rules for older volunteers (cross-cutting requirement)
- **44pt minimum touch targets**; **one primary action per screen.**
- Default landing **"What's next for me?"**
- **Email is the failsafe channel.**
- **Staff can do everything on a parishioner's behalf.**
- **Invitation-first language everywhere** (Requests and beyond) — warm, never corporate.

### 4.15 Non-Goals (deliberately out for this delivery)
Per the spec's explicit MVP exclusions — out now, "add on request" later: SMS; POS integration; ticketing / QR wallet; paid bidding / silent auction; formal proxy voting; drag-drop visual layout planner; cross-ministry scheduling-conflict prevention; custom-branded per-parish apps; sponsor payment processing; **certifications & renewals** (VIRTUS / background checks / CPR tracking). *(For Requests specifically: no SLAs, automation rules, approval chains, or enterprise ticketing features — see 4.0.)*

### 4.16 Delivery sequence (T1–T8) — order, not scope
Per po-wisp-48n9i, decompose per section, deliver iteratively, **mark T1 beads P0**. Every tier ships in full, each bead under full review.
1. **T1 — Groups primitive + Roles/Permissions model** (foundation) — **P0**
2. **T2 — Ministry Directory + Request-to-Join**
3. **T3 — Meetings**
4. **T4 — Sign-Ups + Schedules & Shifts**
5. **T5 — Communication**
6. **T6 — Document Vault**
7. **T7 — Events + Forms Engine**
8. **T8 — Non-parishioner invites + Health Dashboard + Mobile surface**

- **Requests (4.0):** net-new, not in the original tier directive. **Recommended foundational** — built with or immediately after T1 — so every later flow creates Requests in one shared, group-centric system instead of bespoke per-flow queues, and so "What's next for me?" is real from the start. Locked as a first-class Gather pillar; the only remaining choices are the board-scope and surface questions in §7.

---

## 5. UX Intent — Polished, Delightful, and Built for Older Hands

Parvus Gather must feel **warm, calm, and effortless** — a welcoming parish hall, not a corporate dashboard. Its defining constraint is also its soul: it is built for volunteers who skew older, so clarity and dignity beat density and cleverness — and **every ask is an invitation, never an order.**

**The feel** — pastoral, encouraging, gratitude-forward; spacious and uncluttered (**one primary action per screen**, 44pt+ targets, plain language, high contrast); **mobile-first** inside the one unified app.

**Moments of delight**
- **"What's next for me?"** and **Requests** greet every login — a calm, personal answer to "what have I been asked to help with?", so nothing is missed and helping feels light.
- **Discovery that invites belonging** — beautiful cards, one-tap Request to Join, a warm confirmation; gentle group suggestions for newcomers.
- **Satisfying sign-ups & shifts** — claiming a slot animates and updates a live count; swaps and releases are easy; a friendly 24-hour reminder feels like a thoughtful nudge.
- **Asking for help feels kind** — inviting a member is a warm, two-tap *"Could you…?"* they can accept or decline; the group's board gently shows what's still hoped for, never a scoreboard; saying **yes** is satisfying, saying **"not this time"** is graceful and guilt-free, and finishing a Request earns a small, genuine **thank-you**.
- **Meetings that run themselves** — quorum fills visibly as RSVPs arrive; agenda threads let a board arrive aligned; finalizing minutes closes a chapter cleanly and turns follow-ups into gentle Requests.
- **The fair, alive** — RSVPs and shift fill-status update in real time; simple booth list; day-of "I'm here"; live alerts reach everyone instantly.
- **Dignified handoffs** — transferring a role is one tap and a kind confirmation, with a "Past [Role]" badge honoring the outgoing leader.

**Craft & states** — every state designed (skeleton loaders, inviting empty states, plain recoverable errors, a small genuine thank-you on success); **respect reduced-motion**; **email failsafe everywhere**; **staff-on-behalf mode** graceful and obvious; accessibility as a requirement (WCAG, full keyboard and assistive-tech support, strong contrast); fast on modest phones; consistent with the ParvusOrdo design language with Gather's warmer personality.

---

## 6. Success Criteria

**Adoption & belonging** — share of active parishioners in ≥1 group; time-to-first-join; request-to-join conversion; use of onboarding suggestions.

**Engagement & service** — active vs. dormant groups; meetings scheduled & minuted; quorum-met rate; **shift and sign-up fill rates**; swap resolution; events with shifts filled ahead; broadcast open rates; "Important" acknowledgment rates.

**Requests, the parish way** — share of asks that find a willing volunteer; Requests accepted and gently completed; that reminders feel like nudges, not nagging (low mute/opt-out, few complaints); that volunteers feel **asked, not overloaded** (survey sentiment). *Explicitly not a productivity scoreboard — we are measuring whether help flows kindly, not who did the most.*

**Leader efficiency & continuity** — time to set up a group and run a first meeting; reduction in manual roster/sign-up/phone-tree work; share of groups with finalized minutes; **clean role handoffs with zero history loss.**

**Parish-health outcomes** — reduction in "zombie" groups (identified + archived or revived); pending-parishioner approval throughput and time-to-decision; invite acceptance rate.

**Built-for-older-volunteers bar (first-class)** — success and completion time for users 60+ on core flows (find & join, claim a shift, RSVP, check in, accept a Request); declining "how do I…?" support calls; staff-on-behalf available and used; meets 44pt / one-primary-action / email-failsafe / reduced-motion / invitation-first across every primary screen.

---

## 7. Open Product Questions (decisions only the user can make)

*The spec settles many earlier unknowns (no ticketing/payments; iCal calendars; email+push, no SMS; certifications out). The Requests brief is now LOCKED — it settles that Requests is a first-class Gather pillar, assignable to a person or a group/role, with the fixed field set and lifecycle, the names "Requests"/"Requestable," and the invitation-first tone. Two Requests questions remain, plus the cross-module dependencies.*

**Requests**
- **§7-R1 — Board scope:** per-group boards + a personal "my requests" inbox are assumed. Do you **also** want a **parish-wide staff view** of all open Requests (for the office/pastor), or keep it group-scoped + personal only?
- **§7-R2 — Surface:** the web app is the primary surface. Is the **iOS companion** in scope for Requests too, or web-first for now?

**Cross-module dependencies & scope**
1. **Parish Members master directory is "not yet specced"** but Gather reads from it and writes `pending_parishioner` records — can T1 start against an interim directory, or spec a minimal Members capability first? *(biggest dependency)*
2. **Parish website / CMS "not yet specced"** but hosts public forms + directory cards — ship public surfaces now via a temp host, or defer?
3. **Forms Engine timing** — T2 Request-to-Join can route to an application; is T7 right, or land a minimal forms slice earlier?
4. **Unified mobile app shell** — does it exist, or is standing it up part of this work? (affects T8 and Requests surfacing)
5. **Push + iCal hosting infra** — confirm available so Meetings (T3) and Communication (T5) aren't blocked.
6. **Giving** — confirm it's purely a link into the existing Vanco flow (no in-module payment).
7. **"MVP" vs "full module"** — confirm: ship all in-scope sections in full, treat the Out list as deliberate non-goals; flag any Out item to pull in now (e.g., VIRTUS/certifications).
8. **Pending-parishioner edge policies** — confirm the 30/60-day windows and the "second-group invite queues until staff approval" rule.

---

*End of PRD-001. This document is `prd-ready` for the user's review and approval. No architect/RFC or decomposition begins until the user marks it `prd-approved`. Once approved, decompose per section along T1–T8 (T1 Groups + Roles/Permissions = P0), with Requests (4.0) recommended foundational and its two open questions settled per §7.*
