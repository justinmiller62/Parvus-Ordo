import { getProject, isProjectOwner, listProjectSlides, presignSlideUrl } from "@parvaordo/core";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// GET /api/v1/parvus-studio/projects/{id}/package — script + presigned slide URLs +
// upload endpoint, for Parvus Studio to download and record against.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await authenticateApiRequest(req, "studio");
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // The iOS app is the teen's own device; they may only package their OWN project.
  if (!(await isProjectOwner(user.parishId, user.userId, id))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const project = await getProject(user.parishId, id);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  // Real uploaded slides (manual upload or the MCP upload_slide tool); presign
  // short-lived GET URLs from the private R2 bucket.
  const slides = await listProjectSlides(user.parishId, id);
  const visuals = await Promise.all(
    slides.map(async (s) => ({
      id: s.id,
      order: s.order,
      url: await presignSlideUrl(s.r2Key),
    })),
  );

  return Response.json({
    project_id: id,
    title: project.title,
    script: { full_text: project.scriptDraft.full_text, segments: project.scriptDraft.segments },
    visuals,
    upload_endpoint: `/api/v1/parvus-studio/projects/${id}/recording`,
  });
}
