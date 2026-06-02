// Cohort lesson gating — the release/due/hidden/locked semantics, as PURE functions.
//
// Narthex computed these in two places that quietly disagreed (the teacher write path
// and the student read path). The port note is explicit: make them one source of truth,
// pick a single rule for the fallbacks, document it, test it. These functions are that
// source — shared by the teacher schedule view, the student read model, and the calendar
// derivation — so the views can never diverge again.

import { addDays, compareDates, type ISODate } from "./dates";

/** The fields of one cohort_schedule row that gating needs, normalised to ISODates. */
export interface ScheduleGatingEntry {
  lessonId: string;
  /** discussion_date — the ordering key (entries are ordered ascending by this). */
  discussionDate: ISODate;
  /** raw release_date, or null when it should be computed. */
  releaseDate: ISODate | null;
  /** raw due_date, or null when it should be computed. */
  dueDate: ISODate | null;
  /** "always available (skip sequence)" — exempt from drip/lock. */
  skipSequence: boolean;
}

/**
 * Effective release date for the entry at `index` of a discussion-date-ordered list.
 *
 * SINGLE SOURCE OF TRUTH (resolves the Narthex split where the teacher UI fell back to
 * `discussion_date − 6d` while the student side fell back to `'2000-01-01'`):
 *   1. an explicit `release_date` on the entry always wins;
 *   2. the FIRST entry falls back to the cohort `start_date` — or, when the cohort has
 *      no start date, to `null` meaning "released, no gate" (the student-side
 *      `'2000-01-01'`/always-released reading, generalised; the `−6d` teacher fallback
 *      is dropped as the bug it was);
 *   3. every later entry falls back to the day AFTER the previous entry's discussion
 *      date — the drip cascade.
 *
 * `null` return ⇒ no release gate (always released).
 */
export function computeReleaseDate(
  entries: ScheduleGatingEntry[],
  index: number,
  cohortStartDate: ISODate | null,
): ISODate | null {
  const entry = entries[index];
  if (!entry) return null;
  if (entry.releaseDate) return entry.releaseDate;
  if (index === 0) return cohortStartDate ?? null;
  const prev = entries[index - 1];
  return prev ? addDays(prev.discussionDate, 1) : (cohortStartDate ?? null);
}

/** Effective due date: an explicit `due_date`, else `discussion_date − 1 day`. */
export function computeDueDate(entry: ScheduleGatingEntry): ISODate {
  return entry.dueDate ?? addDays(entry.discussionDate, -1);
}

/** Released when there is no gate (`null`) or the gate is on/before today. */
export function isReleased(releaseDate: ISODate | null, today: ISODate): boolean {
  return releaseDate == null || compareDates(releaseDate, today) <= 0;
}

/**
 * Hidden from the student (drip release): a non-`skip_sequence` lesson whose effective
 * release date is still in the future. `skip_sequence` ("always available") is never
 * hidden. This is the visibility gate applied to every cohort regardless of the
 * `sequential` flag — a student only ever sees released lessons; in a sequential cohort
 * the release cascade makes that a one-at-a-time drip.
 */
export function isLessonHidden(args: { skipSequence: boolean; releaseDate: ISODate | null; today: ISODate }): boolean {
  if (args.skipSequence) return false;
  return !isReleased(args.releaseDate, args.today);
}

/**
 * Locked (must complete the prior lesson first) — only in `sequential` cohorts. Walks
 * backward over the discussion-date order, skipping `skip_sequence` entries, and locks
 * the lesson when the nearest previous SEQUENCED lesson has not been completed.
 * `skip_sequence` lessons are never locked; non-sequential cohorts never lock.
 *
 * "Completed" is the single completion signal (see student read model): a lesson is
 * complete for a student when every item in its live version is done — supplied here as
 * `completedLessonIds`.
 */
export function isLessonLocked(args: {
  sequential: boolean;
  /** lesson ids in discussion-date order (the same order shown to the student). */
  orderedLessonIds: string[];
  skipSequenceIds: ReadonlySet<string>;
  completedLessonIds: ReadonlySet<string>;
  lessonId: string;
}): boolean {
  const { sequential, orderedLessonIds, skipSequenceIds, completedLessonIds, lessonId } = args;
  if (!sequential) return false;
  if (skipSequenceIds.has(lessonId)) return false;
  const idx = orderedLessonIds.indexOf(lessonId);
  if (idx <= 0) return false;
  for (let i = idx - 1; i >= 0; i--) {
    const prev = orderedLessonIds[i]!;
    if (skipSequenceIds.has(prev)) continue;
    return !completedLessonIds.has(prev);
  }
  return false; // no sequenced predecessor → never locked
}

export type LessonProgressStatus = "not_started" | "started" | "completed";

/**
 * Teacher Students-tab progress for one lesson: `completed` when the student has
 * answered ALL of the lesson's questions, `started` when ≥1, else `not_started`.
 * A lesson with zero questions returns `null` and is excluded from both counts.
 */
export function lessonProgressStatus(totalQuestions: number, answeredQuestions: number): LessonProgressStatus | null {
  if (totalQuestions <= 0) return null;
  if (answeredQuestions >= totalQuestions) return "completed";
  return answeredQuestions > 0 ? "started" : "not_started";
}
