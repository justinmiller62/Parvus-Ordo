import { getDb, type TenantQuery, withTenant } from "../../db";
import { type GatherGroupMember, type GroupMemberStatus, type TransferGroupRoleInput } from "./types";

// snake_case row + mapper, private to this file (the calendar/events.ts convention).
const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
const toIsoOrNull = (v: unknown): string | null => (v == null ? null : toIso(v));

interface GroupMemberRow {
  id: string;
  parish_id: string;
  group_id: string;
  user_id: string;
  role_id: string | null;
  status: GroupMemberStatus;
  past_badge: string | null;
  badge_until: unknown;
  created_at: unknown;
}

const GROUP_MEMBER_COLUMNS = "id, parish_id, group_id, user_id, role_id, status, past_badge, badge_until, created_at";

function rowToGroupMember(r: GroupMemberRow): GatherGroupMember {
  return {
    id: r.id,
    parishId: r.parish_id,
    groupId: r.group_id,
    userId: r.user_id,
    roleId: r.role_id,
    status: r.status,
    pastBadge: r.past_badge,
    badgeUntil: toIsoOrNull(r.badge_until),
    createdAt: toIso(r.created_at),
  };
}

// Parvus Gather — group roster: add/remove members, assign a role, and the leadership handoff
// (RFC-005 §3.1, po-05xo). EVERY role transition appends a gather_group_role_log row (§3.1 "all
// transitions logged"); the multi-statement mutations run in one tenant-scoped transaction so the
// change and its audit row commit together. Parish-scoped by RLS; authz is the T1-g shim's job.

const PAST_BADGE_DEFAULT_MONTHS = 12; // a handoff's "Past <Role>" badge is time-boxed (§3.1)

interface RoleTransition {
  parishId: string;
  groupId: string;
  userId: string;
  fromRoleId: string | null;
  toRoleId: string | null;
  actorUserId: string | null;
}

/** Append the append-only role-transition audit row (RFC-005 §3.1). Runs inside the caller's txn. */
async function logRoleTransition(q: TenantQuery, e: RoleTransition): Promise<void> {
  await q(
    `INSERT INTO gather_group_role_log (parish_id, group_id, user_id, from_role_id, to_role_id, actor_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [e.parishId, e.groupId, e.userId, e.fromRoleId, e.toRoleId, e.actorUserId],
  );
}

export interface AddGroupMemberOptions {
  /** The role to seat the member in (logged as an initial transition). Default: no role. */
  roleId?: string | null;
  /** active (a direct add) or awaiting_acceptance (an invite the member confirms). Default active. */
  status?: GroupMemberStatus;
  actorUserId?: string | null;
}

/** Add a user to a group's roster (RFC-005 §3.1). Seating them in a role logs the transition.
 *  Throws if the user is already in the group (UNIQUE group_id, user_id). */
export async function addGroupMember(
  parishId: string,
  groupId: string,
  userId: string,
  opts: AddGroupMemberOptions = {},
): Promise<GatherGroupMember> {
  const roleId = opts.roleId ?? null;
  const status = opts.status ?? "active";
  return withTenant(parishId, async (q) => {
    const rows = await q<GroupMemberRow>(
      `INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id, status)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${GROUP_MEMBER_COLUMNS}`,
      [parishId, groupId, userId, roleId, status],
    );
    if (roleId) {
      await logRoleTransition(q, {
        parishId,
        groupId,
        userId,
        fromRoleId: null,
        toRoleId: roleId,
        actorUserId: opts.actorUserId ?? null,
      });
    }
    return rowToGroupMember(rows[0]!);
  });
}

/** Remove a user from a group's roster. Idempotent (a non-member is a no-op). A removed
 *  role-holder's tenure is logged as a transition out of their role (§3.1). */
export async function removeGroupMember(
  parishId: string,
  groupId: string,
  userId: string,
  actorUserId: string | null = null,
): Promise<void> {
  await withTenant(parishId, async (q) => {
    const cur = await q<{ role_id: string | null }>(
      "SELECT role_id FROM gather_group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );
    if (cur.length === 0) return;
    const fromRoleId = cur[0]!.role_id;
    await q("DELETE FROM gather_group_members WHERE group_id = $1 AND user_id = $2", [groupId, userId]);
    if (fromRoleId) {
      await logRoleTransition(q, { parishId, groupId, userId, fromRoleId, toRoleId: null, actorUserId });
    }
  });
}

/** Move an existing member into a different role (RFC-005 §3.1). No-op (no log) when unchanged;
 *  throws when the user is not in the group. Logs the from→to transition. */
export async function assignGroupRole(
  parishId: string,
  groupId: string,
  userId: string,
  roleId: string | null,
  actorUserId: string | null = null,
): Promise<void> {
  await withTenant(parishId, async (q) => {
    const cur = await q<{ role_id: string | null }>(
      "SELECT role_id FROM gather_group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, userId],
    );
    if (cur.length === 0) throw new Error("user is not a member of this group");
    const fromRoleId = cur[0]!.role_id;
    if (fromRoleId === roleId) return; // unchanged — nothing to log
    await q("UPDATE gather_group_members SET role_id = $1 WHERE group_id = $2 AND user_id = $3", [
      roleId,
      groupId,
      userId,
    ]);
    await logRoleTransition(q, { parishId, groupId, userId, fromRoleId, toRoleId: roleId, actorUserId });
  });
}

/**
 * Hand a role off from the outgoing holder to a successor (RFC-005 §3.1). Atomically: the
 * outgoing holder relinquishes the role and becomes `past` with a time-boxed commemorative badge
 * ("Past <role label>" unless overridden); the successor is installed in the role (added to the
 * roster if not already a member), active; and BOTH transitions are logged. Throws if the role is
 * not in the group.
 */
export async function transferGroupRole(
  parishId: string,
  input: TransferGroupRoleInput,
  actorUserId: string | null = null,
): Promise<void> {
  const { groupId, roleId, outgoingUserId, successorUserId } = input;
  await withTenant(parishId, async (q) => {
    const roleRows = await q<{ label: string }>(
      "SELECT label FROM gather_group_roles WHERE id = $1 AND group_id = $2",
      [roleId, groupId],
    );
    if (roleRows.length === 0) throw new Error("role not found in this group");
    const pastBadge = input.pastBadge ?? `Past ${roleRows[0]!.label}`;
    let badgeUntil = input.badgeUntil;
    if (!badgeUntil) {
      badgeUntil = new Date();
      badgeUntil.setMonth(badgeUntil.getMonth() + PAST_BADGE_DEFAULT_MONTHS);
    }

    // Outgoing holder: relinquish the role, mark past with the time-boxed badge.
    await q(
      `UPDATE gather_group_members
       SET role_id = NULL, status = 'past', past_badge = $1, badge_until = $2
       WHERE group_id = $3 AND user_id = $4`,
      [pastBadge, badgeUntil, groupId, outgoingUserId],
    );

    // Successor: install into the role (add if not yet a member), active and badge-free.
    const succ = await q<{ role_id: string | null }>(
      "SELECT role_id FROM gather_group_members WHERE group_id = $1 AND user_id = $2",
      [groupId, successorUserId],
    );
    const successorFromRoleId = succ[0]?.role_id ?? null;
    await q(
      `INSERT INTO gather_group_members (parish_id, group_id, user_id, role_id, status)
       VALUES ($1, $2, $3, $4, 'active')
       ON CONFLICT (group_id, user_id)
       DO UPDATE SET role_id = EXCLUDED.role_id, status = 'active', past_badge = NULL, badge_until = NULL`,
      [parishId, groupId, successorUserId, roleId],
    );

    await logRoleTransition(q, {
      parishId,
      groupId,
      userId: outgoingUserId,
      fromRoleId: roleId,
      toRoleId: null,
      actorUserId,
    });
    await logRoleTransition(q, {
      parishId,
      groupId,
      userId: successorUserId,
      fromRoleId: successorFromRoleId,
      toRoleId: roleId,
      actorUserId,
    });
  });
}
