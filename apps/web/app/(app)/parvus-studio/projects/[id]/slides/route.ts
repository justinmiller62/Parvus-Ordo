import { addProjectSlide } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// POST /parvus-studio/projects/{id}/slides — multipart slide upload (web). A route
// handler (not a Server Action) so the client can stream with an upload progress
// bar and the body isn't subject to the Server Action 1MB cap.
const SLIDE_MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  const order = Number(form.get("slide_order")) || 1;

  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "Slide must be an image (PNG or JPG)." }, { status: 415 });
  if (file.size > SLIDE_MAX_BYTES) {
    return Response.json(
      { error: `Slide is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${SLIDE_MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await addProjectSlide(viewer.identity.parishId, id, order, bytes, file.type || "image/png");
  } catch {
    return Response.json({ error: "Upload failed — please try again." }, { status: 500 });
  }
  return Response.json({ ok: true, slide_order: order });
}
