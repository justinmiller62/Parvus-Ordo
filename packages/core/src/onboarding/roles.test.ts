import { describe, expect, it } from "vitest";
import { canInviteRole } from "./roles";

describe("canInviteRole", () => {
  it("admin and super_admin can invite any invitable role", () => {
    for (const target of ["admin", "catechist", "catechumen_candidate", "parish_member"] as const) {
      expect(canInviteRole("admin", target)).toBe(true);
      expect(canInviteRole("super_admin", target)).toBe(true);
    }
  });

  it("a catechist can invite students/catechists/members but NOT an admin", () => {
    expect(canInviteRole("catechist", "catechumen_candidate")).toBe(true);
    expect(canInviteRole("catechist", "catechist")).toBe(true);
    expect(canInviteRole("catechist", "parish_member")).toBe(true);
    expect(canInviteRole("catechist", "admin")).toBe(false);
  });

  it("learners/members and null roles cannot invite anyone", () => {
    expect(canInviteRole("catechumen_candidate", "catechumen_candidate")).toBe(false);
    expect(canInviteRole("parish_member", "parish_member")).toBe(false);
    expect(canInviteRole(null, "catechumen_candidate")).toBe(false);
  });

  it("super_admin is never invitable, even by an admin", () => {
    expect(canInviteRole("admin", "super_admin")).toBe(false);
    expect(canInviteRole("super_admin", "super_admin")).toBe(false);
  });
});
