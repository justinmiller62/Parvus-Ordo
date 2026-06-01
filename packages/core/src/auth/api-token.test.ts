import { afterEach, describe, expect, it, vi } from "vitest";
import { signApiToken, verifyApiToken } from "./api-token";

const SECRET = "x".repeat(40);

describe("api-token", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("signs and verifies a roundtrip", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const { jwt, expiresAt } = await signApiToken({ userId: "u1", email: "a@b.com" });
    expect(typeof jwt).toBe("string");
    expect(await verifyApiToken(jwt)).toEqual({ userId: "u1", email: "a@b.com" });
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a garbage / tampered token", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    expect(await verifyApiToken("not.a.jwt")).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000; // 30-day TTL → expired 10 days ago
    const { jwt } = await signApiToken({ userId: "u1", email: "a@b.com" }, fortyDaysAgo);
    expect(await verifyApiToken(jwt)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", SECRET);
    const { jwt } = await signApiToken({ userId: "u1", email: "a@b.com" });
    vi.stubEnv("WORKOS_COOKIE_PASSWORD", "y".repeat(40));
    expect(await verifyApiToken(jwt)).toBeNull();
  });
});
