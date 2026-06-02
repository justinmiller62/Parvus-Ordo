import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addLessonItem,
  buildWeeklyExport,
  closeDb,
  createLesson,
  deleteLesson,
  getDb,
  getLessonDetail,
  getLessonForEdit,
  publishVersion,
  submitAnswer,
  submitStudentFeedback,
  submitStudentQuestion,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333"; // another diocese — RLS-isolated

// Self-contained fixtures (created in beforeAll, removed in afterAll).
const S1 = "wx-s1@inttest.local"; // Adults path
const S2 = "wx-s2@inttest.local"; // Adults path
const S3 = "wx-s3@inttest.local"; // Teens path
const EMAILS = [S1, S2, S3];

let cohortId: string;
let pAdults: string;
let pTeens: string;
let lessonId: string;
let questionItemId: string;
const uid: Record<string, string> = {};

async function makeUser(email: string, name: string): Promise<string> {
  const { rows } = await getDb(null).query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = $2 RETURNING id",
    [email, name],
  );
  return rows[0]!.id;
}

beforeAll(async () => {
  uid[S1] = await makeUser(S1, "Anne Adults");
  uid[S2] = await makeUser(S2, "Bob Adults");
  uid[S3] = await makeUser(S3, "Tess Teens");

  const db = getDb(HOLY_SPIRIT);
  const insertId = async (sql: string, params: unknown[]): Promise<string> =>
    (await db.query<{ id: string }>(sql, params)).rows[0]!.id;
  cohortId = await insertId("INSERT INTO cohorts (parish_id, name) VALUES ($1, 'Int Export Cohort') RETURNING id", [
    HOLY_SPIRIT,
  ]);
  pAdults = await insertId(
    "INSERT INTO learning_paths (parish_id, cohort_id, name) VALUES ($1, $2, 'Adults') RETURNING id",
    [HOLY_SPIRIT, cohortId],
  );
  pTeens = await insertId(
    "INSERT INTO learning_paths (parish_id, cohort_id, name) VALUES ($1, $2, 'Teens') RETURNING id",
    [HOLY_SPIRIT, cohortId],
  );
  for (const [path, email] of [
    [pAdults, S1],
    [pAdults, S2],
    [pTeens, S3],
  ] as const) {
    await db.query("INSERT INTO learning_path_members (parish_id, path_id, student_id) VALUES ($1, $2, $3)", [
      HOLY_SPIRIT,
      path,
      uid[email],
    ]);
  }

  // A published lesson: one reading block + one question.
  lessonId = await createLesson({ parishId: HOLY_SPIRIT, createdBy: uid[S1]!, title: "Grace & Mercy" });
  const versionId = (await getLessonForEdit(HOLY_SPIRIT, lessonId))!.selected.versionId;
  await addLessonItem({
    parishId: HOLY_SPIRIT,
    versionId,
    kind: "reading",
    content: { html: "<p>On <b>grace</b>.</p>" },
  });
  await addLessonItem({ parishId: HOLY_SPIRIT, versionId, kind: "question", content: { prompt: "What is grace?" } });
  await publishVersion({ parishId: HOLY_SPIRIT, lessonId, versionId });
  questionItemId = (await getLessonDetail(HOLY_SPIRIT, lessonId))!.items.find((i) => i.kind === "question")!.id;

  // Both paths study the SAME lesson in week 3 (shared lesson → per-path filtering).
  for (const path of [pAdults, pTeens]) {
    await db.query(
      "INSERT INTO learning_path_lessons (parish_id, path_id, lesson_id, week_number) VALUES ($1, $2, $3, 3)",
      [HOLY_SPIRIT, path, lessonId],
    );
  }

  // Answers: all three answer; student questions/feedback from one member each.
  for (const email of EMAILS) {
    await submitAnswer({ parishId: HOLY_SPIRIT, studentId: uid[email]!, itemId: questionItemId, text: `ans-${email}` });
  }
  await submitStudentQuestion({ parishId: HOLY_SPIRIT, studentId: uid[S1]!, lessonId, text: "q-from-adults" });
  await submitStudentFeedback({ parishId: HOLY_SPIRIT, studentId: uid[S3]!, lessonId, text: "fb-from-teens" });
});

afterAll(async () => {
  if (lessonId) await deleteLesson(HOLY_SPIRIT, lessonId); // cascades answers + SQ/SF
  if (cohortId) await getDb(HOLY_SPIRIT).query("DELETE FROM cohorts WHERE id = $1", [cohortId]); // cascades paths/members/path-lessons
  await getDb(null).query("DELETE FROM users WHERE email = ANY($1::text[])", [EMAILS]);
  await closeDb();
});

describe("buildWeeklyExport (integration)", () => {
  it("assembles per-path data, filtering answers/questions/feedback to each path's members", async () => {
    const ex = await buildWeeklyExport(HOLY_SPIRIT, { cohortId, week: 3 });

    expect(ex.cohortName).toBe("Int Export Cohort");
    expect(ex.paths.map((p) => p.pathName)).toEqual(["Adults", "Teens"]);

    const adults = ex.paths.find((p) => p.pathName === "Adults")!;
    const teens = ex.paths.find((p) => p.pathName === "Teens")!;

    expect(adults.readingBlocks).toEqual(["On grace."]); // HTML stripped
    expect(adults.questions[0]!.answers.map((a) => a.text).sort()).toEqual([`ans-${S1}`, `ans-${S2}`]);
    expect(teens.questions[0]!.answers.map((a) => a.text)).toEqual([`ans-${S3}`]);
    expect(adults.answerCount).toBe(2);
    expect(teens.answerCount).toBe(1);
    expect(ex.totalAnswers).toBe(3);

    // Student questions/feedback are path-scoped to the authoring member.
    expect(adults.studentQuestions.map((m) => m.text)).toEqual(["q-from-adults"]);
    expect(teens.studentQuestions).toEqual([]);
    expect(adults.studentFeedback).toEqual([]);
    expect(teens.studentFeedback.map((m) => m.text)).toEqual(["fb-from-teens"]);
  });

  it("isolates across tenants: another parish sees an empty export for the same cohort (RLS)", async () => {
    const ex = await buildWeeklyExport(ST_PETER, { cohortId, week: 3 });
    expect(ex.cohortName).toBe("");
    expect(ex.paths).toEqual([]);
    expect(ex.totalAnswers).toBe(0);
  });

  it("returns an empty export for a week with no assigned lessons", async () => {
    const ex = await buildWeeklyExport(HOLY_SPIRIT, { cohortId, week: 99 });
    expect(ex.cohortName).toBe("Int Export Cohort");
    expect(ex.paths).toEqual([]);
  });

  it("returns an empty export for a non-integer week (bad URL segment)", async () => {
    const ex = await buildWeeklyExport(HOLY_SPIRIT, { cohortId, week: Number.NaN });
    expect(ex.paths).toEqual([]);
  });
});
