import { getDb } from "../db/client";

export interface ParishRow {
  id: string;
  name: string;
  slug: string;
}

// Legacy name retained: `ministries` was renamed to `gather_groups` in 0032 (RFC-005 T1). This
// thin reader stays for the existing home/people surfaces; the rich Groups API (type/visibility/
// roster) is the T1-c core primitive (po-05xo). `type` is the renamed `kind` column.
export interface MinistryRow {
  id: string;
  name: string;
  type: string | null;
}

/** The active parish (RLS returns only the row matching app.parish_id). */
export async function getParishById(parishId: string): Promise<ParishRow | null> {
  const { rows } = await getDb(parishId).query<ParishRow>("SELECT id, name, slug FROM parishes");
  return rows[0] ?? null;
}

/** Groups (legacy "ministries") within the active parish — RLS-scoped to app.parish_id. */
export async function getMinistries(parishId: string): Promise<MinistryRow[]> {
  const { rows } = await getDb(parishId).query<MinistryRow>("SELECT id, name, type FROM gather_groups ORDER BY name");
  return rows;
}
