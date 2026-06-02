import { addDays, type ISODate } from "../cohorts/dates";

// Free-text time parsing + local-naive datetime composition for calendar events.
// Pure + timezone-immune: we never call `new Date(str)`. A timed event becomes a
// fixed 1-hour block (Narthex stores no end time); an absent/unparseable time is all-day.

const TIME_RE = /^(\d{1,2}):(\d{2})\s*(am|pm)?$/i;

/** Hardcoded duration for a timed event — Narthex never stored an end time (`+ 3600000`). */
export const TIMED_EVENT_DURATION_MIN = 60;

export interface TimeOfDay {
  /** 0–23 */
  hour: number;
  /** 0–59 */
  minute: number;
}

/**
 * Parse a free-text time ("7:00 PM", "19:00", "12:00 am") into 24-hour {hour,minute},
 * or null when absent/unparseable (⇒ the event renders all-day). Mirrors Narthex
 * `parseTimeString` including the 12 AM/PM edge: 12am→00:xx, 12pm→12:xx.
 */
export function parseTimeString(raw: string | null | undefined): TimeOfDay | null {
  if (!raw) return null;
  const m = TIME_RE.exec(raw.trim());
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2]);
  if (minute > 59) return null;
  const ampm = m[3]?.toLowerCase();
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = ampm === "am" ? (hour === 12 ? 0 : hour) : hour === 12 ? 12 : hour + 12;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** A local-naive timed ISO string "YYYY-MM-DDTHH:mm:00" (no zone — client reads as local). */
export function localDateTime(date: ISODate, t: TimeOfDay): string {
  return `${date}T${pad2(t.hour)}:${pad2(t.minute)}:00`;
}

/** Add `minutes` (may be negative) to a (date, time), rolling the calendar date across midnight. */
export function addMinutes(date: ISODate, t: TimeOfDay, minutes: number): { date: ISODate; time: TimeOfDay } {
  const dayMin = 24 * 60;
  const total = t.hour * 60 + t.minute + minutes;
  const dayShift = Math.floor(total / dayMin);
  const within = ((total % dayMin) + dayMin) % dayMin;
  return {
    date: dayShift === 0 ? date : addDays(date, dayShift),
    time: { hour: Math.floor(within / 60), minute: within % 60 },
  };
}
