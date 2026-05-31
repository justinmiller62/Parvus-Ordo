# Announcements

## Overview

The Announcements section is a parish-scoped bulletin board. Teachers and admins post short title/body notices to everyone in their parish, and any parish member can reply with threaded comments. It is the lightweight, one-to-many broadcast counterpart to the Discussion section (which is many-to-many threads any member can start).

In Narthex it lives at the route `/announcements` and is implemented almost entirely in a single file: `apps/web/src/routes/AnnouncementsPage.tsx`. There is no separate hook, service layer, or `lib` helper — the component talks to Supabase directly. The data model is two tables: `announcements` and `announcement_comments`, both scoped to a single parish.

Scope is strictly **per-parish**. There is no diocese-wide or global announcement concept in Narthex. The page only ever operates on the user's *first* membership's parish (`memberships[0].parishId`).

## Roles & access

The route itself is **ungated** — it is registered as a "Shared route" in `apps/web/src/App.tsx:185` with no `RoleGuard`, unlike admin/teacher-only routes such as the engagement dashboard (`App.tsx:170-174`, `RoleGuard allowedRoles={['admin','teacher']}`). It also appears in both the student and the teacher/admin sidebar nav lists (`apps/web/src/components/layout/Sidebar.tsx:24` and `:34`).

Access is therefore enforced at two layers, not by route guard:

- **Reading** — any authenticated parish member can view announcements and comments for their parish. Enforced by RLS (`announcements_select`, `announcement_comments_select`) and by the UI which simply renders whatever Supabase returns.
- **Posting an announcement** — only `admin` or `teacher`. The "New Announcement" button is shown only when `canPost` is true, where `canPost = isTeacherOrAdmin()` (`AnnouncementsPage.tsx:28`). `isTeacherOrAdmin()` returns true if the user has `admin` or `teacher` in any membership (`useAuth.ts:156-158`). RLS also enforces this on insert (`announcements_insert` requires `user_has_role(..., ARRAY['admin','teacher'])`).
- **Commenting** — any authenticated parish member. No UI gate; RLS `announcement_comments_insert` requires only that the author is the current user and the announcement belongs to one of the user's parishes.
- **Deleting** — `canDelete(authorId) = isAdmin || authorId === user.id` (`AnnouncementsPage.tsx:154`), where `isAdmin = hasRole('admin')` (`:26`). So an admin can delete any announcement/comment in their parish; an author can delete their own. The trash icon is only rendered when `canDelete` is true (`:229`, `:266`). RLS mirrors this exactly (`announcements_delete`, `announcement_comments_delete`).

Roles come from the `memberships` table via `useAuth`. Note: `useAuth` injects a synthetic `admin` membership when a super-admin uses the parish-override feature (`useAuth.ts:139-148`), so a super-admin "impersonating" a parish is treated as an admin here.

Role enum (`membership_role`): the code references `admin`, `teacher`, and (implicitly) `student`. RLS gating for this section only ever checks `admin` and `teacher`.

## User flows

1. **View announcements (member, the default path)**
   1. User navigates to `/announcements`.
   2. `useEffect` fires `fetchAnnouncements()` once on mount (`AnnouncementsPage.tsx:44-46`).
   3. While loading, the page renders `Loading announcements...` (`:156`).
   4. `parishId = memberships[0]?.parishId`. If the user has **no membership**, `parishId` is undefined, `fetchAnnouncements` short-circuits (`:49`) leaving the list empty and `loading=false`.
   5. Announcements render newest-first, each showing title, author display name, and locale date.
   6. **Empty state:** if there are zero announcements, a dashed-border card with a Megaphone icon and "No announcements yet." is shown (`:209-213`).

2. **Post an announcement (teacher/admin)**
   1. `canPost` is true, so a "New Announcement" button appears top-right (`:162-170`).
   2. Clicking toggles an inline form with a title `<input>` and a body `<textarea>` (`:174-206`).
   3. The "Post" button is disabled until both `newTitle.trim()` and `newBody.trim()` are non-empty, and while `posting` is true (`:193`).
   4. On submit, `postAnnouncement` inserts a row into `announcements` with `parish_id`, `author_id = user.id`, trimmed title and body (`:112-117`).
   5. Form fields clear, the form closes, and `fetchAnnouncements()` re-runs to show the new post (`:119-123`).
   6. **Guard:** `postAnnouncement` returns early if no `user`, no `parishId`, or empty title/body (`:109`).
   7. **Cancel** simply hides the form (`:198-203`); field values are retained in state (not cleared on cancel).

3. **View / add comments (any member)**
   1. Each announcement card has a comment toggle showing `N comment(s)` with correct singular/plural (`:250`).
   2. Clicking expands that announcement's comment thread; `expandedId` tracks the single open card — opening one collapses any other (`:245`, accordion behavior).
   3. Existing comments render in a parchment-tinted list with author name + date (`:256-278`).
   4. A text input plus a Send button let the user add a comment. The Send button is disabled while submitting that announcement or when the draft is empty (`:292`).
   5. Pressing **Enter** in the comment input also submits (`onKeyDown ... e.key === 'Enter'`, `:286`).
   6. `postComment` inserts into `announcement_comments` with `announcement_id`, `author_id`, trimmed `body` (`:133-137`), clears that announcement's draft, and re-fetches (`:139-141`).
   7. **Guard:** returns early if no `user` or empty trimmed body (`:127-129`).

4. **Delete an announcement (admin or author)**
   1. Trash icon appears in the card header only when `canDelete(ann.authorId)` (`:229`).
   2. Clicking calls `deleteAnnouncement(annId)` → `delete().eq('id', annId)` then re-fetch (`:144-147`). **No confirmation dialog.**
   3. DB cascade removes the announcement's comments (`announcement_comments.announcement_id ... ON DELETE CASCADE`).

5. **Delete a comment (admin or author)**
   1. Trash icon appears next to a comment only when `canDelete(comment.authorId)` (`:266`).
   2. Clicking calls `deleteComment(commentId)` → `delete().eq('id', commentId)` then re-fetch (`:149-152`). **No confirmation dialog.**

6. **Error states**
   - Supabase errors are **silently swallowed**: `fetchAnnouncements`, `postAnnouncement`, `postComment`, `deleteAnnouncement`, `deleteComment` all ignore the returned `error`. A failed insert/delete looks like a successful no-op after re-fetch; a failed read leaves the list empty. There is no toast, retry, or error banner anywhere in this section.

## Data model

Two tables, both defined in `supabase/migrations/20260422000000_initial.sql`. Author display names are joined client-side from `profiles`.

### `announcements` (initial.sql:226-235)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `parish_id` | uuid NOT NULL | FK → `parishes(id)` `ON DELETE CASCADE`. **Tenancy/ownership key.** |
| `author_id` | uuid NOT NULL | FK → `profiles(id)`. Ownership key for author-delete. |
| `title` | text NOT NULL | |
| `body` | text NOT NULL | rendered with `whitespace-pre-wrap` |
| `created_at` | timestamptz NOT NULL | `DEFAULT now()`; sort key (desc) |

Index: `idx_announcements_parish ON announcements(parish_id)` (`:235`).

### `announcement_comments` (initial.sql:238-246)
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `DEFAULT gen_random_uuid()` |
| `announcement_id` | uuid NOT NULL | FK → `announcements(id)` `ON DELETE CASCADE` |
| `author_id` | uuid NOT NULL | FK → `profiles(id)`. Ownership key. |
| `body` | text NOT NULL | |
| `created_at` | timestamptz NOT NULL | `DEFAULT now()`; sort key (asc) |

Index: `idx_announcement_comments_announcement ON announcement_comments(announcement_id)` (`:246`).

### `profiles` (read-only here)
The page reads `id, display_name` from `profiles` to resolve author names (`AnnouncementsPage.tsx:75-78`). A broad read policy was added (`20260428000003_profiles_read_all.sql`) specifically so author names display in announcements/discussions.

### Relationships
- `parishes 1—N announcements` (cascade delete on parish removal).
- `announcements 1—N announcement_comments` (cascade delete on announcement removal).
- `profiles 1—N announcements` and `profiles 1—N announcement_comments` (via `author_id`; **no cascade** — these reference `profiles(id)` without `ON DELETE`, so deleting a profile with announcements would be blocked).
- Parish membership resolved via `memberships(user_id, parish_id, role)` and helper `get_user_parish_ids(uid)` (`initial.sql:276-279`).

### RLS (ownership-relevant)
- `announcements_select` — `parish_id IN (get_user_parish_ids(auth.uid()))` (initial.sql:621-622).
- `announcements_insert` — `user_has_role(auth.uid(), parish_id, ARRAY['admin','teacher'])` (`:625-628`). Note: it does **not** force `author_id = auth.uid()`, but the client always sets `author_id = user.id`.
- `announcements_delete` — `user_has_role(... 'admin') OR author_id = auth.uid()` (20260428000000:29-33).
- `announcement_comments_select` — comment's announcement is in a parish the user belongs to (`:631-637`).
- `announcement_comments_insert` — `author_id = auth.uid() AND` the announcement is in the user's parish (`:640-647`). Any parish member may comment.
- `announcement_comments_delete` — `author_id = auth.uid() OR` the user is admin of the announcement's parish (20260428000000:36-43).
- Grants: `SELECT, INSERT` (20260422000001_grants.sql:18-19), `DELETE` (20260428000000:23-24), and `ALL` to `service_role` for the MCP server (20260428000000:65-66).

Helper functions (`initial.sql:276-294`) are all `SECURITY DEFINER STABLE`:
- `get_user_parish_ids(uid)` → set of parish_ids from `memberships`.
- `user_has_role(uid, pid, allowed_roles[])` → boolean existence check against `memberships`.

## Key logic & algorithms

- **Three-query fan-out with client-side joins.** Supabase here has no embedded-resource join; the page does it manually:
  1. Fetch announcements for the parish, newest first (`AnnouncementsPage.tsx:50-54`).
  2. Collect their ids and fetch all comments in one `.in('announcement_id', annIds)` query, oldest first (`:63-68`).
  3. Build a `Set` of all author ids across both announcements and comments, then fetch `profiles` once with `.in('id', ...)` (`:71-78`).
  4. Build `nameMap` (id → display_name) and `commentsByAnn` (announcement_id → comments[]), then assemble the final view rows (`:80-104`).
  Author names fall back to `'Unknown'` when a profile is missing (`:88`, `:100`).

- **Ordering is intentional and split:** announcements `order('created_at', { ascending: false })` (newest first, `:54`); comments `order('created_at')` (default ascending = oldest first, `:68`).

- **Early-exit on no announcements** avoids the comment/profile queries entirely (`:56-60`).

- **Single-open accordion** for comments via one `expandedId` string-or-null, not a per-card boolean (`:217`, `:245`).

- **Permission check is duplicated client + server.** `canDelete` (`:154`) and `canPost` (`:28`) gate the UI; the same logic lives in RLS. The client check is purely cosmetic — RLS is the real boundary.

- **Mutations always re-fetch the whole list** rather than optimistically updating local state (`:123`, `:141`, `:146`, `:151`). Simple but chatty.

- Critical snippet — insert sets author from the session, never trusting form input:
  ```ts
  await supabase.from('announcements').insert({
    parish_id: parishId, author_id: user.id,
    title: newTitle.trim(), body: newBody.trim(),
  }); // AnnouncementsPage.tsx:112-117
  ```

## External integrations

**None.** This section has no Mux, Whisper/OpenAI, ICS/ical, email, or YouTube integration. It is pure Supabase CRUD plus `profiles` lookups. (Author-name display relies on the `profiles_read_all` policy, the only cross-cutting dependency.) The MCP server only touches these tables to wipe a parish's announcements during reset (`packages/mcp-server/src/tools.ts:1306`).

## Edge cases & gotchas

- **Multi-parish users only ever see parish #0.** `parishId = memberships[0]?.parishId` (`:27`). A user belonging to multiple parishes silently sees and posts to only their first membership; there is no parish picker. Order of `memberships` is whatever Supabase returns (unordered).
- **Super-admin override forces admin.** When a super-admin uses parish override, `useAuth` injects a synthetic `admin` membership (`useAuth.ts:139-148`), so on this page they can post and delete anything in the overridden parish.
- **All errors are swallowed.** No error UI; failures appear as silent no-ops. (See User flows #6.)
- **No confirmation on delete** for either announcements or comments — single click destroys.
- **No pagination / no limit.** `fetchAnnouncements` loads every announcement and every comment for the parish in one shot. Scales poorly for large/old parishes.
- **No realtime.** Other users' new posts/comments only appear on remount or after the current user performs a mutation (which triggers re-fetch). Two users commenting concurrently won't see each other live.
- **Comment count reflects last fetch**, not live state.
- **`author_id` on announcements is not RLS-pinned to the session** (insert policy checks role, not author), so the client is trusted to set it — fine in-app, but worth pinning when re-porting.
- **Enter-to-submit has no shift-handling** because it's a single-line `<input>`, not a textarea — fine, but newlines in comments aren't possible (the body textarea on announcements does keep newlines via `whitespace-pre-wrap`).
- **Profile delete is blocked**, not cascaded — `author_id` FKs have no `ON DELETE`, so removing a profile that authored anything would error.
- **Cancel doesn't clear the form** — reopening shows the previously typed (unposted) draft.

## Acceptance criteria

- [ ] A teacher or admin in a parish sees a "New Announcement" button; a student/member does not.
- [ ] A user with no parish membership sees the empty state (no crash, no infinite loading).
- [ ] Posting an announcement requires non-empty trimmed title AND body; the Post button is disabled otherwise.
- [ ] A posted announcement stores `parish_id` of the author's parish and `author_id` equal to the current user.
- [ ] Announcements render newest-first by `created_at`.
- [ ] Comments within an announcement render oldest-first by `created_at`.
- [ ] Any authenticated parish member (including students) can post a comment; an empty/whitespace comment is rejected.
- [ ] Pressing Enter in the comment input submits the comment.
- [ ] Author display names resolve from `profiles`; a missing profile renders as "Unknown".
- [ ] An admin can delete any announcement or comment in their parish; a non-admin can delete only their own (delete control is hidden otherwise).
- [ ] Deleting an announcement cascades to delete its comments.
- [ ] RLS prevents a user from reading announcements/comments belonging to a parish they are not a member of.
- [ ] RLS prevents a student/member from inserting an announcement (server-side, even if the UI is bypassed).
- [ ] RLS prevents a member from deleting another member's announcement/comment unless they are a parish admin.
- [ ] Expanding one announcement's comments collapses any previously expanded one (single-open accordion).
- [ ] The comment toggle shows correct singular/plural ("1 comment" vs "2 comments").
- [ ] The empty state ("No announcements yet.") shows only when the parish has zero announcements.
- [ ] A super-admin using parish override can post and delete in the overridden parish as an admin.

## Port notes

**Boundary placement (per CLAUDE.md / packages/core rule):**

- **`packages/core`** owns all logic and data access. Add an `announcements` module exposing: `listAnnouncements(parishId)` (returns announcements + nested comments + author names in one core call — replace the 3-query client fan-out with a single SQL query using joins / `json_agg`), `createAnnouncement({parishId, authorId, title, body})`, `addComment({announcementId, authorId, body})`, `deleteAnnouncement(id, actor)`, `deleteComment(id, actor)`. Validators (zod) for title/body (non-empty, trimmed, max length) live here. Author/role authorization checks live here too (don't rely solely on RLS).
- **Reads → RSC.** The announcements list page is a Server Component that calls `core.listAnnouncements(parishId)` directly against Neon. Newest-first announcements, oldest-first comments.
- **Mutations → Server Actions**, each a ~10-line shim: auth check (WorkOS session) → validate input → call the corresponding `core` function → revalidate. Four actions: post announcement, add comment, delete announcement, delete comment.
- **Client-reactive bits** (the expand/collapse accordion, comment draft state, Enter-to-submit) stay in a small Client Component; it calls the Server Actions. If live updates across users are desired (a Narthex gap — it has none), use tRPC subscriptions or polling; otherwise keep the re-fetch/revalidate model.
- **route handler / `/api/v1`** — none needed unless external consumers must read announcements. Not required to match Narthex.
- **infra/workers** — none. This is fully request/response; nothing to offload. (No transcription, no email digests in Narthex — if a future "email me new announcements" feature is wanted, that bulk email belongs in `infra/workers`, but it is out of scope for a faithful port.)

**Tenancy / RLS (Neon + RLS):**

- Scope is **parish-only** in Narthex. In Parvus Ordo's diocese → parish → ministry hierarchy, port announcements as **parish-scoped** rows (`parish_id`). Consider whether diocese-scoped announcements are desired (Narthex GAP — it has none); if so, add a nullable `diocese_id` / scope discriminator, but only if explicitly requested. Do not gold-plate.
- Re-implement the four RLS policies on Neon: select = member-of-parish; insert announcement = admin/teacher of parish; comment insert = any parish member with `author_id = current_user`; delete = author OR parish admin. Mirror these checks in `core` so the boundary is enforced even outside SQL.
- Pin `author_id = session user` server-side on insert (Narthex's insert policy did not enforce this — tighten it).
- Replace Supabase `auth.uid()` / `get_user_parish_ids` with the WorkOS-derived user id and the Parvus Ordo membership lookup. The `user_has_role(uid, parish_id, roles[])` helper maps to an equivalent core/SQL predicate.
- `profiles.display_name` maps to whatever the Parvus Ordo user/profile table exposes; the author-name join must respect tenancy (don't leak names across parishes beyond what's needed to display).

**Mux→Bunny / Whisper→Groq:** Not applicable. Announcements have no media or transcription. These mappings only matter for the media/lesson sections.

**Explicit GAPS vs. what Parvus Ordo has already built:**

- **No versioning.** Unlike lessons (which Parvus Ordo built with versioning/fork-and-edit), announcements are flat, mutable-by-delete-only records. Do **not** add lesson-style versioning — it's not in scope and CLAUDE.md says no speculative features.
- **No media/asset manager involvement.** Announcements reference no assets; the media/asset manager, seek-enforcing player + transcript, and teacher preview are all irrelevant here. If rich-media announcements are ever wanted, that would reuse the asset manager — but that is a new feature, not part of this port.
- **No teacher-preview concept** — announcements are published immediately on insert (no draft/preview/publish workflow). Faithful port keeps immediate publish.
- **No edit.** Narthex has no update path for announcements or comments (only insert + delete). RLS grants only `SELECT, INSERT, DELETE` — never `UPDATE`. A faithful port should omit edit unless the user asks; if added, it belongs in `core` with a new RLS/update policy.
- **No realtime, no pagination, no error surfacing** in Narthex — these are quality gaps the porting team may choose to fix (toasts/error boundaries, cursor pagination, optional live updates), but each is an additive decision, not a port requirement.
