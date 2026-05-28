import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  getAnswersForLesson,
  getCompletedItems,
  getDb,
  markItemComplete,
  submitAnswer,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333";
const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let studentId: string;
let questionItemId: string;
let readingItemId: string;

beforeAll(async () => {
  const u = await getDb(HOLY_SPIRIT).query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'student@parvaordo.test'",
  );
  studentId = u.rows[0]!.id;

  const items = await getDb(HOLY_SPIRIT).query<{ id: string; kind: string }>(
    "SELECT id, kind FROM lesson_items WHERE lesson_id = $1 ORDER BY position",
    [GLOBAL_LESSON],
  );
  readingItemId = items.rows.find((r) => r.kind === "reading")!.id;
  questionItemId = items.rows.find((r) => r.kind === "question")!.id;
});

afterAll(async () => {
  await closeDb();
});

describe("answers + progress (integration)", () => {
  it("upserts an answer (submit then edit)", async () => {
    await submitAnswer({ parishId: HOLY_SPIRIT, studentId, itemId: questionItemId, text: "The Christ." });
    let answers = await getAnswersForLesson(HOLY_SPIRIT, studentId, GLOBAL_LESSON);
    expect(answers[questionItemId]).toBe("The Christ.");

    await submitAnswer({ parishId: HOLY_SPIRIT, studentId, itemId: questionItemId, text: "The Son of God." });
    answers = await getAnswersForLesson(HOLY_SPIRIT, studentId, GLOBAL_LESSON);
    expect(answers[questionItemId]).toBe("The Son of God.");
  });

  it("marks items complete (idempotent) and reports completion", async () => {
    await markItemComplete({ parishId: HOLY_SPIRIT, studentId, itemId: readingItemId });
    await markItemComplete({ parishId: HOLY_SPIRIT, studentId, itemId: readingItemId });
    const done = await getCompletedItems(HOLY_SPIRIT, studentId, GLOBAL_LESSON);
    expect(done.has(readingItemId)).toBe(true);
  });

  it("does not leak one parish's answers/progress to another (RLS)", async () => {
    const answers = await getAnswersForLesson(ST_PETER, studentId, GLOBAL_LESSON);
    expect(answers[questionItemId]).toBeUndefined();
    const done = await getCompletedItems(ST_PETER, studentId, GLOBAL_LESSON);
    expect(done.has(readingItemId)).toBe(false);
  });
});
