import { describe, expect, it } from "vitest";
import { addMinutes, localDateTime, parseTimeString } from "./time";

describe("parseTimeString", () => {
  it("parses 12-hour times with AM/PM", () => {
    expect(parseTimeString("7:00 PM")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeString("7:00 pm")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeString("9:05 AM")).toEqual({ hour: 9, minute: 5 });
    expect(parseTimeString("11:30 pm")).toEqual({ hour: 23, minute: 30 });
  });

  it("handles the 12 AM/PM edge", () => {
    expect(parseTimeString("12:00 AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeString("12:30 am")).toEqual({ hour: 0, minute: 30 });
    expect(parseTimeString("12:00 PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseTimeString("12:45 pm")).toEqual({ hour: 12, minute: 45 });
  });

  it("parses bare 24-hour times", () => {
    expect(parseTimeString("19:00")).toEqual({ hour: 19, minute: 0 });
    expect(parseTimeString("00:00")).toEqual({ hour: 0, minute: 0 });
    expect(parseTimeString("23:59")).toEqual({ hour: 23, minute: 59 });
    expect(parseTimeString(" 7:15 ")).toEqual({ hour: 7, minute: 15 });
  });

  it("returns null for absent/unparseable times (⇒ all-day)", () => {
    expect(parseTimeString(null)).toBeNull();
    expect(parseTimeString(undefined)).toBeNull();
    expect(parseTimeString("")).toBeNull();
    expect(parseTimeString("noon")).toBeNull();
    expect(parseTimeString("7pm")).toBeNull(); // no minutes
    expect(parseTimeString("7:5 PM")).toBeNull(); // single-digit minute
  });

  it("rejects out-of-range components", () => {
    expect(parseTimeString("25:00")).toBeNull();
    expect(parseTimeString("7:60 PM")).toBeNull();
    expect(parseTimeString("13:00 PM")).toBeNull(); // hour 13 invalid with meridiem
    expect(parseTimeString("0:00 AM")).toBeNull(); // hour 0 invalid with meridiem
  });
});

describe("localDateTime", () => {
  it("formats a zone-free timed ISO string", () => {
    expect(localDateTime("2026-12-25", { hour: 19, minute: 0 })).toBe("2026-12-25T19:00:00");
    expect(localDateTime("2026-01-05", { hour: 9, minute: 5 })).toBe("2026-01-05T09:05:00");
  });
});

describe("addMinutes", () => {
  it("adds within the same day", () => {
    expect(addMinutes("2026-12-25", { hour: 19, minute: 0 }, 60)).toEqual({
      date: "2026-12-25",
      time: { hour: 20, minute: 0 },
    });
  });

  it("rolls the calendar date across midnight", () => {
    expect(addMinutes("2026-12-25", { hour: 23, minute: 30 }, 60)).toEqual({
      date: "2026-12-26",
      time: { hour: 0, minute: 30 },
    });
  });

  it("rolls backward across midnight", () => {
    expect(addMinutes("2026-12-25", { hour: 0, minute: 30 }, -60)).toEqual({
      date: "2026-12-24",
      time: { hour: 23, minute: 30 },
    });
  });
});
