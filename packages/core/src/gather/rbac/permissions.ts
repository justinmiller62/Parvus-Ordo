import {
  GRANT_FREE_PERMISSIONS,
  holdsGroupPermission,
  isStaff,
  type GatherPermission,
  type Role,
} from "@parvaordo/shared";
import { getDb } from "../../db/client";
import { enabledModules } from "../../platform/modules";

// ─── Group-scoped RBAC enforcement (RFC-005 §3.2/§3.3) ────────────────────────
//
// The new group-authz subsystem, layered INSIDE the parish tenant. Tenant isolation is RLS
// (getDb(parishId)); GROUP isolation is THIS layer — a permission is held within ONE group
// only (a Grand Knight administers only their own council, never the parish at large). The
// composition order mirrors RFC-004's getViewer discipline and is enforced HERE, in core, so
// it holds on EVERY entry point — including /api/v1 and the public no-login routes, which
// never pass through the web `requireModule` shim (RFC-005 §13 bypass-resistance):
//
//     module-enabled  →  parish RLS (getDb)  →  group permission
//
// The pure permission DECISION lives in @parvaordo/shared (holdsGroupPermission: staff
// implicit-all, instance-scoping, the roles.define separate-grant, self_leave grant-free).
// This module adds the MODULE-ENABLED gate and the async orchestration (load the caller's
// group-role bundle from the DB). Group VISIBILITY is a separate read filter (./visibility).

/** The caller as resolved by the entry-point shim: the active parish, the user, and their
 *  parish role (the staff short-circuit). Mirrors the RFC-005 §3.3 ctx. */
export interface GroupAuthzContext {
  parishId: string;
  userId: string;
  role: Role;
}

/**
 * Raised when a caller lacks a group permission (or the Gather module is disabled for the
 * parish). Maps to 403 at the entry point. Deliberately detail-free so a caller cannot probe
 * which groups exist or which permissions they are missing.
 */
export class GroupPermissionError extends Error {
  constructor(message = "forbidden") {
    super(message);
    this.name = "GroupPermissionError";
  }
}

/**
 * The PURE group-permission decision (unit-tested): the MODULE-ENABLED gate on top of the
 * shared `holdsGroupPermission` contract. A disabled module denies EVERYONE — even parish
 * staff — because the whole module is off for that parish; only once enabled does the staff
 * implicit-all / instance-scoped / roles.define-gated / self_leave-grant-free decision apply.
 */
export function decideGroupPermission(
  input: { moduleEnabled: boolean; role: Role; permissions: readonly GatherPermission[] },
  perm: GatherPermission,
): boolean {
  if (!input.moduleEnabled) return false;
  return holdsGroupPermission({ role: input.role, permissions: input.permissions }, perm);
}

/**
 * Load the caller's group-role permission bundle for `groupId` — empty when they hold no
 * ACTIVE membership, or an active membership with no role assigned. RLS (getDb(parishId))
 * confines the read to the active parish; the `WHERE group_id` keys the INSTANCE, so a role
 * held in ANOTHER group is never loaded here — that is how instance-scoping is enforced.
 * `awaiting_acceptance` / `past` members do not yet / no longer hold their role's
 * permissions, so only `active` membership counts.
 */
export async function loadMemberPermissions(
  parishId: string,
  groupId: string,
  userId: string,
): Promise<readonly GatherPermission[]> {
  const { rows } = await getDb(parishId).query<{ permissions: GatherPermission[] | null }>(
    `SELECT r.permissions
       FROM gather_group_members m
       LEFT JOIN gather_group_roles r ON r.id = m.role_id
      WHERE m.group_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
    [groupId, userId],
  );
  return rows[0]?.permissions ?? [];
}

/**
 * Whether the caller may exercise `perm` in `groupId` (RFC-005 §3.3) — the response-style
 * variant (a route handler returns 403/404 on false). Enforces module-enabled → parish RLS →
 * group permission. A disabled module, parish STAFF (implicit-all), and the grant-free
 * `group.self_leave` are all decided WITHOUT a membership query; everyone else has their
 * group-role bundle loaded and checked against the shared contract.
 */
export async function hasGroupPermission(
  ctx: GroupAuthzContext,
  groupId: string,
  perm: GatherPermission,
): Promise<boolean> {
  const moduleEnabled = (await enabledModules(ctx.parishId)).has("gather");
  // The membership bundle only matters when the outcome can depend on it. A disabled module
  // (denies all), parish staff (implicit-all), and grant-free self_leave are decided without a
  // query — skip the round trip; an empty bundle gives the right answer for each.
  if (!moduleEnabled || isStaff(ctx.role) || GRANT_FREE_PERMISSIONS.has(perm)) {
    return decideGroupPermission({ moduleEnabled, role: ctx.role, permissions: [] }, perm);
  }
  const permissions = await loadMemberPermissions(ctx.parishId, groupId, ctx.userId);
  return decideGroupPermission({ moduleEnabled, role: ctx.role, permissions }, perm);
}

/**
 * Assert the caller may exercise `perm` in `groupId`, else throw {@link GroupPermissionError}
 * (→403). The throw-style gate every Gather mutation shim calls before acting (RFC-005 §3.3).
 */
export async function requireGroupPermission(
  ctx: GroupAuthzContext,
  groupId: string,
  perm: GatherPermission,
): Promise<void> {
  if (!(await hasGroupPermission(ctx, groupId, perm))) {
    throw new GroupPermissionError();
  }
}
