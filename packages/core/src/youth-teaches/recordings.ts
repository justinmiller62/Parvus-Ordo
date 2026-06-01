import { getDb } from "../db/client";

export interface CreateRecordingInput {
  projectId: string;
  bunnyVideoId: string;
  playbackUrl: string;
  durationSeconds?: number;
  slideAdvanceCount?: number;
}

/** Record an uploaded recording's metadata (the MP4 itself lives in Bunny) and flip
 * the project to submitted. */
export async function createRecording(
  parishId: string,
  input: CreateRecordingInput,
): Promise<{ recordingId: string; playbackUrl: string; projectStatus: "submitted" }> {
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO youth_recordings
       (parish_id, project_id, bunny_video_id, playback_url, duration_seconds, slide_advance_count)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [parishId, input.projectId, input.bunnyVideoId, input.playbackUrl, input.durationSeconds ?? null, input.slideAdvanceCount ?? null],
  );
  await getDb(parishId).query("UPDATE youth_projects SET status = 'submitted', updated_at = now() WHERE id = $1", [input.projectId]);
  return { recordingId: rows[0]!.id, playbackUrl: input.playbackUrl, projectStatus: "submitted" };
}

/** Upload a recording's bytes to Bunny Stream (create video → PUT bytes) and return
 * the video id + an iframe embed playback URL. */
export async function uploadRecordingToBunny(
  bytes: ArrayBuffer | Uint8Array,
  title: string,
): Promise<{ videoId: string; playbackUrl: string }> {
  const lib = process.env.BUNNY_STREAM_LIBRARY_ID;
  const key = process.env.BUNNY_STREAM_LIBRARY_KEY;
  if (!lib || !key) throw new Error("Bunny is not configured (BUNNY_STREAM_LIBRARY_ID / BUNNY_STREAM_LIBRARY_KEY)");

  const create = await fetch(`https://video.bunnycdn.com/library/${lib}/videos`, {
    method: "POST",
    headers: { AccessKey: key, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!create.ok) throw new Error(`Bunny create video failed (${create.status})`);
  const { guid } = (await create.json()) as { guid: string };

  const put = await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${guid}`, {
    method: "PUT",
    headers: { AccessKey: key },
    // Cast bridges two tsconfigs: core (lib ES2022, no DOM `BodyInit`) and apps/web
    // (DOM lib). `ArrayBuffer` is a valid fetch body in both; fetch accepts the
    // Uint8Array at runtime regardless.
    body: bytes as ArrayBuffer,
  });
  if (!put.ok) throw new Error(`Bunny upload bytes failed (${put.status})`);

  return { videoId: guid, playbackUrl: `https://iframe.mediadelivery.net/embed/${lib}/${guid}` };
}

/** Latest recording for a project (the web player + the iOS package). */
export async function getLatestRecording(
  parishId: string,
  projectId: string,
): Promise<{ id: string; playbackUrl: string | null; bunnyVideoId: string | null } | null> {
  const { rows } = await getDb(parishId).query<{ id: string; playback_url: string | null; bunny_video_id: string | null }>(
    "SELECT id, playback_url, bunny_video_id FROM youth_recordings WHERE project_id = $1 ORDER BY created_at DESC LIMIT 1",
    [projectId],
  );
  const r = rows[0];
  return r ? { id: r.id, playbackUrl: r.playback_url, bunnyVideoId: r.bunny_video_id } : null;
}

/** Best-effort delete of a Bunny Stream video (no-op without Bunny config). */
async function deleteBunnyVideo(videoId: string): Promise<void> {
  const lib = process.env.BUNNY_STREAM_LIBRARY_ID;
  const key = process.env.BUNNY_STREAM_LIBRARY_KEY;
  if (!lib || !key) return;
  await fetch(`https://video.bunnycdn.com/library/${lib}/videos/${videoId}`, {
    method: "DELETE",
    headers: { AccessKey: key, Accept: "application/json" },
  }).catch(() => {});
}

/** Delete a project's recordings (DB rows + their Bunny videos). Caller decides the
 * resulting project status (typically back to ready_to_record so it can be re-recorded). */
export async function deleteRecordings(parishId: string, projectId: string): Promise<void> {
  const { rows } = await getDb(parishId).query<{ bunny_video_id: string | null }>(
    "SELECT bunny_video_id FROM youth_recordings WHERE project_id = $1",
    [projectId],
  );
  for (const r of rows) {
    if (r.bunny_video_id) await deleteBunnyVideo(r.bunny_video_id);
  }
  await getDb(parishId).query("DELETE FROM youth_recordings WHERE project_id = $1", [projectId]);
}
