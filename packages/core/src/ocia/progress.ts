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

// How close to the clip's end (ms) a student must reach for completion to count as
// "earned". Matches the player, which flips the clip to "watched" within 5s of the end.
const COMPLETION_GRACE_MS = 5_000;
// Slack above the recorded duration tolerated before a report is treated as forged:
// the decoded video can run marginally longer than its stored metadata. A value past
// this is rejected for completion (and the stored furthest point is clamped to the clip).
const OVERSHOOT_GRACE_MS = 2_000;

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
 * Persist video watch progress: the furthest point reached (only ever grows) and,
 * optionally, completion. Used for resume + seek-enforcement that survives reloads.
 *
 * `maxReachedMs` and `completed` arrive straight from the client, so they're validated
 * against the clip's real length before they're trusted: the stored furthest point is
 * clamped to the clip (it gates seek-enforcement, so a forged value mustn't inflate it),
 * and completion is only honored when the report actually reaches the clip's end — a
 * forged or over-large value can't self-award completion. When the length can't be
 * resolved we fall back to recording the report as-is.
 */
export async function markVideoProgress(params: {
  parishId: string;
  studentId: string;
  itemId: string;
  maxReachedMs?: number;
  completed?: boolean;
}): Promise<void> {
  const reportedMax = Number.isFinite(params.maxReachedMs) ? (params.maxReachedMs as number) : null;
  let storedMax = reportedMax;
  let completed = params.completed ?? false;

  const durationMs = await videoItemDurationMs(params.parishId, params.itemId);
  if (durationMs != null) {
    if (reportedMax != null) storedMax = Math.min(Math.max(reportedMax, 0), durationMs);
    const reachedEnd =
      reportedMax != null &&
      reportedMax >= durationMs - COMPLETION_GRACE_MS &&
      reportedMax <= durationMs + OVERSHOOT_GRACE_MS;
    completed = completed && reachedEnd;
  }

  await getDb(params.parishId).query(
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
