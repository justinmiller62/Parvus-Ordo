import { pacedMaxReachedMs, videoWatchSatisfied } from "@parvaordo/shared";
import { getDb } from "../db/client";
import { getAsset } from "../media/assets";

// Student-progress data access. `lesson_item_progress` RLS isolates rows to the PARISH
// only (the house model has no per-user GUC — `getDb` sets parish/diocese, not the user),
// so per-student OWNERSHIP is enforced HERE at the app/core layer: every read and write is
// keyed by `studentId`, and callers MUST pass the SESSION user id (never a client param),
// so a learner reaches only their own rows. DB-layer per-user ownership is a deferred
// cross-cutting RFC (po-s6vb; see CLAUDE.md "Student-owned tables").

/** Mark a lesson item complete for a student (idempotent). */
export async function markItemComplete(params: { parishId: string; studentId: string; itemId: string }): Promise<void> {
  await getDb(params.parishId).query(
    `INSERT INTO lesson_item_progress (parish_id, student_id, item_id, completed)
     VALUES ($1, $2, $3, true)
     ON CONFLICT (student_id, item_id)
     DO UPDATE SET completed = true, updated_at = now()`,
    [params.parishId, params.studentId, params.itemId],
  );
}

/**
 * Trusted upper bound (ms) for how far a student can legitimately have watched a video
 * lesson item — the clip's real playable length. Mirrors how the lesson page derives the
 * player window: a cut clip's own duration, else the explicit [start,end] window, else
 * the source duration from the start offset. Returns null when it can't be determined
 * (not a video item, or no known duration), in which case progress is left unvalidated.
 */
async function videoItemDurationMs(parishId: string, itemId: string): Promise<number | null> {
  const { rows } = await getDb(parishId).query<{ kind: string; content: Record<string, unknown> }>(
    "SELECT kind, content FROM lesson_items WHERE id = $1",
    [itemId],
  );
  const row = rows[0];
  if (!row || row.kind !== "video") return null;
  const content = row.content ?? {};
  const startMs = Number(content.start_ms ?? 0);

  const clipId = typeof content.clip_asset_id === "string" ? content.clip_asset_id : null;
  if (clipId) {
    const clip = await getAsset(parishId, clipId);
    if (clip?.durationMs != null) return Math.max(0, clip.durationMs);
  }
  if (content.end_ms != null) return Math.max(0, Number(content.end_ms) - startMs);
  const assetId = typeof content.asset_id === "string" ? content.asset_id : null;
  if (assetId) {
    const source = await getAsset(parishId, assetId);
    if (source?.durationMs != null) return Math.max(0, source.durationMs - startMs);
  }
  return null;
}

/**
 * Persist video watch progress: the furthest point reached (only ever grows) and a
 * completion flag DERIVED SERVER-SIDE from that point against the clip's real length —
 * never trusted from the client. The client report is first PACED against the real
 * wall-clock elapsed since the previous save (`pacedMaxReachedMs`), so a single forged
 * save can't jump the point to the clip end — reaching the end takes roughly a clip-length
 * of real time (closes the po-4dyo residual). The paced point is then clamped to the clip
 * (it seeds the seek-enforcement ceiling, so a forged value mustn't inflate it), and
 * completion is gated on `videoWatchSatisfied`. Together these close the forges: the
 * client `completed` flag (gone), a direct advanceAction POST, a save with no/too-little
 * progress, AND a one-shot jump to the clip end. When the clip length can't be resolved
 * the (paced) report is stored as-is and completion stays false.
 */
export async function markVideoProgress(params: {
  parishId: string;
  studentId: string;
  itemId: string;
  maxReachedMs: number;
}): Promise<void> {
  const reportedMax = Number.isFinite(params.maxReachedMs) ? Math.max(0, params.maxReachedMs) : 0;
  const durationMs = await videoItemDurationMs(params.parishId, params.itemId);
  const db = getDb(params.parishId);

  // Read the prior furthest point AND the real time since it was last written, both on the
  // DB clock, so the report can be paced against actual elapsed time. No prior row → this
  // is the first save (null elapsed → the fixed first-save budget). (Two statements rather
  // than one CTE keep the pacing math pure + unit-tested; saves for one student+item are
  // effectively serial — one throttled player — so the read→write window isn't a vector.)
  const { rows } = await db.query<{ prev_max: number | null; wall_elapsed_ms: number | null }>(
    `SELECT max_reached_ms AS prev_max,
            EXTRACT(EPOCH FROM (now() - updated_at)) * 1000 AS wall_elapsed_ms
       FROM lesson_item_progress
      WHERE student_id = $1 AND item_id = $2`,
    [params.studentId, params.itemId],
  );
  const prior = rows[0];
  const prevMax = prior?.prev_max ?? 0;
  const wallElapsedMs = prior ? Number(prior.wall_elapsed_ms) : null;

  // Pace against real elapsed time, THEN clamp to the clip so a forged report can't inflate
  // the seek-enforcement ceiling beyond the real window.
  const paced = pacedMaxReachedMs(prevMax, reportedMax, wallElapsedMs);
  const storedMax = Math.floor(durationMs != null ? Math.min(paced, durationMs) : paced);
  // Completion is derived from the (paced + clamped) furthest point — never from the client.
  const completed = videoWatchSatisfied(storedMax, durationMs);

  await db.query(
    `INSERT INTO lesson_item_progress (parish_id, student_id, item_id, completed, max_reached_ms)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, item_id) DO UPDATE SET
       completed = lesson_item_progress.completed OR EXCLUDED.completed,
       max_reached_ms = GREATEST(COALESCE(lesson_item_progress.max_reached_ms, 0), COALESCE(EXCLUDED.max_reached_ms, 0)),
       updated_at = now()`,
    [params.parishId, params.studentId, params.itemId, completed, storedMax],
  );
}

/** Furthest point (ms, clip-relative) a student has reached on a video item. */
export async function getItemMaxReached(parishId: string, studentId: string, itemId: string): Promise<number> {
  const { rows } = await getDb(parishId).query<{ max_reached_ms: number | null }>(
    "SELECT max_reached_ms FROM lesson_item_progress WHERE student_id = $1 AND item_id = $2",
    [studentId, itemId],
  );
  return rows[0]?.max_reached_ms ?? 0;
}

/**
 * Server-side video-watch gate — the authoritative check behind the player's cosmetic
 * `watched` button. True once the student's persisted furthest-reached point is within
 * tolerance of the clip end (`videoWatchSatisfied`). `advanceAction` calls this before
 * completing a video item so a tampered (unwatched) completion is bounced, not trusted.
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
