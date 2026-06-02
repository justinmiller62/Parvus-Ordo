import { getDb } from "../db/client";

export type YouthProjectStatus = "drafting" | "ready_to_record" | "submitted" | "approved" | "rejected";

export interface ScriptSegment {
  id: string;
  text: string;
  slide_id?: string;
}
export interface ScriptDraft {
  full_text: string;
  segments: ScriptSegment[];
}

export interface YouthProjectSummary {
  id: string;
  title: string;
  status: YouthProjectStatus;
  topicCategory: string | null;
}

export interface YouthProjectDetails {
  id: string;
  title: string;
  topic: string | null;
  age_band: string | null;
  current_script_text: string;
  common_misconception: string | null;
  correct_teaching: string | null;
}

// Spoken-delivery rate for a teen reading their script aloud. Intentionally lower than
// shared's silent-reading READING_WPM (200): speaking aloud is slower than reading silently.
const WORDS_PER_MINUTE = 150;

/** Word count + estimated speaking time (~150 wpm). Pure + unit-testable. */
export function scriptStats(text: string): { words: number; seconds: number } {
  const t = text.trim();
  const words = t ? t.split(/\s+/).length : 0;
  return { words, seconds: Math.round((words / WORDS_PER_MINUTE) * 60) };
}

/** The teen's projects (summary). RLS pins to the parish; we also scope to the teen. */
export async function listMyProjects(parishId: string, teenUserId: string): Promise<YouthProjectSummary[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    status: YouthProjectStatus;
    topic_category: string | null;
  }>(
    `SELECT p.id, p.title, p.status, t.category AS topic_category
       FROM youth_projects p
       LEFT JOIN youth_topics t ON t.id = p.topic_id
      WHERE p.teen_user_id = $1
      ORDER BY p.created_at DESC`,
    [teenUserId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, status: r.status, topicCategory: r.topic_category }));
}

/** Full project detail for the MCP get_project_details tool (joins the topic). */
export async function getProjectDetails(parishId: string, projectId: string): Promise<YouthProjectDetails | null> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    topic_title: string | null;
    age_band: string | null;
    full_text: string;
    common_misconception: string | null;
    correct_teaching: string | null;
  }>(
    `SELECT p.id, p.title, t.title AS topic_title, t.age_band,
            COALESCE(p.script_draft->>'full_text', '') AS full_text,
            t.common_misconception, t.correct_teaching
       FROM youth_projects p
       LEFT JOIN youth_topics t ON t.id = p.topic_id
      WHERE p.id = $1`,
    [projectId],
  );
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    topic: r.topic_title,
    age_band: r.age_band,
    current_script_text: r.full_text,
    common_misconception: r.common_misconception,
    correct_teaching: r.correct_teaching,
  };
}

/** Project + its draft + status, for the web page (poll target). */
export async function getProject(
  parishId: string,
  projectId: string,
): Promise<{
  id: string;
  title: string;
  status: YouthProjectStatus;
  scriptDraft: ScriptDraft;
  savedPassages: unknown[];
} | null> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    title: string;
    status: YouthProjectStatus;
    script_draft: ScriptDraft;
    saved_passages: unknown[];
  }>("SELECT id, title, status, script_draft, saved_passages FROM youth_projects WHERE id = $1", [projectId]);
  const r = rows[0];
  return r
    ? { id: r.id, title: r.title, status: r.status, scriptDraft: r.script_draft, savedPassages: r.saved_passages }
    : null;
}

/** Overwrite the script's full_text (the update_script_draft MCP tool + the web editor). */
export async function updateScriptDraft(
  parishId: string,
  projectId: string,
  newText: string,
): Promise<{ ok: true; new_word_count: number; new_estimated_seconds: number }> {
  const { words, seconds } = scriptStats(newText);
  await getDb(parishId).query(
    `UPDATE youth_projects
        SET script_draft = jsonb_set(COALESCE(script_draft, '{}'::jsonb), '{full_text}', to_jsonb($2::text)),
            updated_at = now()
      WHERE id = $1`,
    [projectId, newText],
  );
  return { ok: true, new_word_count: words, new_estimated_seconds: seconds };
}

export async function setProjectStatus(parishId: string, projectId: string, status: YouthProjectStatus): Promise<void> {
  await getDb(parishId).query("UPDATE youth_projects SET status = $2, updated_at = now() WHERE id = $1", [
    projectId,
    status,
  ]);
}

/** Append a corpus passage the teen saved (save_corpus_passage MCP tool). */
export async function saveCorpusPassage(
  parishId: string,
  projectId: string,
  citation: string,
  notes?: string,
): Promise<{ ok: true }> {
  await getDb(parishId).query(
    `UPDATE youth_projects
        SET saved_passages = saved_passages || $2::jsonb, updated_at = now()
      WHERE id = $1`,
    [projectId, JSON.stringify([{ citation, notes: notes ?? null }])],
  );
  return { ok: true };
}
