import type { GatherPermission, GroupType } from "@parvaordo/shared";

// Domain + input types for the Parvus Gather Groups primitive (RFC-005 §3.1/§3.3). These mirror
// the gather_groups / gather_group_roles / gather_group_members tables (migration 0032, po-qdw6).
// Pure data shapes — authz is enforced at the shim layer (T1-g), never in core (po-05xo). Each
// impl file keeps its own snake_case row + mapper private (the calendar/events.ts convention).

/** Group discovery/read visibility — mirrors the gather_groups.visibility CHECK (RFC-005 §3.3). */
export type GroupVisibility = "public" | "members_only" | "leaders_only";
export const GROUP_VISIBILITIES = ["public", "members_only", "leaders_only"] as const;

/** Membership lifecycle — mirrors the gather_group_members.status CHECK. */
export type GroupMemberStatus = "active" | "awaiting_acceptance" | "past";

/** A viewer's standing relative to ONE group, the input to the visibility read-filter. */
export type GroupViewerRelationship = "none" | "member" | "leader";

/** Freeform jsonb payload (group public profile, quorum rules) — shape owned by later tiers. */
export type GatherJson = Record<string, unknown>;

export interface GatherGroup {
  id: string;
  parishId: string;
  name: string;
  type: GroupType;
  parentId: string | null;
  visibility: GroupVisibility;
  profile: GatherJson | null;
  quorum: GatherJson | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatherGroupRole {
  id: string;
  parishId: string;
  groupId: string;
  label: string;
  isLeadership: boolean;
  permissions: GatherPermission[];
  createdAt: string;
}

export interface GatherGroupMember {
  id: string;
  parishId: string;
  groupId: string;
  userId: string;
  roleId: string | null;
  status: GroupMemberStatus;
  pastBadge: string | null;
  badgeUntil: string | null;
  createdAt: string;
}

// ── Inputs ──

export interface CreateGroupInput {
  name: string;
  type: GroupType;
  visibility?: GroupVisibility;
  profile?: GatherJson | null;
  quorum?: GatherJson | null;
  parentId?: string | null;
}

/** Edit group settings + public profile. Only the provided fields change (RFC-005 §3.1). */
export interface UpdateGroupInput {
  name?: string;
  visibility?: GroupVisibility;
  profile?: GatherJson | null;
  quorum?: GatherJson | null;
  parentId?: string | null;
}

export interface DefineGroupRoleInput {
  label: string;
  isLeadership?: boolean;
  permissions?: readonly GatherPermission[];
}

export interface UpdateGroupRoleInput {
  label?: string;
  isLeadership?: boolean;
  permissions?: readonly GatherPermission[];
}

/** Hand off a leadership role from the outgoing holder to a successor (RFC-005 §3.1). */
export interface TransferGroupRoleInput {
  groupId: string;
  roleId: string;
  /** The member currently holding the role — marked `past` with a commemorative badge. */
  outgoingUserId: string;
  /** The member receiving the role — added if not already in the group. */
  successorUserId: string;
  /** Override the default "Past <role label>" badge text. */
  pastBadge?: string;
  /** When the past badge expires; defaults to one year from the handoff. */
  badgeUntil?: Date;
}
