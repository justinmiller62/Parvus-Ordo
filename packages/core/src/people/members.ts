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
    user_id: string; display_name: string; email: string; role: Role; ministry_name: string | null;
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
