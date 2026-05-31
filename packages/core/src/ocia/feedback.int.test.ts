import "dotenv/config";
import { afterAll, describe, expect, it } from "vitest";
import {
  closeDb,
  createLesson,
  deleteLesson,
  getDb,
  getStudentFeedback,
  getStudentQuestions,
  submitStudentFeedback,
  submitStudentQuestion,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333";

async function userId(email: string): Promise<string> {
  const { rows } = await getDb(HOLY_SPIRIT).query<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]);
  return rows[0]!.id;
}

afterAll(async () => {
  await closeDb();
});

describe("student questions + feedback", () => {
  it("captures questions/feedback and lists them per lesson with the student's name", async () => {
    const by = await userId("admin@parvaordo.test");
    const student = await userId("student@parvaordo.test");
    const lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: by, title: "Q&A Test" });

    await submitStudentQuestion({ parishId: HOLY_SPIRIT, studentId: student, lessonId, text: "Why the Trinity?" });
    await submitStudentFeedback({ parishId: HOLY_SPIRIT, studentId: student, lessonId, text: "Loved it." });

    const qs = await getStudentQuestions(HOLY_SPIRIT, lessonId);
    expect(qs).toHaveLength(1);
    expect(qs[0]?.text).toBe("Why the Trinity?");
    expect(qs[0]?.studentName).toBe("Catechumen");
    const fb = await getStudentFeedback(HOLY_SPIRIT, lessonId);
    expect(fb[0]?.text).toBe("Loved it.");

    // another parish sees none of it (RLS isolation)
    expect(await getStudentQuestions(ST_PETER, lessonId)).toHaveLength(0);

    await deleteLesson(HOLY_SPIRIT, lessonId); // cascades questions + feedback
    expect(await getStudentQuestions(HOLY_SPIRIT, lessonId)).toHaveLength(0);
  });
});
