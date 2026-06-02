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

/** The teen who owns a project (its `teen_user_id`), or null if it doesn't exist in
 * this parish. Entry points use this to authorize project-scoped actions, since RLS is
 * parish-level only and cannot tell one teen's project from another's (po-7ge). */
export async function getProjectOwnerId(parishId: string, projectId: string): Promise<string | null> {
  const { rows } = await getDb(parishId).query<{ teen_user_id: string }>(
    "SELECT teen_user_id FROM youth_projects WHERE id = $1",
    [projectId],
  );
  return rows[0]?.teen_user_id ?? null;
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

// ─── Project lifecycle state machine ────────────────────────────────────────
// drafting → ready_to_record → submitted → approved | rejected, with a "reopen"
// edge back to ready_to_record so a recording can be replaced. These legal edges
// are the SINGLE source of truth — call sites use the intent-named wrappers below
// (markProjectReady / submitProject / approveProject / rejectProject / reopenProject)
// instead of writing `status` directly, so an illegal jump (e.g. approving a draft)
// cannot be expressed.
const PROJECT_TRANSITIONS: Record<YouthProjectStatus, readonly YouthProjectStatus[]> = {
  drafting: ["ready_to_record"],
  ready_to_record: ["submitted"],
  submitted: ["approved", "rejected", "ready_to_record"],
  approved: ["ready_to_record"],
  rejected: ["ready_to_record"],
};

/** Is `to` a legal forward transition from `from`? Pure + unit-testable. A same-state
 * edge is intentionally false here; transitionProject treats from===to as a no-op. */
export function canTransitionProject(from: YouthProjectStatus, to: YouthProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

/** Thrown when a status change would violate the lifecycle (e.g. approving a draft). */
export class InvalidProjectTransition extends Error {
  constructor(
    readonly from: YouthProjectStatus,
    readonly to: YouthProjectStatus,
  ) {
    super(`illegal project transition: ${from} → ${to}`);
    this.name = "InvalidProjectTransition";
  }
}

/**
 * Guarded status change: read the current status, enforce the transition table, then
 * update. A same-state change is an idempotent no-op (tolerates double-clicks / repeat
 * uploads). Throws InvalidProjectTransition on an illegal edge, or if the project does
 * not exist. Returns the resulting status. Prefer the intent-named wrappers below.
 */
export async function transitionProject(
  parishId: string,
  projectId: string,
  to: YouthProjectStatus,
): Promise<YouthProjectStatus> {
  const { rows } = await getDb(parishId).query<{ status: YouthProjectStatus }>(
    "SELECT status FROM youth_projects WHERE id = $1",
    [projectId],
  );
  const from = rows[0]?.status;
  if (!from) throw new Error(`project not found: ${projectId}`);
  if (from === to) return from; // idempotent
  if (!canTransitionProject(from, to)) throw new InvalidProjectTransition(from, to);
  await getDb(parishId).query("UPDATE youth_projects SET status = $2, updated_at = now() WHERE id = $1", [
    projectId,
    to,
  ]);
  return to;
}

/** Teen marks the script done and ready to record (drafting → ready_to_record). */
export const markProjectReady = (parishId: string, projectId: string): Promise<YouthProjectStatus> =>
  transitionProject(parishId, projectId, "ready_to_record");

/** A recording was uploaded for review (ready_to_record → submitted). */
export const submitProject = (parishId: string, projectId: string): Promise<YouthProjectStatus> =>
  transitionProject(parishId, projectId, "submitted");

/** Catechist/admin approves a submitted recording (submitted → approved). */
export const approveProject = (parishId: string, projectId: string): Promise<YouthProjectStatus> =>
  transitionProject(parishId, projectId, "approved");

/** Catechist/admin rejects a submitted recording (submitted → rejected). */
export const rejectProject = (parishId: string, projectId: string): Promise<YouthProjectStatus> =>
  transitionProject(parishId, projectId, "rejected");

/** Reopen for re-recording after the recording is deleted (submitted/approved/rejected → ready_to_record). */
export const reopenProject = (parishId: string, projectId: string): Promise<YouthProjectStatus> =>
  transitionProject(parishId, projectId, "ready_to_record");

/**
 * Hard-reset a project to drafting, OUTSIDE the lifecycle guard. Not a product
 * transition — only the dev reset route uses this to recycle a project for testing.
 */
export async function resetProjectToDrafting(parishId: string, projectId: string): Promise<void> {
  await getDb(parishId).query("UPDATE youth_projects SET status = 'drafting', updated_at = now() WHERE id = $1", [
    projectId,
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
