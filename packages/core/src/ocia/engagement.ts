// OCIA engagement telemetry — writer + SQL aggregator (Narthex port: engagement-dashboard).
//
// The legacy dashboard pulled every matching `engagement_events` row to the browser and
// reduced them in JavaScript. Here the raw stream is written by `recordEngagementEvent`
// and ALL aggregation happens in Postgres in `getEngagementSummary` — the 30-min / 10-min
// duration caps, the first-start/first-complete rule, the feedback→question fold, the
// distinct-index counts, and the per-step durations are SQL CTEs / window functions, never
// a client-side scan. Aggregation is scoped to a single lesson VERSION so a later edit to
// the lesson can't corrupt historical per-step / per-question numbers (the legacy bug).

import { getDb, withTenant, type TenantQuery } from "../db/client";

export type EngagementEventType = "lesson_start" | "step_complete" | "answer_submit" | "lesson_complete";
export type EngagementStepKind = "reading" | "video" | "question" | "feedback";

const EVENT_TYPES = new Set<EngagementEventType>(["lesson_start", "step_complete", "answer_submit", "lesson_complete"]);
const STEP_KINDS = new Set<EngagementStepKind>(["reading", "video", "question", "feedback"]);
const SINGLETON_TYPES = new Set<EngagementEventType>(["lesson_start", "lesson_complete"]);

// Per-event-type metadata, discriminated by `type`. (The repo has no Zod; we validate with
// native TypeScript + the Postgres enum/jsonb columns, matching the house style.)
type StepFields = { itemId: string; stepIndex: number; stepKind: EngagementStepKind };

export type RecordEngagementInput = {
  parishId: string;
  studentId: string;
  lessonId: string;
  versionId: string;
  cohortId?: string | null;
} & (
  | { type: "lesson_start" }
  | { type: "lesson_complete" }
  | ({ type: "step_complete" } & StepFields)
  | ({ type: "answer_submit"; answerText: string } & StepFields)
);

// ── Writer ───────────────────────────────────────────────────────────────────

/** Normalize a question item's `choices` (string | { label, correct }) — mirrors the
 *  player's parsing — and decide whether `answerText` is the correct multiple-choice pick.
 *  Returns null for open-ended (no correctness notion), matching the legacy behavior. */
export function computeAnswerCorrect(content: Record<string, unknown>, answerText: string): boolean | null {
  if (content.format !== "multiple_choice") return null;
  const raw = Array.isArray(content.choices)
    ? (content.choices as Array<string | { label?: string; correct?: boolean }>)
    : [];
  const choices = raw.map((c) =>
    typeof c === "string" ? { label: c, correct: false } : { label: String(c.label ?? ""), correct: !!c.correct },
  );
  return choices.some((c) => c.correct && c.label === answerText);
}

/**
 * Record one student engagement event. Fire-and-forget from the player — never blocks
 * navigation. Ownership is enforced by the caller (the Server Action sets `studentId` from
 * the session, never from client input); parish isolation is enforced by RLS.
 *
 * `lesson_start` / `lesson_complete` are idempotent (one per student+version) so the
 * fire-and-forget client can't double-count the bookend events.
 */
export async function recordEngagementEvent(input: RecordEngagementInput): Promise<void> {
  if (!EVENT_TYPES.has(input.type)) throw new Error(`unknown engagement event_type: ${String(input.type)}`);

  const isStep = input.type === "step_complete" || input.type === "answer_submit";
  let itemId: string | null = null;
  let stepIndex: number | null = null;
  let stepKind: EngagementStepKind | null = null;
  let metadata: Record<string, unknown> = {};

  if (isStep) {
    const s = input as RecordEngagementInput & StepFields;
    if (!STEP_KINDS.has(s.stepKind)) throw new Error(`unknown engagement step_kind: ${String(s.stepKind)}`);
    itemId = s.itemId;
    stepIndex = Number.isFinite(s.stepIndex) ? s.stepIndex : null;
    stepKind = s.stepKind;
  }

  if (input.type === "answer_submit") {
    // Compute correctness server-side from the item content (authoritative; not client-trusted).
    const { rows } = await getDb(input.parishId).query<{ content: Record<string, unknown> }>(
      "SELECT content FROM lesson_items WHERE id = $1",
      [input.itemId],
    );
    const content = rows[0]?.content ?? {};
    metadata = { answer_correct: computeAnswerCorrect(content, input.answerText) };
  }

  const cohortId = input.cohortId ?? null;
  const conflict = SINGLETON_TYPES.has(input.type)
    ? "ON CONFLICT (student_id, version_id, event_type) WHERE event_type IN ('lesson_start', 'lesson_complete') DO NOTHING"
    : "";

  await getDb(input.parishId).query(
    `INSERT INTO engagement_events
       (parish_id, student_id, lesson_id, version_id, cohort_id, item_id, event_type, step_index, step_kind, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ${conflict}`,
    [
      input.parishId,
      input.studentId,
      input.lessonId,
      input.versionId,
      cohortId,
      itemId,
      input.type,
      stepIndex,
      stepKind,
      metadata,
    ],
  );
}

// ── Aggregator (the reduced metrics, computed in SQL) ─────────────────────────

export interface EngagementSummary {
  lessonId: string;
  versionId: string;
  cohortId: string | null;
  /** distinct students who emitted a `lesson_start`. */
  studentsStarted: number;
  /** distinct students who emitted a `lesson_complete`. */
  studentsCompleted: number;
  /** completed ÷ started (0 when none started). */
  completionRate: number;
  /** in-progress = max(0, started − completed) — the pie's second slice. */
  inProgress: number;
  /** mean of (first lesson_complete − first lesson_start) per completed student, ms. */
  avgDurationMs: number | null;
  /** total rows in the active filter. */
  totalEvents: number;
  byContentType: ContentTypeStat[];
  perStep: StepStat[];
  perQuestion: QuestionStat[];
  perStudent: StudentStat[];
}

export interface ContentTypeStat {
  kind: "video" | "reading" | "question";
  avgMs: number;
  samples: number;
}
export interface StepStat {
  itemId: string | null;
  stepIndex: number;
  stepKind: EngagementStepKind;
  label: string;
  avgMs: number;
  samples: number;
}
export interface QuestionStat {
  itemId: string;
  position: number;
  prompt: string;
  questionType: "open_ended" | "multiple_choice";
  submissions: number;
  avgAnswerMs: number | null;
  /** fraction correct (multiple-choice only); null for open-ended. */
  accuracyRate: number | null;
}
export interface StudentStat {
  studentId: string;
  displayName: string;
  stepsCompleted: number;
  questionsAnswered: number;
  completed: boolean;
  totalMs: number | null;
  startedAt: string | null;
}

const num = (v: unknown): number => (v == null ? 0 : typeof v === "number" ? v : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const STEP_CAP_MS = 1_800_000; // 30 min — drop tab-left-open outliers
const ANSWER_CAP_MS = 600_000; // 10 min

/** Truncated, player-consistent label for a step (questions show their prompt). */
export function stepLabel(kind: EngagementStepKind, prompt: string | null, stepIndex: number): string {
  if (kind === "question") {
    const p = (prompt ?? "").trim();
    return p ? (p.length > 50 ? `${p.slice(0, 50)}…` : p) : "Question";
  }
  if (kind === "video") return "Video";
  if (kind === "reading") return "Reading";
  return `Step ${stepIndex + 1}`;
}

/**
 * The fully-reduced dashboard metrics for one lesson version (optionally narrowed to a
 * cohort). Everything is aggregated in Postgres; this function only shapes rows into the
 * `EngagementSummary` and resolves presentation labels.
 *
 * RLS pins every query to `parishId`, so a catechist/admin viewing a lesson owned by a
 * parish they don't belong to gets zero rows (the empty state) — never another parish's data.
 */
export async function getEngagementSummary(params: {
  parishId: string;
  lessonId: string;
  versionId: string;
  cohortId?: string | null;
}): Promise<EngagementSummary> {
  const { parishId, lessonId, versionId } = params;
  const cohortId = params.cohortId ?? null;

  return withTenant(parishId, async (q: TenantQuery) => {
    // Shared scope: one version, optionally one cohort. $1 versionId, $2 cohortId (nullable).
    const where = "version_id = $1 AND ($2::uuid IS NULL OR cohort_id = $2)";
    const args = [versionId, cohortId];

    // Per-completed-step duration, derived per student from the gap to the previous timeline
    // event (lesson_start anchors step 0; each step_complete anchors the next). This is the
    // robust server-side analog of the legacy client `step_exit` duration_ms.
    const stepDurCte = `
      WITH ev AS (
        SELECT student_id, item_id, step_index, step_kind, event_type, metadata, created_at
          FROM engagement_events WHERE ${where}
      ),
      timeline AS (
        SELECT student_id, item_id, step_index, step_kind, event_type, created_at,
               lag(created_at) OVER (
                 PARTITION BY student_id
                 ORDER BY created_at, CASE event_type WHEN 'lesson_start' THEN 0 ELSE 1 END
               ) AS prev_at
          FROM ev WHERE event_type IN ('lesson_start', 'step_complete')
      ),
      step_dur AS (
        SELECT student_id, item_id, step_index, step_kind,
               EXTRACT(EPOCH FROM (created_at - prev_at)) * 1000 AS dur_ms
          FROM timeline WHERE event_type = 'step_complete' AND prev_at IS NOT NULL
      )`;

    // ── Summary cards: started / completed / total events ──
    const [cards] = await q<{ started: string; completed: string; total: string }>(
      `SELECT
         count(DISTINCT student_id) FILTER (WHERE event_type = 'lesson_start')    AS started,
         count(DISTINCT student_id) FILTER (WHERE event_type = 'lesson_complete') AS completed,
         count(*)                                                                  AS total
       FROM engagement_events WHERE ${where}`,
      args,
    );
    const studentsStarted = num(cards?.started);
    const studentsCompleted = num(cards?.completed);

    // Avg lesson duration: mean of (first complete − first start) over completed students.
    const [dur] = await q<{ avg_ms: string | null }>(
      `WITH s AS (SELECT student_id, min(created_at) st FROM engagement_events WHERE ${where} AND event_type = 'lesson_start'    GROUP BY student_id),
            c AS (SELECT student_id, min(created_at) ct FROM engagement_events WHERE ${where} AND event_type = 'lesson_complete' GROUP BY student_id)
       SELECT avg(EXTRACT(EPOCH FROM (c.ct - s.st)) * 1000) AS avg_ms FROM s JOIN c USING (student_id)`,
      args,
    );

    // ── Avg time by content type (feedback folded into question; zero-total buckets drop out) ──
    const contentRows = await q<{ kind: string; avg_ms: string; samples: string }>(
      `${stepDurCte}
       SELECT CASE WHEN step_kind = 'feedback' THEN 'question' ELSE step_kind::text END AS kind,
              avg(dur_ms) AS avg_ms, count(*) AS samples
         FROM step_dur
        WHERE dur_ms > 0 AND dur_ms <= ${STEP_CAP_MS} AND step_kind IN ('video', 'reading', 'question', 'feedback')
        GROUP BY 1`,
      args,
    );

    // ── Per-step timing (avg per item, with the question prompt for labels) ──
    const stepRows = await q<{
      item_id: string | null;
      step_index: number;
      step_kind: EngagementStepKind;
      prompt: string | null;
      avg_ms: string;
      samples: string;
    }>(
      `${stepDurCte}
       SELECT d.item_id, d.step_index, d.step_kind, li.content->>'prompt' AS prompt,
              avg(d.dur_ms) AS avg_ms, count(*) AS samples
         FROM step_dur d
         LEFT JOIN lesson_items li ON li.id = d.item_id
        WHERE d.dur_ms > 0 AND d.dur_ms <= ${STEP_CAP_MS}
        GROUP BY d.item_id, d.step_index, d.step_kind, li.content->>'prompt'
        ORDER BY d.step_index`,
      args,
    );

    // ── Per-question analytics: every question in the version, with submissions / accuracy /
    //    answer-time. Accuracy is multiple-choice only (from metadata.answer_correct). ──
    const questionRows = await q<{
      item_id: string;
      position: number;
      prompt: string | null;
      question_type: "open_ended" | "multiple_choice";
      submissions: string;
      avg_answer_ms: string | null;
      accuracy: string | null;
    }>(
      `${stepDurCte},
       answers_agg AS (
         SELECT item_id,
                count(*) AS submissions,
                avg(CASE WHEN metadata->>'answer_correct' = 'true' THEN 1.0
                         WHEN metadata->>'answer_correct' = 'false' THEN 0.0 ELSE NULL END) AS accuracy
           FROM ev WHERE event_type = 'answer_submit' GROUP BY item_id
       ),
       answer_time AS (
         SELECT item_id, avg(dur_ms) FILTER (WHERE dur_ms > 0 AND dur_ms <= ${ANSWER_CAP_MS}) AS avg_answer_ms
           FROM step_dur WHERE step_kind = 'question' GROUP BY item_id
       )
       SELECT li.id AS item_id, li.position,
              li.content->>'prompt' AS prompt,
              COALESCE(li.content->>'format', 'open_ended') AS question_type,
              COALESCE(aa.submissions, 0) AS submissions,
              at.avg_answer_ms,
              aa.accuracy
         FROM lesson_items li
         LEFT JOIN answers_agg aa ON aa.item_id = li.id
         LEFT JOIN answer_time at ON at.item_id = li.id
        WHERE li.version_id = $1 AND li.kind = 'question'
        ORDER BY li.position`,
      args,
    );

    // ── Per-student progress ──
    const studentRows = await q<{
      student_id: string;
      display_name: string;
      steps_completed: string;
      questions_answered: string;
      completed: boolean;
      started_at: Date | string | null;
      last_at: Date | string | null;
    }>(
      `SELECT e.student_id, u.display_name,
              count(DISTINCT e.item_id) FILTER (WHERE e.event_type = 'step_complete') AS steps_completed,
              count(DISTINCT e.item_id) FILTER (WHERE e.event_type = 'answer_submit') AS questions_answered,
              bool_or(e.event_type = 'lesson_complete') AS completed,
              min(e.created_at) FILTER (WHERE e.event_type = 'lesson_start') AS started_at,
              max(e.created_at) AS last_at
         FROM engagement_events e JOIN users u ON u.id = e.student_id
        WHERE ${where}
        GROUP BY e.student_id, u.display_name
        ORDER BY completed ASC, u.display_name ASC`,
      args,
    );

    const toIso = (v: Date | string | null): string | null =>
      v == null ? null : v instanceof Date ? v.toISOString() : String(v);

    return {
      lessonId,
      versionId,
      cohortId,
      studentsStarted,
      studentsCompleted,
      completionRate: studentsStarted ? studentsCompleted / studentsStarted : 0,
      inProgress: Math.max(0, studentsStarted - studentsCompleted),
      avgDurationMs: numOrNull(dur?.avg_ms),
      totalEvents: num(cards?.total),
      byContentType: contentRows
        .map((r) => ({ kind: r.kind as ContentTypeStat["kind"], avgMs: num(r.avg_ms), samples: num(r.samples) }))
        .sort((a, b) => a.kind.localeCompare(b.kind)),
      perStep: stepRows.map((r) => ({
        itemId: r.item_id,
        stepIndex: num(r.step_index),
        stepKind: r.step_kind,
        label: stepLabel(r.step_kind, r.prompt, num(r.step_index)),
        avgMs: num(r.avg_ms),
        samples: num(r.samples),
      })),
      perQuestion: questionRows.map((r) => ({
        itemId: r.item_id,
        position: num(r.position),
        prompt: stepLabel("question", r.prompt, num(r.position)),
        questionType: r.question_type === "multiple_choice" ? "multiple_choice" : "open_ended",
        submissions: num(r.submissions),
        avgAnswerMs: numOrNull(r.avg_answer_ms),
        accuracyRate: numOrNull(r.accuracy),
      })),
      perStudent: studentRows.map((r) => {
        const startedAt = toIso(r.started_at);
        const lastAt = toIso(r.last_at);
        const totalMs = startedAt && lastAt ? new Date(lastAt).getTime() - new Date(startedAt).getTime() : null;
        return {
          studentId: r.student_id,
          displayName: r.display_name,
          stepsCompleted: num(r.steps_completed),
          questionsAnswered: num(r.questions_answered),
          completed: !!r.completed,
          totalMs: totalMs != null && totalMs >= 0 ? totalMs : null,
          startedAt,
        };
      }),
    };
  });
}

/** One cohort member's engagement rolled up across all the cohort's scheduled lessons. */
export interface CohortStudentEngagement {
  studentId: string;
  displayName: string;
  /** distinct cohort lessons this student has a lesson_start for. */
  lessonsStarted: number;
  /** distinct cohort lessons this student has a lesson_complete for. */
  lessonsCompleted: number;
}

/** Cohort-wide engagement (the "all lessons" reduced view: summary cards + per-student). */
export interface CohortEngagementSummary {
  cohortId: string;
  /** scheduled lessons that have a live version — the completion denominator. */
  lessonCount: number;
  /** distinct cohort members who started at least one lesson. */
  studentsStarted: number;
  /** cohort members who completed EVERY scheduled lesson. */
  studentsCompletedAll: number;
  totalEvents: number;
  perStudent: CohortStudentEngagement[];
}

/**
 * Engagement across ALL of a cohort's scheduled lessons — the cohort-level dashboard
 * (engagement-dashboard.md "reduced view"). Per-step / per-question detail is deliberately
 * omitted; this rolls each member's started/completed lesson counts up across the cohort's
 * lessons. Events are scoped to the LIVE version of each scheduled lesson (matching the
 * per-lesson page) and to the cohort roster, all inside the parish RLS fence via getDb.
 */
export async function getCohortEngagement(parishId: string, cohortId: string): Promise<CohortEngagementSummary> {
  const db = getDb(parishId);

  const lessonCount =
    (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM cohort_schedule s JOIN lessons l ON l.id = s.lesson_id
          WHERE s.cohort_id = $1 AND l.live_version_id IS NOT NULL`,
        [cohortId],
      )
    ).rows[0]?.n ?? 0;

  const rows = (
    await db.query<{
      student_id: string;
      display_name: string;
      lessons_started: number;
      lessons_completed: number;
      events: number;
    }>(
      `WITH cohort_versions AS (
         SELECT l.live_version_id AS vid
           FROM cohort_schedule s JOIN lessons l ON l.id = s.lesson_id
          WHERE s.cohort_id = $1 AND l.live_version_id IS NOT NULL
       ),
       roster AS (
         SELECT u.id, u.display_name
           FROM cohort_members m JOIN users u ON u.id = m.student_id
          WHERE m.cohort_id = $1
       ),
       per_student AS (
         SELECT e.student_id,
                count(DISTINCT e.lesson_id) FILTER (WHERE e.event_type = 'lesson_start')    AS started,
                count(DISTINCT e.lesson_id) FILTER (WHERE e.event_type = 'lesson_complete') AS completed,
                count(*) AS events
           FROM engagement_events e
          WHERE e.version_id IN (SELECT vid FROM cohort_versions)
            AND e.student_id IN (SELECT id FROM roster)
          GROUP BY e.student_id
       )
       SELECT r.id AS student_id, r.display_name,
              COALESCE(ps.started, 0)::int   AS lessons_started,
              COALESCE(ps.completed, 0)::int AS lessons_completed,
              COALESCE(ps.events, 0)::int    AS events
         FROM roster r LEFT JOIN per_student ps ON ps.student_id = r.id
        ORDER BY r.display_name`,
      [cohortId],
    )
  ).rows;

  return {
    cohortId,
    lessonCount,
    studentsStarted: rows.filter((r) => r.lessons_started > 0).length,
    studentsCompletedAll: lessonCount > 0 ? rows.filter((r) => r.lessons_completed >= lessonCount).length : 0,
    totalEvents: rows.reduce((sum, r) => sum + r.events, 0),
    perStudent: rows.map((r) => ({
      studentId: r.student_id,
      displayName: r.display_name,
      lessonsStarted: r.lessons_started,
      lessonsCompleted: r.lessons_completed,
    })),
  };
}
