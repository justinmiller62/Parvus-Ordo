import { isStaff } from "@parvaordo/shared";
import Link from "next/link";
import { getManageLessons, getPublishedLessons, type ContentScope, type LessonStatus } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { ManageRowActions } from "@/src/components/ocia/manage-row-actions";
import { createLessonAction, forkLessonAction } from "./actions";

const SCOPE_BADGE: Record<string, string> = {
  global: "bg-gold/20 text-gold-dark",
  diocese: "bg-navy/10 text-navy",
  parish: "bg-rose/15 text-rose",
};
const STATUS_BADGE: Record<string, string> = {
  published: "bg-green-100 text-green-700",
  draft: "bg-amber-100 text-amber-700",
  offline: "bg-gray-100 text-gray-500",
};

function FilterLink({ active, href, children }: { active: boolean; href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active ? "bg-navy text-white" : "border border-gray-200 bg-white text-gray-600 hover:bg-parchment"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function LessonsPage({
  searchParams,
}: {
  searchParams: Promise<{ scope?: string; status?: string; sort?: string }>;
}) {
  const viewer = await getViewer();
  const parishId = viewer?.identity?.parishId ?? null;
  const role = viewer?.identity?.role ?? null;
  const canBuild = isStaff(role);

  // Learners: a simple list of published lessons they can take.
  if (!canBuild) {
    const lessons = parishId ? await getPublishedLessons(parishId) : [];
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="mb-4 font-heading text-2xl text-navy">My Lessons</h1>
        {lessons.length === 0 ? (
          <p className="text-sm text-gray-500">No lessons available yet.</p>
        ) : (
          <ul className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link
                  href={`/ocia/lessons/${l.id}`}
                  className="flex items-center justify-between px-4 py-3 text-sm transition hover:bg-parchment"
                >
                  <span className="text-navy">{l.title}</span>
                  <span className={`ml-3 rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_BADGE[l.scope]}`}>
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

  // Builders: the manage list with sort + filter by type/status, fork, and new.
  const sp = await searchParams;
  const scope = (["global", "diocese", "parish"].includes(sp.scope ?? "") ? sp.scope : undefined) as
    | ContentScope
    | undefined;
  const status = (["published", "draft", "offline"].includes(sp.status ?? "") ? sp.status : undefined) as
    | LessonStatus
    | undefined;
  const sort: "title" | "updated" = sp.sort === "updated" ? "updated" : "title";

  const lessons = parishId ? await getManageLessons(parishId, { scope, status, sort }) : [];

  const qs = (o: Record<string, string | undefined>) => {
    const merged: Record<string, string | undefined> = { scope, status, sort, ...o };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/ocia/lessons?${s}` : "/ocia/lessons";
  };

  return (
    <div className="w-full">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="font-heading text-2xl text-navy">Lessons</h1>
        <form action={createLessonAction}>
          <button
            type="submit"
            className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-white hover:bg-gold-dark"
          >
            New lesson
          </button>
        </form>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <div className="flex items-center gap-1.5" data-testid="filter-type">
          <span className="text-gray-400">Type</span>
          <FilterLink active={!scope} href={qs({ scope: undefined })}>
            All
          </FilterLink>
          <FilterLink active={scope === "global"} href={qs({ scope: "global" })}>
            Global
          </FilterLink>
          <FilterLink active={scope === "diocese"} href={qs({ scope: "diocese" })}>
            Diocese
          </FilterLink>
          <FilterLink active={scope === "parish"} href={qs({ scope: "parish" })}>
            Parish
          </FilterLink>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">Status</span>
          <FilterLink active={!status} href={qs({ status: undefined })}>
            All
          </FilterLink>
          <FilterLink active={status === "published"} href={qs({ status: "published" })}>
            Published
          </FilterLink>
          <FilterLink active={status === "draft"} href={qs({ status: "draft" })}>
            Draft
          </FilterLink>
          <FilterLink active={status === "offline"} href={qs({ status: "offline" })}>
            Offline
          </FilterLink>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-gray-400">Sort</span>
          <FilterLink active={sort === "title"} href={qs({ sort: "title" })}>
            Title
          </FilterLink>
          <FilterLink active={sort === "updated"} href={qs({ sort: "updated" })}>
            Recent
          </FilterLink>
        </div>
      </div>

      {lessons.length === 0 ? (
        <p className="text-sm text-gray-500">No lessons match these filters.</p>
      ) : (
        <ul
          className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200 bg-white"
          data-testid="lesson-list"
        >
          {lessons.map((l) => {
            const editable = l.scope === "parish";
            return (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                <Link
                  href={editable ? `/ocia/lessons/${l.id}/edit` : `/ocia/lessons/${l.id}`}
                  className="min-w-0 flex-1 truncate text-navy hover:text-burgundy"
                >
                  {l.title}
                  {l.isFork ? <span className="ml-2 text-xs text-gray-400">fork</span> : null}
                </Link>
                {l.scope !== "global" ? (
                  <span className="hidden shrink-0 text-xs text-gray-400 lg:inline">
                    edited{" "}
                    {new Date(l.updatedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                ) : null}
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${SCOPE_BADGE[l.scope]}`}>
                  {l.scope}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[l.status]}`}>
                  {l.status}
                </span>
                <ManageRowActions lessonId={l.id} editable={editable} status={l.status} />
                {!editable ? (
                  <form action={forkLessonAction.bind(null, l.id)}>
                    <button
                      type="submit"
                      className="shrink-0 rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-parchment"
                    >
                      Fork
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
