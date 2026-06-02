import { describe, expect, it } from "vitest";
import { ociaEligible, studioEligible, peopleEligible, type Role } from "./index";

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

describe("module eligibility predicates", () => {
  it("ociaEligible: parish staff + OCIA learners (not parish members, studio creators, or signed-out)", () => {
    expect(ALL_ROLES.filter((r) => ociaEligible(r))).toEqual([
      "super_admin",
      "admin",
      "catechist",
      "catechumen_candidate",
    ]);
  });

  it("studioEligible: studio creators + catechists + admins (not OCIA learners or parish members)", () => {
    expect(ALL_ROLES.filter((r) => studioEligible(r))).toEqual(["super_admin", "admin", "catechist", "studio"]);
  });

  it("peopleEligible: admins only", () => {
    expect(ALL_ROLES.filter((r) => peopleEligible(r))).toEqual(["super_admin", "admin"]);
  });

  it("treats a missing role as ineligible for every module", () => {
    expect(ociaEligible(null)).toBe(false);
    expect(studioEligible(null)).toBe(false);
    expect(peopleEligible(null)).toBe(false);
  });
});
