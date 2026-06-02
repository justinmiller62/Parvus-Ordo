import { describe, expect, it } from "vitest";
import { type GroupVisibility, type Role } from "@parvaordo/shared";
import { canViewGroup } from "./visibility";

// canViewGroup is the PURE visibility read-filter. The DB-backed canAccessGroup (loads the
// group's visibility + the caller's active membership under RLS) is proven in rbac.int.test.ts.

const STAFF: Role[] = ["super_admin", "admin", "catechist"];
const member = { isLeadership: false };
const leader = { isLeadership: true };

describe("canViewGroup — visibility read-filter (RFC-005 §3.1/§3.3)", () => {
  it("parish staff see every group, at any visibility, even without a membership", () => {
    const visibilities: GroupVisibility[] = ["public", "members_only", "leaders_only"];
    for (const role of STAFF) {
      for (const visibility of visibilities) {
        expect(canViewGroup({ role, visibility, membership: null })).toBe(true);
      }
    }
  });

  it("public: any parish member sees it (member or not)", () => {
    expect(canViewGroup({ role: "parish_member", visibility: "public", membership: null })).toBe(true);
    expect(canViewGroup({ role: "parish_member", visibility: "public", membership: member })).toBe(true);
  });

  it("members_only: an active member sees it; a non-member does not", () => {
    expect(canViewGroup({ role: "parish_member", visibility: "members_only", membership: member })).toBe(true);
    expect(canViewGroup({ role: "parish_member", visibility: "members_only", membership: leader })).toBe(true);
    expect(canViewGroup({ role: "parish_member", visibility: "members_only", membership: null })).toBe(false);
  });

  it("leaders_only: only a leadership-role member sees it — not a plain member, not a non-member", () => {
    expect(canViewGroup({ role: "parish_member", visibility: "leaders_only", membership: leader })).toBe(true);
    expect(canViewGroup({ role: "parish_member", visibility: "leaders_only", membership: member })).toBe(false);
    expect(canViewGroup({ role: "parish_member", visibility: "leaders_only", membership: null })).toBe(false);
  });
});
