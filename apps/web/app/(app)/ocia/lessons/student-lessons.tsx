import Link from "next/link";
import { ChevronDown, Lock } from "lucide-react";
import type { StudentLesson, StudentLessonSections } from "@parvaordo/core";

// Per-lesson progress badge. Locked lessons render their own treatment (see DueRow),
// so this only covers the three progress states getStudentLessons reports.
const STATUS: Record<StudentLesson["status"], { label: string; badge: string }> = {
  not_started: { label: "Not started", badge: "bg-gray-100 text-gray-500" },
  started: { label: "In progress", badge: "bg-amber-100 text-amber-700" },
  completed: { label: "Completed", badge: "bg-green-100 text-green-700" },
};

/**
 * The student's "My Lessons" surface. It renders the already-gated output of
 * getStudentLessons (release/sequential/path gating, schedule order) — no gating is
 * re-derived here. Lessons split into Due (to-do, locked ones included) and a
 * collapsed-by-default Completed section; "All caught up!" shows when nothing is due.
 */
export function StudentLessons({ due, completed }: StudentLessonSections) {
  const total = due.length + completed.length;

  if (total === 0) {
    return (
      <Shell>
        <div
          data-testid="lesson-empty-state"
          className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center"
        >
          <p className="text-sm text-gray-500">No lessons available yet. Check back soon.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="space-y-6">
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Due{due.length > 0 ? ` · ${due.length}` : ""}
          </h2>
          {due.length === 0 ? (
            <div
              data-testid="lesson-all-caught-up"
              className="rounded-lg border border-gray-200 bg-white px-6 py-10 text-center"
            >
              <p className="text-sm font-medium text-navy">All caught up!</p>
              <p className="mt-1 text-xs text-gray-500">You&apos;ve finished everything released so far.</p>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
              {due.map((lesson, i) => (
                <DueRow key={lesson.lessonId} lesson={lesson} index={i + 1} />
              ))}
            </ul>
          )}
        </section>

        {completed.length > 0 ? (
          <details
            data-testid="lesson-completed"
            className="group overflow-hidden rounded-lg border border-gray-200 bg-white"
          >
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-navy hover:bg-parchment">
              <span>Completed · {completed.length}</span>
              <ChevronDown
                className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <ul className="divide-y divide-gray-100 border-t border-gray-100">
              {completed.map((lesson) => (
                <li key={lesson.lessonId}>
                  <Link
                    href={`/ocia/lessons/${lesson.lessonId}`}
                    className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-parchment"
                  >
                    <span className="min-w-0 flex-1 truncate text-navy">{lesson.title}</span>
                    <span
                      className={`ml-3 shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS.completed.badge}`}
                    >
                      {STATUS.completed.label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 font-heading text-2xl text-navy">My Lessons</h1>
      {children}
    </div>
  );
}

function DueRow({ lesson, index }: { lesson: StudentLesson; index: number }) {
  if (lesson.locked) {
    // Released but gated behind a prior sequenced lesson: visible, never a link.
    return (
      <li data-testid="lesson-locked" aria-disabled="true" className="flex items-center gap-3 px-4 py-3 text-sm">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-400">
          {index}
        </span>
        <span className="min-w-0 flex-1 truncate text-gray-400">{lesson.title}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-gray-400">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
          Complete the previous lesson first
        </span>
      </li>
    );
  }

  const status = STATUS[lesson.status];
  return (
    <li>
      <Link
        href={`/ocia/lessons/${lesson.lessonId}`}
        className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-parchment"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy/10 text-xs font-medium text-navy">
          {index}
        </span>
        <span className="min-w-0 flex-1 truncate text-navy">{lesson.title}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${status.badge}`}>{status.label}</span>
      </Link>
    </li>
  );
}
