import { isStaff } from "@parvaordo/shared";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLessonDetail, getStudentFeedback, getStudentQuestions, type StudentMessage } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

function MessageList({ items, empty }: { items: StudentMessage[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((m) => (
        <li key={m.id} className="rounded-lg border border-gray-200 bg-white p-3">
          <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
            <span className="font-medium text-navy">{m.studentName}</span>
            <span>{new Date(m.createdAt).toLocaleDateString()}</span>
          </div>
          <p className="text-sm text-gray-700">{m.text}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function ResponsesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  const role = viewer?.identity?.role;
  const parishId = viewer?.identity?.parishId;
  if (!parishId || !isStaff(role)) redirect("/ocia");

  const [lesson, questions, feedback] = await Promise.all([
    getLessonDetail(parishId, id),
    getStudentQuestions(parishId, id),
    getStudentFeedback(parishId, id),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/ocia/lessons" className="text-sm text-gray-400 hover:text-navy">
        ← Lessons
      </Link>
      <h1 className="mt-3 font-heading text-2xl text-navy">Student Responses</h1>
      {lesson ? <p className="mb-4 text-sm text-gray-500">{lesson.title}</p> : <div className="mb-4" />}

      <section className="mb-6" data-testid="responses-questions">
        <h2 className="mb-2 font-heading text-lg text-navy">Questions ({questions.length})</h2>
        <MessageList items={questions} empty="No questions yet." />
      </section>
      <section data-testid="responses-feedback">
        <h2 className="mb-2 font-heading text-lg text-navy">Feedback ({feedback.length})</h2>
        <MessageList items={feedback} empty="No feedback yet." />
      </section>
    </div>
  );
}
