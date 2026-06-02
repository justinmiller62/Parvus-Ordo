import { describe, expect, it } from "vitest";
import { ADMIN_ROLES, isAdmin, isStaff, STAFF_ROLES, type Role } from "./index";

// Every role, in declaration order, plus the unauthenticated `null` case.
const ALL_ROLES: (Role | null)[] = [
  "super_admin",
  "admin",
  "catechist",
  "catechumen_candidate",
  "parish_member",
  "studio",
  null,
];

// Module → role capability moved entirely into the MODULES registry (MODULES[key].roles)
// and is asserted via moduleAvailable() in module-registry.test.ts; the standalone
// ociaEligible/studioEligible/peopleEligible predicates were removed (RFC-001 §3.5).

describe("isStaff (content-managing parish staff)", () => {
  it("is exactly admins + catechists — not learners, studio creators, members, or signed-out", () => {
    expect(ALL_ROLES.filter((r) => isStaff(r))).toEqual(["super_admin", "admin", "catechist"]);
  });

  it("STAFF_ROLES lists those same roles — the single source the predicate reads", () => {
    expect(STAFF_ROLES).toEqual(["super_admin", "admin", "catechist"]);
  });
});

describe("isAdmin (parish/diocese administrators)", () => {
  it("is exactly admins — a strict subset of staff (catechists are staff but not admins)", () => {
    expect(ALL_ROLES.filter((r) => isAdmin(r))).toEqual(["super_admin", "admin"]);
    expect(isAdmin("catechist")).toBe(false);
  });

  it("ADMIN_ROLES lists those same roles — the single source the predicate reads", () => {
    expect(ADMIN_ROLES).toEqual(["super_admin", "admin"]);
  });
});
