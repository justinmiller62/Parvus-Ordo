import type { RequestPriority, RequestStatus } from "@parvaordo/shared";

// Shared row + recurrence shapes for the Gather Requests pillar (RFC-005 §4). The state machine,
// status/priority/action unions, and copy live in @parvaordo/shared (T1-a); this is the core
// data layer over the gather_requestables / _comments / _subtasks tables (T1-b migration 0032).

/** A Requestable as the app reads it (camelCase; `recurrence` parsed). */
export interface Requestable {
  id: string;
  groupId: string | null;
  requesterId: string;
  assigneeUserId: string | null;
  assigneeRoleId: string | null;
  status: RequestStatus;
  priority: RequestPriority;
  title: string;
  detail: string | null;
  dueOn: string | null;
  sourceType: string | null;
  sourceId: string | null;
  recurrence: RequestRecurrence | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * The T1 recurrence rule (RFC-005 §4.1 `recurrence jsonb`). Deliberately minimal — a fixed
 * cadence the done-transition uses to regenerate the next occurrence SYNCHRONOUSLY (no worker,
 * Q3). A richer RRULE-style rule can layer on later without a schema change (it is jsonb).
 */
export interface RequestRecurrence {
  every: number; // a positive integer count of `unit`s
  unit: "day" | "week" | "month";
}

/** Parse + validate the `recurrence` jsonb into a {@link RequestRecurrence}, or null when absent
 *  or malformed (a bad rule never blocks the done-transition; it just does not regenerate). */
export function parseRecurrence(raw: unknown): RequestRecurrence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const every = typeof r.every === "number" ? Math.floor(r.every) : 0;
  const unit = r.unit;
  if (every < 1) return null;
  if (unit !== "day" && unit !== "week" && unit !== "month") return null;
  return { every, unit };
}

/**
 * The next occurrence date for a recurring Requestable: `fromISO` (the completed one's due date,
 * or its completion date when it had none) advanced by the rule. Pure + UTC-stable (the value is
 * a calendar date, YYYY-MM-DD) so it is unit-testable without a clock.
 */
export function nextRecurrenceDate(fromISO: string, rec: RequestRecurrence): string {
  const d = new Date(`${fromISO}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return fromISO;
  if (rec.unit === "day") d.setUTCDate(d.getUTCDate() + rec.every);
  else if (rec.unit === "week") d.setUTCDate(d.getUTCDate() + rec.every * 7);
  else d.setUTCMonth(d.getUTCMonth() + rec.every);
  return d.toISOString().slice(0, 10);
}

/** snake_case row as it comes back from gather_requestables. */
export interface RequestableRow {
  id: string;
  group_id: string | null;
  requester_id: string;
  assignee_user_id: string | null;
  assignee_role_id: string | null;
  status: RequestStatus;
  priority: RequestPriority;
  title: string;
  detail: string | null;
  due_on: string | null;
  source_type: string | null;
  source_id: string | null;
  recurrence: unknown;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** All gather_requestables columns, in one place so the read shape never drifts from the writes. */
export const REQUESTABLE_COLUMNS =
  "id, group_id, requester_id, assignee_user_id, assignee_role_id, status, priority, title, detail, " +
  "due_on::text, source_type, source_id, recurrence, completed_at::text, created_at::text, updated_at::text";

/** Map a DB row to the app {@link Requestable}. */
export function mapRequestable(r: RequestableRow): Requestable {
  return {
    id: r.id,
    groupId: r.group_id,
    requesterId: r.requester_id,
    assigneeUserId: r.assignee_user_id,
    assigneeRoleId: r.assignee_role_id,
    status: r.status,
    priority: r.priority,
    title: r.title,
    detail: r.detail,
    dueOn: r.due_on,
    sourceType: r.source_type,
    sourceId: r.source_id,
    recurrence: parseRecurrence(r.recurrence),
    completedAt: r.completed_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
