import { addProjectSlide, nextSlideOrder, presignSlideUrl } from "@parvaordo/core";
import { getViewer } from "@/src/lib/viewer";

// POST /parvus-studio/projects/{id}/slides — multipart slide upload (web). A route
// handler (not a Server Action) so the client can stream with an upload progress
// bar and the body isn't subject to the Server Action 1MB cap. The slide is
// appended (next order); returns the new slide (id, order, presigned url).
const SLIDE_MAX_BYTES = 12 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const viewer = await getViewer();
  if (!viewer?.identity?.parishId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parishId = viewer.identity.parishId;

  const form = await req.formData();
  const file = form.get("file");

  if (!(file instanceof File) || file.size === 0) return Response.json({ error: "Choose an image to upload." }, { status: 400 });
  if (!file.type.startsWith("image/")) return Response.json({ error: "Slide must be an image (PNG or JPG)." }, { status: 415 });
  if (file.size > SLIDE_MAX_BYTES) {
    return Response.json(
      { error: `Slide is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${SLIDE_MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 },
    );
  }

  try {
    const order = await nextSlideOrder(parishId, id);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { id: slideId, r2Key } = await addProjectSlide(parishId, id, order, bytes, file.type || "image/png");
    const url = await presignSlideUrl(r2Key);
    return Response.json({ ok: true, slide: { id: slideId, order, url } });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("slide upload failed:", detail);
    return Response.json({ error: `Upload failed: ${detail}` }, { status: 500 });
  }
}
