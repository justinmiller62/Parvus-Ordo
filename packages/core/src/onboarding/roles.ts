import type { Role } from "@parvaordo/shared";

/** Roles that can be granted via an invitation. `super_admin` is the app-wide
 * `users.is_super_admin` flag, set out-of-band — never minted through an invite. */
export const INVITABLE_ROLES: Role[] = ["admin", "catechist", "catechumen_candidate", "studio", "parish_member"];

/**
 * May a caller with `callerRole` invite someone as `targetRole` in their parish?
 * - admin / super_admin → any invitable role.
 * - catechist → anyone EXCEPT admin (can't escalate someone to parish admin).
 * - everyone else → no.
 * Pure + testable (the Narthex "teacher cannot mint admin" rule).
 */
export function canInviteRole(callerRole: Role | null, targetRole: Role): boolean {
  if (!INVITABLE_ROLES.includes(targetRole)) return false;
  if (callerRole === "super_admin" || callerRole === "admin") return true;
  if (callerRole === "catechist") return targetRole !== "admin";
  return false;
}
