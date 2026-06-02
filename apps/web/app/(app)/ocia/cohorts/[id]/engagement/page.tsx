import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getCohortEngagement, getCohortSettings } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

function EmptyState() {
  return (
    <div
      data-testid="cohort-engagement-empty"
      className="animate-[po-fade-in_240ms_ease-out] rounded-lg border-2 border-dashed border-gray-200 bg-white/50 p-16 text-center"
    >
      <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
      <p className="mt-3 font-heading text-lg text-navy">No engagement data yet</p>
      <p className="mt-1 text-sm text-gray-500">
        Students will generate data as they work through this cohort’s lessons.
      </p>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className="mt-1 font-heading text-2xl text-navy">{value}</p>
    </div>
  );
}

/**
 * Catechist/admin engagement dashboard for a WHOLE cohort — every scheduled lesson rolled
 * up (engagement-dashboard "reduced view": summary cards + per-student, no per-step/question).
 * Read path → RSC calling core directly. Role-gated here (admin/catechist/super_admin) AND
 * parish-isolated by RLS inside core (a cohort in another parish 404s via getCohortSettings).
 */
export default async function CohortEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) redirect("/ocia");

  const cohort = await getCohortSettings(parishId, id);
  if (!cohort) notFound();
  const summary = await getCohortEngagement(parishId, id);

  return (
    <div className="mx-auto max-w-5xl">
      <Link href={`/ocia/cohorts/${id}`} className="text-sm text-gray-400 hover:text-navy">
        ← {cohort.name}
      </Link>
      <div className="mt-3 mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-gold" />
          <h1 className="font-heading text-2xl text-navy">Cohort Engagement</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          {cohort.name} · {summary.lessonCount} {summary.lessonCount === 1 ? "lesson" : "lessons"}
        </p>
      </div>

      {summary.totalEvents === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-3" data-testid="cohort-engagement-cards">
            <Card label="Students started" value={String(summary.studentsStarted)} />
            <Card label="Completed all lessons" value={String(summary.studentsCompletedAll)} />
            <Card label="Total events" value={String(summary.totalEvents)} />
          </div>

          <div
            className="overflow-hidden rounded-lg border border-gray-200 bg-white"
            data-testid="cohort-engagement-students"
          >
            <table className="w-full text-sm">
              <thead className="bg-parchment/50 text-left text-xs uppercase tracking-wide text-gray-400">
                <tr>
                  <th className="px-4 py-2 font-medium">Student</th>
                  <th className="px-4 py-2 font-medium">Started</th>
                  <th className="px-4 py-2 font-medium">Completed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {summary.perStudent.map((s) => (
                  <tr key={s.studentId}>
                    <td className="px-4 py-2 text-navy">{s.displayName}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {s.lessonsStarted} / {summary.lessonCount}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {s.lessonsCompleted} / {summary.lessonCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
