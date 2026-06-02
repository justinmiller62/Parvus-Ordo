# PRD-001 — Parvus Gather (Parish Ministries & Events)

- **Status:** DRAFT v0.1 — `prd-ready`, awaiting user approval (first gate, before any architect/RFC work)
- **Owner:** Product Manager (product-manager)
- **Bead:** po-h99
- **Module:** Parvus Gather — a toggleable parish module alongside OCIA, Parvus Studio, and the CMS
- **Date:** 2026-06-02

> **⚠️ Provenance note — please read before reviewing.**
> This draft was authored **without the source spec** `ParvusOrdo_Ministries_Events.md`. That file lives under `~/Documents`, which this agent's process is blocked from reading by a macOS permission (TCC) restriction — the Read tool, `cat`, and even `cp` all return "Operation not permitted." Rather than stay parked, I wrote a complete full-scope PRD from the scope the user has already given me (the build-priority directive, the bead description, and standing project memory) plus parish-domain knowledge.
>
> **What this means for your review:** Sections 1–3 and 5–7 are full product design and stand on their own. **Section 4 (Requirements & Scope) organizes the module into 11 functional pillars that are my reconstruction of the spec's scope, not a verbatim copy of it.** When you provide the spec (copy it to `~/Desktop/parva-ordo-city/parvus-gather-vision.md`, paste it into a mail, or `! cat` it in the prompt), I will reconcile any missing, renamed, or differently-grouped areas in minutes. Please review Section 4's coverage against the spec.

---

## 1. Problem / Opportunity

A parish runs on its people — its ministries, boards, committees, councils, and the events that bring everyone together. Yet the infrastructure underneath all of that is almost always paper bulletins, clipboard sign-up sheets, group texts, a leader's personal spreadsheet, and institutional memory that walks out the door when a volunteer steps down.

The pain is felt by everyone:

- **Parishioners — especially new ones — can't find their place.** "How do I get involved?" has no good answer. The list of ministries (if it exists) is a bulletin insert or a stale webpage. There is no way to see what exists, what it's about, when it meets, or how to join.
- **Ministry leaders drown in administrative overhead.** They re-key rosters, chase RSVPs by text, run sign-ups on paper, juggle meeting logistics, and lose continuity every time leadership changes hands.
- **Boards and committees lack continuity.** Agendas, minutes, and decisions live in someone's inbox. When the chair changes, the history is gone.
- **Events — above all the annual parish fair — are coordination nightmares.** Booths, shifts, volunteers, vendors, and schedules are spread across dozens of email threads and a master spreadsheet only one person understands.
- **Volunteers burn out.** The same handful of people get asked again and again because there's no fair, visible way to spread the load or to surface fresh hands.
- **Staff and clergy fly blind.** They have no view of ministry health, participation, who is serving, or whether the parish community is actually growing and connecting.

**The opportunity:** Parvus Gather becomes the single, warm, beautiful home for parish involvement — making it effortless to **discover, join, organize, meet, serve, and stay connected.** It is the "community" pillar of Parva Ordo, completing the platform's story: **formation** (OCIA), **media/creativity** (Parvus Studio), and now **community life** (Gather). For a parish, switching on Gather should feel like the moment the lights come up and the whole community can finally see and reach each other.

---

## 2. Users & Their Goals

| User | Who they are | Their goals (jobs to be done) |
|---|---|---|
| **Parishioner / prospective member** | Anyone in the parish, from a 20-year veteran to someone who registered last Sunday | Discover what ministries exist, find where they belong, join easily, show up informed, serve, and stay connected without effort |
| **Ministry leader / coordinator** | The volunteer or staff member who runs a ministry | Organize their group with minimal admin pain — roster, meetings, communications, volunteer scheduling, events — and keep momentum without burning out |
| **Board / committee member & chair** | Members of governance groups (parish council, finance council, fair committee) | Run their group with structure and continuity — agendas, minutes, attendance, decisions, documents that survive leadership changes |
| **Volunteer** | Usually the same person as a parishioner, in "serving" mode | See opportunities, sign up for shifts or items in seconds, get friendly reminders, swap when life happens, and feel their service is seen and appreciated |
| **Event organizer** | The chair of a major event (e.g., the parish fair) | Plan complex, multi-ministry events end to end — booths, shifts, schedules, registrations — and run a smooth day-of |
| **Parish staff / clergy / admin** | The office, the pastor, the parish admin | Toggle and configure the module, oversee all ministries, see participation and health, ensure safe-environment compliance, and communicate parish-wide |

---

## 3. User Stories / Key Flows

These are the journeys the module must make feel effortless and welcoming. Each is described in product terms; the technical "how" is the architect's job after approval.

### 3.1 A new parishioner finds their place
> *As a new parishioner, I want to discover the ministries that fit me and join one in a couple of taps, so that I actually get involved instead of giving up.*

1. From the parish home, they open **"Get Involved"** (the Ministry Directory).
2. They browse beautiful ministry cards — photo, a warm one-line description, when it meets, who it's for. They filter ("for families," "service," "music," "weeknights").
3. They open a ministry that resonates and read its rich profile — what we do, our next meeting, recent photos, the friendly faces who lead it.
4. They tap **"Request to Join."** A warm confirmation appears ("The St. Vincent de Paul team will welcome you soon"). The leader is notified.
5. The leader approves; the parishioner is welcomed into the group with a gentle onboarding (intro, next meeting, how to help).

### 3.2 A leader sets up a ministry and runs a meeting
> *As a ministry leader, I want to set up my group and run a meeting without paperwork, so that I can spend my energy on people, not admin.*

1. The leader creates their ministry (or claims an existing one staff pre-created), adds a photo, description, meeting rhythm, and visibility/join policy.
2. They invite or approve members; the roster builds itself.
3. They schedule a meeting (one-off or recurring), attach an agenda, and members RSVP.
4. At the meeting, attendance is captured in a tap; minutes are written inline and saved to the group's library.
5. Action items and notes carry forward to the next meeting automatically.

### 3.3 A leader opens volunteer opportunities and parishioners sign up
> *As a leader, I want to post what I need help with and have people sign up themselves, so that I stop chasing volunteers.*

1. The leader creates an opportunity with shifts/slots or a sign-up sheet ("bring a dish," "staff the table 9–11am").
2. They publish it to the group (or parish-wide).
3. Parishioners see open slots, claim one in a tap, and get a friendly confirmation and reminder.
4. As slots fill, a progress indicator updates live ("3 of 5 casseroles claimed — almost there!").
5. Day-of, volunteers check in; their service hours are logged and acknowledged.

### 3.4 A committee runs governance with continuity
> *As a committee chair, I want our agendas, minutes, and documents in one durable place, so that nothing is lost when leadership changes.*

1. The committee meets on a recurring cadence with structured agendas.
2. Minutes, decisions, and documents accrue to the group's archive.
3. When the chair changes, leadership transfers cleanly — the new chair inherits the full history.

### 3.5 The annual parish fair, end to end
> *As the fair organizer, I want to orchestrate booths, shifts, and volunteers in one place, so that the biggest event of the year runs smoothly.*

1. The organizer creates the fair as a large, multi-session event with **booths/spaces** and a master schedule.
2. Ministries claim booths; each booth defines its **volunteer shifts**.
3. Parishioners sign up for shifts across the whole fair; fill status is visible in real time.
4. A visual booth map and day-of mode guide the event; volunteers check in at their shifts.
5. Afterward, a wrap-up report captures participation, hours, and what to repeat next year.

### 3.6 Staff toggles the module and oversees the community
> *As parish staff, I want to switch Gather on, set our policies, and see how our community is doing, so that I can lead and support it.*

1. An admin enables Parvus Gather for the parish (it appears alongside OCIA, Studio, CMS).
2. They set parish-wide policies (visibility defaults, join policies, compliance gating, who can create ministries).
3. They monitor dashboards — active ministries, participation, volunteer load, event readiness.
4. They send a parish-wide announcement targeted to the right groups or roles.

### 3.7 The parishioner's "My Parish Life" hub
> *As a parishioner, I want one calm place that shows where I belong and what's next, so that staying involved is effortless.*

1. A personal hub shows my ministries, my upcoming meetings and events, my volunteer shifts, and announcements that matter to me.
2. From here I can RSVP, sign up, message my groups, and discover something new.

---

## 4. Requirements & Scope

**Full scope. No MVP, no v1/v2 cuts.** Below, scope is organized into **11 functional pillars.** A **build sequence** is flagged at the end so the downstream RFC and decomposition can deliver iteratively on a stable foundation — **the sequence is about delivery order, not about cutting anything.**

> *The 11 pillars below are my reconstruction of the module's scope (see provenance note). Please verify against `ParvusOrdo_Ministries_Events.md` — especially for any area I've missed, renamed, or grouped differently.*

### Pillar 1 — Groups & Membership Foundation *(foundation)*
The core primitive that everything else builds on. A "group" represents a ministry, board, committee, council, or sub-group.
- Multiple group **types** (ministry, board, committee, council, ad-hoc group), each with appropriate defaults.
- Rich group **profiles**: name, description, photo/banner, category/tags, meeting rhythm, contact, "who it's for."
- **Membership roster** with member status (active, pending, alumni/inactive) and join date.
- Sub-groups / teams within a group (e.g., the choir's sections; the fair committee's sub-teams).
- Group lifecycle: create, archive, reactivate — without losing history.

### Pillar 2 — Roles, Permissions & Visibility (RBAC) *(foundation)*
Who can see and do what, at the group and parish level. (Product-level description; the technical model is the architect's.)
- **Group roles:** member, coordinator/leader, chair, and a staff-liaison/oversight role.
- **Visibility levels:** publicly listed, listed-but-private, fully private, hidden.
- **Join policies:** open (join instantly), request-to-join (leader approval), invite-only.
- **Permissions** scoped to roles: who can edit the group, manage the roster, post announcements, schedule meetings, create events, manage volunteer opportunities.
- Respects the platform's existing parish-scoping and module-enablement; staff/admin retain oversight everywhere.

### Pillar 3 — Ministry Directory & Discovery
The front door to parish involvement.
- Browse, search, and filter ministries by category, schedule, audience, and interest.
- Featured/recommended ministries; personalized suggestions ("based on your family/age/interests").
- Rich, inviting ministry profile pages with photos, "ways to get involved," and next meeting/event.
- A clear, repeated call to action: **Get Involved.**

### Pillar 4 — Membership Lifecycle & Request-to-Join
The full journey of belonging to a group.
- Request to join → leader approves/declines (with a warm, optional message).
- Invite existing parishioners **and** invite new people who aren't yet members.
- Onboarding for new members (welcome, intro, next steps).
- Leave a group; roster management by leaders (add, remove, change role).
- **Leadership transfer / handoff** without data loss.
- Optional **safe-environment / compliance gating** (e.g., background-check status) before certain participation — *see open questions.*

### Pillar 5 — Meetings
- One-off and recurring meetings; in-person or virtual (with a link).
- **Agendas** (with carryover of prior action items).
- **Minutes** captured inline and archived to the group library.
- **Attendance** capture; **RSVPs**.
- Reminders before meetings.

### Pillar 6 — Events & the Annual Parish Fair
- Create and manage events with date(s)/time(s), location, description, and capacity.
- **Registration / RSVP** for parishioners; guest registration where appropriate.
- Multi-day, multi-session events.
- **The parish fair as a first-class experience:** booths/spaces, assigning booths to ministries, a master schedule, a visual booth map, and a day-of mode.
- Check-in for events and sessions.
- (Paid tickets / fees — *see open questions.*)

### Pillar 7 — Volunteer Operations
- Volunteer **opportunities** with **shifts/slots** and **sign-up sheets** ("bring a dish," "staff the table 9–11").
- Self-service sign-up, **swaps**, and waitlists.
- Live fill status and progress indicators.
- Reminders, day-of check-in, and **service-hours tracking**.
- Fair, visible distribution so the same few people aren't always carrying the load; gentle recognition of service.

### Pillar 8 — Communications
- Group **announcements** and a group discussion/comment space.
- **Parish-wide broadcasts** by staff, **targeted** to groups or roles.
- Email **and** in-app notifications; digests so people aren't overwhelmed.
- Friendly, pastoral tone throughout (not spammy).

### Pillar 9 — Files, Resources & Continuity
- Per-group **document library**: minutes archive, forms, links, photos.
- Resources survive leadership changes (continuity is a first-class goal).
- Simple, safe sharing scoped to group membership/roles.

### Pillar 10 — Calendar & Scheduling
- **Unified parish calendar** + per-group calendars + a personal "my schedule."
- Subscriptions/exports so events land in people's own calendars.
- Conflict awareness (don't double-book a volunteer or a room).
- Integration with the platform's existing calendar — *see open questions.*

### Pillar 11 — Insights, Reporting & Administration
- Participation, attendance, and **volunteer-hours** reporting.
- **Ministry health** and growth views for staff/admin.
- Module settings & parish-wide policies (visibility defaults, who can create ministries, compliance rules).
- Oversight/audit for staff and clergy; data export.

### Build sequence (delivery order — NOT scope cuts)
Per the user directive and standing project memory, sequence the decomposition so the foundation is stable before later pillars build on it:
1. **Foundation first:** Pillar 1 (Groups & Membership) + Pillar 2 (Roles, Permissions & Visibility / RBAC). Nail these so nothing downstream needs rework.
2. **Then:** Pillar 3 (Ministry Directory) + Pillar 4 (Membership Lifecycle / Request-to-Join).
3. **Then:** Pillar 5 (Meetings), with the supporting slices of Communications (8), Files (9), and Calendar (10) that meetings need.
4. **Then:** Pillar 6 (Events & the Parish Fair) + Pillar 7 (Volunteer Operations), with Pillar 11 (Insights & Administration) as the capstone.

Every pillar ships. The sequence simply protects the foundation from churn.

---

## 5. UX Intent — Polished & Delightful

Parvus Gather must feel **warm, welcoming, and human** — like a parish, not a corporate SaaS dashboard. It is the place where people find their belonging, so every detail should reduce friction and increase the feeling of *being welcomed and seen.*

**The feel**
- Pastoral, encouraging, gratitude-forward. The product celebrates service and community.
- Calm and uncluttered; plain language over jargon; generous whitespace; beautiful imagery of the real parish community.
- **Mobile-first** — parishioners live on their phones; large tap targets, fast, low-friction, and friendly to older or less-technical users.

**Moments of delight**
- **"Find your place" discovery:** gorgeous ministry cards with photos and a single warm line; one-tap *Request to Join* with a personal confirmation ("Fr. Tom and the team will welcome you soon").
- **Welcoming onboarding:** a gentle, human welcome when you join — who's who, when you meet, the first easy way to help.
- **Satisfying sign-ups:** claiming a slot animates and fills a progress bar ("3 of 5 casseroles claimed — almost there!"), with a small note of gratitude.
- **The parish fair, alive:** a visual booth map, real-time shift-fill status, and a focused **day-of mode**; a touch of celebration (e.g., confetti) when an event is fully staffed.
- **"My Parish Life" hub:** a calm, personal home showing where you belong and what's next.
- **Inviting empty states:** never a dead end — "No ministries yet — let's add your first," "Nothing on your schedule — here's something you might love."
- **Friendly reminders:** they feel like a thoughtful friend, never spam; easy to control.

**Craft & states**
- Every state designed: loading (skeletons), empty, error, and success.
- Micro-animations and **optimistic UI** so actions feel instant.
- **Accessibility** as a requirement (WCAG), full keyboard support, and strong color contrast.
- Fast performance on modest phones and connections; offline-tolerant where it makes sense.
- Consistent with the Parva Ordo design language while carrying Gather's warmer, community-centered personality.

---

## 6. Success Criteria

**Adoption**
- Share of parishes that enable Parvus Gather once available.
- Share of active parishioners who belong to ≥1 ministry/group.
- Time-to-first-join for a new parishioner (faster is better).

**Engagement & participation**
- Count of active ministries/groups; meetings scheduled and minuted.
- Volunteer **shift fill rate**; share of events fully staffed before the day.
- Event registrations and attendance.
- **Volunteer-load distribution** — fewer people carrying everything; more new volunteers activated.

**Leader efficiency & continuity**
- Time to set up a ministry; reduction in manual roster/sign-up/chasing work (qualitative + survey).
- Share of groups with documented minutes; **successful leadership transfers with zero data loss.**

**Parish fair**
- Shifts filled ahead of time, smooth day-of check-in, fewer coverage gaps than the prior (manual) year.

**Delight & quality**
- Leader and parishioner satisfaction (NPS/CSAT); qualitative "I finally found my place."
- Meets the accessibility and mobile-performance bar across all primary flows; all states polished.

---

## 7. Open Product Questions (decisions only the user can make)

1. **Spec coverage (top priority):** Do my 11 pillars match `ParvusOrdo_Ministries_Events.md`? Anything missing, renamed, or grouped differently? (I'll reconcile immediately once I can read the spec.)
2. **Payments / fees:** Are paid event tickets, fair booth fees, or group dues (e.g., Knights) in scope, or do we defer all money to the parish's existing giving/payments setup? *Draft assumes free events + "pay at the door" unless told otherwise.*
3. **Calendar relationship:** Is Gather's calendar the **same** calendar as the platform's existing Calendar module (a layer/view on it), or a separate Gather calendar that syncs?
4. **Safe-environment / compliance gating:** Should participation in certain ministries (esp. those with minors) be **gated** on background-check / safe-environment status (e.g., VIRTUS)? How deep — display only, soft warning, or hard block?
5. **Public visibility:** Should the Ministry Directory be visible to **non-logged-in visitors** (evangelization / "get involved" for newcomers and the parish website), or members-only?
6. **Communications depth:** Full threaded discussion/chat per group, or announcements + comments only? Any SMS/push, or email + in-app only?
7. **Teens & minors:** How does Gather handle minors in ministries — does it reuse Parvus Studio's teen-handling and parental-consent model, or its own? (Affects compliance, visibility, and messaging.)
8. **Photos & media:** Should ministry/event photos tie into **Parvus Studio**, the CMS media library, or be self-contained in Gather?
9. **Diocesan roll-up:** Any diocese-level view of ministries/events/participation across parishes, or strictly per-parish for now?
10. **Who can create ministries:** Staff/admin only, or can approved leaders self-create (with a staff approval step)?

---

*End of PRD-001 v0.1. This draft is `prd-ready` for the user's review and approval. Per the product flow, no architect/RFC work begins until the user marks it `prd-approved`. I will reconcile Section 4 against the source spec as soon as it is accessible.*
