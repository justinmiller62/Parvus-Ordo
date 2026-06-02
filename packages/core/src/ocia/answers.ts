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

/** One row of the student's "My Answers" surface — a lesson they have answers in. */
export interface AnsweredLesson {
  lessonId: string;
  title: string;
  answerCount: number;
  /** ISO timestamp of the most recently submitted/edited answer in this lesson. */
  lastAnsweredAt: string;
}

/**
 * Lessons the student has answered, most-recently-answered first — the aggregate
 * behind the "My Answers" surface. Only answers on each lesson's LIVE version count,
 * so the surface stays consistent with the review view (`?review=1`), which loads the
 * live version: every listed lesson has answers the review will actually show. Scoped
 * to the student (a_student_id) and the parish (RLS via getDb), so it never leaks
 * another student's or parish's answers.
 */
export async function getStudentAnsweredLessons(parishId: string, studentId: string): Promise<AnsweredLesson[]> {
  const { rows } = await getDb(parishId).query<{
    lesson_id: string;
    title: string;
    answer_count: number;
    last_answered_at: unknown;
  }>(
    `SELECT l.id AS lesson_id,
            lv.title AS title,
            count(a.id)::int AS answer_count,
            max(COALESCE(a.edited_at, a.submitted_at)) AS last_answered_at
       FROM answers a
       JOIN lesson_items li ON li.id = a.item_id
       JOIN lessons l ON l.live_version_id = li.version_id
       JOIN lesson_versions lv ON lv.id = l.live_version_id
      WHERE a.student_id = $1
      GROUP BY l.id, lv.title
      ORDER BY max(COALESCE(a.edited_at, a.submitted_at)) DESC NULLS LAST, lv.title`,
    [studentId],
  );
  return rows.map((r) => ({
    lessonId: r.lesson_id,
    title: r.title,
    answerCount: r.answer_count,
    lastAnsweredAt:
      r.last_answered_at instanceof Date ? r.last_answered_at.toISOString() : String(r.last_answered_at ?? ""),
  }));
}
