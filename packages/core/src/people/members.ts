import { getDb } from "../db/client";
import type { Role } from "@parvaordo/shared";

// People management (catechist/admin console). Parish-scoped via getDb(parishId).

export interface ParishMember {
  userId: string;
  displayName: string;
  email: string;
  role: Role;
  ministryName: string | null;
}

/** Every membership in the parish (one row per membership). */
export async function listParishMembers(parishId: string): Promise<ParishMember[]> {
  const { rows } = await getDb(parishId).query<{
    user_id: string;
    display_name: string;
    email: string;
    role: Role;
    ministry_name: string | null;
  }>(
    `SELECT m.user_id, u.display_name, u.email, m.role, mn.name AS ministry_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
       LEFT JOIN ministries mn ON mn.id = m.ministry_id
      ORDER BY u.display_name, m.role`,
  );
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    role: r.role,
    ministryName: r.ministry_name,
  }));
}

/** Rename a member. Updates the global (RLS-less) users.display_name, so the parish
 * guard is kept SELF-CONTAINED: the EXISTS is scoped to the acting parish ($3)
 * explicitly rather than relying on transitive memberships RLS. The cross-tenant
 * guarantee ("you may only rename a member of THIS parish") then holds on its own
 * terms and survives any future change to memberships RLS (po-73w). */
export async function setMemberName(parishId: string, userId: string, displayName: string): Promise<void> {
  await getDb(parishId).query(
    "UPDATE users SET display_name = $2 WHERE id = $1 AND EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $1 AND m.parish_id = $3)",
    [userId, displayName, parishId],
  );
}

/** Change a member's parish role. */
export async function setMemberRole(parishId: string, userId: string, role: Role): Promise<void> {
  await getDb(parishId).query(
    "UPDATE memberships SET role = $3::membership_role WHERE user_id = $1 AND parish_id = $2",
    [userId, parishId, role],
  );
}

/** Remove a member from the parish (all their memberships here). */
export async function removeMember(parishId: string, userId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM memberships WHERE user_id = $1 AND parish_id = $2", [userId, parishId]);
}
