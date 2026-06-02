import { createRecording, getProjectOwnerId, uploadRecordingToBunny } from "@parvaordo/core";
import { validateRecordingUpload } from "@parvaordo/shared";
import { authenticateApiRequest } from "@/src/lib/api-auth";

// POST /api/v1/parvus-studio/projects/{id}/recording — multipart MP4 → Bunny.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await params;
  const user = await authenticateApiRequest(req);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  // Authorize the project BEFORE reading the body or uploading to Bunny: a caller may
  // only record against their OWN project. Parish RLS does not scope per-project, so
  // without this any member could overwrite another teen's recording (po-7ge). 404
  // (not 403) so we don't reveal which project ids exist in the parish.
  if ((await getProjectOwnerId(user.parishId, id)) !== user.userId) {
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
    teenUserId: user.userId,
    bunnyVideoId: videoId,
    playbackUrl,
    durationSeconds,
    slideAdvanceCount,
  });
  // Defense-in-depth: core re-checks ownership, so a project reassigned/deleted between
  // the guard above and the write yields no row rather than a mis-attributed recording.
  if (!rec) return Response.json({ error: "not found" }, { status: 404 });

  return Response.json({
    recording_id: rec.recordingId,
    playback_url: rec.playbackUrl,
    project_status: rec.projectStatus,
  });
}
