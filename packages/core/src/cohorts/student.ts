// Student consumption read model — the cohort/release/sequential/learning-path gating
// that decides which lessons a student sees and in what order. This is the keystone the
// student-lesson-list + student-lesson-view (sequential lock) and weekly-export depend
// on; it is the read side of the same gating.ts rules the teacher write side uses.
//
// Improvement over Narthex (noted in the spec's "single-cohort assumption" gotcha):
// Narthex applied only the FIRST cohort's `sequential` flag to a merged schedule. Here
// each cohort's own schedule is gated with its OWN sequential flag, then merged — so a
// student in two cohorts gets each one's rules correctly.

import { getDb } from "../db/client";
import { compareDates, toISODate, todayISODate, type ISODate } from "./dates";
import { computeDueDate, computeReleaseDate, isLessonHidden, isLessonLocked, type ScheduleGatingEntry } from "./gating";

export interface StudentLesson {
  lessonId: string;
  title: string;
  cohortId: string;
  cohortName: string;
  discussionDate: ISODate;
  dueDate: ISODate;
  weekNumber: number | null;
  locked: boolean;
  status: "not_started" | "started" | "completed";
}

type CohortRow = {
  id: string;
  name: string;
  sequential: boolean;
  start_date: unknown;
};

type SchedRow = {
  lesson_id: string;
  title: string;
  week_number: number | null;
  discussion_date: unknown;
  release_date: unknown;
  due_date: unknown;
  skip_sequence: boolean;
};

/**
 * The gated, schedule-ordered lesson list for a student across all their cohorts.
 * A student in no cohort sees nothing. Within a cohort: lessons not yet released are
 * hidden (drip); if the student is in any learning path, only the intersection with
 * that path's lessons is shown; sequential cohorts lock a lesson until the previous
 * sequenced lesson is complete. Ordering is by schedule position (discussion_date),
 * never global lesson_order.
 */
export async function getStudentLessons(parishId: string, studentId: string): Promise<StudentLesson[]> {
  const db = getDb(parishId);
  const today = todayISODate();

  const cohorts = (
    await db.query<CohortRow>(
      `SELECT c.id, c.name, c.sequential, c.start_date
         FROM cohort_members m JOIN cohorts c ON c.id = m.cohort_id
        WHERE m.student_id = $1
        ORDER BY c.created_at`,
      [studentId],
    )
  ).rows;
  if (cohorts.length === 0) return [];

  const out: StudentLesson[] = [];

  for (const cohort of cohorts) {
    const sched = (
      await db.query<SchedRow>(
        `SELECT s.lesson_id, s.week_number, s.discussion_date, s.release_date, s.due_date, s.skip_sequence,
                COALESCE(live.title, latest.title) AS title
           FROM cohort_schedule s
           JOIN lessons l ON l.id = s.lesson_id
           LEFT JOIN lesson_versions live ON live.id = l.live_version_id
           LEFT JOIN LATERAL (
             SELECT title FROM lesson_versions v WHERE v.lesson_id = l.id ORDER BY v.version_number DESC LIMIT 1
           ) latest ON true
          WHERE s.cohort_id = $1
          ORDER BY s.discussion_date, s.week_number NULLS LAST, title`,
        [cohort.id],
      )
    ).rows;
    if (sched.length === 0) continue;

    // Learning-path filter: if the student belongs to ≥1 path in this cohort, restrict
    // to the union of those paths' lessons (possibly empty → sees nothing).
    const pathCount = (
      await db.query<{ n: number }>(
        `SELECT count(*)::int AS n
           FROM learning_path_members lpm
           JOIN learning_paths lp ON lp.id = lpm.path_id AND lp.cohort_id = $1
          WHERE lpm.student_id = $2`,
        [cohort.id, studentId],
      )
    ).rows[0]!.n;
    let pathLessonIds: Set<string> | null = null;
    if (pathCount > 0) {
      const rows = (
        await db.query<{ lesson_id: string }>(
          `SELECT DISTINCT lpl.lesson_id
             FROM learning_path_members lpm
             JOIN learning_paths lp ON lp.id = lpm.path_id AND lp.cohort_id = $1
             JOIN learning_path_lessons lpl ON lpl.path_id = lpm.path_id
            WHERE lpm.student_id = $2`,
          [cohort.id, studentId],
        )
      ).rows;
      pathLessonIds = new Set(rows.map((r) => r.lesson_id));
    }

    // Per-lesson item completion (live version) for status + the sequential lock.
    const prog = (
      await db.query<{ lesson_id: string; items_total: number; items_done: number }>(
        `SELECT s.lesson_id,
                count(li.id)::int AS items_total,
                count(p.item_id)::int AS items_done
           FROM cohort_schedule s
           JOIN lessons l ON l.id = s.lesson_id
           JOIN lesson_items li ON li.version_id = l.live_version_id
           LEFT JOIN lesson_item_progress p
                  ON p.item_id = li.id AND p.student_id = $2 AND p.completed = true
          WHERE s.cohort_id = $1
          GROUP BY s.lesson_id`,
        [cohort.id, studentId],
      )
    ).rows;
    const completedLessonIds = new Set<string>();
    const startedLessonIds = new Set<string>();
    for (const p of prog) {
      if (p.items_total > 0 && p.items_done >= p.items_total) completedLessonIds.add(p.lesson_id);
      if (p.items_done > 0) startedLessonIds.add(p.lesson_id);
    }

    const entries: ScheduleGatingEntry[] = sched.map((r) => ({
      lessonId: r.lesson_id,
      discussionDate: toISODate(r.discussion_date)!,
      releaseDate: toISODate(r.release_date),
      dueDate: toISODate(r.due_date),
      skipSequence: r.skip_sequence,
    }));
    const orderedLessonIds = entries.map((e) => e.lessonId);
    const skipSequenceIds = new Set(entries.filter((e) => e.skipSequence).map((e) => e.lessonId));

    sched.forEach((r, i) => {
      const releaseDate = computeReleaseDate(entries, i, toISODate(cohort.start_date));
      if (isLessonHidden({ skipSequence: r.skip_sequence, releaseDate, today })) return;
      if (pathLessonIds && !pathLessonIds.has(r.lesson_id)) return;
      const locked = isLessonLocked({
        sequential: cohort.sequential,
        orderedLessonIds,
        skipSequenceIds,
        completedLessonIds,
        lessonId: r.lesson_id,
      });
      const status = completedLessonIds.has(r.lesson_id)
        ? "completed"
        : startedLessonIds.has(r.lesson_id)
          ? "started"
          : "not_started";
      out.push({
        lessonId: r.lesson_id,
        title: r.title,
        cohortId: cohort.id,
        cohortName: cohort.name,
        discussionDate: entries[i]!.discussionDate,
        dueDate: computeDueDate(entries[i]!),
        weekNumber: r.week_number,
        locked,
        status,
      });
    });
  }

  out.sort((a, b) => compareDates(a.discussionDate, b.discussionDate) || (a.weekNumber ?? 0) - (b.weekNumber ?? 0));
  return out;
}
