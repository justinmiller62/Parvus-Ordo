import Link from "next/link";
import { redirect } from "next/navigation";
import { listMyProjects } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

const STATUS_LABEL: Record<string, string> = {
  drafting: "Drafting",
  ready_to_record: "Ready to record",
  submitted: "Recording submitted",
};

// Youth Teaches home — the teen's project list (the landing route for youth_teen).
export default async function YouthTeachesHome() {
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId || !viewer.identity.userId) redirect("/login");
  const { parishId, userId } = viewer.identity;
  const projects = await listMyProjects(parishId, userId);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Youth Teaches</p>
        <h1 className="font-heading text-2xl text-navy">My projects</h1>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500">
          No projects yet. Your catechist will assign you a topic to teach.
        </div>
      ) : (
        <ul className="space-y-2" data-testid="yt-project-list">
          {projects.map((p) => (
            <li key={p.id}>
              <Link
                href={`/youth-teaches/projects/${p.id}`}
                data-testid={`yt-project-${p.id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
              >
                <span>
                  <span className="block font-medium text-navy">{p.title}</span>
                  {p.topicCategory ? <span className="block text-sm text-gray-500">{p.topicCategory}</span> : null}
                </span>
                <span className="rounded bg-navy/10 px-2 py-1 text-xs font-medium text-navy">
                  {STATUS_LABEL[p.status] ?? p.status}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
