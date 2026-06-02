import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getStudentAnsweredLessons, submitAnswer } from "@parvaordo/core";

const { Client } = pg;

// Seed parishes (see infra/db/seed.mjs). HS + SM are used for the cross-tenant check.
const HS = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const SM = "22222222-2222-2222-2222-222222222222"; // St. Monica

let owner: InstanceType<typeof Client>;
const NAME = "INT-answers:"; // tag every row this suite creates, for teardown
const made: { lessons: string[] } = { lessons: [] };

// A published parish lesson (live v1) with the given items; owner conn bypasses RLS.
async function seedLesson(
  parishId: string,
  title: string,
  items: Array<{ kind: string; content: object }>,
): Promise<{ lessonId: string; itemIds: string[] }> {
  const l = await owner.query<{ id: string }>(
    "INSERT INTO lessons (scope, parish_id, lesson_order) VALUES ('parish', $1, 0) RETURNING id",
    [parishId],
  );
  const lessonId = l.rows[0]!.id;
  made.lessons.push(lessonId);
  const v = await owner.query<{ id: string }>(
    `INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title, published_at)
     VALUES ($1, 'parish', $2, 1, $3, now()) RETURNING id`,
    [lessonId, parishId, NAME + title],
  );
  const versionId = v.rows[0]!.id;
  const itemIds: string[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    const r = await owner.query<{ id: string }>(
      `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
       VALUES ('parish', $1, $2, $3, $4, $5) RETURNING id`,
      [parishId, versionId, i, it.kind, JSON.stringify(it.content)],
    );
    itemIds.push(r.rows[0]!.id);
  }
  await owner.query("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [versionId, lessonId]);
  return { lessonId, itemIds };
}

async function makeStudent(parishId: string, email: string): Promise<string> {
  const u = await owner.query<{ id: string }>(
    "INSERT INTO users (email, display_name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id",
    [email, NAME + email],
  );
  const userId = u.rows[0]!.id;
  await owner.query(
    `INSERT INTO memberships (user_id, parish_id, role) VALUES ($1, $2, 'catechumen_candidate')
     ON CONFLICT (user_id, parish_id, ministry_id, role) DO NOTHING`,
    [userId, parishId],
  );
  return userId;
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
});

afterAll(async () => {
  for (const id of made.lessons) await owner.query("DELETE FROM lessons WHERE id = $1", [id]);
  await owner.query("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [
    "answers-int-%",
  ]);
  await owner.query("DELETE FROM users WHERE email LIKE $1", ["answers-int-%"]);
  await owner.end();
  await closeDb();
});

describe("getStudentAnsweredLessons (integration)", () => {
  it("lists only the lessons a student has answered, with the count, scoped to that student", async () => {
    const answered = await seedLesson(HS, "Answered", [
      { kind: "reading", content: { html: "r" } },
      { kind: "question", content: { prompt: "Who is Jesus?", format: "open_ended" } },
    ]);
    const unanswered = await seedLesson(HS, "Unanswered", [
      { kind: "question", content: { prompt: "Unasked", format: "open_ended" } },
    ]);
    const student = await makeStudent(HS, "answers-int-a@test.local");
    const other = await makeStudent(HS, "answers-int-b@test.local");

    const questionItemId = answered.itemIds[1]!; // the question item
    await submitAnswer({ parishId: HS, studentId: student, itemId: questionItemId, text: "The Son of God." });

    const list = await getStudentAnsweredLessons(HS, student);
    const ids = list.map((l) => l.lessonId);
    expect(ids).toContain(answered.lessonId);
    expect(ids).not.toContain(unanswered.lessonId); // no answers there → not listed

    const row = list.find((l) => l.lessonId === answered.lessonId)!;
    expect(row.answerCount).toBe(1);
    expect(row.title).toContain("Answered");
    expect(typeof row.lastAnsweredAt).toBe("string");
    expect(row.lastAnsweredAt.length).toBeGreaterThan(0);

    // A different student with no answers sees nothing.
    expect(await getStudentAnsweredLessons(HS, other)).toEqual([]);
  });

  it("does not leak a student's answered lessons to another parish (RLS)", async () => {
    const answered = await seedLesson(HS, "RLS", [
      { kind: "question", content: { prompt: "q", format: "open_ended" } },
    ]);
    const student = await makeStudent(HS, "answers-int-rls@test.local");
    await submitAnswer({ parishId: HS, studentId: student, itemId: answered.itemIds[0]!, text: "secret" });

    expect(await getStudentAnsweredLessons(HS, student)).toHaveLength(1);
    expect(await getStudentAnsweredLessons(SM, student)).toEqual([]); // other parish cannot see it
  });
});
