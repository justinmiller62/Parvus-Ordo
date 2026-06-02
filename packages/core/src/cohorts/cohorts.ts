// Cohorts — the parish-scoped student-grouping + lesson-scheduling layer (the unit
// that drives WHAT a student sees and WHEN). Ported from Narthex's CohortDetailPage +
// CohortsTab against the Parvus Ordo schema (cohort* tables already exist in 0003;
// the per-entry time/location overrides land in 0022).
//
// All access is via getDb(parishId)/withTenant(parishId) so RLS pins every row to the
// active parish — cross-tenant access is a bug. Role gating (admin vs catechist) is
// enforced in the Server Actions, as elsewhere in the codebase.

import { getDb, withTenant } from "../db/client";
import type { ContentScope } from "../ocia/lessons";
import { addDays, compareDates, generateWeeklyDates, toISODate, todayISODate, type ISODate } from "./dates";
import { computeDueDate, computeReleaseDate, type ScheduleGatingEntry } from "./gating";

export interface CohortSettings {
  id: string;
  name: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  discussionDay: string | null;
  discussionTime: string | null;
  discussionLocation: string | null;
  sequential: boolean;
}

export interface CohortCard {
  id: string;
  name: string;
  discussionDay: string | null;
  discussionTime: string | null;
  studentCount: number;
  lessonCount: number;
  nextDiscussion: ISODate | null;
}

/** One schedule row, raw columns plus the computed effective values for display. */
export interface ScheduleEntry {
  id: string;
  lessonId: string;
  title: string;
  weekNumber: number | null;
  discussionDate: ISODate;
  releaseDate: ISODate | null;
  dueDate: ISODate | null;
  isDateOverride: boolean;
  skipSequence: boolean;
  timeOverride: string | null;
  locationOverride: string | null;
  // ── computed (single source of truth in gating.ts) ──
  effectiveReleaseDate: ISODate | null;
  effectiveDueDate: ISODate;
  effectiveTime: string | null;
  effectiveLocation: string | null;
  isPast: boolean;
}

export interface AddableLesson {
  id: string;
  title: string;
  scope: ContentScope;
  lessonOrder: number;
}

export interface ParishStudent {
  userId: string;
  displayName: string;
  email: string;
  inCohort: boolean;
}

export interface CohortStudentProgress {
  userId: string;
  displayName: string;
  email: string;
  /** lessons fully answered (all questions) / scheduled lessons that have questions. */
  completed: number;
  total: number;
}

export interface CohortSettingsInput {
  name: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  discussionDay: string | null;
  discussionTime: string | null;
  discussionLocation: string | null;
}

export interface ScheduleEntryPatch {
  releaseDate?: ISODate | null;
  dueDate?: ISODate | null;
  discussionDate?: ISODate;
  timeOverride?: string | null;
  locationOverride?: string | null;
  skipSequence?: boolean;
}

const blankToNull = (v: string | null | undefined): string | null => {
  const s = (v ?? "").trim();
  return s ? s : null;
};

// ── Cohort CRUD + roster ─────────────────────────────────────────────────────

/** Create a cohort (admin-gated in the action). Returns its id, or null on blank name. */
export async function createCohort(parishId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    "INSERT INTO cohorts (parish_id, name) VALUES ($1, $2) RETURNING id",
    [parishId, trimmed],
  );
  return rows[0]!.id;
}

/** Delete a cohort. Children (members, schedule, paths) cascade via FK. */
export async function deleteCohort(parishId: string, cohortId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM cohorts WHERE id = $1", [cohortId]);
}

/** Update the editable cohort settings (name + meeting pattern). Blanks → NULL. */
export async function updateCohortSettings(
  parishId: string,
  cohortId: string,
  input: CohortSettingsInput,
): Promise<void> {
  await getDb(parishId).query(
    `UPDATE cohorts
        SET name = $1, start_date = $2, end_date = $3,
            discussion_day = $4, discussion_time = $5, discussion_location = $6
      WHERE id = $7`,
    [
      input.name.trim() || "Untitled cohort",
      blankToNull(input.startDate),
      blankToNull(input.endDate),
      blankToNull(input.discussionDay),
      blankToNull(input.discussionTime),
      blankToNull(input.discussionLocation),
      cohortId,
    ],
  );
}

/** Toggle the drip/gating switch. */
export async function setSequential(parishId: string, cohortId: string, sequential: boolean): Promise<void> {
  await getDb(parishId).query("UPDATE cohorts SET sequential = $1 WHERE id = $2", [sequential, cohortId]);
}

/**
 * Add or remove a student from a cohort's roster. The INSERT verifies the student is
 * a member of THIS parish (memberships is RLS-pinned), so a cohort roster can never
 * pull in a user from another parish.
 */
export async function toggleMember(
  parishId: string,
  cohortId: string,
  studentId: string,
  member: boolean,
): Promise<void> {
  const db = getDb(parishId);
  if (member) {
    await db.query(
      `INSERT INTO cohort_members (parish_id, cohort_id, student_id)
       SELECT $1, $2, $3
        WHERE EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = $3 AND m.parish_id = $1)
       ON CONFLICT (cohort_id, student_id) DO NOTHING`,
      [parishId, cohortId, studentId],
    );
  } else {
    await db.query("DELETE FROM cohort_members WHERE cohort_id = $1 AND student_id = $2", [cohortId, studentId]);
  }
}

/** Cohort cards for the parish list — one round-trip, counts + next discussion inline
 *  (fixes Narthex's N+1 per-card fan-out). Ordered by created_at. */
export async function listCohortCards(parishId: string): Promise<CohortCard[]> {
  const today = todayISODate();
  const { rows } = await getDb(parishId).query<{
    id: string;
    name: string;
    discussion_day: string | null;
    discussion_time: string | null;
    student_count: number;
    lesson_count: number;
    next_discussion: unknown;
  }>(
    `SELECT c.id, c.name, c.discussion_day, c.discussion_time,
            (SELECT count(*) FROM cohort_members m  WHERE m.cohort_id = c.id)::int AS student_count,
            (SELECT count(*) FROM cohort_schedule s WHERE s.cohort_id = c.id)::int AS lesson_count,
            (SELECT min(s.discussion_date) FROM cohort_schedule s
              WHERE s.cohort_id = c.id AND s.discussion_date >= $1::date) AS next_discussion
       FROM cohorts c
      ORDER BY c.created_at`,
    [today],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    discussionDay: r.discussion_day,
    discussionTime: r.discussion_time,
    studentCount: r.student_count,
    lessonCount: r.lesson_count,
    nextDiscussion: toISODate(r.next_discussion),
  }));
}

/** A cohort's editable settings, or null if not found (in this parish). */
export async function getCohortSettings(parishId: string, cohortId: string): Promise<CohortSettings | null> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    name: string;
    start_date: unknown;
    end_date: unknown;
    discussion_day: string | null;
    discussion_time: string | null;
    discussion_location: string | null;
    sequential: boolean;
  }>(
    `SELECT id, name, start_date, end_date, discussion_day, discussion_time, discussion_location, sequential
       FROM cohorts WHERE id = $1`,
    [cohortId],
  );
  const c = rows[0];
  if (!c) return null;
  return {
    id: c.id,
    name: c.name,
    startDate: toISODate(c.start_date),
    endDate: toISODate(c.end_date),
    discussionDay: c.discussion_day,
    discussionTime: c.discussion_time,
    discussionLocation: c.discussion_location,
    sequential: c.sequential,
  };
}

// ── Schedule ─────────────────────────────────────────────────────────────────

type ScheduleRowDb = {
  id: string;
  lesson_id: string;
  title: string;
  week_number: number | null;
  discussion_date: unknown;
  release_date: unknown;
  due_date: unknown;
  is_date_override: boolean;
  skip_sequence: boolean;
  time_override: string | null;
  location_override: string | null;
};

const SCHEDULE_SELECT = `
  SELECT s.id, s.lesson_id, s.week_number, s.discussion_date, s.release_date, s.due_date,
         s.is_date_override, s.skip_sequence, s.time_override, s.location_override,
         COALESCE(live.title, latest.title) AS title
    FROM cohort_schedule s
    JOIN lessons l ON l.id = s.lesson_id
    LEFT JOIN lesson_versions live ON live.id = l.live_version_id
    LEFT JOIN LATERAL (
      SELECT title FROM lesson_versions v WHERE v.lesson_id = l.id ORDER BY v.version_number DESC LIMIT 1
    ) latest ON true
   WHERE s.cohort_id = $1
   ORDER BY s.discussion_date, s.week_number NULLS LAST, title`;

/** The cohort's schedule, ordered by discussion date, with effective release/due/
 *  time/location computed via the shared gating functions. */
export async function getCohortSchedule(parishId: string, cohortId: string): Promise<ScheduleEntry[]> {
  const settings = await getCohortSettings(parishId, cohortId);
  if (!settings) return [];
  const { rows } = await getDb(parishId).query<ScheduleRowDb>(SCHEDULE_SELECT, [cohortId]);

  const entries: ScheduleGatingEntry[] = rows.map((r) => ({
    lessonId: r.lesson_id,
    discussionDate: toISODate(r.discussion_date)!,
    releaseDate: toISODate(r.release_date),
    dueDate: toISODate(r.due_date),
    skipSequence: r.skip_sequence,
  }));

  const today = todayISODate();
  return rows.map((r, i) => {
    const discussionDate = toISODate(r.discussion_date)!;
    return {
      id: r.id,
      lessonId: r.lesson_id,
      title: r.title,
      weekNumber: r.week_number,
      discussionDate,
      releaseDate: toISODate(r.release_date),
      dueDate: toISODate(r.due_date),
      isDateOverride: r.is_date_override,
      skipSequence: r.skip_sequence,
      timeOverride: r.time_override,
      locationOverride: r.location_override,
      effectiveReleaseDate: computeReleaseDate(entries, i, settings.startDate),
      effectiveDueDate: computeDueDate(entries[i]!),
      effectiveTime: r.time_override ?? settings.discussionTime,
      effectiveLocation: r.location_override ?? settings.discussionLocation,
      isPast: compareDates(discussionDate, today) < 0,
    };
  });
}

/** Published lessons visible to the parish that are NOT yet on this cohort's schedule. */
export async function getAddableLessons(parishId: string, cohortId: string): Promise<AddableLesson[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    scope: ContentScope;
    lesson_order: number;
  }>(
    `SELECT l.id, lv.title, l.scope, l.lesson_order
       FROM lessons l
       JOIN lesson_versions lv ON lv.id = l.live_version_id
      WHERE l.id NOT IN (SELECT lesson_id FROM cohort_schedule WHERE cohort_id = $1)
      ORDER BY l.scope, l.lesson_order, lv.title`,
    [cohortId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, scope: r.scope, lessonOrder: r.lesson_order }));
}

/**
 * Auto-generate the schedule: pair the i-th published lesson (scope, lesson_order)
 * with the i-th weekly discussion date, capped by min(weeks-in-window, lesson count).
 * Wipe + insert run in ONE transaction (Narthex did two unguarded calls). Returns the
 * number of rows written; 0 when start_date/discussion_day are unset or no lessons.
 */
export async function generateSchedule(parishId: string, cohortId: string): Promise<number> {
  return withTenant(parishId, async (q) => {
    const [c] = await q<{ start_date: unknown; end_date: unknown; discussion_day: string | null }>(
      "SELECT start_date, end_date, discussion_day FROM cohorts WHERE id = $1",
      [cohortId],
    );
    if (!c) return 0;

    const lessons = await q<{ id: string }>(
      `SELECT l.id FROM lessons l JOIN lesson_versions lv ON lv.id = l.live_version_id
        ORDER BY l.scope, l.lesson_order, lv.title`,
    );

    const dates = generateWeeklyDates({
      startDate: toISODate(c.start_date),
      endDate: toISODate(c.end_date),
      discussionDay: c.discussion_day,
      lessonCount: lessons.length,
    });
    if (dates.length === 0) return 0;

    await q("DELETE FROM cohort_schedule WHERE cohort_id = $1", [cohortId]);
    for (let i = 0; i < dates.length; i++) {
      await q(
        `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number)
         VALUES ($1, $2, $3, $4, $5)`,
        [parishId, cohortId, lessons[i]!.id, dates[i], i + 1],
      );
    }
    return dates.length;
  });
}

/** Manually add a lesson: 7 days after the last scheduled discussion (else after the
 *  cohort start date, else 7 days out), week_number = current count + 1. */
export async function addScheduleEntry(parishId: string, cohortId: string, lessonId: string): Promise<void> {
  await withTenant(parishId, async (q) => {
    const [agg] = await q<{ last_disc: unknown; n: number }>(
      "SELECT max(discussion_date) AS last_disc, count(*)::int AS n FROM cohort_schedule WHERE cohort_id = $1",
      [cohortId],
    );
    const [c] = await q<{ start_date: unknown }>("SELECT start_date FROM cohorts WHERE id = $1", [cohortId]);
    const base = toISODate(agg?.last_disc) ?? toISODate(c?.start_date) ?? todayISODate();
    await q(
      `INSERT INTO cohort_schedule (parish_id, cohort_id, lesson_id, discussion_date, week_number)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (cohort_id, lesson_id) DO NOTHING`,
      [parishId, cohortId, lessonId, addDays(base, 7), (agg?.n ?? 0) + 1],
    );
  });
}

/** Patch a schedule entry. Editing the discussion date flips is_date_override → true. */
export async function updateScheduleEntry(parishId: string, entryId: string, patch: ScheduleEntryPatch): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };
  if ("releaseDate" in patch) push("release_date", blankToNull(patch.releaseDate));
  if ("dueDate" in patch) push("due_date", blankToNull(patch.dueDate));
  if ("timeOverride" in patch) push("time_override", blankToNull(patch.timeOverride));
  if ("locationOverride" in patch) push("location_override", blankToNull(patch.locationOverride));
  if (typeof patch.skipSequence === "boolean") push("skip_sequence", patch.skipSequence);
  if (patch.discussionDate) {
    push("discussion_date", patch.discussionDate);
    push("is_date_override", true);
  }
  if (sets.length === 0) return;
  params.push(entryId);
  await getDb(parishId).query(`UPDATE cohort_schedule SET ${sets.join(", ")} WHERE id = $${params.length}`, params);
}

/** Remove a schedule entry. */
export async function removeScheduleEntry(parishId: string, entryId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM cohort_schedule WHERE id = $1", [entryId]);
}

// ── Students tab ─────────────────────────────────────────────────────────────

/** All parish learners (catechumen/candidate), flagged with whether each is on the
 *  given cohort's roster — drives the Settings → roster checklist. */
export async function listParishStudents(parishId: string, cohortId: string): Promise<ParishStudent[]> {
  const { rows } = await getDb(parishId).query<{
    user_id: string;
    display_name: string;
    email: string;
    in_cohort: boolean;
  }>(
    `SELECT DISTINCT u.id AS user_id, u.display_name, u.email,
            EXISTS (SELECT 1 FROM cohort_members cm WHERE cm.cohort_id = $1 AND cm.student_id = u.id) AS in_cohort
       FROM memberships mem
       JOIN users u ON u.id = mem.user_id
      WHERE mem.role = 'catechumen_candidate'
      ORDER BY u.display_name`,
    [cohortId],
  );
  return rows.map((r) => ({
    userId: r.user_id,
    displayName: r.display_name,
    email: r.email,
    inCohort: r.in_cohort,
  }));
}

/** Per-student progress over the cohort's scheduled lessons: a lesson counts as
 *  "completed" when the student has answered all of its questions; zero-question
 *  lessons are excluded from the totals (matches the Narthex Students tab). */
export async function getCohortStudents(parishId: string, cohortId: string): Promise<CohortStudentProgress[]> {
  const db = getDb(parishId);
  const roster = (
    await db.query<{ user_id: string; display_name: string; email: string }>(
      `SELECT u.id AS user_id, u.display_name, u.email
         FROM cohort_members m JOIN users u ON u.id = m.student_id
        WHERE m.cohort_id = $1
        ORDER BY u.display_name`,
      [cohortId],
    )
  ).rows;

  // Question-item count per scheduled lesson (live version), lessons with ≥1 question.
  const totals = (
    await db.query<{ lesson_id: string; total: number }>(
      `SELECT s.lesson_id, count(li.id)::int AS total
         FROM cohort_schedule s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN lesson_items li ON li.version_id = l.live_version_id AND li.kind = 'question'
        WHERE s.cohort_id = $1
        GROUP BY s.lesson_id`,
      [cohortId],
    )
  ).rows;
  const totalByLesson = new Map(totals.map((t) => [t.lesson_id, t.total]));
  const lessonsWithQuestions = totals.length;

  // Answered question count per (student, lesson).
  const answered = (
    await db.query<{ student_id: string; lesson_id: string; answered: number }>(
      `SELECT a.student_id, s.lesson_id, count(*)::int AS answered
         FROM cohort_schedule s
         JOIN lessons l ON l.id = s.lesson_id
         JOIN lesson_items li ON li.version_id = l.live_version_id AND li.kind = 'question'
         JOIN answers a ON a.item_id = li.id
        WHERE s.cohort_id = $1
          AND a.student_id IN (SELECT student_id FROM cohort_members WHERE cohort_id = $1)
        GROUP BY a.student_id, s.lesson_id`,
      [cohortId],
    )
  ).rows;
  const answeredByStudentLesson = new Map<string, number>();
  for (const a of answered) answeredByStudentLesson.set(`${a.student_id}:${a.lesson_id}`, a.answered);

  return roster.map((r) => {
    let completed = 0;
    for (const [lessonId, total] of totalByLesson) {
      const ans = answeredByStudentLesson.get(`${r.user_id}:${lessonId}`) ?? 0;
      if (total > 0 && ans >= total) completed++;
    }
    return { userId: r.user_id, displayName: r.display_name, email: r.email, completed, total: lessonsWithQuestions };
  });
}
