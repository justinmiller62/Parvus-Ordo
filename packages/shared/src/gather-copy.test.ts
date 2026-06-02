import { describe, expect, it } from "vitest";
import {
  GATHER_INVITATION_COPY,
  GATHER_NEVER_SAY,
  gatherToneViolations,
  REQUEST_ACTION_COPY,
  REQUEST_PRIORITY_COPY,
  REQUEST_STATUS_COPY,
} from "./index";

// Every user-facing Gather copy value defined in shared.
const ALL_COPY: string[] = [
  ...Object.values(GATHER_INVITATION_COPY),
  ...Object.values(REQUEST_STATUS_COPY),
  ...Object.values(REQUEST_PRIORITY_COPY),
  ...Object.values(REQUEST_ACTION_COPY),
];

describe("invitation-first copy guardrail (RFC-005 §4.5/§15)", () => {
  it("never-say list is the locked corporate-task vocabulary", () => {
    expect(GATHER_NEVER_SAY).toEqual(["task", "queue", "overdue", "assigned to you"]);
  });

  it("gatherToneViolations flags banned words (case-insensitive) and passes clean copy", () => {
    expect(gatherToneViolations("This task is overdue")).toEqual(["task", "overdue"]);
    expect(gatherToneViolations("Items in your QUEUE")).toEqual(["queue"]);
    expect(gatherToneViolations("It was assigned to you")).toEqual(["assigned to you"]);
    expect(gatherToneViolations("Maria asked you to help")).toEqual([]);
  });

  it("NO shared copy constant uses corporate-task language", () => {
    for (const phrase of ALL_COPY) {
      expect({ phrase, violations: gatherToneViolations(phrase) }).toEqual({ phrase, violations: [] });
    }
  });

  it("every status / priority / action label is non-empty (no swallowed blank)", () => {
    for (const phrase of ALL_COPY) expect(phrase.trim().length).toBeGreaterThan(0);
  });

  it("surfaces the invitation-first phrases the model promises (§4.5)", () => {
    expect(GATHER_INVITATION_COPY.askedYouToHelp).toBe("asked you to help");
    expect(GATHER_INVITATION_COPY.canYou).toBe("Can you?");
    expect(GATHER_INVITATION_COPY.notThisTime).toBe("Not this time");
    expect(GATHER_INVITATION_COPY.thankYou).toBe("Thank you");
  });
});
