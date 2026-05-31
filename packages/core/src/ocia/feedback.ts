// Student → catechist channel: questions and feedback submitted from a lesson's
// completion screen. Both tables (student_questions, student_feedback) are
// parish-isolated by RLS, so the catechist inbox reads only its own parish.

import { getDb } from "../db/client";

export interface StudentMessage {
  id: string;
  studentName: string;
  text: string;
  createdAt: string;
}

function toIso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : v == null ? "" : String(v);
}

export async function submitStudentQuestion(p: {
  parishId: string;
  studentId: string;
  lessonId: string;
  text: string;
}): Promise<void> {
  await getDb(p.parishId).query(
    "INSERT INTO student_questions (parish_id, lesson_id, student_id, text) VALUES ($1, $2, $3, $4)",
    [p.parishId, p.lessonId, p.studentId, p.text],
  );
}

export async function submitStudentFeedback(p: {
  parishId: string;
  studentId: string;
  lessonId: string;
  text: string;
}): Promise<void> {
  await getDb(p.parishId).query(
    "INSERT INTO student_feedback (parish_id, lesson_id, student_id, text) VALUES ($1, $2, $3, $4)",
    [p.parishId, p.lessonId, p.studentId, p.text],
  );
}

async function listMessages(parishId: string, lessonId: string, table: "student_questions" | "student_feedback") {
  const { rows } = await getDb(parishId).query<{ id: string; student_name: string; text: string; created_at: unknown }>(
    `SELECT m.id, u.display_name AS student_name, m.text, m.created_at
       FROM ${table} m JOIN users u ON u.id = m.student_id
      WHERE m.lesson_id = $1
      ORDER BY m.created_at DESC`,
    [lessonId],
  );
  return rows.map((r) => ({ id: r.id, studentName: r.student_name, text: r.text, createdAt: toIso(r.created_at) }));
}

/** Catechist inbox: questions students asked on this lesson (newest first). */
export function getStudentQuestions(parishId: string, lessonId: string): Promise<StudentMessage[]> {
  return listMessages(parishId, lessonId, "student_questions");
}

/** Catechist inbox: feedback students left on this lesson (newest first). */
export function getStudentFeedback(parishId: string, lessonId: string): Promise<StudentMessage[]> {
  return listMessages(parishId, lessonId, "student_feedback");
}
