import { redirect } from "next/navigation";
import { isStaff } from "@parvaordo/shared";
import {
  type CalendarEvent,
  type MergedEvent,
  expandCalendarEvent,
  fetchFeed,
  getStudentCalendarEvents,
  listCalendarEvents,
  listEnabledSources,
  monthWindow,
  parseIcal,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { CalendarClient } from "./calendar-client";

const MONTH_RE = /^\d{4}-\d{2}$/;
// The current month as YYYY-MM (UTC — matches the tz-immune calendar-date convention).
function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

// The unified Calendar: parish/diocese events + the student's cohort schedule + enabled
// iCal feeds, merged server-side for the visible month (± 1). Reads are RSC (no tRPC); the
// three streams normalize to MergedEvent so the client only renders + filters. Month nav is
// a ?month= link, so navigating re-fetches and re-expands feeds (Narthex behavior).
export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await getViewer();
  if (!viewer) redirect("/login");
  const identity = viewer.identity;
  if (!identity?.parishId) redirect("/");
  const parishId = identity.parishId;
  const canEdit = isStaff(identity.role); // Narthex isTeacherOrAdmin

  const sp = await searchParams;
  const month = sp.month && MONTH_RE.test(sp.month) ? sp.month : currentMonth();
  const { rangeStart, rangeEnd } = monthWindow(`${month}-15`);

  // 1) Narthex DB events → expand transferred-feast ghosts.
  const editable: CalendarEvent[] = await listCalendarEvents(parishId, rangeStart, rangeEnd);
  const dbEvents = editable.flatMap(expandCalendarEvent);

  // 2) Cohort schedule overlay — fetched ONLY for non-editors (students), per the spec:
  //    a teacher/admin never sees the blue "Cohort Schedule" layer.
  const cohortEvents: MergedEvent[] = canEdit ? [] : await getStudentCalendarEvents(parishId, identity.userId);

  // 3) External iCal feeds — fetched + parsed server-side per source, best-effort: a feed
  //    that fails to load surfaces a dismissible warning and the rest still renders.
  const sources = await listEnabledSources(parishId);
  const icalEvents: MergedEvent[] = [];
  const failedSources: string[] = [];
  await Promise.all(
    sources.map(async (s) => {
      try {
        const ics = await fetchFeed(s.url);
        icalEvents.push(...parseIcal(ics, { source: s.name, color: s.color, rangeStart, rangeEnd }));
      } catch {
        failedSources.push(s.name);
      }
    }),
  );

  const inWindow = (e: MergedEvent) => {
    const day = e.start.slice(0, 10);
    return day >= rangeStart && day <= rangeEnd;
  };
  const events = [...dbEvents, ...cohortEvents, ...icalEvents].filter(inWindow);

  return (
    <CalendarClient
      month={month}
      events={events}
      editable={editable}
      sources={sources}
      failedSources={failedSources}
      canEdit={canEdit}
    />
  );
}
