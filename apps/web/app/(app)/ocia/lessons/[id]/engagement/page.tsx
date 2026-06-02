import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { BarChart3 } from "lucide-react";
import { getEngagementSummary, getLessonDetail } from "@parvaordo/core";
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
      <p className="mt-1 text-sm text-gray-500">Students will generate data as they work through this lesson.</p>
    </div>
  );
}

/**
 * Catechist/admin engagement dashboard for one lesson (Narthex port: engagement-dashboard).
 *
 * Read path → RSC calling core directly. Role-gated here (admin/catechist/super_admin) AND
 * parish-isolated by RLS inside core: a teacher viewing a lesson owned by a parish they don't
 * belong to gets zero rows — the empty state — never another parish's data. Aggregation is
 * scoped to the lesson's live version so a later edit can't corrupt the per-step numbers.
 */
export default async function LessonEngagementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) redirect("/ocia");

  const lesson = await getLessonDetail(parishId, id);
  if (!lesson) notFound();

  const summary = await getEngagementSummary({ parishId, lessonId: id, versionId: lesson.versionId });

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
        ← Lessons
      </Link>
      <div className="mt-3 mb-6">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-gold" />
          <h1 className="font-heading text-2xl text-navy">Engagement Analytics</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">{lesson.title}</p>
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
