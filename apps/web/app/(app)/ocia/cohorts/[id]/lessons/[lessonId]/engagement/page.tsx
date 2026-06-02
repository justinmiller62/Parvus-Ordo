import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { getCohortSettings, getEngagementSummary, getLessonDetail } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import {
  CompletionDonut,
  ContentTypeBars,
  PerStepBars,
  QuestionTable,
  StudentTable,
  SummaryCards,
} from "@/src/components/ocia/engagement-charts";

function EmptyState() {
  return (
    <div
      data-testid="engagement-empty"
      className="animate-[po-fade-in_240ms_ease-out] rounded-lg border-2 border-dashed border-gray-200 bg-white/50 p-16 text-center"
    >
      <BarChart3 className="mx-auto h-10 w-10 text-gray-300" />
      <p className="mt-3 font-heading text-lg text-navy">No engagement data yet</p>
      <p className="mt-1 text-sm text-gray-500">
        This cohort’s students will generate data as they work through the lesson.
      </p>
    </div>
  );
}

/**
 * One lesson's engagement scoped to ONE cohort — the richest engagement view
 * (engagement-dashboard.md). Same posture as the lesson-level page: role-gated
 * (catechist/admin/super_admin) AND parish-isolated by RLS inside core; the cohort filter
 * narrows to events stamped with this cohort_id (po-ux49). The route lives under
 * cohorts/[id] (the standardized cohort slug — NOT [cohortId]) to avoid a sibling-slug
 * collision; the lesson is [lessonId] one level down.
 */
export default async function CohortLessonEngagementPage({
  params,
}: {
  params: Promise<{ id: string; lessonId: string }>;
}) {
  const { id: cohortId, lessonId } = await params;

  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) redirect("/ocia");

  const [lesson, cohort] = await Promise.all([
    getLessonDetail(parishId, lessonId),
    getCohortSettings(parishId, cohortId),
  ]);
  if (!lesson || !cohort) notFound();

  const summary = await getEngagementSummary({ parishId, lessonId, versionId: lesson.versionId, cohortId });

  return (
    <div className="mx-auto max-w-5xl">
      <Link
        href={`/ocia/cohorts/${cohortId}`}
        data-testid="back-to-cohort"
        className="inline-flex items-center gap-1 text-sm text-gray-400 hover:text-navy"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to cohort
      </Link>
      <div className="mt-3 mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-gold" />
          <h1 className="font-heading text-2xl text-navy">Engagement Analytics</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500" data-testid="cohort-engagement-subtitle">
          {lesson.title} <span className="text-navy">— {cohort.name}</span>
        </p>
      </div>

      {summary.totalEvents === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-6">
          <SummaryCards s={summary} />
          <div className="grid gap-6 lg:grid-cols-2">
            <CompletionDonut
              completed={summary.studentsCompleted}
              inProgress={summary.inProgress}
              rate={summary.completionRate}
            />
            <ContentTypeBars data={summary.byContentType} />
          </div>
          <PerStepBars steps={summary.perStep} />
          <QuestionTable questions={summary.perQuestion} />
          <StudentTable students={summary.perStudent} />
        </div>
      )}
    </div>
  );
}
