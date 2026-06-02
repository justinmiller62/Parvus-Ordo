import "dotenv/config";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addScheduleEntry,
  closeDb,
  createCohort,
  createPath,
  generateSchedule,
  getCohortSchedule,
  getCohortStudents,
  getDb,
  getPathDetail,
  getPublishedLessons,
  getStudentLessons,
  isStudentLessonLocked,
  listCohortCards,
  listParishStudents,
  markItemComplete,
  setPathLessons,
  setSequential,
  togglePathMember,
  toggleMember,
  updateCohortSettings,
  updateScheduleEntry,
} from "@parvaordo/core";

const { Client } = pg;

// Seed parishes (see infra/db/seed.mjs). HS + SM share a diocese; both used for the
// cross-tenant isolation assertions.
const HS = "11111111-1111-1111-1111-111111111111"; // Holy Spirit
const SM = "22222222-2222-2222-2222-222222222222"; // St. Monica

let owner: InstanceType<typeof Client>;
const NAME = "INT-cohorts:"; // tag every row this suite creates, for teardown
const made: { lessons: string[] } = { lessons: [] };

// Insert a published parish lesson with the given items directly (owner bypasses RLS).
async function seedLesson(parishId: string, title: string, items: Array<{ kind: string; content: object }>) {
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
  // Cohorts cascade to schedule/members/paths; lessons cascade to versions/items.
  await owner.query("DELETE FROM cohorts WHERE name LIKE $1", [NAME + "%"]);
  for (const id of made.lessons) await owner.query("DELETE FROM lessons WHERE id = $1", [id]);
  await owner.query("DELETE FROM memberships WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)", [
    "cohort-int-%",
  ]);
  await owner.query("DELETE FROM users WHERE email LIKE $1", ["cohort-int-%"]);
  await owner.end();
  await closeDb();
});

describe("cohorts — CRUD + cross-tenant isolation (integration)", () => {
  it("creates cohorts scoped to their parish and never leaks across tenants", async () => {
    const hs = (await createCohort(HS, NAME + "HS Alpha"))!;
    const sm = (await createCohort(SM, NAME + "SM Beta"))!;
    expect(hs).toBeTruthy();
    expect(sm).toBeTruthy();

    const hsCards = await listCohortCards(HS);
    const smCards = await listCohortCards(SM);
    expect(hsCards.find((c) => c.id === hs)).toBeTruthy();
    expect(hsCards.find((c) => c.id === sm)).toBeFalsy(); // SM's cohort not visible to HS
    expect(smCards.find((c) => c.id === sm)).toBeTruthy();
    expect(smCards.find((c) => c.id === hs)).toBeFalsy();

    // RLS hides the row entirely from the other parish.
    const leaked = await getDb(SM).query("SELECT id FROM cohorts WHERE id = $1", [hs]);
    expect(leaked.rows).toHaveLength(0);
    expect(await getCohortSchedule(SM, hs)).toEqual([]); // settings null → empty
  });

  it("rejects empty names", async () => {
    expect(await createCohort(HS, "   ")).toBeNull();
  });

  it("only adds parish members to a roster (cross-parish student blocked)", async () => {
    const cohort = (await createCohort(HS, NAME + "Roster"))!;
    const hsStudent = await makeStudent(HS, "cohort-int-hs-roster@test.local");
    const smStudent = await makeStudent(SM, "cohort-int-sm-roster@test.local");

    await toggleMember(HS, cohort, hsStudent, true);
    await toggleMember(HS, cohort, smStudent, true); // must be a no-op (not an HS member)

    const roster = await owner.query<{ student_id: string }>(
      "SELECT student_id FROM cohort_members WHERE cohort_id = $1",
      [cohort],
    );
    const ids = roster.rows.map((r) => r.student_id);
    expect(ids).toContain(hsStudent);
    expect(ids).not.toContain(smStudent);

    // listParishStudents marks roster membership and only lists HS learners.
    const students = await listParishStudents(HS, cohort);
    expect(students.find((s) => s.userId === hsStudent)?.inCohort).toBe(true);
    expect(students.find((s) => s.userId === smStudent)).toBeFalsy();

    await toggleMember(HS, cohort, hsStudent, false);
    const after = await listParishStudents(HS, cohort);
    expect(after.find((s) => s.userId === hsStudent)?.inCohort).toBe(false);
  });
});

describe("cohorts — schedule generation + edits (integration)", () => {
  it("auto-generates weekly dates capped by the window, in one transaction", async () => {
    // Ensure ≥3 published lessons are visible to HS (global+diocese seed already gives 3,
    // but add parish ones so the count is unambiguous).
    await seedLesson(HS, "gen-a", [{ kind: "reading", content: { html: "a" } }]);
    await seedLesson(HS, "gen-b", [{ kind: "reading", content: { html: "b" } }]);
    await seedLesson(HS, "gen-c", [{ kind: "reading", content: { html: "c" } }]);

    const cohort = (await createCohort(HS, NAME + "Gen"))!;
    // Window: 2026-06-01 (Mon) → 2026-06-16, Tuesdays ⇒ 06-02, 06-09, 06-16 = 3 weeks.
    await updateCohortSettings(HS, cohort, {
      name: NAME + "Gen",
      startDate: "2026-06-01",
      endDate: "2026-06-16",
      discussionDay: "Tuesday",
      discussionTime: "7:00 PM",
      discussionLocation: "Parish Hall",
    });
    const count = await generateSchedule(HS, cohort);
    expect(count).toBe(3); // window-capped, even though >3 lessons exist

    const sched = await getCohortSchedule(HS, cohort);
    expect(sched.map((s) => s.discussionDate)).toEqual(["2026-06-02", "2026-06-09", "2026-06-16"]);
    expect(sched.map((s) => s.weekNumber)).toEqual([1, 2, 3]);
    // Effective time/location fall back to the cohort defaults; due = discussion − 1.
    expect(sched[0]!.effectiveTime).toBe("7:00 PM");
    expect(sched[0]!.effectiveLocation).toBe("Parish Hall");
    expect(sched[1]!.effectiveDueDate).toBe("2026-06-08");
    // Re-generating wipes + rebuilds (still 3, not 6).
    expect(await generateSchedule(HS, cohort)).toBe(3);
    expect(await getCohortSchedule(HS, cohort)).toHaveLength(3);
  });

  it("adds a manual entry 7 days out and records a date override on edit", async () => {
    const { lessonId } = await seedLesson(HS, "manual", [{ kind: "reading", content: { html: "m" } }]);
    const cohort = (await createCohort(HS, NAME + "Manual"))!;
    await updateCohortSettings(HS, cohort, {
      name: NAME + "Manual",
      startDate: "2026-06-01",
      endDate: null,
      discussionDay: null,
      discussionTime: null,
      discussionLocation: null,
    });
    await addScheduleEntry(HS, cohort, lessonId); // first → start_date + 7 = 2026-06-08
    let sched = await getCohortSchedule(HS, cohort);
    expect(sched).toHaveLength(1);
    expect(sched[0]!.discussionDate).toBe("2026-06-08");
    expect(sched[0]!.weekNumber).toBe(1);
    expect(sched[0]!.isDateOverride).toBe(false);

    await updateScheduleEntry(HS, sched[0]!.id, { discussionDate: "2026-06-10", timeOverride: "8:00 PM" });
    sched = await getCohortSchedule(HS, cohort);
    expect(sched[0]!.discussionDate).toBe("2026-06-10");
    expect(sched[0]!.isDateOverride).toBe(true); // editing the discussion date flips this
    expect(sched[0]!.effectiveTime).toBe("8:00 PM"); // per-entry override wins
  });
});

describe("cohorts — student gating read model (integration)", () => {
  // Three past-dated lessons (all released by default), one cohort, one student.
  let cohort: string;
  let student: string;
  let L: string[];

  beforeAll(async () => {
    cohort = (await createCohort(HS, NAME + "Gating"))!;
    student = await makeStudent(HS, "cohort-int-gating@test.local");
    await toggleMember(HS, cohort, student, true);
    await setSequential(HS, cohort, true);
    const a = await seedLesson(HS, "L1", [{ kind: "reading", content: { html: "1" } }]);
    const b = await seedLesson(HS, "L2", [{ kind: "reading", content: { html: "2" } }]);
    const c = await seedLesson(HS, "L3", [{ kind: "reading", content: { html: "3" } }]);
    L = [a.lessonId, b.lessonId, c.lessonId];
    // Exact past dates so they are released regardless of "today".
    const dates = ["2026-01-06", "2026-01-13", "2026-01-20"];
    for (let i = 0; i < 3; i++) {
      await owner.query(
        `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number)
         VALUES ($1, $2, $3, $4, $5)`,
        [HS, cohort, L[i], dates[i], i + 1],
      );
    }
  });

  it("a student not in any cohort sees zero lessons", async () => {
    const orphan = await makeStudent(HS, "cohort-int-orphan@test.local");
    expect(await getStudentLessons(HS, orphan)).toEqual([]);
  });

  it("sequential cohort locks each lesson until the prior is complete", async () => {
    let lessons = await getStudentLessons(HS, student);
    expect(lessons.map((l) => l.lessonId)).toEqual(L); // schedule order
    expect(lessons.map((l) => l.locked)).toEqual([false, true, true]); // L1 open, rest locked

    // Complete L1 (its single item) → L2 unlocks, L3 still locked.
    const items = await getDb(HS).query<{ id: string }>(
      `SELECT li.id FROM lesson_items li JOIN lessons l ON l.live_version_id = li.version_id WHERE l.id = $1`,
      [L[0]],
    );
    await markItemComplete({ parishId: HS, studentId: student, itemId: items.rows[0]!.id });
    lessons = await getStudentLessons(HS, student);
    expect(lessons.map((l) => l.locked)).toEqual([false, false, true]);
    expect(lessons.find((l) => l.lessonId === L[0])!.status).toBe("completed");
  });

  it("hides a future-release lesson (drip)", async () => {
    await owner.query(
      "UPDATE cohort_schedule SET release_date = '2099-01-01' WHERE cohort_id = $1 AND lesson_id = $2",
      [cohort, L[2]],
    );
    const lessons = await getStudentLessons(HS, student);
    expect(lessons.find((l) => l.lessonId === L[2])).toBeFalsy(); // L3 hidden
    expect(lessons).toHaveLength(2);
    // restore
    await owner.query("UPDATE cohort_schedule SET release_date = NULL WHERE cohort_id = $1 AND lesson_id = $2", [
      cohort,
      L[2],
    ]);
  });

  it("a student in a learning path sees only the path ∩ released lessons", async () => {
    const path = (await createPath(HS, cohort, NAME + "Path"))!;
    await setPathLessons(HS, path, [L[0]!]); // only L1
    await togglePathMember(HS, path, student, true);

    const lessons = await getStudentLessons(HS, student);
    expect(lessons.map((l) => l.lessonId)).toEqual([L[0]]); // intersection

    const detail = await getPathDetail(HS, path);
    expect(detail!.lessons.map((l) => l.lessonId)).toEqual([L[0]]);
    expect(detail!.members.find((m) => m.studentId === student)?.inPath).toBe(true);

    // cleanup so later assertions in this describe aren't affected
    await togglePathMember(HS, path, student, false);
  });
});

describe("cohorts — teacher Students-tab progress (integration)", () => {
  it("counts a lesson completed only when all its questions are answered", async () => {
    const cohort = (await createCohort(HS, NAME + "Progress"))!;
    const student = await makeStudent(HS, "cohort-int-progress@test.local");
    await toggleMember(HS, cohort, student, true);
    // One lesson with two questions; answer both → completed. One with a question left blank.
    const q2 = await seedLesson(HS, "Q2", [
      { kind: "question", content: { prompt: "a", format: "open_ended" } },
      { kind: "question", content: { prompt: "b", format: "open_ended" } },
    ]);
    const q1 = await seedLesson(HS, "Q1", [{ kind: "question", content: { prompt: "c", format: "open_ended" } }]);
    await owner.query(
      `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number) VALUES
        ($1,$2,$3,'2026-02-03',1), ($1,$2,$4,'2026-02-10',2)`,
      [HS, cohort, q2.lessonId, q1.lessonId],
    );
    // Answer both questions of the 2-question lesson, none of the other.
    for (const itemId of q2.itemIds) {
      await owner.query("INSERT INTO answers (parish_id, item_id, student_id, text) VALUES ($1, $2, $3, 'ans')", [
        HS,
        itemId,
        student,
      ]);
    }

    const progress = await getCohortStudents(HS, cohort);
    const me = progress.find((p) => p.userId === student)!;
    expect(me.total).toBe(2); // two lessons have questions
    expect(me.completed).toBe(1); // only the fully-answered lesson counts
  });
});

describe("cohorts — student list closes the over-exposure leak (integration)", () => {
  // The legacy learner list called getPublishedLessons() and rendered EVERY published
  // parish lesson unconditionally. The fix routes the learner through getStudentLessons,
  // which only surfaces lessons the student's cohort schedule has released to them.
  // These two tests pin the leak shut: a lesson getPublishedLessons WOULD have shown is
  // absent from the gated list when the student isn't entitled to it yet.
  it("a not-enrolled student does NOT see a published lesson that getPublishedLessons returns", async () => {
    const { lessonId } = await seedLesson(HS, "overexpose-unenrolled", [{ kind: "reading", content: { html: "x" } }]);
    const loner = await makeStudent(HS, "cohort-int-overexpose-a@test.local");

    const published = await getPublishedLessons(HS);
    expect(published.map((l) => l.id)).toContain(lessonId); // the legacy path WOULD have shown it

    const gated = await getStudentLessons(HS, loner);
    expect(gated.map((l) => l.lessonId)).not.toContain(lessonId); // the gated path hides it
    expect(gated).toEqual([]); // not in any cohort → nothing at all
  });

  it("an enrolled student before a lesson's release date does NOT see it (drip), though it is published", async () => {
    const { lessonId } = await seedLesson(HS, "overexpose-future", [{ kind: "reading", content: { html: "y" } }]);
    const cohort = (await createCohort(HS, NAME + "Overexpose"))!;
    const student = await makeStudent(HS, "cohort-int-overexpose-b@test.local");
    await toggleMember(HS, cohort, student, true);
    // Scheduled, but with a release date far in the future → not released to the student yet.
    await owner.query(
      `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, release_date, week_number)
       VALUES ($1, $2, $3, '2099-01-06', '2099-01-01', 1)`,
      [HS, cohort, lessonId],
    );

    const published = await getPublishedLessons(HS);
    expect(published.map((l) => l.id)).toContain(lessonId); // still published parish-wide

    const gated = await getStudentLessons(HS, student);
    expect(gated.map((l) => l.lessonId)).not.toContain(lessonId); // hidden until its release date passes
  });
});

describe("cohorts — isStudentLessonLocked server-enforcement guard (integration)", () => {
  // The guard the lesson view + advanceAction call to refuse a locked deep-link. It must
  // mirror the list's lock state exactly (it reuses getStudentLessons), honor skip_sequence
  // and cohort.sequential, and never over-refuse a lesson outside the student's gated list.
  it("locks a sequenced lesson until the prior is complete, honors skip_sequence, never locks an out-of-list lesson", async () => {
    const cohort = (await createCohort(HS, NAME + "LockGuard"))!;
    const student = await makeStudent(HS, "cohort-int-lockguard@test.local");
    await toggleMember(HS, cohort, student, true);
    await setSequential(HS, cohort, true);
    const a = await seedLesson(HS, "LG1", [{ kind: "reading", content: { html: "1" } }]);
    const b = await seedLesson(HS, "LG2", [{ kind: "reading", content: { html: "2" } }]);
    await owner.query(
      `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number)
       VALUES ($1, $2, $3, '2026-01-06', 1), ($1, $2, $4, '2026-01-13', 2)`,
      [HS, cohort, a.lessonId, b.lessonId],
    );

    // First sequenced lesson is open; the next is locked while the prior is incomplete.
    expect(await isStudentLessonLocked(HS, student, a.lessonId)).toBe(false);
    expect(await isStudentLessonLocked(HS, student, b.lessonId)).toBe(true);

    // A lesson absent from the student's gated list is never "locked" (hidden/out-of-cohort
    // is a separate concern — the guard must not over-refuse legitimate access).
    expect(await isStudentLessonLocked(HS, student, "00000000-0000-0000-0000-000000000000")).toBe(false);

    // skip_sequence exempts the lesson from the chain → no longer locked.
    await owner.query("UPDATE cohort_schedule SET skip_sequence = true WHERE cohort_id = $1 AND lesson_id = $2", [
      cohort,
      b.lessonId,
    ]);
    expect(await isStudentLessonLocked(HS, student, b.lessonId)).toBe(false);
    await owner.query("UPDATE cohort_schedule SET skip_sequence = false WHERE cohort_id = $1 AND lesson_id = $2", [
      cohort,
      b.lessonId,
    ]);
    expect(await isStudentLessonLocked(HS, student, b.lessonId)).toBe(true); // restored

    // Completing the prerequisite unlocks it.
    const items = await getDb(HS).query<{ id: string }>(
      "SELECT li.id FROM lesson_items li JOIN lessons l ON l.live_version_id = li.version_id WHERE l.id = $1",
      [a.lessonId],
    );
    await markItemComplete({ parishId: HS, studentId: student, itemId: items.rows[0]!.id });
    expect(await isStudentLessonLocked(HS, student, b.lessonId)).toBe(false);
  });

  it("never locks in a non-sequential cohort", async () => {
    const cohort = (await createCohort(HS, NAME + "NonSeq"))!;
    const student = await makeStudent(HS, "cohort-int-nonseq@test.local");
    await toggleMember(HS, cohort, student, true);
    await setSequential(HS, cohort, false);
    const a = await seedLesson(HS, "NS1", [{ kind: "reading", content: { html: "1" } }]);
    const b = await seedLesson(HS, "NS2", [{ kind: "reading", content: { html: "2" } }]);
    await owner.query(
      `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number)
       VALUES ($1, $2, $3, '2026-01-06', 1), ($1, $2, $4, '2026-01-13', 2)`,
      [HS, cohort, a.lessonId, b.lessonId],
    );
    expect(await isStudentLessonLocked(HS, student, b.lessonId)).toBe(false);
  });
});
