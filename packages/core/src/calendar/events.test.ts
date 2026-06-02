import { describe, expect, it } from "vitest";
import { expandCalendarEvent } from "./events";
import type { CalendarEvent } from "./types";

const base: CalendarEvent = {
  id: "e1",
  scope: "parish",
  title: "Easter Vigil",
  eventDate: "2026-04-04",
  observedDate: null,
  eventTime: null,
  location: "Nave",
  eventType: "liturgical",
  description: "Bring a candle",
  recurrence: null,
  createdBy: "u1",
};

describe("expandCalendarEvent", () => {
  it("renders a single all-day entry when there is no time", () => {
    const [main, ...rest] = expandCalendarEvent(base);
    expect(rest).toHaveLength(0);
    expect(main).toMatchObject({
      key: "narthex-e1",
      start: "2026-04-04",
      end: "2026-04-04",
      allDay: true,
      isGhost: false,
      dbEventId: "e1",
      kind: "narthex",
      source: "Narthex Events",
    });
  });

  it("renders a 1-hour timed block when the time parses", () => {
    const events = expandCalendarEvent({ ...base, eventTime: "7:00 PM" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ start: "2026-04-04T19:00:00", end: "2026-04-04T20:00:00", allDay: false });
  });

  it("falls back to all-day for an unparseable time", () => {
    const events = expandCalendarEvent({ ...base, eventTime: "after vespers" });
    expect(events[0]).toMatchObject({ allDay: true, start: "2026-04-04" });
  });

  it("emits a ghost + full event for a transferred feast", () => {
    const events = expandCalendarEvent({
      ...base,
      title: "St. Joseph",
      eventDate: "2026-03-19", // actual date (a ghost)
      observedDate: "2026-03-20", // celebrated date
      eventTime: "9:00 AM",
    });
    expect(events).toHaveLength(2);
    const ghost = events.find((e) => e.isGhost)!;
    const full = events.find((e) => !e.isGhost)!;
    expect(ghost).toMatchObject({ key: "narthex-ghost-e1", start: "2026-03-19", end: "2026-03-19", allDay: true });
    expect(full).toMatchObject({
      key: "narthex-e1",
      start: "2026-03-20T09:00:00",
      end: "2026-03-20T10:00:00",
      allDay: false,
    });
    // both keep the editable dbEventId so a double-click on either opens the same row
    expect(ghost.dbEventId).toBe("e1");
    expect(full.dbEventId).toBe("e1");
  });

  it("does not split when observed_date equals event_date", () => {
    const events = expandCalendarEvent({ ...base, observedDate: "2026-04-04" });
    expect(events).toHaveLength(1);
    expect(events[0]!.isGhost).toBe(false);
  });
});
