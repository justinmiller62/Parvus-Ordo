// Calendar-date arithmetic for cohort scheduling. Pure + timezone-immune.
//
// Cohort schedule columns are Postgres `date` (a calendar date, no time, no zone).
// The Narthex port note is explicit: a lesson scheduled for a given date must show
// on that exact date in ANY client timezone, or weeks drift by a day. So we model a
// calendar date as a `YYYY-MM-DD` string and do all arithmetic in UTC (parsing to
// Date.UTC, never local), which is immune to the host/DST timezone. We never call
// `new Date(str)` (local-midnight parsing — the exact bug the spec warns about).

/** A calendar date with no time/zone, formatted `YYYY-MM-DD`. */
export type ISODate = string;

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Coerce a value to a `YYYY-MM-DD` calendar-date string, or null.
 * Accepts an existing `YYYY-MM-DD` string OR a JS `Date` (the `pg` driver returns
 * `date` columns as a Date at LOCAL midnight, so we read its LOCAL y/m/d — that is
 * the calendar date the driver intended — and reformat without any zone shift).
 */
export function toISODate(value: unknown): ISODate | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const y = value.getFullYear();
    const m = value.getMonth() + 1;
    const d = value.getDate();
    return `${y.toString().padStart(4, "0")}-${m.toString().padStart(2, "0")}-${d.toString().padStart(2, "0")}`;
  }
  const s = String(value).slice(0, 10);
  return ISO_DATE_RE.test(s) ? s : null;
}

/** Parse `YYYY-MM-DD` to a UTC-midnight epoch (ms) for tz-immune math. null if invalid. */
function toUtcMs(date: ISODate): number | null {
  const m = ISO_DATE_RE.exec(date);
  if (!m) return null;
  const [, y, mo, d] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  // Guard against rollover (e.g. 2026-02-31 → Mar 3): round-trip must match.
  const back = fromUtcMs(ms);
  return back === date ? ms : null;
}

function fromUtcMs(ms: number): ISODate {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  return `${y.toString().padStart(4, "0")}-${mo.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

const DAY_MS = 86_400_000;

/** Add `n` days (may be negative) to a calendar date. Returns the input unchanged-shape on invalid. */
export function addDays(date: ISODate, n: number): ISODate {
  const ms = toUtcMs(date);
  if (ms == null) return date;
  return fromUtcMs(ms + n * DAY_MS);
}

/** Day-of-week index, 0 = Sunday … 6 = Saturday. null if the date is invalid. */
export function dayOfWeek(date: ISODate): number | null {
  const ms = toUtcMs(date);
  if (ms == null) return null;
  return new Date(ms).getUTCDay();
}

/** Map a weekday name (case-insensitive, e.g. "Tuesday") to 0–6. null if unknown. */
export function weekdayIndex(name: string | null | undefined): number | null {
  if (!name) return null;
  const i = WEEKDAYS.findIndex((w) => w.toLowerCase() === name.trim().toLowerCase());
  return i === -1 ? null : i;
}

/** a < b ? -1 : a > b ? 1 : 0, comparing calendar dates lexically (ISO sorts correctly). */
export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Today as a calendar date. The ONLY clock-reading function here (everything else is
 * pure and takes `today` as a parameter so it stays unit-testable). Uses the UTC date,
 * matching Narthex's `new Date().toISOString().split('T')[0]`; this can sit a day off
 * for far-western parishes near midnight until per-parish timezones exist.
 */
export function todayISODate(): ISODate {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Auto-generate weekly discussion dates (Narthex `generateSchedule`):
 * find the first `discussionDay` weekday on/after `startDate`, then step +7 days,
 * stopping when either `endDate` is passed (inclusive, when provided) OR `lessonCount`
 * dates have been produced. The count is therefore capped by BOTH the date window and
 * the number of lessons. Returns [] if inputs are missing/invalid.
 *
 * Narthex required start_date + discussion_day but read end_date unguarded (a null
 * end produced zero rows); here a null `endDate` means "no upper window bound", so the
 * count is bounded only by `lessonCount` — the sensible reading of the same intent.
 */
export function generateWeeklyDates(opts: {
  startDate: ISODate | null;
  endDate: ISODate | null;
  discussionDay: string | null;
  lessonCount: number;
}): ISODate[] {
  const { startDate, endDate, discussionDay, lessonCount } = opts;
  const dayIdx = weekdayIndex(discussionDay);
  if (!startDate || dayIdx == null || lessonCount <= 0) return [];
  let cursorMs = toUtcMs(startDate);
  if (cursorMs == null) return [];
  const endMs = endDate ? toUtcMs(endDate) : null;
  if (endDate && endMs == null) return [];

  // Advance to the first matching weekday on/after the start date.
  while (new Date(cursorMs).getUTCDay() !== dayIdx) cursorMs += DAY_MS;

  const dates: ISODate[] = [];
  while (dates.length < lessonCount && (endMs == null || cursorMs <= endMs)) {
    dates.push(fromUtcMs(cursorMs));
    cursorMs += 7 * DAY_MS;
  }
  return dates;
}
