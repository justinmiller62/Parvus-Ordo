import type { ISODate } from "../cohorts/dates";
import type { ContentScope } from "../ocia/lessons";

/** The three calendar streams the unified grid merges. */
export type CalendarStream = "narthex" | "cohort" | "ical";

/** event_type is app-enforced (no DB enum); only these three are produced/consumed. */
export type CalendarEventType = "liturgical" | "obligation" | "custom";
export const CALENDAR_EVENT_TYPES: readonly CalendarEventType[] = ["liturgical", "obligation", "custom"];

/** A row of `calendar_events` — the parish/diocese "Narthex Events" source. */
export interface CalendarEvent {
  id: string;
  scope: ContentScope;
  title: string;
  /** The actual calendar date. */
  eventDate: ISODate;
  /** Transferred-feast celebrated date; differs from eventDate ⇒ a ghost is rendered. */
  observedDate: ISODate | null;
  /** Free-text time ("7:00 PM"); null ⇒ all-day. */
  eventTime: string | null;
  location: string | null;
  eventType: CalendarEventType;
  description: string | null;
  /** Only `"annual"` is interpreted by the UI. */
  recurrence: string | null;
  createdBy: string | null;
}

/** A row of `calendar_sources` — an external iCal feed (live-fetched, never persisted). */
export interface CalendarSource {
  id: string;
  scope: ContentScope;
  name: string;
  url: string;
  color: string;
  enabled: boolean;
  displayOrder: number;
}

/**
 * The unified event the calendar grid renders, normalized from any stream. Times are
 * LOCAL-naive ISO strings — `YYYY-MM-DD` for all-day, `YYYY-MM-DDTHH:mm:00` for timed —
 * so the client renders them in its own zone with no UTC shift (the Narthex
 * `new Date(d + 'T00:00:00')` local-midnight convention, made serializable for the
 * RSC→client boundary). The React layer only concatenates these, hides by `source`,
 * and renders: it never computes ghosts, recurrence, or time parsing.
 */
export interface MergedEvent {
  /** Stable, unique key — `narthex-<id>`, `narthex-ghost-<id>`, `cohort-<id>`, `ical-<source>-<n>`. */
  key: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  kind: CalendarStream;
  /** Filter/grouping label: "Narthex Events", "Cohort Schedule", or the iCal source name. */
  source: string;
  color: string | null;
  location: string | null;
  description: string | null;
  /** Faded dashed transferred-feast marker drawn on the actual (un-transferred) date. */
  isGhost: boolean;
  /** Present for editable Narthex DB events (drives double-click-to-edit); null otherwise. */
  dbEventId: string | null;
}

export const NARTHEX_SOURCE_LABEL = "Narthex Events";
export const COHORT_SOURCE_LABEL = "Cohort Schedule";
