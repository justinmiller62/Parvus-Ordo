import { SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signApiToken, verifyApiToken } from "./api-token";

const SECRET = "x".repeat(40);
const DEDICATED = "z".repeat(40);
const CLAIMS = { userId: "u1", email: "a@b.com", parishId: "p1" };

describe("api-token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs and verifies a roundtrip (incl. parish binding)", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const { jwt, expiresAt } = await signApiToken(CLAIMS);
    expect(typeof jwt).toBe("string");
    expect(await verifyApiToken(jwt)).toEqual(CLAIMS);
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a garbage / tampered token", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    expect(await verifyApiToken("not.a.jwt")).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000; // 30-day TTL → expired 10 days ago
    const { jwt } = await signApiToken(CLAIMS, fortyDaysAgo);
    expect(await verifyApiToken(jwt)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const { jwt } = await signApiToken(CLAIMS);
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "y".repeat(40));
    expect(await verifyApiToken(jwt)).toBeNull();
  });

  // po-u79: signing prefers the dedicated API_TOKEN_SECRET over the cookie password.
  // Re-resolve afterward with ONLY the cookie password holding the dedicated value — the
  // token verifies iff it was signed with API_TOKEN_SECRET, not WORKOS_COOKIE_PASSWORD.
  it("signs with API_TOKEN_SECRET when both are set", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    vi.stubEnv("API_TOKEN_SECRET", DEDICATED);
    const { jwt } = await signApiToken(CLAIMS);
    vi.unstubAllEnvs();
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", DEDICATED);
    expect(await verifyApiToken(jwt)).toEqual(CLAIMS);
  });

  // po-u79: once the dedicated secret is provisioned, tokens previously signed under the
  // cookie password no longer verify — the two trust domains are separated.
  it("rejects a cookie-password-signed token once API_TOKEN_SECRET is set", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const { jwt } = await signApiToken(CLAIMS); // signed under the cookie-password fallback
    vi.stubEnv("API_TOKEN_SECRET", DEDICATED); // dedicated secret provisioned later
    expect(await verifyApiToken(jwt)).toBeNull();
  });

  // po-u79: iss/aud pin the token to this surface. A token signed with the right secret
  // but a foreign audience/issuer (e.g. minted for another purpose) is not replayable.
  it("rejects a token with the wrong audience/issuer even when the secret matches", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const foreign = await new SignJWT({ email: "a@b.com", parishId: "p1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer("someone-else")
      .setAudience("some-other-app")
      .setSubject("u1")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));
    expect(await verifyApiToken(foreign)).toBeNull();
  });
});
