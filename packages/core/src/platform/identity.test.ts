import { describe, expect, it } from "vitest";
import { pickActiveMembership, type ParishMembership } from "./identity";

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
