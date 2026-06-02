import { getDb } from "../../db/client";

// The small checklist within a Requestable (RFC-005 §4.1) — KEEP IT LIGHTWEIGHT. RLS-scoped.

export interface RequestSubtask {
  id: string;
  title: string;
  done: boolean;
  position: number;
}

/** Append a subtask (placed after the current last). Returns the new id (null for an empty title). */
export async function addRequestSubtask(
  parishId: string,
  requestableId: string,
  title: string,
): Promise<string | null> {
  const trimmed = title.trim();
  if (!trimmed) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    `INSERT INTO gather_request_subtasks (parish_id, requestable_id, title, position)
     VALUES ($1, $2, $3,
       COALESCE((SELECT max(position) + 1 FROM gather_request_subtasks WHERE requestable_id = $2), 0))
     RETURNING id`,
    [parishId, requestableId, trimmed],
  );
  return rows[0]!.id;
}

/** A request's checklist, in order. */
export async function listRequestSubtasks(parishId: string, requestableId: string): Promise<RequestSubtask[]> {
  const { rows } = await getDb(parishId).query<{ id: string; title: string; done: boolean; position: number }>(
    "SELECT id, title, done, position FROM gather_request_subtasks WHERE requestable_id = $1 ORDER BY position, title",
    [requestableId],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, done: r.done, position: r.position }));
}

/** Check / uncheck a subtask. */
export async function setRequestSubtaskDone(parishId: string, subtaskId: string, done: boolean): Promise<void> {
  await getDb(parishId).query("UPDATE gather_request_subtasks SET done = $2 WHERE id = $1", [subtaskId, done]);
}

/** Remove a subtask. */
export async function deleteRequestSubtask(parishId: string, subtaskId: string): Promise<void> {
  await getDb(parishId).query("DELETE FROM gather_request_subtasks WHERE id = $1", [subtaskId]);
}
