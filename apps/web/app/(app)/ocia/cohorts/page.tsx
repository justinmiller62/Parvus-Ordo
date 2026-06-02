import { redirect } from "next/navigation";
import { listCohortCards } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { CohortsListClient } from "./cohorts-list-client";

// Cohorts — the parish's catechesis groups + their lesson schedules. Staff surface
// (admin/catechist); a learner's schedule is their "My Lessons" view. Admins can create.
export default async function CohortsPage() {
  const viewer = await getViewer();
  const role = viewer?.identity?.role ?? null;
  const parishId = viewer?.identity?.parishId;
  const isStaff = role === "admin" || role === "catechist" || role === "super_admin";
  if (!parishId || !isStaff) redirect("/ocia/lessons");

  const canCreate = role === "admin" || role === "super_admin";
  const cohorts = await listCohortCards(parishId);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">OCIA</p>
        <h1 className="font-heading text-2xl text-navy">Cohorts</h1>
        <p className="mt-1 text-sm text-gray-500">
          Catechesis groups and the schedule that releases lessons to them, week by week.
        </p>
      </div>
      <CohortsListClient cohorts={cohorts} canCreate={canCreate} />
    </div>
  );
}
