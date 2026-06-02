import type { RequestStatus } from "@parvaordo/shared";
import { getDb } from "../../db/client";
import { type Requestable, type RequestableRow, REQUESTABLE_COLUMNS, mapRequestable } from "./types";

// The three Requests read surfaces (RFC-005 §4.3; Q4-locked — NO parish-wide staff view): the
// group BOARD, the personal cross-group INBOX, and the per-group leader OVERVIEW. All are
// RLS-scoped to the active parish (getDb(parishId)), so a parish never reads another's requests.

// Urgency-first ordering used across the surfaces: live before terminal, then the gentle priority
// (soon > normal > low), then soonest due (undated last), then oldest. No "overdue" in copy — the
// ordering only surfaces a soft sense (§4.5).
const ORDER =
  "ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'assigned' THEN 1 WHEN 'in_progress' THEN 2 ELSE 3 END, " +
  "CASE priority WHEN 'soon' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, due_on NULLS LAST, created_at";

const LIVE_STATUSES: RequestStatus[] = ["open", "assigned", "in_progress"];

export interface BoardFilter {
  /** Restrict to these statuses (default: the live ones — open/assigned/in_progress). */
  status?: RequestStatus[];
  /** Restrict to one helper. */
  assigneeUserId?: string;
}

/** One group's board (RFC-005 §4.3): its requests, urgency-ordered, optionally filtered. */
export async function listGroupBoard(
  parishId: string,
  groupId: string,
  filter: BoardFilter = {},
): Promise<Requestable[]> {
  const statuses = filter.status?.length ? filter.status : LIVE_STATUSES;
  const params: unknown[] = [groupId, statuses];
  let where = "group_id = $1 AND status = ANY($2)";
  if (filter.assigneeUserId) {
    params.push(filter.assigneeUserId);
    where += ` AND assignee_user_id = $${params.length}`;
  }
  const { rows } = await getDb(parishId).query<RequestableRow>(
    `SELECT ${REQUESTABLE_COLUMNS} FROM gather_requestables WHERE ${where} ${ORDER}`,
    params,
  );
  return rows.map(mapRequestable);
}

/**
 * A person's "my requests" inbox (RFC-005 §4.3) — ACROSS ALL their groups in the parish: asks they
 * raised (requester), asks they hold (assignee), and open pool offers to a role they carry. Live
 * items only by default; urgency-ordered. RLS already confines this to the active parish.
 */
export async function listMyRequests(
  parishId: string,
  userId: string,
  filter: { status?: RequestStatus[] } = {},
): Promise<Requestable[]> {
  const statuses = filter.status?.length ? filter.status : LIVE_STATUSES;
  const { rows } = await getDb(parishId).query<RequestableRow>(
    `SELECT ${REQUESTABLE_COLUMNS} FROM gather_requestables
      WHERE status = ANY($2)
        AND (requester_id = $1
             OR assignee_user_id = $1
             OR (assignee_role_id IS NOT NULL AND assignee_role_id IN (
                   SELECT role_id FROM gather_group_members
                    WHERE user_id = $1 AND status = 'active' AND role_id IS NOT NULL)))
      ${ORDER}`,
    [userId, statuses],
  );
  return rows.map(mapRequestable);
}

/** A row of the per-group leader "who owes what" overview (RFC-005 §4.3). */
export interface LeaderOverviewRow {
  assigneeUserId: string | null;
  status: RequestStatus;
  count: number;
  /** Outstanding items now past their due date — the "overdue surfaced" signal, named softly so
   *  it is never rendered as the banned word. */
  pastDue: number;
}

/**
 * Per-group leader overview (RFC-005 §4.3): outstanding (live) requests grouped by helper + status,
 * with the past-due count surfaced. Unassigned outstanding rows group under a null helper.
 */
export async function listGroupLeaderOverview(parishId: string, groupId: string): Promise<LeaderOverviewRow[]> {
  const { rows } = await getDb(parishId).query<{
    assignee_user_id: string | null;
    status: RequestStatus;
    count: string;
    past_due: string;
  }>(
    `SELECT assignee_user_id, status, count(*) AS count,
            count(*) FILTER (WHERE due_on IS NOT NULL AND due_on < CURRENT_DATE) AS past_due
       FROM gather_requestables
      WHERE group_id = $1 AND status = ANY($2)
      GROUP BY assignee_user_id, status
      ORDER BY past_due DESC, count DESC`,
    [groupId, LIVE_STATUSES],
  );
  return rows.map((r) => ({
    assigneeUserId: r.assignee_user_id,
    status: r.status,
    count: Number(r.count),
    pastDue: Number(r.past_due),
  }));
}
