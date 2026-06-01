import { getDb } from "../db/client";

// Catechist/admin management of Youth Teaches: list every project in the parish,
// create topics, and assign a project to a teen. (Teen-facing reads live in
// projects.ts; this is the staff side.)

export interface ParishYouthProject {
  id: string;
  title: string;
  status: string;
  teenName: string | null;
  topicTitle: string | null;
}

/** Every youth project in the parish (catechist/admin oversight list). */
export async function listParishYouthProjects(parishId: string): Promise<ParishYouthProject[]> {
  const { rows } = await getDb(parishId).query<{
    id: string; title: string; status: string; teen_name: string | null; topic_title: string | null;
  }>(
    `SELECT p.id, p.title, p.status, u.display_name AS teen_name, t.title AS topic_title
       FROM youth_projects p
       LEFT JOIN users u ON u.id = p.teen_user_id
       LEFT JOIN youth_topics t ON t.id = p.topic_id
      ORDER BY p.created_at DESC`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, teenName: r.teen_name, topicTitle: r.topic_title }));
}

/** Parish members with the studio role — the assignable teens. */
export async function listYouthTeens(parishId: string): Promise<{ userId: string; displayName: string }[]> {
  const { rows } = await getDb(parishId).query<{ user_id: string; display_name: string }>(
    `SELECT m.user_id, u.display_name
       FROM memberships m
       JOIN users u ON u.id = m.user_id
      WHERE m.role = 'studio'
      ORDER BY u.display_name`,
  );
  return rows.map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

/** Topics available to assign (the parish's topic library). */
export async function listYouthTopics(parishId: string): Promise<{ id: string; title: string; category: string }[]> {
  const { rows } = await getDb(parishId).query<{ id: string; title: string; category: string }>(
    "SELECT id, title, category FROM youth_topics ORDER BY category, title",
  );
  return rows;
}

export interface NewYouthTopic {
  category: string;
  title: string;
  commonMisconception?: string;
  correctTeaching?: string;
  ageBand?: string;
}

/** Add a topic to the parish's topic library. */
export async function createYouthTopic(parishId: string, input: NewYouthTopic): Promise<{ id: string }> {
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO youth_topics (parish_id, category, title, common_misconception, correct_teaching, age_band)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [parishId, input.category, input.title, input.commonMisconception ?? null, input.correctTeaching ?? null, input.ageBand ?? null],
  );
  return { id: rows[0]!.id };
}

/** Create a project and assign it to a teen (topic optional). */
export async function createYouthProject(
  parishId: string,
  input: { teenUserId: string; title: string; topicId?: string | null },
): Promise<{ id: string }> {
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO youth_projects (parish_id, teen_user_id, topic_id, title)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [parishId, input.teenUserId, input.topicId ?? null, input.title],
  );
  return { id: rows[0]!.id };
}
