import { isStaff, type GroupVisibility, type Role } from "@parvaordo/shared";
import { getDb } from "../../db/client";
import type { GroupAuthzContext } from "./permissions";

// ─── Group visibility read-filter (RFC-005 §3.1/§3.3) ─────────────────────────
//
// Visibility is a READ filter layered on top of the permission engine (./permissions): it
// decides who may SEE a group's existence + data, where permissions decide who may ACT. Group
// isolation is in-tenant (NOT a separate RLS policy — groups share the parish tenant), so this
// is the gate that stops a parish member from reaching a `leaders_only` group's data without a
// leadership role (RFC-005 §13).

/** The caller's membership facet relevant to visibility: whether the active membership's role
 *  is a leadership role. The membership itself is `null` when the caller holds no ACTIVE
 *  membership in the group. */
export interface GroupMembershipFacet {
  isLeadership: boolean;
}

/**
 * PURE visibility decision (unit-tested): may a viewer with parish `role` and the given group
 * `membership` SEE a group of `visibility`?
 *   • parish STAFF see every group in their parish (implicit-all, §3.2);
 *   • `public` — any parish member (no membership needed);
 *   • `members_only` — an active member (any role);
 *   • `leaders_only` — an active member whose role is a leadership role.
 */
export function canViewGroup(input: {
  role: Role;
  visibility: GroupVisibility;
  membership: GroupMembershipFacet | null;
}): boolean {
  if (isStaff(input.role)) return true;
  switch (input.visibility) {
    case "public":
      return true;
    case "members_only":
      return input.membership !== null;
    case "leaders_only":
      return input.membership?.isLeadership === true;
  }
}

/**
 * Whether the caller may SEE `groupId` (RFC-005 §3.3 read filter) — loads the group's
 * visibility plus the caller's ACTIVE membership/leadership under RLS (getDb(parishId)) and
 * applies {@link canViewGroup}. Returns false when the group is not in the caller's parish
 * (RLS) or does not exist. Reads use this to filter discovery lists and to gate a single-group
 * load (returning a 404 on false, so a `leaders_only` group's existence is not revealed).
 */
export async function canAccessGroup(ctx: GroupAuthzContext, groupId: string): Promise<boolean> {
  const { rows } = await getDb(ctx.parishId).query<{
    visibility: GroupVisibility;
    membership_id: string | null;
    is_leadership: boolean | null;
  }>(
    `SELECT g.visibility, m.id AS membership_id, r.is_leadership
       FROM gather_groups g
       LEFT JOIN gather_group_members m ON m.group_id = g.id AND m.user_id = $2 AND m.status = 'active'
       LEFT JOIN gather_group_roles r ON r.id = m.role_id
      WHERE g.id = $1`,
    [groupId, ctx.userId],
  );
  const row = rows[0];
  if (!row) return false; // not in this parish (RLS) or nonexistent
  const membership = row.membership_id ? { isLeadership: row.is_leadership === true } : null;
  return canViewGroup({ role: ctx.role, visibility: row.visibility, membership });
}
