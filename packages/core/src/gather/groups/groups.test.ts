import { describe, expect, it } from "vitest";
import { isGroupVisibleTo } from "./groups";
import type { GroupViewerRelationship } from "./types";

// The pure group-visibility read-filter (RFC-005 §3.3, po-05xo). The DB-backed listVisibleGroups
// applies exactly this predicate, so locking it here pins the discovery rules for core + UI.

const ALL_RELATIONSHIPS: GroupViewerRelationship[] = ["none", "member", "leader"];

describe("isGroupVisibleTo (RFC-005 §3.3)", () => {
  it("public — visible to everyone, whatever their relationship", () => {
    for (const rel of ALL_RELATIONSHIPS) expect(isGroupVisibleTo("public", rel)).toBe(true);
  });

  it("members_only — visible to active members and leaders, hidden from outsiders", () => {
    expect(isGroupVisibleTo("members_only", "none")).toBe(false);
    expect(isGroupVisibleTo("members_only", "member")).toBe(true);
    expect(isGroupVisibleTo("members_only", "leader")).toBe(true);
  });

  it("leaders_only — visible to leadership-role members only", () => {
    expect(isGroupVisibleTo("leaders_only", "none")).toBe(false);
    expect(isGroupVisibleTo("leaders_only", "member")).toBe(false);
    expect(isGroupVisibleTo("leaders_only", "leader")).toBe(true);
  });
});
