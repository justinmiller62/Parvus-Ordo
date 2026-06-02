import { redirect } from "next/navigation";
import { isAdmin, isStaff } from "@parvaordo/shared";
import { getViewer } from "./viewer";

// Shared role guards for Server Actions and page/route handlers. One definition each,
// so the entry points that gate writes can't drift when a role is added. They build on
// getViewer() (request-cached, so calling a guard alongside a page's own getViewer()
// costs nothing) and return the active-parish write context or redirect away. (po-uha)

/** The active-parish context a write needs: the tenant id + the acting user. */
export interface StaffContext {
  parishId: string;
  userId: string;
}

/**
 * Require parish STAFF (catechist / admin / super_admin) with an active parish. Returns
 * {parishId, userId} for the mutation, or redirects to `redirectTo` (the module's
 * landing — "/" for the parish dashboard, "/ocia" inside OCIA, etc.). Replaces the
 * per-file inline `if (!parishId || !isStaff(role)) redirect()` copies.
 */
export async function requireStaff(redirectTo = "/"): Promise<StaffContext> {
  const id = (await getViewer())?.identity;
  if (!id?.parishId || !id.userId || !isStaff(id.role)) redirect(redirectTo);
  return { parishId: id.parishId, userId: id.userId };
}

/**
 * Require a parish/diocese ADMIN (admin / super_admin) with an active parish — member &
 * role management, invites, settings. Returns {parishId, userId} or redirects to
 * `redirectTo`.
 */
export async function requireAdmin(redirectTo = "/"): Promise<StaffContext> {
  const id = (await getViewer())?.identity;
  if (!id?.parishId || !id.userId || !isAdmin(id.role)) redirect(redirectTo);
  return { parishId: id.parishId, userId: id.userId };
}

/** The acting super-admin: just the user id (the platform admin plane is cross-tenant, so
 *  there is no active parish to return — unlike StaffContext). */
export interface SuperAdminContext {
  userId: string;
}

/**
 * Require a platform SUPER-ADMIN (the `users.is_super_admin` flag — RFC-004 §6). Unlike
 * requireStaff/requireAdmin this needs NO active parish: the admin plane manages every parish
 * cross-tenant. Returns {userId} (the audited actor passed to packages/core platform/admin), or
 * redirects to `redirectTo` ("/" — nav hiding is not enforcement, so every (admin) page AND every
 * admin Server Action calls this). The core layer re-asserts is_super_admin against the DB too.
 */
export async function requireSuperAdmin(redirectTo = "/"): Promise<SuperAdminContext> {
  const id = (await getViewer())?.identity;
  if (!id?.userId || !id.isSuperAdmin) redirect(redirectTo);
  return { userId: id.userId };
}
