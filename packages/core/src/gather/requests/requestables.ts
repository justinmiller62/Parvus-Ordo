import {
  type GatherPermission,
  type RequestAction,
  type RequestActor,
  type RequestPriority,
  type RequestStatus,
  REQUEST_PRIORITIES,
  nextRequestStatus,
} from "@parvaordo/shared";
import { getDb, withTenant } from "../../db/client";
import {
  type Requestable,
  type RequestableRow,
  REQUESTABLE_COLUMNS,
  mapRequestable,
  nextRecurrenceDate,
  parseRecurrence,
} from "./types";

// The Requests pillar — the SINGLE coordination spine every Gather flow emits into (RFC-005 §4.4).
// createRequestable is the sole emission path; transitions go through the shared pure machine
// (nextRequestStatus, T1-a) and apply the associated data changes here (claim/assign set the
// assignee, hand_back re-opens, done completes + thanks + regenerates a recurrence). Authorization
// INTRINSIC to an action (assignee-only finish, requester-only cancel) lives in the machine; this
// layer resolves the actor's relationship to the ask + their group-board power.

/** In-app gratitude recorded on the request thread when an ask is completed (RFC-005 §4.2/§4.5).
 *  T1 has no notification inbox (that is the T5 surface) — this persistent comment IS the in-app
 *  thank-you the requester sees. Invitation-first, and clear of the GATHER_NEVER_SAY words. */
const THANK_YOU_BODY = "Thank you for asking — this is all done.";

export interface CreateRequestableInput {
  groupId?: string | null;
  requesterId: string;
  /** Assign directly to a person … */
  assigneeUserId?: string | null;
  /** … XOR offer to a group role's pool (the DB CHECK enforces at-most-one). */
  assigneeRoleId?: string | null;
  title: string;
  detail?: string | null;
  priority?: RequestPriority;
  dueOn?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  recurrence?: unknown;
}

/**
 * Emit a Requestable (RFC-005 §4.4) — the ONE entry every Gather flow calls so nothing re-invents
 * pending/assign/track. A direct person-assignment starts `assigned`; a pool offer or an
 * unassigned ask starts `open`. Returns the new id. RLS scopes the write to `parishId`.
 */
export async function createRequestable(parishId: string, input: CreateRequestableInput): Promise<string> {
  const title = input.title.trim();
  if (!title) throw new Error("a request needs a title");
  if (input.assigneeUserId && input.assigneeRoleId) {
    throw new Error("a request is assigned to a person OR offered to a role, not both");
  }
  const priority: RequestPriority = REQUEST_PRIORITIES.includes(input.priority as RequestPriority)
    ? (input.priority as RequestPriority)
    : "normal";
  const status: RequestStatus = input.assigneeUserId ? "assigned" : "open";
  const recurrence = parseRecurrence(input.recurrence);
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO gather_requestables
       (parish_id, group_id, requester_id, assignee_user_id, assignee_role_id, status, priority,
        title, detail, due_on, source_type, source_id, recurrence)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
     RETURNING id`,
    [
      parishId,
      input.groupId ?? null,
      input.requesterId,
      input.assigneeUserId ?? null,
      input.assigneeRoleId ?? null,
      status,
      priority,
      title,
      input.detail?.trim() || null,
      input.dueOn ?? null,
      input.sourceType ?? null,
      input.sourceId ?? null,
      recurrence ? JSON.stringify(recurrence) : null,
    ],
  );
  return rows[0]!.id;
}

/** A single Requestable (RLS-scoped), or null. */
export async function getRequestable(parishId: string, id: string): Promise<Requestable | null> {
  const { rows } = await getDb(parishId).query<RequestableRow>(
    `SELECT ${REQUESTABLE_COLUMNS} FROM gather_requestables WHERE id = $1`,
    [id],
  );
  return rows[0] ? mapRequestable(rows[0]) : null;
}

export interface TransitionOpts {
  /** The person an `assign` directs the ask to (required for `assign`). */
  assigneeUserId?: string;
}

/**
 * Apply a transition to a Requestable (RFC-005 §4.2). Resolves the actor's relationship to the ask
 * (requester / assignee / pool-eligible / board-manager / staff), runs the shared pure machine, and
 * — only for a legal+authorized move — applies the status + associated data in ONE transaction:
 *   • claim  → assignee_user_id = the claimant (role offer consumed: cleared to satisfy the XOR);
 *   • assign → assignee_user_id = opts.assigneeUserId (role offer consumed likewise);
 *   • start  → in_progress;
 *   • done   → completed_at + an in-app thank-you + (if recurring) the next occurrence, synchronously;
 *   • hand_back → assignee cleared, back to open (re-offered to whoever is eligible);
 *   • decline/cancel → terminal, assignee kept for the record.
 * Returns the new status, or null when the move is illegal for the source state OR unauthorized.
 */
export async function transitionRequestable(
  parishId: string,
  requestableId: string,
  actorUserId: string,
  action: RequestAction,
  opts: TransitionOpts = {},
): Promise<RequestStatus | null> {
  return withTenant(parishId, async (q) => {
    const rows = await q<RequestableRow>(`SELECT ${REQUESTABLE_COLUMNS} FROM gather_requestables WHERE id = $1`, [
      requestableId,
    ]);
    const row = rows[0];
    if (!row) return null;

    const actor = await resolveActor(q, parishId, row, actorUserId);
    const next = nextRequestStatus(row.status, action, actor);
    if (next === null) return null;

    const sets = ["status = $2", "updated_at = now()"];
    const params: unknown[] = [requestableId, next];
    const add = (frag: string, val: unknown) => {
      params.push(val);
      sets.push(frag.replace("$$", `$${params.length}`));
    };
    if (action === "claim") {
      add("assignee_user_id = $$", actorUserId);
      sets.push("assignee_role_id = NULL"); // role offer consumed (XOR: at most one assignee)
    } else if (action === "assign") {
      const target = opts.assigneeUserId?.trim();
      if (!target) throw new Error("assign needs a person to ask");
      add("assignee_user_id = $$", target);
      sets.push("assignee_role_id = NULL");
    } else if (action === "hand_back") {
      sets.push("assignee_user_id = NULL"); // back to the open board
    } else if (action === "done") {
      sets.push("completed_at = now()");
    }
    await q(`UPDATE gather_requestables SET ${sets.join(", ")} WHERE id = $1`, params);

    if (action === "done") {
      // In-app thank-you (no notification inbox in T1 — a persistent thread comment).
      await q(
        "INSERT INTO gather_request_comments (parish_id, requestable_id, author_id, body) VALUES ($1, $2, $3, $4)",
        [parishId, requestableId, actorUserId, THANK_YOU_BODY],
      );
      // Recurrence: regenerate the next open occurrence SYNCHRONOUSLY (no worker, Q3).
      const rec = parseRecurrence(row.recurrence);
      if (rec) {
        const anchor = row.due_on ?? new Date().toISOString().slice(0, 10);
        const nextDue = nextRecurrenceDate(anchor, rec);
        await q(
          `INSERT INTO gather_requestables
             (parish_id, group_id, requester_id, assignee_role_id, status, priority, title, detail,
              due_on, source_type, source_id, recurrence)
           VALUES ($1, $2, $3, $4, 'open', $5, $6, $7, $8, $9, $10, $11::jsonb)`,
          [
            parishId,
            row.group_id,
            row.requester_id,
            row.assignee_role_id,
            row.priority,
            row.title,
            row.detail,
            nextDue,
            row.source_type,
            row.source_id,
            JSON.stringify(rec),
          ],
        );
      }
    }
    return next;
  });
}

/** Resolve the actor's relationship to a Requestable for the transition machine (RFC-005 §4.2). */
async function resolveActor(
  q: <R = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<R[]>,
  parishId: string,
  row: RequestableRow,
  actorUserId: string,
): Promise<RequestActor> {
  const staffRows = await q<{ staff: boolean | null }>(
    "SELECT bool_or(role IN ('super_admin', 'admin', 'catechist')) AS staff FROM memberships WHERE parish_id = $1 AND user_id = $2",
    [parishId, actorUserId],
  );
  const isStaff = staffRows[0]?.staff === true;

  let perms: GatherPermission[] = [];
  let memberRoleId: string | null = null;
  if (row.group_id) {
    const memRows = await q<{ role_id: string | null; permissions: GatherPermission[] | null }>(
      `SELECT gm.role_id, ggr.permissions
         FROM gather_group_members gm
         LEFT JOIN gather_group_roles ggr ON ggr.id = gm.role_id
        WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.status = 'active'`,
      [row.group_id, actorUserId],
    );
    perms = memRows[0]?.permissions ?? [];
    memberRoleId = memRows[0]?.role_id ?? null;
  }
  return {
    isRequester: row.requester_id === actorUserId,
    isAssignee: row.assignee_user_id === actorUserId,
    isPoolEligible: !!row.assignee_role_id && memberRoleId === row.assignee_role_id,
    canManageBoard: isStaff || perms.includes("request.assign") || perms.includes("request.manage_board"),
    isStaff,
  };
}
