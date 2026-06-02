// Format a `YYYY-MM-DD` calendar date for display WITHOUT timezone drift: parse the
// components as UTC and format in UTC, so a lesson scheduled for the 9th always reads as
// the 9th in any client timezone (the core stores these as Postgres `date` for the same
// reason — see packages/core/src/cohorts/dates.ts).
export function formatCalendarDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString(undefined, {
    timeZone: "UTC",
    ...(opts ?? { month: "short", day: "numeric", year: "numeric" }),
  });
}
