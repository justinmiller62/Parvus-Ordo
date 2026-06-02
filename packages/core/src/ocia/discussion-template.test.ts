import { describe, expect, it } from "vitest";
import { SYSTEM_DEFAULT_DISCUSSION_TEMPLATE, resolveDiscussionTemplate } from "@parvaordo/core";

describe("resolveDiscussionTemplate", () => {
  it("uses the lesson template when non-blank (wins over parish)", () => {
    expect(resolveDiscussionTemplate("LESSON", "PARISH")).toBe("LESSON");
  });

  it("falls back to the parish template when the lesson template is blank/null", () => {
    expect(resolveDiscussionTemplate(null, "PARISH")).toBe("PARISH");
    expect(resolveDiscussionTemplate("   ", "PARISH")).toBe("PARISH");
  });

  it("falls back to the system default when both are blank/null", () => {
    expect(resolveDiscussionTemplate(null, null)).toBe(SYSTEM_DEFAULT_DISCUSSION_TEMPLATE);
    expect(resolveDiscussionTemplate("", "   ")).toBe(SYSTEM_DEFAULT_DISCUSSION_TEMPLATE);
    expect(resolveDiscussionTemplate(undefined, undefined)).toBe(SYSTEM_DEFAULT_DISCUSSION_TEMPLATE);
  });
});
