import { describe, expect, it } from "vitest";
import {
  DEFAULT_GROUP_ROLES,
  GATHER_PERMISSIONS,
  GRANT_FREE_PERMISSIONS,
  GROUP_LEADERSHIP_PERMISSIONS,
  GROUP_MEMBER_PERMISSIONS,
  GROUP_TYPES,
  holdsGroupPermission,
  PARISH_SCOPED_PERMISSIONS,
  type GatherPermission,
  type Role,
} from "./index";

// The whole §3.2 union, written out independently of the source so a drift in either
// (a dropped permission, a typo, a duplicate) fails loudly.
const EXPECTED_PERMISSIONS = [
  "group.edit_settings",
  "group.edit_public_profile",
  "group.roster.add",
  "group.roster.invite_new",
  "group.roster.remove",
  "group.roster.assign_role",
  "group.roster.transfer_role",
  "group.roster.approve_join_request",
  "group.roles.define",
  "group.create",
  "group.delete",
  "group.archive",
  "group.self_leave",
  "health_dashboard.view",
  "parishioner.approve_pending",
  "meeting.draft",
  "meeting.finalize",
  "meeting.define_recurrence",
  "meeting.set_quorum",
  "agenda_thread.moderate",
  "signup.create",
  "signup.edit",
  "signup.save_template",
  "signup.instantiate_template",
  "broadcast.send",
  "broadcast.view_read_receipts",
  "document.upload",
  "document.delete",
  "form.create",
  "form.edit",
  "form.delete",
  "form.review_submissions",
  "form.publish_public",
  "form.use_starter_template",
  "form.export_submissions",
  "request.create",
  "request.assign",
  "request.manage_board",
];

describe("GatherPermission union (RFC-005 §3.2)", () => {
  it("is exactly the fixed §3.2 set, with no duplicates", () => {
    expect([...GATHER_PERMISSIONS].sort()).toEqual([...EXPECTED_PERMISSIONS].sort());
    expect(new Set(GATHER_PERMISSIONS).size).toBe(GATHER_PERMISSIONS.length);
  });

  it("classifies parish-scoped + grant-free permissions as §3.2 documents", () => {
    expect([...PARISH_SCOPED_PERMISSIONS].sort()).toEqual(
      ["group.archive", "group.create", "group.delete", "health_dashboard.view", "parishioner.approve_pending"].sort(),
    );
    expect([...GRANT_FREE_PERMISSIONS]).toEqual(["group.self_leave"]);
    // every classified permission is a real member of the union (no orphan strings)
    for (const p of [...PARISH_SCOPED_PERMISSIONS, ...GRANT_FREE_PERMISSIONS]) {
      expect(GATHER_PERMISSIONS).toContain(p);
    }
  });
});

describe("default group role bundles (RFC-005 §3.2)", () => {
  it("excludes group.roles.define from the leadership bundle (separate grant)", () => {
    expect(GROUP_LEADERSHIP_PERMISSIONS).not.toContain("group.roles.define");
  });

  it("never puts a parish-scoped or grant-free permission in the leadership bundle", () => {
    for (const p of GROUP_LEADERSHIP_PERMISSIONS) {
      expect(PARISH_SCOPED_PERMISSIONS.has(p)).toBe(false);
      expect(GRANT_FREE_PERMISSIONS.has(p)).toBe(false);
    }
  });

  it("leadership bundle is exactly every group-instance permission minus roles.define", () => {
    const instanceMinusDefine = GATHER_PERMISSIONS.filter(
      (p) => !PARISH_SCOPED_PERMISSIONS.has(p) && !GRANT_FREE_PERMISSIONS.has(p) && p !== "group.roles.define",
    );
    expect([...GROUP_LEADERSHIP_PERMISSIONS].sort()).toEqual([...instanceMinusDefine].sort());
  });

  it("member bundle lets a member raise a gentle ask, nothing managerial", () => {
    expect(GROUP_MEMBER_PERMISSIONS).toEqual(["request.create"]);
    // self_leave is grant-free (implicit), so it is intentionally NOT listed
    expect(GROUP_MEMBER_PERMISSIONS).not.toContain("group.self_leave");
  });

  it("seeds every group type with one leadership + one member starter role (no permission typos)", () => {
    expect(Object.keys(DEFAULT_GROUP_ROLES).sort()).toEqual([...GROUP_TYPES].sort());
    for (const type of GROUP_TYPES) {
      const roles = DEFAULT_GROUP_ROLES[type];
      expect(roles.filter((r) => r.isLeadership)).toHaveLength(1);
      expect(roles.filter((r) => !r.isLeadership)).toHaveLength(1);
      for (const r of roles) {
        expect(r.label.trim().length).toBeGreaterThan(0);
        for (const p of r.permissions) expect(GATHER_PERMISSIONS).toContain(p);
      }
    }
  });

  it("the leadership starter role carries the full leadership bundle for every type", () => {
    for (const type of GROUP_TYPES) {
      const lead = DEFAULT_GROUP_ROLES[type].find((r) => r.isLeadership);
      expect(lead?.permissions).toBe(GROUP_LEADERSHIP_PERMISSIONS);
    }
  });
});

describe("holdsGroupPermission — requireGroupPermission decision table (RFC-005 §3.2/§3.3)", () => {
  const STAFF: Role[] = ["super_admin", "admin", "catechist"];
  const NON_STAFF: Role[] = ["catechumen_candidate", "parish_member", "studio"];

  it("staff short-circuit: every staff role holds ANY permission, even with no group role", () => {
    for (const role of STAFF) {
      for (const p of GATHER_PERMISSIONS) {
        expect(holdsGroupPermission({ role, permissions: [] }, p)).toBe(true);
      }
    }
  });

  it("instance scoping: a non-staff actor holds only the permissions in THEIR group bundle", () => {
    const actor = { role: "parish_member" as Role, permissions: ["meeting.draft"] as GatherPermission[] };
    expect(holdsGroupPermission(actor, "meeting.draft")).toBe(true);
    expect(holdsGroupPermission(actor, "meeting.finalize")).toBe(false); // not granted in this group
  });

  it("roles.define gate: a default leader does NOT hold group.roles.define; staff does", () => {
    const leader = { role: "parish_member" as Role, permissions: [...GROUP_LEADERSHIP_PERMISSIONS] };
    expect(holdsGroupPermission(leader, "group.roles.define")).toBe(false);
    expect(holdsGroupPermission({ role: "admin", permissions: [] }, "group.roles.define")).toBe(true);
  });

  it("self_leave is grant-free: every non-staff member holds it with no bundle entry", () => {
    for (const role of NON_STAFF) {
      expect(holdsGroupPermission({ role, permissions: [] }, "group.self_leave")).toBe(true);
    }
  });

  it("a parish-scoped permission is never satisfied by a group role (non-staff refused, staff allowed)", () => {
    for (const p of PARISH_SCOPED_PERMISSIONS) {
      // even a misconfigured group role listing it does not grant it to a non-staff actor
      expect(holdsGroupPermission({ role: "parish_member", permissions: [p] }, p)).toBe(false);
      expect(holdsGroupPermission({ role: "admin", permissions: [] }, p)).toBe(true); // parish-staff path
    }
  });

  it("a non-staff actor with an empty bundle holds no instance permission", () => {
    const actor = { role: "parish_member" as Role, permissions: [] as GatherPermission[] };
    for (const p of GATHER_PERMISSIONS) {
      if (GRANT_FREE_PERMISSIONS.has(p)) continue; // self_leave is implicit
      expect(holdsGroupPermission(actor, p)).toBe(false);
    }
  });
});
