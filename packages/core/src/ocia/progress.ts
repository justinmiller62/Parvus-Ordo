import { getDb } from "../db/client";

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
 * Persist video watch progress: the furthest point reached (only ever grows) and,
 * optionally, completion. Used for resume + seek-enforcement that survives reloads.
 */
export async function markVideoProgress(params: {
  parishId: string;
  studentId: string;
  itemId: string;
  maxReachedMs?: number;
  completed?: boolean;
}): Promise<void> {
  await getDb(params.parishId).query(
    `INSERT INTO lesson_item_progress (parish_id, student_id, item_id, completed, max_reached_ms)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (student_id, item_id) DO UPDATE SET
       completed = lesson_item_progress.completed OR EXCLUDED.completed,
       max_reached_ms = GREATEST(COALESCE(lesson_item_progress.max_reached_ms, 0), COALESCE(EXCLUDED.max_reached_ms, 0)),
       updated_at = now()`,
    [params.parishId, params.studentId, params.itemId, params.completed ?? false, params.maxReachedMs ?? null],
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
