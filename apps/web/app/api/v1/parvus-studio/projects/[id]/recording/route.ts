import { createRecording, uploadRecordingToBunny } from "@parvaordo/core";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// POST /api/v1/parvus-studio/projects/{id}/recording — multipart MP4 → Bunny.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await authenticateApiRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const MAX_RECORDING_BYTES = 120 * 1024 * 1024; // ~120MB, under the proxy's 128MB buffer cap

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "file is required" }, { status: 400 });
  if (file.size > MAX_RECORDING_BYTES) {
    return Response.json(
      { error: `recording too large (${(file.size / 1024 / 1024).toFixed(0)} MB). Max 120 MB.` },
      { status: 413 },
    );
  }

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
