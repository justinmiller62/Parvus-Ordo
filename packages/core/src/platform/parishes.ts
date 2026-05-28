import { getDb } from "../db/client";

export interface ParishRow {
  id: string;
  name: string;
  slug: string;
}

export interface MinistryRow {
  id: string;
  name: string;
  kind: string | null;
}

/** The active parish (RLS returns only the row matching app.parish_id). */
export async function getParishById(parishId: string): Promise<ParishRow | null> {
  const { rows } = await getDb(parishId).query<ParishRow>("SELECT id, name, slug FROM parishes");
  return rows[0] ?? null;
}

/** Ministries within the active parish. */
export async function getMinistries(parishId: string): Promise<MinistryRow[]> {
  const { rows } = await getDb(parishId).query<MinistryRow>(
    "SELECT id, name, kind FROM ministries ORDER BY name",
  );
  return rows;
}
