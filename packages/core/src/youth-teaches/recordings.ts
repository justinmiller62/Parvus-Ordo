import { getDb } from "../db/client";
import { getStorage } from "../media/storage";
import { getProjectOwnerId, submitProject } from "./projects";

export interface CreateRecordingInput {
  /** The teen recording — must own `projectId` (RLS is parish-level, not per-project). */
  teenUserId: string;
  projectId: string;
  bunnyVideoId: string;
  playbackUrl: string;
  durationSeconds?: number;
  slideAdvanceCount?: number;
}

/** Record an uploaded recording's metadata (the MP4 itself lives in Bunny) and flip the
 * project to submitted. Authorization: only the project's owner (`teenUserId`) may record
 * against it — parish RLS isn't per-project — so a non-owner gets null, which the route
 * maps to 404 (po-7ge). The status flip then goes through the guarded submitProject
 * transition, so an upload against a project that is not ready_to_record is rejected before
 * any recording row is created (no orphan row on an illegal submit) (po-nd4). */
export async function createRecording(
  parishId: string,
  input: CreateRecordingInput,
): Promise<{ recordingId: string; playbackUrl: string; projectStatus: "submitted" } | null> {
  // Ownership gate first: a non-owner (or unknown project) must change nothing — no status
  // flip, no recording row — before the guarded transition can take effect.
  if ((await getProjectOwnerId(parishId, input.projectId)) !== input.teenUserId) return null;
  await submitProject(parishId, input.projectId);
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO youth_recordings
       (parish_id, project_id, bunny_video_id, playback_url, duration_seconds, slide_advance_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [
      parishId,
      input.projectId,
      input.bunnyVideoId,
      input.playbackUrl,
      input.durationSeconds ?? null,
      input.slideAdvanceCount ?? null,
    ],
  );
  return { recordingId: rows[0]!.id, playbackUrl: input.playbackUrl, projectStatus: "submitted" };
}

/** Upload a recording's bytes through the shared media StorageProvider (Bunny in
 * prod, the stub locally / under MEDIA_STUB) and return the video id + an embeddable
 * playback URL. Routed through getStorage() so Parvus Studio reuses OCIA's one Bunny
 * client — no second, divergent integration, and Studio works on the stub path. */
export async function uploadRecordingToBunny(
  bytes: ArrayBuffer | Uint8Array,
  title: string,
): Promise<{ videoId: string; playbackUrl: string }> {
  const { providerAssetId, playbackUrl } = await getStorage().uploadBytes({ title }, bytes);
  return { videoId: providerAssetId, playbackUrl };
}

/** Latest recording for a project (the web player + the iOS package). */
export async function getLatestRecording(
  parishId: string,
  projectId: string,
): Promise<{ id: string; playbackUrl: string | null; bunnyVideoId: string | null } | null> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    playback_url: string | null;
    bunny_video_id: string | null;
  }>(
    "SELECT id, playback_url, bunny_video_id FROM youth_recordings WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
    [projectId],
  );
  const r = rows[0];
  return r ? { id: r.id, playbackUrl: r.playback_url, bunnyVideoId: r.bunny_video_id } : null;
}

/** Delete a project's recordings (DB rows + their hosted videos via the shared
 * StorageProvider). Caller decides the resulting project status (typically back to
 * ready_to_record so it can be re-recorded). */
export async function deleteRecordings(parishId: string, projectId: string): Promise<void> {
  const { rows } = await getDb(parishId).query<{ bunny_video_id: string | null }>(
    "SELECT bunny_video_id FROM youth_recordings WHERE project_id = $1",
    [projectId],
  );
  const storage = getStorage();
  for (const r of rows) {
    // Best-effort: a failed host delete (or the stub no-op) must not block removing the row.
    if (r.bunny_video_id) await storage.delete(r.bunny_video_id).catch(() => {});
  }
  await getDb(parishId).query("DELETE FROM youth_recordings WHERE project_id = $1", [projectId]);
}
