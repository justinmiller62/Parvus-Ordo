import { redirect } from "next/navigation";
import { getLatestRecording, getProject, getProjectDetails, listProjectSlides, presignSlideUrl } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";
import { YouthProjectClient } from "./youth-project-client";
import { SlideUploadForm } from "./slide-upload-form";
import { deleteSlideAction } from "./actions";

export default async function YouthProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) redirect("/login");
  const parishId = viewer.identity.parishId;

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

      <section data-testid="yt-slides">
        <h2 className="mb-1 text-sm font-medium text-navy">Slides</h2>
        <p className="mb-2 text-xs text-gray-400">1920×1080 (16:9). Parvus Studio downloads these to record against.</p>

        {slidePreviews.length > 0 ? (
          <ul className="mb-3 grid grid-cols-3 gap-3">
            {slidePreviews.map((s) => (
              <li key={s.id} className="space-y-1">
                <div className="aspect-video overflow-hidden rounded-md border border-navy/15 bg-navy/5">
                  {s.url ? <img src={s.url} alt={`Slide ${s.order}`} className="h-full w-full object-cover" /> : null}
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-500">Slide {s.order}</span>
                  <form action={deleteSlideAction.bind(null, id, s.order)}>
                    <button type="submit" className="text-xs text-rose hover:underline">Remove</button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mb-3 text-sm text-gray-500">No slides yet.</p>
        )}

        <SlideUploadForm projectId={id} />
      </section>
    </div>
  );
}
