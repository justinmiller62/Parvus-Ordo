import { getDb } from "../../db/client";

// The discussion thread on a Requestable (RFC-005 §4.1). RLS-scoped to the parish; the done
// transition also writes here (the in-app thank-you) — see requestables.ts.

export interface RequestComment {
  id: string;
  authorId: string;
  body: string;
  createdAt: string;
}

/** Add a comment to a request's thread. Returns the new id (null for an empty body). */
export async function addRequestComment(
  parishId: string,
  requestableId: string,
  authorId: string,
  body: string,
): Promise<string | null> {
  const trimmed = body.trim();
  if (!trimmed) return null;
  const { rows } = await getDb(parishId).query<{ id: string }>(
    "INSERT INTO gather_request_comments (parish_id, requestable_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING id",
    [parishId, requestableId, authorId, trimmed],
  );
  return rows[0]!.id;
}

/** A request's thread, oldest first. */
export async function listRequestComments(parishId: string, requestableId: string): Promise<RequestComment[]> {
  const { rows } = await getDb(parishId).query<{
    id: string;
    author_id: string;
    body: string;
    created_at: string;
  }>(
    "SELECT id, author_id, body, created_at::text FROM gather_request_comments WHERE requestable_id = $1 ORDER BY created_at",
    [requestableId],
  );
  return rows.map((r) => ({ id: r.id, authorId: r.author_id, body: r.body, createdAt: r.created_at }));
}
