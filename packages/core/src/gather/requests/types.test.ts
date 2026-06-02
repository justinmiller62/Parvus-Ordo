import { describe, expect, it } from "vitest";
import { nextRecurrenceDate, parseRecurrence } from "./types";

// Pure-logic coverage for the recurrence rule. The DB spine (createRequestable, transitions,
// queries, recurrence regen, RLS) is exercised in requests.int.test.ts.

describe("parseRecurrence", () => {
  it("accepts a well-formed rule and floors `every`", () => {
    expect(parseRecurrence({ every: 2, unit: "week" })).toEqual({ every: 2, unit: "week" });
    expect(parseRecurrence({ every: 3.9, unit: "day" })).toEqual({ every: 3, unit: "day" });
    expect(parseRecurrence({ every: 1, unit: "month" })).toEqual({ every: 1, unit: "month" });
  });

  it("rejects absent / malformed rules as null (never blocks the done-transition)", () => {
    expect(parseRecurrence(null)).toBeNull();
    expect(parseRecurrence(undefined)).toBeNull();
    expect(parseRecurrence({})).toBeNull();
    expect(parseRecurrence({ every: 0, unit: "day" })).toBeNull();
    expect(parseRecurrence({ every: 2, unit: "year" })).toBeNull();
    expect(parseRecurrence({ every: "2", unit: "day" })).toBeNull();
    expect(parseRecurrence("weekly")).toBeNull();
  });
});

describe("nextRecurrenceDate", () => {
  it("advances by days / weeks / months (UTC, calendar-stable)", () => {
    expect(nextRecurrenceDate("2026-01-01", { every: 1, unit: "day" })).toBe("2026-01-02");
    expect(nextRecurrenceDate("2026-01-01", { every: 2, unit: "week" })).toBe("2026-01-15");
    expect(nextRecurrenceDate("2026-01-15", { every: 1, unit: "month" })).toBe("2026-02-15");
    expect(nextRecurrenceDate("2026-12-20", { every: 1, unit: "month" })).toBe("2027-01-20"); // year rollover
  });

  it("returns the input unchanged for an unparseable date", () => {
    expect(nextRecurrenceDate("not-a-date", { every: 1, unit: "day" })).toBe("not-a-date");
  });
});
