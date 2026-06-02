// Learning paths — named sub-sequences of lessons assigned to a subset of a cohort's
// roster, so different students in one cohort can follow different lesson sets. Ported
// from Narthex's LearningPathsSection. Parish-scoped via RLS on every table.

import { getDb, withTenant } from "../db/client";

export interface LearningPathSummary {
  id: string;
  name: string;
  lessonCount: number;
  memberCount: number;
}

export interface PathLesson {
  lessonId: string;
  title: string;
  weekNumber: number;
}

export interface PathMember {
  studentId: string;
  displayName: string;
  inPath: boolean;
}

export interface PathDetail {
  id: string;
  name: string;
  lessons: PathLesson[];
  members: PathMember[];
}

/** Paths for a cohort with lesson/member counts, ordered by creation. */
export async function listPaths(parishId: string, cohortId: string): Promise<LearningPathSummary[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    name: string;
    lesson_count: number;
    member_count: number;
  }>(
    `SELECT p.id, p.name,
            (SELECT count(*) FROM learning_path_lessons l WHERE l.path_id = p.id)::int AS lesson_count,
            (SELECT count(*) FROM learning_path_members m WHERE m.path_id = p.id)::int AS member_count
       FROM learning_paths p
      WHERE p.cohort_id = $1
      ORDER BY p.created_at`,
    [cohortId],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, lessonCount: r.lesson_count, memberCount: r.member_count }));
}

/** Create a path in a cohort. Returns its id, or null on a blank name. */
export async function createPath(parishId: string, cohortId: string, name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO learning_paths (parish_id, cohort_id, name)
     SELECT $1, $2, $3 WHERE EXISTS (SELECT 1 FROM cohorts c WHERE c.id = $2)
     RETURNING id`,
    [parishId, cohortId, trimmed],
  );
  return rows[0]?.id ?? null;
}

/** Delete a path (its lessons + members cascade). */
export async function deletePath(parishId: string, pathId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM learning_paths WHERE id = $1", [pathId]);
}

/**
 * Replace a path's lessons (the Narthex "Edit Lessons" quick-setup, which is
 * destructive): delete all current path lessons, then re-insert the selected set
 * ordered by lesson_order with fresh contiguous week numbers. Runs in one transaction.
 * Only lessons visible to the parish are inserted (RLS filters the lookup).
 */
export async function setPathLessons(parishId: string, pathId: string, lessonIds: string[]): Promise<void> {
  await withTenant(parishId, async (q) => {
    await q("DELETE FROM learning_path_lessons WHERE path_id = $1", [pathId]);
    if (lessonIds.length === 0) return;
    const ordered = await q<{ id: string }>(
      "SELECT id FROM lessons WHERE id = ANY($1::uuid[]) ORDER BY scope, lesson_order, id",
      [lessonIds],
    );
    for (let i = 0; i < ordered.length; i++) {
      await q(
        `INSERT INTO learning_path_lessons (parish_id, path_id, lesson_id, week_number)
         VALUES ($1, $2, $3, $4)`,
        [parishId, pathId, ordered[i]!.id, i + 1],
      );
    }
  });
}

/** Add/remove a student from a path. The student must already be on the path's cohort
 *  roster (verified in the INSERT). */
export async function togglePathMember(
  parishId: string,
  pathId: string,
  studentId: string,
  member: boolean,
): Promise<void> {
  const db = getDb(parishId);
  if (member) {
    await db.query(
      `INSERT INTO learning_path_members (parish_id, path_id, student_id)
       SELECT $1, $2, $3
        WHERE EXISTS (
          SELECT 1 FROM learning_paths lp JOIN cohort_members cm ON cm.cohort_id = lp.cohort_id
           WHERE lp.id = $2 AND cm.student_id = $3
        )
       ON CONFLICT (path_id, student_id) DO NOTHING`,
      [parishId, pathId, studentId],
    );
  } else {
    await db.query("DELETE FROM learning_path_members WHERE path_id = $1 AND student_id = $2", [pathId, studentId]);
  }
}

/** A path's lessons (ordered by week) + the cohort roster with in-path flags. */
export async function getPathDetail(parishId: string, pathId: string): Promise<PathDetail | null> {
  const db = getDb(parishId);
  const [path] = (
    await db.query<{ id: string; name: string }>("SELECT id, name FROM learning_paths WHERE id = $1", [pathId])
  ).rows;
  if (!path) return null;

  const lessons = (
    await db.query<{ lesson_id: string; title: string; week_number: number }>(
      `SELECT lpl.lesson_id, COALESCE(live.title, latest.title) AS title, lpl.week_number
         FROM learning_path_lessons lpl
         JOIN lessons l ON l.id = lpl.lesson_id
         LEFT JOIN lesson_versions live ON live.id = l.live_version_id
         LEFT JOIN LATERAL (
           SELECT title FROM lesson_versions v WHERE v.lesson_id = l.id ORDER BY v.version_number DESC LIMIT 1
         ) latest ON true
        WHERE lpl.path_id = $1
        ORDER BY lpl.week_number`,
      [pathId],
    )
  ).rows;

  const members = (
    await db.query<{ student_id: string; display_name: string; in_path: boolean }>(
      `SELECT u.id AS student_id, u.display_name,
              EXISTS (SELECT 1 FROM learning_path_members lpm WHERE lpm.path_id = $1 AND lpm.student_id = u.id) AS in_path
         FROM learning_paths lp
         JOIN cohort_members cm ON cm.cohort_id = lp.cohort_id
         JOIN users u ON u.id = cm.student_id
        WHERE lp.id = $1
        ORDER BY u.display_name`,
      [pathId],
    )
  ).rows;

  return {
    id: path.id,
    name: path.name,
    lessons: lessons.map((l) => ({ lessonId: l.lesson_id, title: l.title, weekNumber: l.week_number })),
    members: members.map((m) => ({ studentId: m.student_id, displayName: m.display_name, inPath: m.in_path })),
  };
}
