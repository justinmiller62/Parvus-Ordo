import { videoWatchSatisfied } from "@parvaordo/shared";
import { getDb } from "../db/client";
import { getAsset } from "../media";

/** Mark a lesson item complete for a student (idempotent). */
export async function markItemComplete(params: {
  parishId: string;
  studentId: string;
  itemId: string;
}): Promise<void> {
  await getDb(params.parishId).query(
    `INSERT INTO lesson_item_progress (parish_id, student_id, item_id, completed)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (student_id, item_id)
     DO UPDATE SET completed = true, updated_at = now()`,
    [params.parishId, params.studentId, params.itemId],
  );
}

/**
 * Persist video watch progress: the furthest point reached (only ever grows) and a
 * completion flag DERIVED SERVER-SIDE from that point — never trusted from the
 * client. Used for resume + seek-enforcement that survives reloads. Because the
 * `completed` write is gated on `videoWatchSatisfied`, a forged completion (e.g. a
 * direct `saveVideoProgress` with a tiny `maxReachedMs`) can't mark an unwatched
 * video done; combined with the GREATEST()/OR upsert, completion only ever flips
 * true and only once the clip was (almost) fully reached.
 */
export async function markVideoProgress(params: {
  parishId: string;
  studentId: string;
  itemId: string;
  maxReachedMs: number;
}): Promise<void> {
  const durationMs = await videoItemDurationMs(params.parishId, params.itemId);
  const completed = videoWatchSatisfied(params.maxReachedMs, durationMs);
  await getDb(params.parishId).query(
    `INSERT INTO lesson_item_progress (parish_id, student_id, item_id, completed, max_reached_ms)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, item_id) DO UPDATE SET
       completed = lesson_item_progress.completed OR EXCLUDED.completed,
       max_reached_ms = GREATEST(COALESCE(lesson_item_progress.max_reached_ms, 0), COALESCE(EXCLUDED.max_reached_ms, 0)),
       updated_at = now()`,
    [params.parishId, params.studentId, params.itemId, completed, params.maxReachedMs],
  );
}

/**
 * Expected watch length (ms) of a video lesson item: its clip window
 * `end_ms - start_ms`. An open-ended ("full video") window falls back to the source
 * asset's probed duration minus the start offset. Mirrors the client's own clip
 * length (`endSec - startSec` in the player, `estimateItemsDurationSec` in shared),
 * so the gate threshold matches the player's clip-relative `max_reached_ms`.
 * Returns null when the item isn't a video or the length can't be resolved.
 */
async function videoItemDurationMs(parishId: string, itemId: string): Promise<number | null> {
  const { rows } = await getDb(parishId).query<{ kind: string; content: Record<string, unknown> }>(
    "SELECT kind, content FROM lesson_items WHERE id = $1",
    [itemId],
  );
  const item = rows[0];
  if (!item || item.kind !== "video") return null;
  const startMs = Number(item.content.start_ms ?? 0);
  const endMs = item.content.end_ms == null ? null : Number(item.content.end_ms);
  if (endMs != null) return Math.max(0, endMs - startMs);
  // Open-ended window: the clip runs to the end of the source, so its length is the
  // source's probed duration past the start offset.
  const sourceId = item.content.asset_id;
  if (typeof sourceId !== "string") return null;
  const source = await getAsset(parishId, sourceId);
  return source?.durationMs == null ? null : Math.max(0, source.durationMs - startMs);
}

/**
 * Server-side video-watch gate — the authoritative check behind the player's
 * cosmetic `watched` button. Returns true once the student's persisted
 * furthest-reached point is within tolerance of the clip end. `advanceAction`
 * calls this before completing a video item so a tampered (un-watched) completion
 * is refused rather than trusted.
 */
export async function isVideoItemWatched(params: {
  parishId: string;
  studentId: string;
  itemId: string;
}): Promise<boolean> {
  const durationMs = await videoItemDurationMs(params.parishId, params.itemId);
  const maxReachedMs = await getItemMaxReached(params.parishId, params.studentId, params.itemId);
  return videoWatchSatisfied(maxReachedMs, durationMs);
}

/** Furthest point (ms, clip-relative) a student has reached on a video item. */
export async function getItemMaxReached(parishId: string, studentId: string, itemId: string): Promise<number> {
  const { rows } = await getDb(parishId).query<{ max_reached_ms: number | null }>(
    "SELECT max_reached_ms FROM lesson_item_progress WHERE student_id = $1 AND item_id = $2",
    [studentId, itemId],
  );
  return rows[0]?.max_reached_ms ?? 0;
}

/** The set of lesson_item ids a student has completed within a lesson version. */
export async function getCompletedItemsForVersion(
  parishId: string,
  studentId: string,
  versionId: string,
): Promise<Set<string>> {
  const { rows } = await getDb(parishId).query<{ item_id: string }>(
    `SELECT p.item_id
       FROM lesson_item_progress p
       JOIN lesson_items li ON li.id = p.item_id
      WHERE li.version_id = $1 AND p.student_id = $2 AND p.completed = true`,
    [versionId, studentId],
  );
  return new Set(rows.map((r) => r.item_id));
}

/** Clear a student's answers + progress (dev/test reset; parish-scoped via RLS). */
export async function resetStudentProgress(parishId: string, studentId: string): Promise<void> {
  const db = getDb(parishId);
  await db.query("DELETE FROM answers WHERE student_id = $1", [studentId]);
  await db.query("DELETE FROM lesson_item_progress WHERE student_id = $1", [studentId]);
  await db.query("DELETE FROM student_questions WHERE student_id = $1", [studentId]);
  await db.query("DELETE FROM student_feedback WHERE student_id = $1", [studentId]);
}
