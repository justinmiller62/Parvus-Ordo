import { describe, expect, it } from "vitest";
import { authorizeApiToken, pickActiveMembership, type ParishMembership } from "./identity";

const m = (parishId: string, role: ParishMembership["role"], host: string | null = null): ParishMembership => ({
  parishId,
  parishName: parishId,
  parishHostname: host,
  role,
});

describe("pickActiveMembership", () => {
  it("returns null when there are no memberships", () => {
    expect(pickActiveMembership([])).toBeNull();
  });
  it("returns the sole membership automatically", () => {
    const a = m("p1", "admin");
    expect(pickActiveMembership([a])).toBe(a);
  });
  it("an explicit parishId (chooser pick / cookie) wins", () => {
    const a = m("p1", "admin");
    const b = m("p2", "catechist");
    expect(pickActiveMembership([a, b], { parishId: "p2" })).toBe(b);
  });
  it("falls back to the host-resolved parish", () => {
    const a = m("p1", "admin");
    const b = m("p2", "catechist");
    expect(pickActiveMembership([a, b], { hostParishId: "p2" })).toBe(b);
  });
  it("an explicit parishId beats the host-resolved parish", () => {
    const a = m("p1", "admin");
    const b = m("p2", "catechist");
    expect(pickActiveMembership([a, b], { parishId: "p1", hostParishId: "p2" })).toBe(a);
  });
  it("is ambiguous (→ null, show chooser) with 2+ memberships and no hint", () => {
    expect(pickActiveMembership([m("p1", "admin"), m("p2", "catechist")])).toBeNull();
  });
  it("ignores a parishId the user doesn't hold and uses the sole membership", () => {
    const a = m("p1", "admin");
    expect(pickActiveMembership([a], { parishId: "nope" })).toBe(a);
  });
});

// The active parish (and thus the parishId fed to getDb for every RSC read) is steered
// by the client-controlled po_active_parish cookie. The ENTIRE tenant boundary rests on
// pickActiveMembership only honoring a hint that matches one of the user's OWN
// memberships. These pin that invariant so a regression to "trust the raw hint" — which
// would be a cross-tenant escalation — fails CI. (po-h8v)
describe("pickActiveMembership — tenant boundary (forged po_active_parish cookie)", () => {
  const own1 = m("own-1", "admin");
  const own2 = m("own-2", "catechist");

  it("ignores a forged cookie for a foreign parish — stays ambiguous, never a silent pick", () => {
    // 2+ memberships + a hint the user doesn't hold ⇒ null (show the chooser), NOT a
    // fallback to an arbitrary membership and NEVER the forged foreign parish.
    expect(pickActiveMembership([own1, own2], { parishId: "foreign-parish" })).toBeNull();
  });

  it("a forged cookie cannot override a legitimate host-resolved parish", () => {
    expect(pickActiveMembership([own1, own2], { parishId: "foreign-parish", hostParishId: "own-2" })).toBe(own2);
  });

  it("cannot fabricate a parish when BOTH cookie and host are foreign", () => {
    expect(pickActiveMembership([own1, own2], { parishId: "foreign", hostParishId: "also-foreign" })).toBeNull();
  });

  it("only ever returns one of the user's own membership objects (no hint-derived parish)", () => {
    // Referential check: a non-null result must BE an input membership, proving the
    // function selects from memberships and never constructs a parish from a hint.
    const cases: Array<{ parishId?: string; hostParishId?: string }> = [
      { parishId: "foreign-parish" },
      { parishId: "own-1" },
      { hostParishId: "own-2" },
      { parishId: "foreign-parish", hostParishId: "own-1" },
    ];
    for (const opts of cases) {
      const picked = pickActiveMembership([own1, own2], opts);
      if (picked !== null) expect([own1, own2]).toContain(picked);
    }
  });
});

describe("authorizeApiToken", () => {
  it("returns null when the token carries no bound parish", () => {
    const a = m("p1", "admin");
    expect(authorizeApiToken("", [a])).toBeNull();
    expect(authorizeApiToken(null, [a])).toBeNull();
    expect(authorizeApiToken(undefined, [a])).toBeNull();
  });
  it("returns the live membership when the user still belongs to the bound parish", () => {
    const a = m("p1", "admin");
    const b = m("p2", "catechist");
    expect(authorizeApiToken("p2", [a, b])).toBe(b);
  });
  it("cuts off (→ null) a user removed from the bound parish, even if other memberships remain", () => {
    // Token bound to p2, but that membership was removed — only p1 remains (po-u79).
    expect(authorizeApiToken("p2", [m("p1", "admin")])).toBeNull();
  });
  it("returns null when the user has no memberships at all", () => {
    expect(authorizeApiToken("p1", [])).toBeNull();
  });
});
