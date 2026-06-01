import Link from "next/link";
import { redirect } from "next/navigation";
import {
  listMyProjects,
  listParishYouthProjects,
  listYouthTeens,
  listYouthTopics,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { createProjectAction, createTopicAction } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  drafting: "Drafting",
  ready_to_record: "Ready to record",
  submitted: "Recording submitted",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded bg-navy/10 px-2 py-1 text-xs font-medium text-navy">
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// Parvus Studio home. Teens see their own projects; catechists/admins get the
// management view (assign projects, manage topics, oversee every project).
export default async function YouthTeachesHome() {
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId || !viewer.identity.userId) redirect("/login");
  const { parishId, userId, role } = viewer.identity;
  const isStaff = role === "catechist" || role === "admin" || role === "super_admin";

  if (!isStaff) {
    const projects = await listMyProjects(parishId, userId);
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400">Parvus Studio</p>
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
                  href={`/parvus-studio/projects/${p.id}`}
                  data-testid={`yt-project-${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
                >
                  <span>
                    <span className="block font-medium text-navy">{p.title}</span>
                    {p.topicCategory ? <span className="block text-sm text-gray-500">{p.topicCategory}</span> : null}
                  </span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  // ── Staff management view ──────────────────────────────────────────────────
  const [projects, teens, topics] = await Promise.all([
    listParishYouthProjects(parishId),
    listYouthTeens(parishId),
    listYouthTopics(parishId),
  ]);

  const inputClass =
    "w-full rounded-md border border-navy/15 bg-white p-2 text-sm text-navy focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Parvus Studio</p>
        <h1 className="font-heading text-2xl text-navy">Manage projects</h1>
      </div>

      {/* Assign a new project */}
      <section className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-navy">Assign a project</h2>
        {teens.length === 0 ? (
          <p className="text-sm text-gray-500">
            No studio creators in this parish yet. Invite one from the{" "}
            <Link href="/" className="text-burgundy underline">Dashboard</Link> (Invite a member → “Studio”) before assigning a project.
          </p>
        ) : (
          <form action={createProjectAction} className="space-y-3" data-testid="yt-create-project">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="teenUserId">Studio creator</label>
              <select id="teenUserId" name="teenUserId" required className={inputClass} data-testid="yt-teen-select">
                {teens.map((t) => (
                  <option key={t.userId} value={t.userId}>{t.displayName}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="topicId">Topic (optional)</label>
              <select id="topicId" name="topicId" className={inputClass} data-testid="yt-topic-select">
                <option value="">— none —</option>
                {topics.map((t) => (
                  <option key={t.id} value={t.id}>{t.category} · {t.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="title">Project title</label>
              <input id="title" name="title" required className={inputClass} data-testid="yt-title-input" placeholder="What Catholics actually believe about the Real Presence" />
            </div>
            <button
              type="submit"
              data-testid="yt-create-submit"
              className="rounded-md bg-burgundy px-3 py-1.5 text-sm font-medium text-cream hover:bg-rose"
            >
              Create &amp; assign
            </button>
          </form>
        )}
      </section>

      {/* Add a topic */}
      <details className="rounded-lg border border-gray-200 bg-white p-5">
        <summary className="cursor-pointer text-sm font-semibold text-navy">Add a topic</summary>
        <form action={createTopicAction} className="mt-3 space-y-3" data-testid="yt-create-topic">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="t-category">Category</label>
              <input id="t-category" name="category" required className={inputClass} placeholder="Sacraments" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="t-ageBand">Age band</label>
              <input id="t-ageBand" name="ageBand" className={inputClass} placeholder="high_school" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="t-title">Title</label>
            <input id="t-title" name="title" required className={inputClass} placeholder="What Catholics actually believe about the Real Presence" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="t-misconception">Common misconception</label>
            <input id="t-misconception" name="commonMisconception" className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500" htmlFor="t-correct">Correct teaching</label>
            <input id="t-correct" name="correctTeaching" className={inputClass} />
          </div>
          <button type="submit" className="rounded-md border border-gold bg-gold/10 px-3 py-1.5 text-sm font-medium text-gold-dark hover:bg-gold/20">
            Add topic
          </button>
        </form>
      </details>

      {/* All projects in the parish */}
      <section>
        <h2 className="mb-2 text-sm font-semibold text-gray-400">All projects ({projects.length})</h2>
        {projects.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-500">
            No projects yet. Assign one above.
          </div>
        ) : (
          <ul className="space-y-2" data-testid="yt-manage-list">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/parvus-studio/projects/${p.id}`}
                  data-testid={`yt-project-${p.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-4 transition hover:border-gold hover:bg-parchment"
                >
                  <span>
                    <span className="block font-medium text-navy">{p.title}</span>
                    <span className="block text-sm text-gray-500">
                      {p.teenName ?? "Unassigned"}{p.topicTitle ? ` · ${p.topicTitle}` : ""}
                    </span>
                  </span>
                  <StatusBadge status={p.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
