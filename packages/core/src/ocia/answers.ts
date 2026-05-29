import { getDb } from "../db/client";

/**
 * Upsert a student's answer to a question item. parish-scoped (the answering
 * parish), so RLS isolates answers even when the lesson is global/diocese.
 * student_id is always the acting user, so a user can only write their own answer.
 */
export async function submitAnswer(params: {
  parishId: string;
  studentId: string;
  itemId: string;
  text: string;
}): Promise<void> {
  await getDb(params.parishId).query(
    `INSERT INTO answers (parish_id, item_id, student_id, text)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id, student_id)
     DO UPDATE SET text = EXCLUDED.text, edited_at = now()`,
    [params.parishId, params.itemId, params.studentId, params.text],
  );
}

/** A student's saved answers within a lesson version, keyed by lesson_item id. */
export async function getAnswersForVersion(
  parishId: string,
  studentId: string,
  versionId: string,
): Promise<Record<string, string>> {
  const { rows } = await getDb(parishId).query<{ item_id: string; text: string }>(
    `SELECT a.item_id, a.text
       FROM answers a
       JOIN lesson_items li ON li.id = a.item_id
      WHERE li.version_id = $1 AND a.student_id = $2`,
    [versionId, studentId],
  );
  return Object.fromEntries(rows.map((r) => [r.item_id, r.text]));
}
