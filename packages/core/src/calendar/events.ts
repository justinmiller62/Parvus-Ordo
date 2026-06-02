import { compareDates, type ISODate, toISODate } from "../cohorts/dates";
import { getDb } from "../db";
import { addMinutes, localDateTime, parseTimeString } from "./time";
import {
  CALENDAR_EVENT_TYPES,
  type CalendarEvent,
  type CalendarEventType,
  type MergedEvent,
  NARTHEX_SOURCE_LABEL,
} from "./types";
import type { ContentScope } from "../ocia/lessons";

// calendar_events — the parish/diocese "Narthex Events" source. CRUD lives here; the
// React layer calls these from RSC reads + Server Actions. The ghost/observed-date
// expansion is a PURE function (the page never computes it). Writes are parish-scoped by
// RLS; role gating (admin/catechist) is enforced at the Server Action boundary.

interface CalendarEventRow {
  id: string;
  scope: ContentScope;
  title: string;
  event_date: unknown;
  observed_date: unknown;
  event_time: string | null;
  location: string | null;
  event_type: string;
  description: string | null;
  recurrence: string | null;
  created_by: string | null;
}

function normalizeEventType(value: string): CalendarEventType {
  return (CALENDAR_EVENT_TYPES as readonly string[]).includes(value) ? (value as CalendarEventType) : "custom";
}

function rowToEvent(r: CalendarEventRow): CalendarEvent {
  return {
    id: r.id,
    scope: r.scope,
    title: r.title,
    eventDate: toISODate(r.event_date)!,
    observedDate: toISODate(r.observed_date),
    eventTime: r.event_time,
    location: r.location,
    eventType: normalizeEventType(r.event_type),
    description: r.description,
    recurrence: r.recurrence,
    createdBy: r.created_by,
  };
}

const EVENT_COLUMNS = `id, scope, title, event_date, observed_date, event_time, location, event_type, description, recurrence, created_by`;

/**
 * Calendar events visible to the parish (own + diocese + global, via RLS) whose actual OR
 * observed date falls within [rangeStart, rangeEnd]. The observed-date arm keeps a
 * transferred feast in the window when only its celebrated date lands there.
 */
export async function listCalendarEvents(
  parishId: string,
  rangeStart: ISODate,
  rangeEnd: ISODate,
): Promise<CalendarEvent[]> {
  const { rows } = await getDb(parishId).query<CalendarEventRow>(
    `SELECT ${EVENT_COLUMNS} FROM calendar_events
      WHERE (event_date BETWEEN $1::date AND $2::date)
         OR (observed_date IS NOT NULL AND observed_date BETWEEN $1::date AND $2::date)
      ORDER BY event_date`,
    [rangeStart, rangeEnd],
  );
  return rows.map(rowToEvent);
}

/** A single event by id (for the edit-modal prefill). RLS scopes it to the parish. */
export async function getCalendarEvent(parishId: string, id: string): Promise<CalendarEvent | null> {
  const { rows } = await getDb(parishId).query<CalendarEventRow>(
    `SELECT ${EVENT_COLUMNS} FROM calendar_events WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToEvent(rows[0]) : null;
}

export interface CalendarEventInput {
  title: string;
  eventDate: ISODate;
  observedDate?: ISODate | null;
  eventTime?: string | null;
  location?: string | null;
  eventType: CalendarEventType;
  description?: string | null;
  /** Only `"annual"` is meaningful; anything else is stored as null. */
  recurrence?: string | null;
}

const blankToNull = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};

function normalizeInput(input: CalendarEventInput) {
  return {
    title: input.title.trim(),
    eventDate: input.eventDate,
    observedDate: input.observedDate ?? null,
    eventTime: blankToNull(input.eventTime),
    location: blankToNull(input.location),
    eventType: normalizeEventType(input.eventType),
    description: blankToNull(input.description),
    recurrence: input.recurrence === "annual" ? "annual" : null,
  };
}

/** Create a parish-scoped event. Returns its id, or null if RLS rejected the write. */
export async function createCalendarEvent(
  parishId: string,
  createdBy: string,
  input: CalendarEventInput,
): Promise<string | null> {
  const v = normalizeInput(input);
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO calendar_events
       (scope, parish_id, title, event_date, observed_date, event_time, location, event_type, description, recurrence, created_by)
     VALUES ('parish', $1, $2, $3::date, $4::date, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      parishId,
      v.title,
      v.eventDate,
      v.observedDate,
      v.eventTime,
      v.location,
      v.eventType,
      v.description,
      v.recurrence,
      createdBy,
    ],
  );
  return rows[0]?.id ?? null;
}

/** Update a parish-scoped event in place. RLS confines the UPDATE to the active parish. */
export async function updateCalendarEvent(parishId: string, id: string, input: CalendarEventInput): Promise<void> {
  const v = normalizeInput(input);
  await getDb(parishId).query(
    `UPDATE calendar_events
        SET title = $2, event_date = $3::date, observed_date = $4::date, event_time = $5,
            location = $6, event_type = $7, description = $8, recurrence = $9
      WHERE id = $1`,
    [id, v.title, v.eventDate, v.observedDate, v.eventTime, v.location, v.eventType, v.description, v.recurrence],
  );
}

export async function deleteCalendarEvent(parishId: string, id: string): Promise<void> {
  await getDb(parishId).query(`DELETE FROM calendar_events WHERE id = $1`, [id]);
}

/**
 * Expand a stored event into the 1–2 grid entries the calendar renders (PURE — the React
 * layer never computes this):
 *  • A transferred feast (observed_date set and ≠ event_date) yields a faded all-day
 *    "ghost" on the actual date plus the full event on the celebrated (observed) date.
 *  • Otherwise a single entry on event_date.
 * A parseable event_time produces a 1-hour timed block; otherwise the entry is all-day.
 */
export function expandCalendarEvent(event: CalendarEvent): MergedEvent[] {
  const transferred = event.observedDate != null && compareDates(event.observedDate, event.eventDate) !== 0;
  const displayDate = transferred ? event.observedDate! : event.eventDate;
  const time = parseTimeString(event.eventTime);
  const ends = time ? addMinutes(displayDate, time, 60) : null;

  const main: MergedEvent = {
    key: `narthex-${event.id}`,
    title: event.title,
    start: time ? localDateTime(displayDate, time) : displayDate,
    end: ends ? localDateTime(ends.date, ends.time) : displayDate,
    allDay: time == null,
    kind: "narthex",
    source: NARTHEX_SOURCE_LABEL,
    color: null,
    location: event.location,
    description: event.description,
    isGhost: false,
    dbEventId: event.id,
  };
  if (!transferred) return [main];

  const ghost: MergedEvent = {
    key: `narthex-ghost-${event.id}`,
    title: event.title,
    start: event.eventDate,
    end: event.eventDate,
    allDay: true,
    kind: "narthex",
    source: NARTHEX_SOURCE_LABEL,
    color: null,
    location: event.location,
    description: event.description,
    isGhost: true,
    dbEventId: event.id,
  };
  return [ghost, main];
}
