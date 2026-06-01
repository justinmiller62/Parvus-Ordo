import { SignJWT, jwtVerify } from "jose";

// App-issued bearer token for the public /api/v1 surface (Parvus Studio iOS).
// Long-lived + self-contained so the app can store it in the Keychain and reuse it,
// rather than juggling WorkOS's short-lived access/refresh tokens on-device.
// Signed HS256 with WORKOS_COOKIE_PASSWORD (already a strong, deployed secret).

const TTL_DAYS = 30;

function secret(): Uint8Array {
  const s = process.env.WORKOS_COOKIE_PASSWORD;
  if (!s) throw new Error("WORKOS_COOKIE_PASSWORD is not set (API token signing secret)");
  return new TextEncoder().encode(s);
}

export interface ApiTokenClaims {
  userId: string;
  email: string;
}

/** Mint a 30-day API token. `nowMs` is injectable for tests. */
export async function signApiToken(claims: ApiTokenClaims, nowMs: number = Date.now()): Promise<{ jwt: string; expiresAt: string }> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + TTL_DAYS * 24 * 60 * 60;
  const jwt = await new SignJWT({ email: claims.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret());
  return { jwt, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verify an API token → its claims, or null (expired / tampered / wrong secret). */
export async function verifyApiToken(token: string): Promise<ApiTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return { userId: String(payload.sub), email: String(payload.email ?? "") };
  } catch {
    return null;
  }
}
