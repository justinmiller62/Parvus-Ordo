import { describe, expect, it } from "vitest";
import { GROUP_LEADERSHIP_PERMISSIONS, type GatherPermission, type Role } from "@parvaordo/shared";
import { decideGroupPermission } from "./permissions";

// decideGroupPermission is the PURE core of requireGroupPermission: the module-enabled gate on
// top of the shared holdsGroupPermission contract. The DB-backed orchestration (loading the
// group-role bundle, instance isolation across two real groups, RLS) is proven in
// rbac.int.test.ts; here we lock the decision table.

const STAFF: Role[] = ["super_admin", "admin", "catechist"];
const NON_STAFF: Role[] = ["catechumen_candidate", "parish_member", "studio"];

describe("decideGroupPermission — module gate (RFC-005 §3.3)", () => {
  it("a DISABLED module denies everyone — even parish staff with the strongest role", () => {
    for (const role of STAFF) {
      expect(decideGroupPermission({ moduleEnabled: false, role, permissions: [] }, "group.edit_settings")).toBe(false);
      // even self_leave (grant-free) is denied while the whole module is off
      expect(decideGroupPermission({ moduleEnabled: false, role, permissions: [] }, "group.self_leave")).toBe(false);
    }
  });

  it("a disabled module denies even a member who holds the permission in their bundle", () => {
    expect(
      decideGroupPermission(
        { moduleEnabled: false, role: "parish_member", permissions: ["meeting.draft"] },
        "meeting.draft",
      ),
    ).toBe(false);
  });
});

describe("decideGroupPermission — enabled-module decision table (RFC-005 §3.2)", () => {
  it("staff short-circuit: every staff role holds ANY permission with no group role", () => {
    for (const role of STAFF) {
      expect(decideGroupPermission({ moduleEnabled: true, role, permissions: [] }, "group.roles.define")).toBe(true);
      expect(decideGroupPermission({ moduleEnabled: true, role, permissions: [] }, "request.manage_board")).toBe(true);
    }
  });

  it("instance scoping: a non-staff member holds only the permissions in THIS group's bundle", () => {
    const permissions: GatherPermission[] = ["meeting.draft"];
    expect(decideGroupPermission({ moduleEnabled: true, role: "parish_member", permissions }, "meeting.draft")).toBe(
      true,
    );
    // a permission their role does NOT carry in this group → denied (a role in group A grants
    // nothing in group B; here the bundle simply lacks it)
    expect(decideGroupPermission({ moduleEnabled: true, role: "parish_member", permissions }, "meeting.finalize")).toBe(
      false,
    );
  });

  it("roles.define gate: a default leadership member does NOT hold group.roles.define; staff does", () => {
    const leader = {
      moduleEnabled: true,
      role: "parish_member" as Role,
      permissions: [...GROUP_LEADERSHIP_PERMISSIONS],
    };
    expect(decideGroupPermission(leader, "group.roles.define")).toBe(false);
    // but the same leader holds the rest of the leadership bundle
    expect(decideGroupPermission(leader, "group.edit_settings")).toBe(true);
    expect(decideGroupPermission({ moduleEnabled: true, role: "admin", permissions: [] }, "group.roles.define")).toBe(
      true,
    );
  });

  it("self_leave is grant-free: any enabled-module member holds it with an empty bundle", () => {
    for (const role of NON_STAFF) {
      expect(decideGroupPermission({ moduleEnabled: true, role, permissions: [] }, "group.self_leave")).toBe(true);
    }
  });

  it("a parish-scoped permission is never satisfied by a group role (non-staff denied)", () => {
    expect(
      decideGroupPermission(
        { moduleEnabled: true, role: "parish_member", permissions: ["group.create"] },
        "group.create",
      ),
    ).toBe(false);
    expect(decideGroupPermission({ moduleEnabled: true, role: "admin", permissions: [] }, "group.create")).toBe(true);
  });

  it("a non-member (empty bundle, non-staff) holds no instance permission", () => {
    expect(
      decideGroupPermission({ moduleEnabled: true, role: "parish_member", permissions: [] }, "group.edit_settings"),
    ).toBe(false);
  });
});
