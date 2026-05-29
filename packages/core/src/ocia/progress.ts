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
}
