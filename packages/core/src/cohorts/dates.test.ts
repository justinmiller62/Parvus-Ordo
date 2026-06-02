import { describe, expect, it } from "vitest";
import { addDays, compareDates, dayOfWeek, generateWeeklyDates, toISODate, weekdayIndex } from "./dates";

describe("cohort dates — calendar-date helpers (tz-immune)", () => {
  it("toISODate accepts strings and Date objects, rejects junk", () => {
    expect(toISODate("2026-06-02")).toBe("2026-06-02");
    expect(toISODate("2026-06-02T00:00:00.000Z")).toBe("2026-06-02");
    // A Date at local midnight (what pg returns for a `date` column) keeps its calendar day.
    expect(toISODate(new Date(2026, 5, 2))).toBe("2026-06-02");
    expect(toISODate(null)).toBeNull();
    expect(toISODate("not-a-date")).toBeNull();
    expect(toISODate(new Date("nope"))).toBeNull();
  });

  it("addDays does tz-immune arithmetic across month and DST boundaries", () => {
    expect(addDays("2026-06-02", 7)).toBe("2026-06-09");
    expect(addDays("2026-06-02", -1)).toBe("2026-06-01");
    expect(addDays("2026-01-31", 1)).toBe("2026-02-01"); // month rollover
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01"); // year rollover
    // US DST spring-forward (2026-03-08) must NOT drop or duplicate a calendar day.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
  });

  it("dayOfWeek / weekdayIndex agree (0=Sun)", () => {
    expect(dayOfWeek("2026-06-02")).toBe(2); // Tuesday
    expect(weekdayIndex("Tuesday")).toBe(2);
    expect(weekdayIndex("tuesday")).toBe(2);
    expect(weekdayIndex(" Sunday ")).toBe(0);
    expect(weekdayIndex("Funday")).toBeNull();
    expect(weekdayIndex(null)).toBeNull();
  });

  it("compareDates orders calendar dates", () => {
    expect(compareDates("2026-06-02", "2026-06-09")).toBe(-1);
    expect(compareDates("2026-06-09", "2026-06-02")).toBe(1);
    expect(compareDates("2026-06-02", "2026-06-02")).toBe(0);
  });
});

describe("generateWeeklyDates", () => {
  it("starts on the first matching weekday on/after start and steps weekly", () => {
    // 2026-06-01 is a Monday; first Tuesday on/after is 06-02.
    const dates = generateWeeklyDates({
      startDate: "2026-06-01",
      endDate: "2026-07-31",
      discussionDay: "Tuesday",
      lessonCount: 3,
    });
    expect(dates).toEqual(["2026-06-02", "2026-06-09", "2026-06-16"]);
  });

  it("includes the start date itself when it is the matching weekday", () => {
    const dates = generateWeeklyDates({
      startDate: "2026-06-02", // a Tuesday
      endDate: "2026-06-30",
      discussionDay: "Tuesday",
      lessonCount: 10,
    });
    expect(dates[0]).toBe("2026-06-02");
  });

  it("caps by the date window (min of weeks-in-window, lessonCount)", () => {
    // Window holds 3 Tuesdays (02, 09, 16) but we ask for 10 lessons → capped at 3.
    const dates = generateWeeklyDates({
      startDate: "2026-06-01",
      endDate: "2026-06-16",
      discussionDay: "Tuesday",
      lessonCount: 10,
    });
    expect(dates).toEqual(["2026-06-02", "2026-06-09", "2026-06-16"]);
  });

  it("caps by lessonCount when the window is wide", () => {
    const dates = generateWeeklyDates({
      startDate: "2026-06-01",
      endDate: "2026-12-31",
      discussionDay: "Tuesday",
      lessonCount: 2,
    });
    expect(dates).toEqual(["2026-06-02", "2026-06-09"]);
  });

  it("treats a null endDate as no upper bound (capped only by lessonCount)", () => {
    const dates = generateWeeklyDates({
      startDate: "2026-06-01",
      endDate: null,
      discussionDay: "Tuesday",
      lessonCount: 2,
    });
    expect(dates).toEqual(["2026-06-02", "2026-06-09"]);
  });

  it("returns [] when start or day is missing/invalid", () => {
    expect(
      generateWeeklyDates({ startDate: null, endDate: "2026-07-31", discussionDay: "Tuesday", lessonCount: 5 }),
    ).toEqual([]);
    expect(
      generateWeeklyDates({ startDate: "2026-06-01", endDate: null, discussionDay: null, lessonCount: 5 }),
    ).toEqual([]);
    expect(
      generateWeeklyDates({ startDate: "2026-06-01", endDate: null, discussionDay: "Tuesday", lessonCount: 0 }),
    ).toEqual([]);
  });
});
