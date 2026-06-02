import { SignJWT, jwtVerify } from "jose";

// App-issued bearer token for the public /api/v1 surface (Parvus Studio iOS).
// Long-lived + self-contained so the app can store it in the Keychain and reuse it,
// rather than juggling WorkOS's short-lived access/refresh tokens on-device.
//
// Signed HS256 with a DEDICATED secret (API_TOKEN_SECRET) kept distinct from the WorkOS
// session-cookie password, so a leak of one trust domain doesn't compromise the other
// (po-u79). Until API_TOKEN_SECRET is provisioned per environment we fall back to
// WORKOS_COOKIE_PASSWORD, so shipping this is a no-op deploy; setting API_TOKEN_SECRET
// to a fresh value rotates the signing key (outstanding tokens stop verifying → clients
// re-login). `iss`/`aud` pin the token to this issuer and the app surface, so a token
// minted for any other purpose can never be replayed here even if a secret were shared.
//
// TTL is intentionally left at 30 days: there is no on-device refresh endpoint yet
// (that needs a companion-app change), so shortening it is a pure UX regression. The
// long-TTL risk is instead mitigated by revocation levers added in po-u79 — parish
// binding + per-request membership re-validation (authorizeApiToken) cut off a removed
// user on their next call, and rotating API_TOKEN_SECRET invalidates every token at once.

const TTL_DAYS = 30;
const ISSUER = "parvaordo";
const AUDIENCE = "parvus-studio-app";

function secret(): Uint8Array {
  // Prefer the dedicated API-token secret; fall back to the cookie password until the
  // dedicated secret is provisioned in this environment (safe, no-op rollout).
  const s = process.env.API_TOKEN_SECRET ?? process.env.WORKOS_COOKIE_PASSWORD;
  if (!s) throw new Error("API_TOKEN_SECRET (or WORKOS_COOKIE_PASSWORD) is not set (API token signing secret)");
  return new TextEncoder().encode(s);
}

export interface ApiTokenClaims {
  userId: string;
  email: string;
  /** Parish the token is bound to (the user's parish at mint time). Re-validated against
   *  the user's live memberships on every request, so a removed user is cut off. */
  parishId: string;
}

/** Mint a 30-day API token. `nowMs` is injectable for tests. */
export async function signApiToken(claims: ApiTokenClaims, nowMs: number = Date.now()): Promise<{ jwt: string; expiresAt: string }> {
  const iat = Math.floor(nowMs / 1000);
  const exp = iat + TTL_DAYS * 24 * 60 * 60;
  const jwt = await new SignJWT({ email: claims.email, parishId: claims.parishId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(claims.userId)
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .sign(secret());
  return { jwt, expiresAt: new Date(exp * 1000).toISOString() };
}

/** Verify an API token → its claims, or null (expired / tampered / wrong secret / wrong
 *  issuer or audience). Authorization (live membership in the bound parish) is enforced
 *  separately by authorizeApiToken at the request boundary. */
export async function verifyApiToken(token: string): Promise<ApiTokenClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub) return null;
    return {
      userId: String(payload.sub),
      email: String(payload.email ?? ""),
      parishId: String(payload.parishId ?? ""),
    };
  } catch {
    return null;
  }
}
