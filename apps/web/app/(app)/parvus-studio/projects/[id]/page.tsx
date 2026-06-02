import { isStaff } from "@parvaordo/shared";
import { redirect } from "next/navigation";
import {
  getLatestRecording,
  getProject,
  getProjectDetails,
  isProjectOwner,
  listProjectSlides,
  presignSlideUrl,
} from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { YouthProjectClient } from "./youth-project-client";
import { SlideManager } from "./slide-manager";
import { reviewProjectAction } from "./actions";

export default async function YouthProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) redirect("/login");
  const parishId = viewer.identity.parishId;
  const userId = viewer.identity.userId;
  const role = viewer.identity.role;

  // Parish RLS lets any member load any project by id; a teen may only view their
  // OWN project. Staff (catechist/admin) review across the parish, so they're exempt.
  if (!isStaff(role) && !(await isProjectOwner(parishId, userId, id))) {
    return <div className="mx-auto max-w-3xl p-2 text-sm text-gray-500">Project not found.</div>;
  }

  const [project, details, recording, slides] = await Promise.all([
    getProject(parishId, id),
    getProjectDetails(parishId, id),
    getLatestRecording(parishId, id),
    listProjectSlides(parishId, id),
  ]);

  if (!project) {
    return <div className="mx-auto max-w-3xl p-2 text-sm text-gray-500">Project not found.</div>;
  }

  // Presign previews; tolerate R2 being unconfigured (preview just won't render).
  const slidePreviews = await Promise.all(
    slides.map(async (s) => ({ id: s.id, order: s.order, url: await presignSlideUrl(s.r2Key).catch(() => null) })),
  );

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <p className="text-xs uppercase tracking-wide text-gray-400">Parvus Studio</p>
        <h1 className="font-heading text-2xl text-navy">{project.title}</h1>
        {details?.topic ? <p className="mt-1 text-sm text-gray-500">Topic: {details.topic}</p> : null}
      </div>

      {details?.common_misconception ? (
        <div className="rounded-md border border-rose/30 bg-rose/5 p-3 text-sm">
          <p className="font-medium text-rose">Common misconception</p>
          <p className="mt-1 text-navy/80">{details.common_misconception}</p>
          {details.correct_teaching ? (
            <>
              <p className="mt-2 font-medium text-burgundy">What the Church teaches</p>
              <p className="mt-1 text-navy/80">{details.correct_teaching}</p>
            </>
          ) : null}
        </div>
      ) : null}

      <YouthProjectClient
        projectId={id}
        initialScript={project.scriptDraft?.full_text ?? ""}
        initialStatus={project.status}
        recordingUrl={recording?.playbackUrl ?? null}
      />

      {isStaff(role) && recording ? (
        <section className="rounded-lg border border-gray-200 bg-white p-4" data-testid="yt-review">
          <h2 className="mb-2 text-sm font-semibold text-navy">Review</h2>
          {project.status === "submitted" ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="mr-1 text-sm text-gray-500">A recording was submitted.</span>
              <form action={reviewProjectAction.bind(null, id, "approved")}>
                <button
                  type="submit"
                  data-testid="yt-approve"
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  Approve
                </button>
              </form>
              <form action={reviewProjectAction.bind(null, id, "rejected")}>
                <button
                  type="submit"
                  data-testid="yt-reject"
                  className="rounded-md border border-rose px-3 py-1.5 text-sm font-medium text-rose hover:bg-rose/10"
                >
                  Reject
                </button>
              </form>
            </div>
          ) : project.status === "approved" ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="yt-review-approved">
              <span className="text-sm font-medium text-green-700">✓ Approved</span>
              <form action={reviewProjectAction.bind(null, id, "rejected")}>
                <button type="submit" className="text-xs text-rose hover:underline">
                  Reject instead
                </button>
              </form>
            </div>
          ) : project.status === "rejected" ? (
            <div className="flex flex-wrap items-center gap-3" data-testid="yt-review-rejected">
              <span className="text-sm font-medium text-rose">✗ Rejected</span>
              <form action={reviewProjectAction.bind(null, id, "approved")}>
                <button type="submit" className="text-xs text-green-700 hover:underline">
                  Approve instead
                </button>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}

      <section>
        <h2 className="mb-2 text-sm font-medium text-navy">Slides</h2>
        <SlideManager projectId={id} initialSlides={slidePreviews} />
      </section>
    </div>
  );
}
