import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { getStudentAnsweredLessons } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// The student's "My Answers" surface: every lesson they have answered, linking into the
// existing read-only review mode (`?review=1`) at the lesson view. Viewer-scoped — the
// read model only returns the current user's own answers (staff simply see an empty list).
export default async function MyAnswersPage() {
  const viewer = await getViewer();
  const parishId = viewer?.identity?.parishId ?? null;
  const studentId = viewer?.identity?.userId ?? null;
  const lessons = parishId && studentId ? await getStudentAnsweredLessons(parishId, studentId) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 font-heading text-2xl text-navy">My Answers</h1>
      <p className="mb-4 text-sm text-gray-500">Review the answers you have submitted, lesson by lesson.</p>

      {lessons.length === 0 ? (
        <div
          data-testid="my-answers-empty"
          className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center"
        >
          <p className="text-sm text-gray-500">You have not answered any lessons yet.</p>
        </div>
      ) : (
        <ul
          data-testid="my-answers-list"
          className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white"
        >
          {lessons.map((lesson) => (
            <li key={lesson.lessonId}>
              <Link
                href={`/ocia/lessons/${lesson.lessonId}?review=1`}
                className="flex items-center gap-3 px-4 py-3 text-sm transition hover:bg-parchment"
              >
                <ClipboardList className="h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-navy">{lesson.title}</span>
                <span className="shrink-0 text-xs text-gray-400">
                  {lesson.answerCount} {lesson.answerCount === 1 ? "answer" : "answers"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
