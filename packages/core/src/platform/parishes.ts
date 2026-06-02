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
  const { rows } = await getDb(parishId).query<MinistryRow>("SELECT id, name, kind FROM ministries ORDER BY name");
  return rows;
}

export interface DioceseRow {
  id: string;
  name: string;
}

/**
 * Every diocese (the tenancy root). `dioceses` has NO RLS — it sits above the parish tenant —
 * so this is a cross-tenant read on the no-tenant connection, like login_lookup. Used by the
 * super-admin admin plane to populate the "which diocese?" choice when provisioning a parish
 * (RFC-004 §6). Not parish-scoped; never exposed to a tenant surface.
 */
export async function listDioceses(): Promise<DioceseRow[]> {
  const { rows } = await getDb(null).query<DioceseRow>("SELECT id, name FROM dioceses ORDER BY name");
  return rows;
}
