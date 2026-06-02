import { authorizeApiToken, enabledModules, lookupAppUser, verifyApiToken } from "@parvaordo/core";
import type { ModuleKey, Role } from "@parvaordo/shared";

// Bearer auth for the public /api/v1 surface consumed by Parvus Studio (iOS).
// The app logs in via POST /api/v1/auth/login and receives an app-issued token
// (signed by core/auth/api-token); we verify it and map the email to our user.

export interface ApiUser {
  userId: string;
  parishId: string;
  role: Role | null;
  email: string;
}

/** Verify the Bearer app token → our app user, or null (caller returns 401). */
export async function authenticateApiRequest(req: Request, module?: ModuleKey): Promise<ApiUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m?.[1]) return null;

  const claims = await verifyApiToken(m[1]);
  if (!claims?.email) return null;

  // Re-read identity from the DB every request (nothing trusted is cached in the token)
  // and re-validate the token's bound parish against live memberships, so a user removed
  // from that parish is cut off on their next call (po-u79). The matched membership's
  // role — not a stale token claim — is authoritative for the request.
  const id = await lookupAppUser(claims.email);
  if (!id) return null;
  const membership = authorizeApiToken(claims.parishId, id.memberships);
  if (!membership) return null;
  // RFC-001 §3.5: a disabled module rejects direct API calls too, it doesn't merely hide nav.
  // The bearer identity's parish must have the (toggleable) module enabled. (po-7diw)
  if (module && !(await enabledModules(membership.parishId)).has(module)) return null;
  return { userId: id.userId, parishId: membership.parishId, role: membership.role, email: claims.email };
}
