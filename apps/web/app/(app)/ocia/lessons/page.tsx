import Link from "next/link";
import { getLessons } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { createLessonAction } from "./actions";

const SCOPE_BADGE: Record<string, string> = {
  global: "bg-gold/20 text-gold-dark",
  diocese: "bg-navy/10 text-navy",
  parish: "bg-rose/15 text-rose",
};

export default async function LessonsPage() {
  const viewer = await getViewer();
  const parishId = viewer?.identity?.parishId ?? null;
  const role = viewer?.identity?.role ?? null;
  const canBuild = role === "catechist" || role === "admin" || role === "super_admin";

  const lessons = parishId ? await getLessons(parishId) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl text-navy">Lessons</h1>
        {canBuild ? (
          <form action={createLessonAction}>
            <button
              type="submit"
              className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-white hover:bg-gold-dark"
            >
              New lesson
            </button>
          </form>
        ) : null}
      </div>

      {lessons.length === 0 ? (
        <p className="text-sm text-gray-500">No lessons available yet.</p>
      ) : (
        <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
          {lessons.map((l) => (
            <li key={l.id}>
              <Link
                href={canBuild && l.scope === "parish" ? `/ocia/lessons/${l.id}/edit` : `/ocia/lessons/${l.id}`}
                className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-parchment"
              >
                <span className="text-navy">{l.title}</span>
                <span className={`ml-3 rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_BADGE[l.scope] ?? ""}`}>
                  {l.scope}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
