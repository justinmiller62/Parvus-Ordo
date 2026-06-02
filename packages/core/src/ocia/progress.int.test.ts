import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  closeDb,
  getAnswersForVersion,
  getCompletedItemsForVersion,
  getDb,
  markItemComplete,
  submitAnswer,
} from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333";
const GLOBAL_LESSON = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

let studentId: string;
let versionId: string;
let questionItemId: string;
let readingItemId: string;

beforeAll(async () => {
  const u = await getDb(HOLY_SPIRIT).query<{ id: string }>(
    "SELECT id FROM users WHERE email = 'student@parvaordo.test'",
  );
  studentId = u.rows[0]!.id;

  const lv = await getDb(HOLY_SPIRIT).query<{ live_version_id: string }>(
    "SELECT live_version_id FROM lessons WHERE id = $1",
    [GLOBAL_LESSON],
  );
  versionId = lv.rows[0]!.live_version_id;

  const items = await getDb(HOLY_SPIRIT).query<{ id: string; kind: string }>(
    "SELECT id, kind FROM lesson_items WHERE version_id = $1 ORDER BY position",
    [versionId],
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
    let answers = await getAnswersForVersion(HOLY_SPIRIT, studentId, versionId);
    expect(answers[questionItemId]).toBe("The Christ.");

    await submitAnswer({ parishId: HOLY_SPIRIT, studentId, itemId: questionItemId, text: "The Son of God." });
    answers = await getAnswersForVersion(HOLY_SPIRIT, studentId, versionId);
    expect(answers[questionItemId]).toBe("The Son of God.");
  });

  it("marks items complete (idempotent) and reports completion", async () => {
    await markItemComplete({ parishId: HOLY_SPIRIT, studentId, itemId: readingItemId });
    await markItemComplete({ parishId: HOLY_SPIRIT, studentId, itemId: readingItemId });
    const done = await getCompletedItemsForVersion(HOLY_SPIRIT, studentId, versionId);
    expect(done.has(readingItemId)).toBe(true);
  });

  it("does not leak one parish's answers/progress to another (RLS)", async () => {
    const answers = await getAnswersForVersion(ST_PETER, studentId, versionId);
    expect(answers[questionItemId]).toBeUndefined();
    const done = await getCompletedItemsForVersion(ST_PETER, studentId, versionId);
    expect(done.has(readingItemId)).toBe(false);
  });
});
