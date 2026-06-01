import { createRemoteJWKSet, jwtVerify } from "jose";
import { lookupAppUser } from "@parvaordo/core";
import type { Role } from "@parvaordo/shared";

// Bearer auth for the public /api/v1 surface consumed by Parvus Studio (iOS).
// The app logs in via WorkOS and sends its access token; we verify it against the
// WorkOS JWKS, resolve the WorkOS user's email, and map to our local user + parish.

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getJwks() {
  if (!jwks) {
    const clientId = process.env.WORKOS_CLIENT_ID;
    if (!clientId) throw new Error("WORKOS_CLIENT_ID is not set");
    jwks = createRemoteJWKSet(new URL(`https://api.workos.com/sso/jwks/${clientId}`));
  }
  return jwks;
}

export interface ApiUser {
  userId: string;
  parishId: string;
  role: Role | null;
  email: string;
}

/** Verify the WorkOS Bearer token → our app user, or null (caller returns 401). */
export async function authenticateApiRequest(req: Request): Promise<ApiUser | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (!m?.[1]) return null;

  let sub: string;
  try {
    const { payload } = await jwtVerify(m[1], getJwks());
    if (!payload.sub) return null;
    sub = String(payload.sub);
  } catch {
    return null;
  }

  // Resolve the WorkOS user's email, then map to our local user/parish.
  const res = await fetch(`https://api.workos.com/user_management/users/${sub}`, {
    headers: { Authorization: `Bearer ${process.env.WORKOS_API_KEY}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const { email } = (await res.json()) as { email?: string };
  if (!email) return null;

  const id = await lookupAppUser(email);
  if (!id?.parishId) return null;
  return { userId: id.userId, parishId: id.parishId, role: id.role, email };
}
