import { getCohortSchedule, type ScheduleEntry } from "../cohorts";
import { getDb } from "../db";
import { addMinutes, localDateTime, parseTimeString } from "./time";
import { COHORT_SOURCE_LABEL, type MergedEvent } from "./types";

// The cohort-schedule overlay — the calendar's third stream, the discussions of the
// cohorts a student belongs to. The Narthex calendar fetched this only for non-editors
// (students); that gate stays at the page (a teacher/admin never requests this). The
// mapping is PURE and reuses po-mf1's getCohortSchedule read model (effective time /
// location already resolved there via COALESCE(override, cohort default)).

/** A cohort schedule entry → the calendar's blue "Cohort Schedule" event (pure). A
 *  parseable effective time gives a 1-hour block; otherwise the discussion is all-day. */
export function scheduleEntryToCalendarEvent(entry: ScheduleEntry): MergedEvent {
  const time = parseTimeString(entry.effectiveTime);
  const ends = time ? addMinutes(entry.discussionDate, time, 60) : null;
  return {
    key: `cohort-${entry.id}`,
    title: entry.title,
    start: time ? localDateTime(entry.discussionDate, time) : entry.discussionDate,
    end: ends ? localDateTime(ends.date, ends.time) : entry.discussionDate,
    allDay: time == null,
    kind: "cohort",
    source: COHORT_SOURCE_LABEL,
    color: null,
    location: entry.effectiveLocation,
    description: null,
    isGhost: false,
    dbEventId: null,
  };
}

/**
 * The student's cohort discussions as calendar events, across every cohort they belong
 * to. Read-only; the page calls this ONLY for students (editors never see the overlay).
 * Tenancy is enforced by RLS via getDb(parishId) and the reused getCohortSchedule.
 */
export async function getStudentCalendarEvents(parishId: string, studentId: string): Promise<MergedEvent[]> {
  const { rows } = await getDb(parishId).query<{ cohort_id: string }>(
    `SELECT m.cohort_id FROM cohort_members m WHERE m.student_id = $1`,
    [studentId],
  );
  const events: MergedEvent[] = [];
  for (const { cohort_id } of rows) {
    const schedule = await getCohortSchedule(parishId, cohort_id);
    for (const entry of schedule) events.push(scheduleEntryToCalendarEvent(entry));
  }
  return events;
}
