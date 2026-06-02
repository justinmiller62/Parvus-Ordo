"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { normalizeSacredText } from "@parvaordo/shared";
import type { MergedEvent } from "@parvaordo/core/calendar-types";

// A read-only month view of THIS cohort's schedule (its scheduled lessons, mapped to
// calendar events server-side). The Schedule tab edits the schedule; this tab is the
// at-a-glance calendar. Month nav is local state (a tab, not a routed page). Date math is
// tz-immune (UTC, "YYYY-MM-DD" keys) to match how core emits the LOCAL-naive event dates.

const MONTHS = "January February March April May June July August September October November December".split(" ");
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_MS = 86_400_000;

function parseMonth(month: string): [number, number] {
  const [y, m] = month.split("-").map(Number);
  return [y!, m!];
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = parseMonth(month);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}
function isoUTC(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}
/** 42 dates (6 weeks) from the Sunday on/before the 1st — tz-immune. */
function gridDays(month: string): { iso: string; inMonth: boolean }[] {
  const [y, m] = parseMonth(month);
  const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const start = Date.UTC(y, m - 1, 1) - firstDow * DAY_MS;
  return Array.from({ length: 42 }, (_, i) => {
    const ms = start + i * DAY_MS;
    return { iso: isoUTC(ms), inMonth: new Date(ms).getUTCMonth() === m - 1 };
  });
}

export function CohortCalendar({ events }: { events: MergedEvent[] }) {
  // Open on the earliest scheduled month so the grid isn't empty when the schedule is ahead.
  const firstMonth = useMemo(() => {
    if (events.length === 0) return new Date().toISOString().slice(0, 7);
    return events.map((e) => e.start.slice(0, 7)).sort()[0]!;
  }, [events]);
  const [month, setMonth] = useState(firstMonth);

  const byDay = useMemo(() => {
    const map = new Map<string, MergedEvent[]>();
    for (const e of events) {
      const key = e.start.slice(0, 10);
      (map.get(key) ?? map.set(key, []).get(key)!).push(e);
    }
    for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
    return map;
  }, [events]);

  const days = useMemo(() => gridDays(month), [month]);
  const today = new Date().toISOString().slice(0, 10);
  const [y, m] = parseMonth(month);

  if (events.length === 0) {
    return (
      <div
        data-testid="cohort-calendar-empty"
        className="rounded-2xl border border-dashed border-gray-300 bg-parchment/40 p-10 text-center text-sm text-gray-500"
      >
        No scheduled lessons yet. Add a schedule on the Schedule tab and it will appear here.
      </div>
    );
  }

  return (
    <div data-testid="cohort-calendar" className="motion-safe:animate-[po-fade-in_200ms_ease-out]">
      <div className="mb-3 flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="Previous month"
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-parchment hover:text-navy"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
        <h3 data-testid="cohort-calendar-month" className="min-w-40 text-center font-heading text-lg text-navy">
          {MONTHS[m - 1]} {y}
        </h3>
        <button
          type="button"
          onClick={() => setMonth(shiftMonth(month, 1))}
          aria-label="Next month"
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-parchment hover:text-navy"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-7 overflow-hidden rounded-xl border border-gray-200 bg-white text-sm">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="border-b border-gray-200 bg-parchment/50 py-1.5 text-center text-xs font-medium text-gray-500"
          >
            {d}
          </div>
        ))}
        {days.map(({ iso, inMonth }) => {
          const dayEvents = byDay.get(iso) ?? [];
          return (
            <div
              key={iso}
              className={`min-h-20 border-b border-r border-gray-100 p-1 ${inMonth ? "" : "bg-gray-50/60 text-gray-300"}`}
            >
              <div className={`text-right text-xs ${iso === today ? "font-bold text-burgundy" : "text-gray-400"}`}>
                {Number(iso.slice(8, 10))}
              </div>
              <ul className="mt-0.5 space-y-0.5">
                {dayEvents.map((e) => (
                  <li
                    key={e.key}
                    title={normalizeSacredText(e.title)}
                    className="truncate rounded px-1 py-0.5 text-xs text-white"
                    style={{ backgroundColor: e.color ?? "#2563eb" }}
                  >
                    {!e.allDay ? <span className="opacity-80">{e.start.slice(11, 16)} </span> : null}
                    {normalizeSacredText(e.title)}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
