import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, getEngagementSummary, recordEngagementEvent, withTenant } from "@parvaordo/core";

const HOLY_SPIRIT = "11111111-1111-1111-1111-111111111111";
const ST_PETER = "33333333-3333-3333-3333-333333333333";

// Deterministic timeline: all durations are derived from created_at deltas, so the test
// inserts events at fixed offsets from a fixed base (raw, to control created_at). The
// writer's own behavior (idempotency, answer_correct) is exercised separately below.
const BASE = Date.parse("2026-03-01T00:00:00.000Z");
const at = (offsetSec: number): string => new Date(BASE + offsetSec * 1000).toISOString();

const USERS = {
  A: "eng-it-a@parvaordo.test",
  B: "eng-it-b@parvaordo.test",
  C: "eng-it-c@parvaordo.test",
  D: "eng-it-d@parvaordo.test",
  E: "eng-it-e@parvaordo.test",
  F: "eng-it-f@parvaordo.test",
  G: "eng-it-g@parvaordo.test",
};
const EMAILS = Object.values(USERS);

let lessonId: string;
let versionId: string;
let readingItemId: string;
let questionItemId: string;
const id: Record<keyof typeof USERS, string> = {} as never;

async function insertEvent(e: {
  studentId: string;
  type: "lesson_start" | "step_complete" | "answer_submit" | "lesson_complete";
  itemId?: string | null;
  stepIndex?: number | null;
  stepKind?: "reading" | "video" | "question" | "feedback" | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}): Promise<void> {
  await withTenant(HOLY_SPIRIT, async (q) => {
    await q(
      `INSERT INTO engagement_events
         (parish_id, student_id, lesson_id, version_id, item_id, event_type, step_index, step_kind, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        HOLY_SPIRIT,
        e.studentId,
        lessonId,
        versionId,
        e.itemId ?? null,
        e.type,
        e.stepIndex ?? null,
        e.stepKind ?? null,
        e.metadata ?? {},
        e.createdAt,
      ],
    );
  });
}

beforeAll(async () => {
  // Clean any leftovers from a crashed prior run (cascades their events), then create
  // fresh users + a self-contained parish lesson (reading + multiple-choice question).
  await getDb(null).query("DELETE FROM users WHERE email = ANY($1)", [EMAILS]);

  for (const [key, email] of Object.entries(USERS)) {
    const { rows } = await getDb(null).query<{ id: string }>(
      "INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING id",
      [email, key], // display_name = "A".."G" → predictable sort
    );
    id[key as keyof typeof USERS] = rows[0]!.id;
  }

  await withTenant(HOLY_SPIRIT, async (q) => {
    const [lesson] = await q<{ id: string }>(
      "INSERT INTO lessons (scope, parish_id) VALUES ('parish', $1) RETURNING id",
      [HOLY_SPIRIT],
    );
    lessonId = lesson!.id;
    const [version] = await q<{ id: string }>(
      `INSERT INTO lesson_versions (lesson_id, scope, parish_id, version_number, title, published_at)
       VALUES ($1, 'parish', $2, 1, 'Engagement IT', now()) RETURNING id`,
      [lessonId, HOLY_SPIRIT],
    );
    versionId = version!.id;
    const [reading] = await q<{ id: string }>(
      `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
       VALUES ('parish', $1, $2, 0, 'reading', '{"html":"<p>Body</p>"}') RETURNING id`,
      [HOLY_SPIRIT, versionId],
    );
    readingItemId = reading!.id;
    const [question] = await q<{ id: string }>(
      `INSERT INTO lesson_items (scope, parish_id, version_id, position, kind, content)
       VALUES ('parish', $1, $2, 1, 'question',
         '{"prompt":"Who do you say that I am?","format":"multiple_choice","choices":[{"label":"Son of the living God","correct":true},{"label":"A prophet","correct":false}]}')
       RETURNING id`,
      [HOLY_SPIRIT, versionId],
    );
    questionItemId = question!.id;
    await q("UPDATE lessons SET live_version_id = $1 WHERE id = $2", [versionId, lessonId]);
  });

  const reading = { itemId: readingItemId, stepIndex: 0, stepKind: "reading" as const };
  const question = { itemId: questionItemId, stepIndex: 1, stepKind: "question" as const };

  // A — completed, correct answer. reading 120s, question 90s, total 215s.
  await insertEvent({ studentId: id.A, type: "lesson_start", createdAt: at(0) });
  await insertEvent({ studentId: id.A, type: "step_complete", ...reading, createdAt: at(120) });
  await insertEvent({
    studentId: id.A,
    type: "answer_submit",
    ...question,
    metadata: { answer_correct: true },
    createdAt: at(210),
  });
  await insertEvent({ studentId: id.A, type: "step_complete", ...question, createdAt: at(210) });
  await insertEvent({ studentId: id.A, type: "lesson_complete", createdAt: at(215) });

  // B — in progress. reading 60s.
  await insertEvent({ studentId: id.B, type: "lesson_start", createdAt: at(0) });
  await insertEvent({ studentId: id.B, type: "step_complete", ...reading, createdAt: at(60) });

  // C — completed, wrong answer. reading 30s, question 60s, total 100s.
  await insertEvent({ studentId: id.C, type: "lesson_start", createdAt: at(0) });
  await insertEvent({ studentId: id.C, type: "step_complete", ...reading, createdAt: at(30) });
  await insertEvent({
    studentId: id.C,
    type: "answer_submit",
    ...question,
    metadata: { answer_correct: false },
    createdAt: at(90),
  });
  await insertEvent({ studentId: id.C, type: "step_complete", ...question, createdAt: at(90) });
  await insertEvent({ studentId: id.C, type: "lesson_complete", createdAt: at(100) });

  // D — in progress, reading took 31 min → over the 30-min cap, excluded from timing.
  await insertEvent({ studentId: id.D, type: "lesson_start", createdAt: at(0) });
  await insertEvent({ studentId: id.D, type: "step_complete", ...reading, createdAt: at(31 * 60) });
});

afterAll(async () => {
  if (lessonId) await getDb(HOLY_SPIRIT).query("DELETE FROM lessons WHERE id = $1", [lessonId]);
  await getDb(null).query("DELETE FROM users WHERE email = ANY($1)", [EMAILS]);
  await closeDb();
});

describe("getEngagementSummary (integration, aggregated in SQL)", () => {
  it("reduces the raw stream into the dashboard metrics", async () => {
    const s = await getEngagementSummary({ parishId: HOLY_SPIRIT, lessonId, versionId });

    // Summary cards
    expect(s.studentsStarted).toBe(4); // A, B, C, D
    expect(s.studentsCompleted).toBe(2); // A, C
    expect(s.completionRate).toBeCloseTo(0.5, 5);
    expect(s.inProgress).toBe(2);
    expect(s.totalEvents).toBe(14);
    // avg lesson duration = mean(215s, 100s) = 157.5s
    expect(s.avgDurationMs).toBeCloseTo(157_500, 0);

    // Avg time by content type — D's 31-min reading is dropped by the 30-min cap.
    const reading = s.byContentType.find((c) => c.kind === "reading")!;
    const question = s.byContentType.find((c) => c.kind === "question")!;
    expect(reading.samples).toBe(3); // A 120s, B 60s, C 30s  (not D)
    expect(reading.avgMs).toBeCloseTo(70_000, 0);
    expect(question.samples).toBe(2); // A 90s, C 60s
    expect(question.avgMs).toBeCloseTo(75_000, 0);

    // Per-step mirrors content-type here (one item per kind)
    const readingStep = s.perStep.find((p) => p.itemId === readingItemId)!;
    expect(readingStep.label).toBe("Reading");
    expect(readingStep.samples).toBe(3);
    const questionStep = s.perStep.find((p) => p.itemId === questionItemId)!;
    expect(questionStep.label).toBe("Who do you say that I am?");

    // Per-question: 2 submissions, one right one wrong → 50% accuracy; answer time ≤10min.
    expect(s.perQuestion).toHaveLength(1);
    const q = s.perQuestion[0]!;
    expect(q.questionType).toBe("multiple_choice");
    expect(q.submissions).toBe(2);
    expect(q.accuracyRate).toBeCloseTo(0.5, 5);
    expect(q.avgAnswerMs).toBeCloseTo(75_000, 0); // mean(90s, 60s)

    // Per-student: in-progress sort first (B, D), then completed (A, C).
    expect(s.perStudent.map((r) => r.displayName)).toEqual(["B", "D", "A", "C"]);
    const A = s.perStudent.find((r) => r.displayName === "A")!;
    expect(A.completed).toBe(true);
    expect(A.stepsCompleted).toBe(2);
    expect(A.questionsAnswered).toBe(1);
    expect(A.totalMs).toBeCloseTo(215_000, 0);
    const B = s.perStudent.find((r) => r.displayName === "B")!;
    expect(B.completed).toBe(false);
    expect(B.stepsCompleted).toBe(1);
    expect(B.questionsAnswered).toBe(0);
  });

  it("never leaks one parish's engagement to another (RLS isolation)", async () => {
    const s = await getEngagementSummary({ parishId: ST_PETER, lessonId, versionId });
    expect(s.studentsStarted).toBe(0);
    expect(s.totalEvents).toBe(0);
    expect(s.perStudent).toEqual([]);
    expect(s.perQuestion).toEqual([]); // the lesson_items are HS-parish-scoped too
    expect(s.byContentType).toEqual([]);
  });
});

describe("recordEngagementEvent (integration)", () => {
  it("is idempotent for the lesson_start / lesson_complete bookends", async () => {
    const base = { parishId: HOLY_SPIRIT, studentId: id.E, lessonId, versionId };
    await recordEngagementEvent({ ...base, type: "lesson_start" });
    await recordEngagementEvent({ ...base, type: "lesson_start" });
    await recordEngagementEvent({ ...base, type: "lesson_complete" });
    await recordEngagementEvent({ ...base, type: "lesson_complete" });

    const { rows } = await getDb(HOLY_SPIRIT).query<{ event_type: string; n: string }>(
      `SELECT event_type, count(*) AS n FROM engagement_events
        WHERE student_id = $1 AND version_id = $2 GROUP BY event_type`,
      [id.E, versionId],
    );
    const counts = Object.fromEntries(rows.map((r) => [r.event_type, Number(r.n)]));
    expect(counts.lesson_start).toBe(1);
    expect(counts.lesson_complete).toBe(1);
  });

  it("computes answer_correct server-side from the item content", async () => {
    const q = { itemId: questionItemId, stepIndex: 1, stepKind: "question" as const };
    await recordEngagementEvent({
      parishId: HOLY_SPIRIT,
      studentId: id.F,
      lessonId,
      versionId,
      type: "answer_submit",
      answerText: "Son of the living God",
      ...q,
    });
    await recordEngagementEvent({
      parishId: HOLY_SPIRIT,
      studentId: id.G,
      lessonId,
      versionId,
      type: "answer_submit",
      answerText: "A prophet",
      ...q,
    });

    const read = async (studentId: string) =>
      (
        await getDb(HOLY_SPIRIT).query<{ correct: boolean }>(
          "SELECT (metadata->>'answer_correct')::boolean AS correct FROM engagement_events WHERE student_id = $1 AND event_type = 'answer_submit'",
          [studentId],
        )
      ).rows[0]?.correct;

    expect(await read(id.F)).toBe(true);
    expect(await read(id.G)).toBe(false);
  });
});
