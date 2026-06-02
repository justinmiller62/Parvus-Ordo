import { describe, expect, it } from "vitest";
import { secretsMatch } from "./secret-compare";

// secretsMatch backs secret-authed machine callbacks (e.g. the OCIA clip cut-service "ready"
// callback). The SHA-256 digest step is load-bearing: timingSafeEqual THROWS on unequal-length
// buffers, so hashing both sides to a fixed 32-byte digest is what lets a length mismatch
// return false instead of crashing — and stops the comparison from leaking the secret length.
describe("secretsMatch", () => {
  it("returns true for identical secrets", () => {
    expect(secretsMatch("s3cr3t-token", "s3cr3t-token")).toBe(true);
    expect(secretsMatch("a", "a")).toBe(true);
  });

  it("returns false for different secrets of the same length", () => {
    expect(secretsMatch("abcdef", "abcdeg")).toBe(false);
    expect(secretsMatch("00000000", "00000001")).toBe(false);
  });

  it("returns false WITHOUT throwing for different-length secrets (the digest prevents the throw)", () => {
    // The whole point of hashing first: timingSafeEqual throws on unequal lengths, so a raw
    // compare here would crash. The fixed-width digest must make this a plain false.
    expect(() => secretsMatch("short", "a-much-longer-secret-value")).not.toThrow();
    expect(secretsMatch("short", "a-much-longer-secret-value")).toBe(false);
    expect(secretsMatch("a-much-longer-secret-value", "short")).toBe(false);
  });

  it("fails closed for an empty provided secret (missing header) against a real secret", () => {
    expect(secretsMatch("", "the-real-secret")).toBe(false);
    expect(secretsMatch("the-real-secret", "")).toBe(false);
  });

  it("matches a realistic high-entropy secret only when identical", () => {
    const real = "ck_live_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
    expect(secretsMatch(real, real)).toBe(true);
    expect(secretsMatch(`${real}x`, real)).toBe(false); // one char longer
    expect(secretsMatch(real.slice(0, -1), real)).toBe(false); // one char shorter
  });
});
