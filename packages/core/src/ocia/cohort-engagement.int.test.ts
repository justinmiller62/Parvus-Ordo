import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getCohortEngagement } from "@parvaordo/core";

const { Client } = pg;

const HS = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const SM = "22222222-2222-2222-2222-222222222222"; // St. Monica
const BASE = Date.parse("2026-03-01T00:00:00.000Z");
const at = (offsetSec: number): string => new Date(BASE + offsetSec * 1000).toISOString();

let owner: InstanceType<typeof Client>;
const NAME = "INT-cohort-eng:";
const made: { lessons: string[]; cohorts: string[] } = { lessons: [], cohorts: [] };

async function seedLesson(parishId: string, title: string): Promise<{ lessonId: string; versionId: string }> {
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
  await owner.query("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [versionId, lessonId]);
  return { lessonId, versionId };
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

async function createCohort(parishId: string, name: string): Promise<string> {
  const c = await owner.query<{ id: string }>("INSERT INTO cohorts (parish_id, name) VALUES ($1, $2) RETURNING id", [
    parishId,
    NAME + name,
  ]);
  const id = c.rows[0]!.id;
  made.cohorts.push(id);
  return id;
}

async function schedule(parishId: string, cohortId: string, lessonId: string, week: number): Promise<void> {
  await owner.query(
    "INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number) VALUES ($1, $2, $3, $4, $5)",
    [parishId, cohortId, lessonId, `2026-01-0${week}`, week],
  );
}

async function enroll(parishId: string, cohortId: string, studentId: string): Promise<void> {
  await owner.query("INSERT INTO cohort_members (parish_id, cohort_id, student_id) VALUES ($1, $2, $3)", [
    parishId,
    cohortId,
    studentId,
  ]);
}

async function event(
  parishId: string,
  studentId: string,
  lessonId: string,
  versionId: string,
  type: "lesson_start" | "lesson_complete",
  createdAt: string,
): Promise<void> {
  await owner.query(
    `INSERT INTO engagement_events (parish_id, student_id, lesson_id, version_id, event_type, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [parishId, studentId, lessonId, versionId, type, createdAt],
  );
}

beforeAll(async () => {
  owner = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await owner.connect();
});

afterAll(async () => {
  for (const id of made.cohorts) await owner.query("DELETE FROM cohorts WHERE id = $1", [id]);
  for (const id of made.lessons) await owner.query("DELETE FROM lessons WHERE id = $1", [id]);
  await owner.query("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [
    "cohort-eng-int-%",
  ]);
  await owner.query("DELETE FROM users WHERE email LIKE $1", ["cohort-eng-int-%"]);
  await owner.end();
  await closeDb();
});

describe("getCohortEngagement (integration)", () => {
  it("rolls started/completed lesson counts up across the cohort's lessons, per student", async () => {
    const cohort = await createCohort(HS, "Eng");
    const l1 = await seedLesson(HS, "L1");
    const l2 = await seedLesson(HS, "L2");
    await schedule(HS, cohort, l1.lessonId, 1);
    await schedule(HS, cohort, l2.lessonId, 2);
    const alice = await makeStudent(HS, "cohort-eng-int-alice@test.local");
    const bob = await makeStudent(HS, "cohort-eng-int-bob@test.local");
    await enroll(HS, cohort, alice);
    await enroll(HS, cohort, bob);

    // Alice: started + completed BOTH lessons. Bob: started lesson 1 only.
    await event(HS, alice, l1.lessonId, l1.versionId, "lesson_start", at(0));
    await event(HS, alice, l1.lessonId, l1.versionId, "lesson_complete", at(60));
    await event(HS, alice, l2.lessonId, l2.versionId, "lesson_start", at(120));
    await event(HS, alice, l2.lessonId, l2.versionId, "lesson_complete", at(180));
    await event(HS, bob, l1.lessonId, l1.versionId, "lesson_start", at(0));

    const s = await getCohortEngagement(HS, cohort);
    expect(s.lessonCount).toBe(2);
    expect(s.studentsStarted).toBe(2); // both started ≥1
    expect(s.studentsCompletedAll).toBe(1); // only Alice finished both
    expect(s.totalEvents).toBe(5);

    const aliceRow = s.perStudent.find((p) => p.studentId === alice)!;
    expect(aliceRow).toMatchObject({ lessonsStarted: 2, lessonsCompleted: 2 });
    const bobRow = s.perStudent.find((p) => p.studentId === bob)!;
    expect(bobRow).toMatchObject({ lessonsStarted: 1, lessonsCompleted: 0 });
    // Roster includes everyone (even a zero-engagement member would appear); here 2 members.
    expect(s.perStudent).toHaveLength(2);
  });

  it("is parish-isolated — another parish sees nothing for the cohort (RLS)", async () => {
    const cohort = await createCohort(HS, "EngRLS");
    const l1 = await seedLesson(HS, "RLS1");
    await schedule(HS, cohort, l1.lessonId, 1);
    const s = await makeStudent(HS, "cohort-eng-int-rls@test.local");
    await enroll(HS, cohort, s);
    await event(HS, s, l1.lessonId, l1.versionId, "lesson_start", at(0));

    expect((await getCohortEngagement(HS, cohort)).lessonCount).toBe(1);
    const other = await getCohortEngagement(SM, cohort); // HS cohort, viewed as SM
    expect(other.lessonCount).toBe(0);
    expect(other.perStudent).toEqual([]);
    expect(other.totalEvents).toBe(0);
  });
});
