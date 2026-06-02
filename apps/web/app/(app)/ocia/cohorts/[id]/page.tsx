import { notFound, redirect } from "next/navigation";
import {
  getAddableLessons,
  getCohortSchedule,
  getCohortSettings,
  getCohortStudents,
  getPathDetail,
  getPublishedLessons,
  listParishStudents,
  listPaths,
} from "@parvaordo/core";
import { isAdmin, isStaff } from "@parvaordo/shared";
import { getViewer } from "@/src/lib/viewer";
import { CohortDetailClient } from "./cohort-detail-client";

// The cohort cockpit: Lessons / Schedule / Students / Learning Paths / Settings.
// Catechist + admin only; deleting the cohort is admin-only.
export default async function CohortDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !isStaff(role)) redirect("/ocia/cohorts");
  const canDelete = isAdmin(role);

  const settings = await getCohortSettings(parishId, id);
  if (!settings) notFound();

  const [schedule, addable, allLessons, students, roster, pathSummaries] = await Promise.all([
    getCohortSchedule(parishId, id),
    getAddableLessons(parishId, id),
    getPublishedLessons(parishId),
    getCohortStudents(parishId, id),
    listParishStudents(parishId, id),
    listPaths(parishId, id),
  ]);
  const paths = (await Promise.all(pathSummaries.map((p) => getPathDetail(parishId, p.id)))).filter(
    (p): p is NonNullable<typeof p> => p != null,
  );

  return (
    <CohortDetailClient
      cohortId={id}
      settings={settings}
      schedule={schedule}
      addable={addable}
      allLessons={allLessons}
      students={students}
      roster={roster}
      paths={paths}
      canDelete={canDelete}
    />
  );
}
