import { GATHER_PERMISSIONS, type GatherPermission } from "@parvaordo/shared";
import { getDb } from "../../db";
import { type DefineGroupRoleInput, type GatherGroupRole, type UpdateGroupRoleInput } from "./types";

// snake_case row + mapper, private to this file (the calendar/events.ts convention).
const toIso = (v: unknown): string => (v instanceof Date ? v.toISOString() : v == null ? "" : String(v));

interface GroupRoleRow {
  id: string;
  parish_id: string;
  group_id: string;
  label: string;
  is_leadership: boolean;
  permissions: string[];
  created_at: unknown;
}

const GROUP_ROLE_COLUMNS = "id, parish_id, group_id, label, is_leadership, permissions, created_at";

function rowToGroupRole(r: GroupRoleRow): GatherGroupRole {
  return {
    id: r.id,
    parishId: r.parish_id,
    groupId: r.group_id,
    label: r.label,
    isLeadership: r.is_leadership,
    permissions: (r.permissions ?? []) as GatherPermission[],
    createdAt: toIso(r.created_at),
  };
}

// Parvus Gather — group role definition (RFC-005 §3.1/§3.2, po-05xo). A role is a named bundle
// of group-scoped permissions; the permission vocabulary lives in the shared contract (po-a9c0),
// so the DB stores a plain text[] and core validates it here (the migration deliberately adds no
// CHECK so the two never drift). Parish-scoped by RLS; authz is the T1-g shim's job.

const VALID_PERMISSIONS: ReadonlySet<string> = new Set(GATHER_PERMISSIONS);

/** Reject any permission outside the GatherPermission union before it reaches the DB (§3.2). */
function assertValidPermissions(permissions: readonly GatherPermission[]): void {
  const unknown = permissions.filter((p) => !VALID_PERMISSIONS.has(p));
  if (unknown.length > 0) throw new Error(`Unknown Gather permission(s): ${unknown.join(", ")}`);
}

/** Define a new role within a group (RFC-005 §3.1). permissions default to none. */
export async function createGroupRole(
  parishId: string,
  groupId: string,
  input: DefineGroupRoleInput,
): Promise<GatherGroupRole> {
  const permissions = input.permissions ?? [];
  assertValidPermissions(permissions);
  const { rows } = await getDb(parishId).query<GroupRoleRow>(
    `INSERT INTO gather_group_roles (parish_id, group_id, label, is_leadership, permissions)
     VALUES ($1, $2, $3, $4, $5::text[])
     RETURNING ${GROUP_ROLE_COLUMNS}`,
    [parishId, groupId, input.label, input.isLeadership ?? false, [...permissions]],
  );
  return rowToGroupRole(rows[0]!);
}

/** Edit a role's label / leadership flag / permission bundle. Only provided fields change. */
export async function updateGroupRole(parishId: string, roleId: string, input: UpdateGroupRoleInput): Promise<void> {
  if (input.permissions !== undefined) assertValidPermissions(input.permissions);
  const sets: string[] = [];
  const params: unknown[] = [];
  const add = (assignment: string, value: unknown): void => {
    params.push(value);
    sets.push(assignment.replace("?", `$${params.length}`));
  };
  if (input.label !== undefined) add("label = ?", input.label);
  if (input.isLeadership !== undefined) add("is_leadership = ?", input.isLeadership);
  if (input.permissions !== undefined) add("permissions = ?::text[]", [...input.permissions]);
  if (sets.length === 0) return;
  params.push(roleId);
  await getDb(parishId).query(`UPDATE gather_group_roles SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

/** All roles defined for a group, leadership roles first then by label (parish-scoped by RLS). */
export async function listGroupRoles(parishId: string, groupId: string): Promise<GatherGroupRole[]> {
  const { rows } = await getDb(parishId).query<GroupRoleRow>(
    `SELECT ${GROUP_ROLE_COLUMNS} FROM gather_group_roles WHERE group_id = $1 ORDER BY is_leadership DESC, label`,
    [groupId],
  );
  return rows.map(rowToGroupRole);
}
