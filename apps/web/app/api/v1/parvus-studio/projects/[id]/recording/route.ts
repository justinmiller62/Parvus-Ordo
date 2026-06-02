import { createRecording, isProjectOwner, uploadRecordingToBunny } from "@parvaordo/core";
import { validateRecordingUpload } from "@parvaordo/shared";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// POST /api/v1/parvus-studio/projects/{id}/recording — multipart MP4 → Bunny.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await authenticateApiRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  // The iOS app is the teen's own device; they may only submit a recording for
  // their OWN project. Gate before the (expensive) Bunny upload.
  if (!(await isProjectOwner(user.parishId, user.userId, id))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  const tooLarge = validateRecordingUpload(file.size);
  if (tooLarge) return Response.json({ error: tooLarge.message }, { status: tooLarge.status });

  const durationSeconds = Number(form.get("duration_seconds")) || undefined;
  const slideAdvanceCount = Number(form.get("slide_advance_count")) || undefined;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { videoId, playbackUrl } = await uploadRecordingToBunny(bytes, `Parvus Studio ${id}`);
  const rec = await createRecording(user.parishId, {
    projectId: id,
    bunnyVideoId: videoId,
    playbackUrl,
    durationSeconds,
    slideAdvanceCount,
  });

  return Response.json({
    recording_id: rec.recordingId,
    playback_url: rec.playbackUrl,
    project_status: rec.projectStatus,
  });
}
