import Link from "next/link";
import { getPublishedLessons } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

const SCOPE_BADGE: Record<string, string> = {
  global: "bg-gold/20 text-gold-dark",
  diocese: "bg-navy/10 text-navy",
  parish: "bg-rose/15 text-rose",
};

export default async function OciaHomePage() {
  const viewer = await getViewer();
  const parishId = viewer?.identity?.parishId ?? null;
  const lessons = parishId ? await getPublishedLessons(parishId) : [];

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-heading text-2xl text-navy">OCIA Home</h1>
      <p className="mt-1 text-gray-500">Order of Christian Initiation of Adults.</p>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-400">Lessons available to you ({lessons.length})</h2>
        {lessons.length === 0 ? (
          <p className="text-sm text-gray-500">No lessons yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/ocia/lessons/${l.id}`}
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
      </section>
    </div>
  );
}
