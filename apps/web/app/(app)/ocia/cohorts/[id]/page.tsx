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
import { getViewer } from "@/src/lib/viewer";
import { CohortDetailClient } from "./cohort-detail-client";

// The cohort cockpit: Lessons / Schedule / Students / Learning Paths / Settings.
// Catechist + admin only; deleting the cohort is admin-only.
export default async function CohortDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const parishId = viewer?.identity?.parishId;
  const isStaff = role === "admin" || role === "catechist" || role === "super_admin";
  if (!parishId || !isStaff) redirect("/ocia/cohorts");
  const canDelete = role === "admin" || role === "super_admin";

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
