import { lookupAppUser, verifyApiToken } from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";

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
export async function authenticateApiRequest(req: Request): Promise<ApiUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m?.[1]) return null;

  const claims = await verifyApiToken(m[1]);
  if (!claims?.email) return null;

  const id = await lookupAppUser(claims.email);
  if (!id?.parishId) return null;
  return { userId: id.userId, parishId: id.parishId, role: id.role, email: claims.email };
}
