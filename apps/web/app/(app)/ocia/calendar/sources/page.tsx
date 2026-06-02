import { listAllSources } from "@parvaordo/core";
import { requireStaff } from "@/src/lib/require-role";
import { SourcesClient } from "./sources-client";

// Manage external iCal feeds (calendar_sources). Editor-only: requireStaff redirects
// students/parish members back to the calendar. The Calendar page itself only ever lists
// ENABLED feeds (listEnabledSources); this is the sole surface that creates, edits,
// enable-toggles, or deletes them — so disabled feeds never leak to a student.
export default async function CalendarSourcesPage() {
  const { parishId } = await requireStaff("/ocia/calendar");
  const sources = await listAllSources(parishId);
  return <SourcesClient sources={sources} />;
}
