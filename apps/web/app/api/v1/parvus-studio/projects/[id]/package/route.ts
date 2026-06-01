import { getProject, presignSlideUrl } from "@parvaordo/core";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// GET /api/v1/parvus-studio/projects/{id}/package — script + presigned slide URLs +
// upload endpoint, for Parvus Studio to download and record against.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await authenticateApiRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const project = await getProject(user.parishId, id);
  if (!project) return Response.json({ error: "not found" }, { status: 404 });

  // The 3 demo slides live in R2 by convention; presign short-lived GET URLs.
  const visuals = await Promise.all(
    [1, 2, 3].map(async (n) => ({
      id: `v${n}`,
      order: n,
      url: await presignSlideUrl(`youth-slides/${id}/slide${n}.png`),
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
