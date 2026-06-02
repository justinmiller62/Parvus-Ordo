import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time comparison of two shared secrets. Both sides are hashed to a fixed-width
 * SHA-256 digest first, which (a) keeps `timingSafeEqual` on equal-length buffers — it
 * THROWS on unequal lengths — so a length mismatch returns false instead of crashing, and
 * (b) avoids leaking the secret's length through an early size check. Used by secret-authed
 * machine callbacks that aren't logged-in users (e.g. the OCIA clip cut-service "ready"
 * callback). Fails closed: an empty or mismatched secret returns false.
 */
export function secretsMatch(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
