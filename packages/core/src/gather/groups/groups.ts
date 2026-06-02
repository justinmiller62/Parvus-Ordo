import { DEFAULT_GROUP_ROLES, type GroupType } from "@parvaordo/shared";
import { getDb, withTenant } from "../../db";
import {
  type CreateGroupInput,
  type GatherGroup,
  type GatherJson,
  type GroupViewerRelationship,
  type GroupVisibility,
  type UpdateGroupInput,
} from "./types";

// snake_case row + mapper, private to this file (the calendar/events.ts convention).
const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));
const toIsoOrNull = (v: unknown): string | null => (v == null ? null : toIso(v));
const asJson = (v: unknown): GatherJson | null => (v == null ? null : (v as GatherJson));

interface GroupRow {
  id: string;
  parish_id: string;
  name: string;
  type: GroupType;
  parent_id: string | null;
  visibility: GroupVisibility;
  profile: unknown;
  quorum: unknown;
  archived_at: unknown;
  created_at: unknown;
  updated_at: unknown;
}

const GROUP_COLUMNS =
  "id, parish_id, name, type, parent_id, visibility, profile, quorum, archived_at, created_at, updated_at";

function rowToGroup(r: GroupRow): GatherGroup {
  return {
    id: r.id,
    parishId: r.parish_id,
    name: r.name,
    type: r.type,
    parentId: r.parent_id,
    visibility: r.visibility,
    profile: asJson(r.profile),
    quorum: asJson(r.quorum),
    archivedAt: toIsoOrNull(r.archived_at),
    createdAt: toIso(r.created_at),
    updatedAt: toIso(r.updated_at),
  };
}

// Parvus Gather — the ONE Group primitive: CRUD, archive (no hard delete), and the
// visibility read-filter (RFC-005 §3.1/§3.3, po-05xo). Pure data functions scoped by
// getDb(parishId)/RLS; authz (who may create/edit) is the T1-g shim's job, never here.

/**
 * Whether a group with `visibility` is discoverable by a viewer whose standing is
 * `relationship` (RFC-005 §3.3). PURE — the single source of truth the read-path filter
 * (listVisibleGroups) applies, and the one the UI can reuse. public: everyone; members_only:
 * active members and leaders; leaders_only: leadership-role members only.
 */
export function isGroupVisibleTo(visibility: GroupVisibility, relationship: GroupViewerRelationship): boolean {
  switch (visibility) {
    case "public":
      return true;
    case "members_only":
      return relationship === "member" || relationship === "leader";
    case "leaders_only":
      return relationship === "leader";
  }
}

/**
 * Create a group and seed it with the starter roles for its type (RFC-005 §3.2 — "a new group
 * is seeded with these starter roles", DEFAULT_GROUP_ROLES). Atomic: the group row and its
 * default roles commit together. A parish then renames/re-scopes them and adds more via the
 * role helpers. Parish-scoped by RLS.
 */
export async function createGroup(parishId: string, input: CreateGroupInput): Promise<GatherGroup> {
  return withTenant(parishId, async (q) => {
    const rows = await q<GroupRow>(
      `INSERT INTO gather_groups (parish_id, name, type, visibility, profile, quorum, parent_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)
       RETURNING ${GROUP_COLUMNS}`,
      [
        parishId,
        input.name,
        input.type,
        input.visibility ?? "public",
        input.profile == null ? null : JSON.stringify(input.profile),
        input.quorum == null ? null : JSON.stringify(input.quorum),
        input.parentId ?? null,
      ],
    );
    const group = rows[0]!;
    for (const def of DEFAULT_GROUP_ROLES[input.type]) {
      await q(
        `INSERT INTO gather_group_roles (parish_id, group_id, label, is_leadership, permissions)
         VALUES ($1, $2, $3, $4, $5::text[])`,
        [parishId, group.id, def.label, def.isLeadership, [...def.permissions]],
      );
    }
    return rowToGroup(group);
  });
}

/** Edit a group's settings + public profile. Only the provided fields change; bumps updated_at.
 *  Parish-scoped by RLS (the UPDATE never escapes the active tenant). */
export async function updateGroup(parishId: string, groupId: string, input: UpdateGroupInput): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (assignment: string, value: unknown): void => {
    params.push(value);
    sets.push(assignment.replace("?", `$${params.length}`));
  };
  if (input.name !== undefined) add("name = ?", input.name);
  if (input.visibility !== undefined) add("visibility = ?", input.visibility);
  if (input.profile !== undefined)
    add("profile = ?::jsonb", input.profile == null ? null : JSON.stringify(input.profile));
  if (input.quorum !== undefined) add("quorum = ?::jsonb", input.quorum == null ? null : JSON.stringify(input.quorum));
  if (input.parentId !== undefined) add("parent_id = ?", input.parentId);
  if (sets.length === 0) return; // nothing to change
  sets.push("updated_at = now()");
  params.push(groupId);
  await getDb(parishId).query(`UPDATE gather_groups SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

/** Archive a group: set archived_at, preserving all history — NO hard delete (RFC-005 §3.1).
 *  Idempotent (a re-archive is a no-op via the archived_at IS NULL guard). */
export async function archiveGroup(parishId: string, groupId: string): Promise<void> {
  await getDb(parishId).query(
    "UPDATE gather_groups SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL",
    [groupId],
  );
}

/** Read one group by id (parish-scoped by RLS). Null when absent or in another tenant. */
export async function getGroup(parishId: string, groupId: string): Promise<GatherGroup | null> {
  const { rows } = await getDb(parishId).query<GroupRow>(`SELECT ${GROUP_COLUMNS} FROM gather_groups WHERE id = $1`, [
    groupId,
  ]);
  return rows[0] ? rowToGroup(rows[0]) : null;
}

interface GroupWithRelRow extends GroupRow {
  viewer_rel: GroupViewerRelationship;
}

/**
 * The discovery/list read for a viewer: every NON-archived group the viewer may see under its
 * visibility (RFC-005 §3.3), applying {@link isGroupVisibleTo}. The viewer's per-group standing
 * comes from their ACTIVE membership (leader when that membership's role is_leadership). RLS
 * confines the whole query to the active parish.
 */
export async function listVisibleGroups(parishId: string, userId: string): Promise<GatherGroup[]> {
  const cols = GROUP_COLUMNS.split(", ")
    .map((c) => `g.${c}`)
    .join(", ");
  const { rows } = await getDb(parishId).query<GroupWithRelRow>(
    `SELECT ${cols},
       CASE
         WHEN m.id IS NULL THEN 'none'
         WHEN r.is_leadership THEN 'leader'
         ELSE 'member'
       END AS viewer_rel
     FROM gather_groups g
     LEFT JOIN gather_group_members m ON m.group_id = g.id AND m.user_id = $1 AND m.status = 'active'
     LEFT JOIN gather_group_roles r ON r.id = m.role_id
     WHERE g.archived_at IS NULL
     ORDER BY g.name`,
    [userId],
  );
  return rows.filter((r) => isGroupVisibleTo(r.visibility, r.viewer_rel)).map(rowToGroup);
}
