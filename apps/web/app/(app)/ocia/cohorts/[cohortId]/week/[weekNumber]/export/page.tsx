import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, BookOpen, HelpCircle, MessageSquare, Sparkles } from "lucide-react";
import { buildWeeklyExport, renderWeeklyExportMarkdown, type PathWeekData } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { WeeklyExportPanel } from "@/src/components/ocia/weekly-export-panel";

function Stat({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-parchment px-2.5 py-0.5 text-xs font-medium text-gray-600">
      {icon}
      {label}
    </span>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      data-testid="weekly-export-empty"
      className="mt-6 rounded-xl border border-dashed border-gray-300 bg-white/60 p-10 text-center"
    >
      <BookOpen className="mx-auto h-8 w-8 text-gray-300" />
      <p className="mt-3 text-sm text-gray-500">{message}</p>
    </div>
  );
}

function PathCard({ path, multiPath, index }: { path: PathWeekData; multiPath: boolean; index: number }) {
  return (
    <article
      data-testid="export-path-card"
      style={{ animationDelay: `${Math.min(index, 6) * 60}ms` }}
      className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md motion-safe:animate-[po-slide-up_280ms_ease-out] motion-safe:[animation-fill-mode:backwards]"
    >
      {multiPath ? (
        <p className="mb-0.5 text-xs font-semibold uppercase tracking-wide text-rose">{path.pathName}</p>
      ) : null}
      <h3 className="font-heading text-lg text-navy">{path.lessonTitle}</h3>
      {path.lessonDescription ? <p className="mt-1 text-sm text-gray-500">{path.lessonDescription}</p> : null}
      <div className="mt-3 flex flex-wrap gap-1.5">
        <Stat
          icon={<BookOpen className="h-3.5 w-3.5 text-gold-dark" />}
          label={`${path.readingBlocks.length} reading`}
        />
        <Stat
          icon={<HelpCircle className="h-3.5 w-3.5 text-navy" />}
          label={`${path.questions.length} question${path.questions.length === 1 ? "" : "s"}`}
        />
        <Stat
          icon={<MessageSquare className="h-3.5 w-3.5 text-rose" />}
          label={`${path.answerCount} answer${path.answerCount === 1 ? "" : "s"}`}
        />
      </div>
    </article>
  );
}

export default async function WeeklyExportPage({
  params,
}: {
  params: Promise<{ cohortId: string; weekNumber: string }>;
}) {
  const { cohortId, weekNumber } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  // Teacher-only view of student responses — same gate as the student-responses
  // inbox (ocia/lessons/[id]/responses). Students/learners are redirected away.
  if (!parishId || !(role === "catechist" || role === "admin" || role === "super_admin")) redirect("/ocia");

  const week = Number.parseInt(weekNumber ?? "1", 10);
  const validWeek = Number.isInteger(week) && week >= 1;
  const data = validWeek ? await buildWeeklyExport(parishId, { cohortId, week }) : null;
  const paths = data?.paths ?? [];
  const multiPath = paths.length > 1;

  return (
    <div className="mx-auto max-w-3xl motion-safe:animate-[po-fade-in_220ms_ease-out]">
      <Link
        href="/ocia"
        className="inline-flex items-center gap-1 text-sm text-gray-400 transition-colors hover:text-navy"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to OCIA
      </Link>

      <header className="mt-3" data-testid="weekly-export-header">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gold-dark">
          <Sparkles className="h-3.5 w-3.5" />
          Weekly Export
        </p>
        <h1 className="mt-1 font-heading text-2xl text-navy">
          {validWeek ? `Week ${week} Discussion` : "Discussion Export"}
        </h1>
        {data ? (
          <p className="mt-1 text-sm text-gray-500">
            {data.cohortName ? <span className="text-navy">{data.cohortName}</span> : "Cohort"}
            {paths.length > 0 ? (
              <>
                {" · "}
                {paths.length} {paths.length === 1 ? "path" : "paths"}
                {" · "}
                {data.totalAnswers} {data.totalAnswers === 1 ? "answer" : "answers"}
              </>
            ) : null}
          </p>
        ) : null}
      </header>

      {!validWeek ? (
        <EmptyState message="That week number isn’t valid." />
      ) : paths.length === 0 ? (
        <EmptyState
          message={
            data!.cohortName
              ? `No learning paths have lessons assigned for week ${week}.`
              : "This cohort isn’t available."
          }
        />
      ) : (
        <>
          <section className="mt-6 space-y-3">
            {paths.map((p, i) => (
              <PathCard key={p.pathId} path={p} multiPath={multiPath} index={i} />
            ))}
          </section>

          <p className="mt-6 mb-2 text-sm text-gray-500">
            Copy this bundle and paste it into your AI assistant to generate a discussion guide.
          </p>
          <WeeklyExportPanel markdown={renderWeeklyExportMarkdown(data!)} />
        </>
      )}
    </div>
  );
}
