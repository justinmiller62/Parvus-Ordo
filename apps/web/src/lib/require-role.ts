import { redirect } from "next/navigation";
import { isAdmin, isStaff, MODULES, type ModuleKey } from "@parvaordo/shared";
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
export async function requireStaff(redirectTo = "/", module?: ModuleKey): Promise<StaffContext> {
  if (module) await requireModule(module); // disabled module → home (locked override), regardless of redirectTo
  const id = (await getViewer())?.identity;
  if (!id?.parishId || !id.userId || !isStaff(id.role)) redirect(redirectTo);
  return { parishId: id.parishId, userId: id.userId };
}

/**
 * Require a parish/diocese ADMIN (admin / super_admin) with an active parish — member &
 * role management, invites, settings. Returns {parishId, userId} or redirects to
 * `redirectTo`.
 */
export async function requireAdmin(redirectTo = "/", module?: ModuleKey): Promise<StaffContext> {
  if (module) await requireModule(module); // disabled module → home (locked override), regardless of redirectTo
  const id = (await getViewer())?.identity;
  if (!id?.parishId || !id.userId || !isAdmin(id.role)) redirect(redirectTo);
  return { parishId: id.parishId, userId: id.userId };
}

/**
 * Require that a TOGGLEABLE module is enabled for the active parish — the defense-in-depth
 * layer-2 gate (RFC-001 §3.5): nav hiding is not enforcement, so every page layout, Server
 * Action, and API/MCP entry that touches a toggleable module's data must gate on this.
 * Always-on modules (MODULES[key].toggleable === false — dictionary/prayers/onboarding/people)
 * are a no-op. A disabled module redirects HOME for BOTH deep links and top-level entry
 * (locked override po-wisp-rrwul, superseding the RFC's 404-for-deep-links). Enablement is the
 * parish's property and role-INDEPENDENT (role is the separate requireStaff/requireAdmin gate);
 * it comes from getViewer().enabledModules, resolved once per request off the EFFECTIVE parishId.
 */
export async function requireModule(key: ModuleKey, redirectTo = "/"): Promise<void> {
  if (!MODULES[key].toggleable) return; // always-on capability: no gate
  const enabled = (await getViewer())?.enabledModules;
  if (!enabled?.has(key)) redirect(redirectTo);
}
